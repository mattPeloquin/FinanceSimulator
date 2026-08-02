// Roth conversion planner — Monte Carlo over conversion amount under tax-rate
// uncertainty (real / today's dollars).
//
// Product goal: do not assume conversion is beneficial. Every run includes a
// $0 baseline and compares how much conversion (if any) improves after-tax
// ending wealth when future effective tax rates are noisy.
//
// Units:
//   • All balances, conversions, RMDs, QCD, and taxes are real dollars.
//   • Ladder ceilings are real taxable-income dollars.
//   • Rates are decimals (0.22 = 22%).
//   • Returns are real (purchasing-power) decimals inside the year loop.

import { normalizeTaxLadder } from '../data/taxLadderIllustrative.js';
import { rmdDivisor } from '../data/rmdFactors.js';
import { createRng, deriveSeed } from './rng.js';
import { drawTaxRateShock } from './policyShocks.js';
import { mean } from './statistics.js';
import { PERCENTILE_GRID, percentileVector } from './sensitivity.js';
import {
  sampleRealPortfolioReturn,
  allocationFromConfig,
} from './accumulation.js';
import {
  ALLOCATION_ENGINE_KEYS,
  buildAllocationOverTimeSeries,
} from './allocation.js';
import { buildCashflowSeries } from '../state/cashflowSeries.js';

/** Default conversion-aggression grid ids (always includes zero). */
export const DEFAULT_STRATEGY_IDS = Object.freeze([
  'zero',
  'fill-12',
  'fill-22',
  'fill-24',
  'custom',
]);

/** Display labels for default conversion strategies (Plan picker / tables). */
export const DEFAULT_STRATEGY_LABELS = Object.freeze({
  zero: '$0 (no convert)',
  'fill-12': 'Fill to 12%',
  'fill-22': 'Fill to 22%',
  'fill-24': 'Fill to 24%',
  custom: 'Custom',
});

// ---- Tax ladder helpers -----------------------------------------------------

/**
 * Progressive tax on `taxableIncome` using the rate ladder.
 * @returns {{ tax: number, marginalRate: number }}
 */
export function taxOnIncome(ladder, taxableIncome) {
  const tiers = normalizeTaxLadder(ladder);
  const income = Math.max(0, Number(taxableIncome) || 0);
  if (income <= 0) return { tax: 0, marginalRate: tiers[0]?.rate || 0 };

  let tax = 0;
  let prev = 0;
  let marginalRate = tiers[0].rate;
  for (const tier of tiers) {
    const top = Number.isFinite(tier.ceiling) ? tier.ceiling : income;
    const slice = Math.min(income, top) - prev;
    if (slice > 0) {
      tax += slice * tier.rate;
      marginalRate = tier.rate;
    }
    prev = top;
    if (income <= tier.ceiling) break;
  }
  return { tax, marginalRate };
}

/**
 * How many dollars of conversion can be added before taxable income would
 * exceed `targetCeiling` (the top of the chosen fill band).
 */
export function roomToCeiling(otherTaxableIncome, targetCeiling) {
  const other = Math.max(0, Number(otherTaxableIncome) || 0);
  const ceiling = Number(targetCeiling);
  if (!Number.isFinite(ceiling)) return Infinity;
  return Math.max(0, ceiling - other);
}

/**
 * Find the ladder tier whose label/rate matches a fill target (e.g. 0.22),
 * returning that tier's ceiling.
 */
export function ceilingForRate(ladder, targetRate) {
  const tiers = normalizeTaxLadder(ladder);
  const rate = Number(targetRate);
  const match = tiers.find((t) => Math.abs(t.rate - rate) < 1e-9);
  if (match && Number.isFinite(match.ceiling)) return match.ceiling;
  // Fallback: first tier at or above the target rate.
  const above = tiers.find((t) => t.rate >= rate - 1e-9 && Number.isFinite(t.ceiling));
  return above ? above.ceiling : tiers[tiers.length - 2]?.ceiling ?? 207000;
}

// ---- RMD / QCD --------------------------------------------------------------

/**
 * Required minimum distribution from Traditional for one year.
 * RMD age gate: educational model starts RMDs at age 73.
 */
export function requiredRmd(tradBalance, ownerAge, opts = {}) {
  const age = Number(ownerAge) || 0;
  const bal = Math.max(0, Number(tradBalance) || 0);
  if (bal <= 0 || age < 73) return 0;
  const divisor = rmdDivisor(age, {
    spouseSoleBeneficiary: !!opts.spouseSoleBeneficiary,
  });
  return bal / Math.max(1, divisor);
}

/**
 * Split an RMD into taxable vs QCD-excluded portions.
 * QCD reduces taxable RMD dollar-for-dollar up to the RMD amount (simplified).
 */
export function applyQcd(rmdAmount, qcdAmount) {
  const rmd = Math.max(0, Number(rmdAmount) || 0);
  const qcd = Math.max(0, Math.min(rmd, Number(qcdAmount) || 0));
  return {
    rmd,
    qcd,
    taxableRmd: Math.max(0, rmd - qcd),
  };
}

// ---- Strategy definitions ---------------------------------------------------

/**
 * Build the conversion-aggression grid for one run.
 * Always includes $0. User's fill tier / custom cap appear as `custom`.
 */
export function buildConversionStrategies(input) {
  const ladder = normalizeTaxLadder(input.ladder);
  const fillRate = Number(input.fillTierRate) || 0.22;
  const annualCap = Math.max(0, Number(input.annualConversionCap) || 0);

  const strategies = [
    { id: 'zero', label: '$0 (no convert)', kind: 'zero' },
    {
      id: 'fill-12',
      label: 'Fill to 12%',
      kind: 'fillTier',
      fillCeiling: ceilingForRate(ladder, 0.12),
      fillRate: 0.12,
    },
    {
      id: 'fill-22',
      label: 'Fill to 22%',
      kind: 'fillTier',
      fillCeiling: ceilingForRate(ladder, 0.22),
      fillRate: 0.22,
    },
    {
      id: 'fill-24',
      label: 'Fill to 24%',
      kind: 'fillTier',
      fillCeiling: ceilingForRate(ladder, 0.24),
      fillRate: 0.24,
    },
    {
      id: 'custom',
      label: annualCap > 0
        ? `Custom cap $${Math.round(annualCap / 1000)}k`
        : `Fill to ${Math.round(fillRate * 100)}%`,
      kind: annualCap > 0 ? 'annualCap' : 'fillTier',
      fillCeiling: ceilingForRate(ladder, fillRate),
      fillRate,
      annualCap,
    },
  ];
  return strategies;
}

function conversionAmountForYear(strategy, {
  tradBalance,
  otherTaxableIncome,
  annualCapRemaining,
}) {
  if (!strategy || strategy.kind === 'zero') return 0;
  const available = Math.max(0, Number(tradBalance) || 0);
  if (available <= 0) return 0;

  if (strategy.kind === 'annualCap') {
    const cap = Math.min(
      available,
      Math.max(0, Number(strategy.annualCap) || 0),
      annualCapRemaining,
    );
    return cap;
  }

  // fillTier: convert up to the band ceiling, never past Trad balance.
  const room = roomToCeiling(otherTaxableIncome, strategy.fillCeiling);
  return Math.min(available, room);
}

// ---- Single path ------------------------------------------------------------

/**
 * Simulate one conversion path for one strategy.
 *
 * Year order (real $):
 *   1. Compute RMD (+ optional QCD) from Trad
 *   2. Decide conversion amount from strategy + ladder room
 *   3. Tax conversion + taxable RMD at shocked effective rate
 *   4. Pay tax from taxable (or withhold from conversion)
 *   5. Move net conversion into Roth; take RMD out of Trad
 *   6. Grow Trad / Roth / taxable by real return; taxable applies gain drag
 *
 * @returns path summary + year series for packaging
 */
export function simulateRothPath(params, strategy, pathIndex = 0) {
  const numYears = Math.max(1, Math.min(60, params.numYears | 0));
  const seed = (params.seed >>> 0) || 0;
  const rng = createRng(deriveSeed(seed, pathIndex * 2));

  let trad = Math.max(0, Number(params.tradBalance) || 0);
  let roth = Math.max(0, Number(params.rothBalance) || 0);
  let taxable = Math.max(0, Number(params.taxableBalance) || 0);
  let basis = Math.max(0, Math.min(taxable, Number(params.taxableBasis) || 0));

  let ageA = Math.max(40, Math.min(100, Number(params.ageA) || 60));
  let ageB = params.couple
    ? Math.max(40, Math.min(100, Number(params.ageB) || ageA))
    : null;

  const otherIncome = Math.max(0, Number(params.otherTaxableIncome) || 0);
  const ratePremium = Math.max(0, Math.min(0.3, Number(params.ratePremium) || 0));
  const taxNoiseStd = Math.max(0, Math.min(0.2, Number(params.taxNoiseStd) || 0));
  const taxPayment = params.taxPayment === 'withhold' ? 'withhold' : 'fromTaxable';
  const gainRate = Math.max(0, Math.min(1, Number(params.taxableGainRate) || 0.15));
  const qcdEnabled = !!params.qcdEnabled;
  const qcdAnnual = Math.max(0, Number(params.qcdAnnual) || 0);
  const rmdEnabled = params.rmdEnabled !== false;
  const spouseSole = !!params.spouseSoleBeneficiary && !!params.couple;

  // Portfolio growth is always MC SOR via marketParams (no constant-return mode).

  const allocation = params.allocation
    || allocationFromConfig(params.allocationPct, null);
  const allocationSeries = params.allocationSeries || buildAllocationOverTimeSeries(
    params.allocationOverTimeTiers || [],
    numYears,
    allocation,
  );

  const marketState = {};
  let lifetimeTax = 0;
  let lifetimeConverted = 0;
  let lifetimeQcd = 0;

  const years = new Array(numYears);
  const netWorthByYear = new Float64Array(numYears);
  const tradByYear = new Float64Array(numYears);
  const rothByYear = new Float64Array(numYears);
  const taxByYear = new Float64Array(numYears);
  const convertedByYear = new Float64Array(numYears);

  let sumReturns = 0;

  for (let y = 0; y < numYears; y++) {
    // Owner age for RMD: older spouse when modeling a couple (conservative).
    const ownerAge = ageB != null ? Math.max(ageA, ageB) : ageA;

    // --- RMD ---
    let rmd = 0;
    let qcd = 0;
    let taxableRmd = 0;
    if (rmdEnabled) {
      rmd = requiredRmd(trad, ownerAge, { spouseSoleBeneficiary: spouseSole });
      const split = applyQcd(rmd, qcdEnabled ? qcdAnnual : 0);
      qcd = split.qcd;
      taxableRmd = split.taxableRmd;
      lifetimeQcd += qcd;
    }

    // Take RMD (including QCD portion) out of Trad before conversion.
    const rmdTaken = Math.min(trad, rmd);
    trad -= rmdTaken;
    // QCD leaves the household (charitable); taxable RMD lands in taxable.
    if (taxableRmd > 0) {
      taxable += taxableRmd;
      basis += taxableRmd; // cash basis for the distributed dollars
    }

    // --- Conversion amount ---
    const ladderTax = taxOnIncome(params.ladder, otherIncome + taxableRmd);
    const convert = conversionAmountForYear(strategy, {
      tradBalance: trad,
      otherTaxableIncome: otherIncome + taxableRmd,
      annualCapRemaining: strategy.annualCap ?? Infinity,
    });

    // Shocked effective rate around (marginal + premium).
    const baseRate = Math.min(0.55, ladderTax.marginalRate + ratePremium);
    const effectiveRate = drawTaxRateShock(seed, pathIndex, {
      baseRate,
      noiseStd: taxNoiseStd,
    });

    // Tax on ordinary items this year (conversion + taxable RMD).
    // Educational model: flat shocked effective rate × ordinary dollars,
    // not a full re-walk of the ladder after the shock (keeps CRN stable).
    const ordinary = convert + taxableRmd;
    let taxDue = ordinary * effectiveRate;

    let netToRoth = convert;
    if (convert > 0) {
      if (taxPayment === 'withhold') {
        // Withhold tax from the conversion; Roth receives net-of-tax.
        const withheld = Math.min(convert, taxDue);
        // If conversion tax exceeds convert (shouldn't with rate < 1), clamp.
        taxDue = withheld + taxableRmd * effectiveRate;
        netToRoth = convert - withheld;
        // Tax for taxable-RMD portion still needs an external source if any.
        const rmdTax = taxableRmd * effectiveRate;
        taxable = Math.max(0, taxable - rmdTax);
        // Shrink basis proportionally when paying from taxable.
        if (taxable + rmdTax > 0) {
          const pay = Math.min(rmdTax, taxable + rmdTax);
          basis = Math.max(0, basis * (taxable / Math.max(taxable + pay, 1e-9)));
        }
      } else {
        // Pay full tax from taxable / assumed outside cash.
        const paid = Math.min(taxable, taxDue);
        const shortfall = taxDue - paid;
        taxable -= paid;
        if (paid > 0 && taxable + paid > 0) {
          basis = Math.max(0, basis * (taxable / (taxable + paid)));
        }
        // Shortfall: assume paid from outside (does not reduce Roth).
        void shortfall;
        netToRoth = convert;
      }

      trad -= convert;
      roth += netToRoth;
      lifetimeConverted += convert;
    } else if (taxableRmd > 0) {
      // No conversion — still tax the taxable RMD from taxable cash.
      const rmdTax = taxableRmd * effectiveRate;
      taxDue = rmdTax;
      const paid = Math.min(taxable, rmdTax);
      taxable -= paid;
      if (paid > 0 && taxable + paid > 0) {
        basis = Math.max(0, basis * (taxable / (taxable + paid)));
      }
    } else {
      taxDue = 0;
    }

    lifetimeTax += taxDue;

    // --- Market growth (real) — shared portfolio MC SOR ---
    const yearAlloc = allocationSeries[y] || allocation;
    const sampled = sampleRealPortfolioReturn(
      params.marketParams || params,
      rng,
      yearAlloc,
      y,
      marketState,
    );
    const realReturn = sampled.realReturn;
    sumReturns += realReturn;

    // Grow tax-advantaged sleeves tax-free (real).
    trad = Math.max(0, trad * (1 + realReturn));
    roth = Math.max(0, roth * (1 + realReturn));

    // Taxable: grow, then apply a rough drag on gains (no tax lots).
    if (taxable > 0) {
      const pre = taxable;
      taxable = Math.max(0, taxable * (1 + realReturn));
      const gain = Math.max(0, taxable - pre);
      if (gain > 0 && gainRate > 0) {
        const drag = gain * gainRate;
        taxable -= drag;
        // Basis stays put; economic gain was partially taxed away.
      }
      // Basis does not grow with market in this simplified model.
      basis = Math.min(basis, taxable);
    }

    const netWorth = trad + roth + taxable;
    years[y] = {
      yearIndex: y,
      ageA,
      ageB,
      convert,
      netToRoth,
      rmd: rmdTaken,
      qcd,
      taxDue,
      effectiveRate,
      realReturn,
      trad,
      roth,
      taxable,
      netWorth,
    };
    netWorthByYear[y] = netWorth;
    tradByYear[y] = trad;
    rothByYear[y] = roth;
    taxByYear[y] = taxDue;
    convertedByYear[y] = convert;

    ageA += 1;
    if (ageB != null) ageB += 1;
  }

  const endingWealth = trad + roth + taxable;
  return {
    strategyId: strategy.id,
    endingWealth,
    endingTrad: trad,
    endingRoth: roth,
    endingTaxable: taxable,
    lifetimeTax,
    lifetimeConverted,
    lifetimeQcd,
    avgReturn: sumReturns / numYears,
    years,
    netWorthByYear,
    tradByYear,
    rothByYear,
    taxByYear,
    convertedByYear,
  };
}

// ---- Monte Carlo + packaging ------------------------------------------------

function summarizePerPath(values) {
  if (!values || values.length === 0) {
    return { mean: 0, percentiles: percentileVector([]) };
  }
  return {
    mean: mean(values),
    percentiles: percentileVector(values),
  };
}

function atPercentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.floor(p * (sorted.length - 1))),
  );
  return sorted[idx];
}

/**
 * Build rank×year matrix (rows = rank 0..n-1 by ending wealth ascending,
 * cols = year) collapsed to a transferable Float32Array.
 */
function packRankYearMatrix(paths, seriesKey, numYears) {
  const n = paths.length;
  const order = paths
    .map((p, i) => ({ i, w: p.endingWealth }))
    .sort((a, b) => a.w - b.w);
  const values = new Float32Array(n * numYears);
  const simIndex = new Int32Array(n);
  for (let rank = 0; rank < n; rank++) {
    const src = order[rank].i;
    simIndex[rank] = src;
    const series = paths[src][seriesKey];
    for (let y = 0; y < numYears; y++) {
      values[rank * numYears + y] = series[y] || 0;
    }
  }
  return { values, simIndex, numYears, numSimulations: n };
}

/**
 * Percentile path bundles (P10 / P50 / P90) by ending-wealth rank.
 */
function packPercentilePaths(paths) {
  const n = paths.length;
  if (!n) return {};
  const order = paths
    .map((p, i) => ({ i, w: p.endingWealth }))
    .sort((a, b) => a.w - b.w);

  const pick = (p) => {
    const idx = Math.min(n - 1, Math.max(0, Math.floor(p * (n - 1))));
    const src = paths[order[idx].i];
    return {
      endingWealth: src.endingWealth,
      lifetimeTax: src.lifetimeTax,
      lifetimeConverted: src.lifetimeConverted,
      avgReturn: src.avgReturn,
      netWorthByYear: Array.from(src.netWorthByYear),
      tradByYear: Array.from(src.tradByYear),
      rothByYear: Array.from(src.rothByYear),
      taxByYear: Array.from(src.taxByYear),
      convertedByYear: Array.from(src.convertedByYear),
      // Median-path year table uses the P50 years detail.
      years: src.years.map((row) => ({
        yearIndex: row.yearIndex,
        ageA: row.ageA,
        ageB: row.ageB,
        convert: row.convert,
        rmd: row.rmd,
        qcd: row.qcd,
        taxDue: row.taxDue,
        trad: row.trad,
        roth: row.roth,
        taxable: row.taxable,
        netWorth: row.netWorth,
      })),
    };
  };

  return {
    p10: pick(0.10),
    p50: pick(0.50),
    p90: pick(0.90),
  };
}

/**
 * Run full Roth Convert Monte Carlo across the conversion-aggression grid.
 *
 * @param {object} input - worker payload fields (see buildRothWorkerPayload)
 * @param {{ onProgress?: (fraction: number, stage: string) => void }} [hooks]
 */
export function runRothConversionAnalysis(input, hooks = {}) {
  const onProgress = hooks.onProgress || (() => {});
  const strategies = buildConversionStrategies(input);
  const numSimulations = Math.max(100, Math.min(5000, input.numSimulations || 500));
  const numYears = Math.max(1, Math.min(60, input.numYears | 0));
  const seed = (input.seed >>> 0) || 0;

  const pathParams = {
    ...input,
    seed,
    numYears,
    ladder: normalizeTaxLadder(input.ladder),
  };

  /** @type {Record<string, object>} */
  const byStrategy = {};
  const sweepPoints = [];

  for (let s = 0; s < strategies.length; s++) {
    const strategy = strategies[s];
    onProgress(s / strategies.length, `MC: ${strategy.label}`);

    const paths = new Array(numSimulations);
    const endingWealth = new Float64Array(numSimulations);
    const lifetimeTax = new Float64Array(numSimulations);
    const lifetimeConverted = new Float64Array(numSimulations);
    const avgReturn = new Float64Array(numSimulations);

    for (let i = 0; i < numSimulations; i++) {
      const path = simulateRothPath(pathParams, strategy, i);
      paths[i] = path;
      endingWealth[i] = path.endingWealth;
      lifetimeTax[i] = path.lifetimeTax;
      lifetimeConverted[i] = path.lifetimeConverted;
      avgReturn[i] = path.avgReturn;
    }

    const wealthSorted = Float64Array.from(endingWealth).sort();
    const taxSorted = Float64Array.from(lifetimeTax).sort();

    // MetricBundle-style sweep point (Lab shape, Roth metrics).
    const bundle = {
      rates: {},
      perPath: {
        endingWealth: summarizePerPath(endingWealth),
        lifetimeTax: summarizePerPath(lifetimeTax),
        lifetimeConverted: summarizePerPath(lifetimeConverted),
        avgReturn: summarizePerPath(avgReturn),
      },
      summary: {
        p10: atPercentile(wealthSorted, 0.10),
        p50: atPercentile(wealthSorted, 0.50),
        p90: atPercentile(wealthSorted, 0.90),
        taxP50: atPercentile(taxSorted, 0.50),
      },
    };

    // Outcome vs zero baseline filled after the loop.
    const percentiles = packPercentilePaths(paths);
    const heatmaps = {
      netWorth: packRankYearMatrix(paths, 'netWorthByYear', numYears),
      trad: packRankYearMatrix(paths, 'tradByYear', numYears),
      roth: packRankYearMatrix(paths, 'rothByYear', numYears),
      taxes: packRankYearMatrix(paths, 'taxByYear', numYears),
    };

    // Scatter-ready per-run (cap size for main-thread transfer).
    const scatterCap = Math.min(numSimulations, 500);
    const scatterStep = Math.max(1, Math.floor(numSimulations / scatterCap));
    const scatter = [];
    for (let i = 0; i < numSimulations; i += scatterStep) {
      scatter.push({
        endingWealth: endingWealth[i],
        lifetimeTax: lifetimeTax[i],
        lifetimeConverted: lifetimeConverted[i],
        avgReturn: avgReturn[i],
      });
    }

    byStrategy[strategy.id] = {
      strategy,
      bundle,
      percentiles,
      heatmaps,
      scatter,
      // Keep per-path scalars for baseline comparison (not full year matrices).
      endingWealth: Array.from(endingWealth),
      lifetimeTax: Array.from(lifetimeTax),
    };

    sweepPoints.push({
      kind: 'conversion',
      variableId: 'conversionAggression',
      value: strategy.id,
      label: strategy.label,
      fillCeiling: strategy.fillCeiling ?? 0,
      annualCap: strategy.annualCap ?? 0,
      bundle,
    });
  }

  // Tag each strategy's scatter with beat-baseline outcome using CRN pairs.
  const zeroWealth = byStrategy.zero?.endingWealth || [];
  for (const id of Object.keys(byStrategy)) {
    const entry = byStrategy[id];
    const wealth = entry.endingWealth;
    let beat = 0;
    for (let i = 0; i < wealth.length; i++) {
      if (wealth[i] > (zeroWealth[i] || 0)) beat += 1;
    }
    entry.beatBaselineRate = wealth.length ? beat / wealth.length : 0;
    // Drop bulky per-path arrays from the posted result (scalars stay in scatter).
    delete entry.endingWealth;
    delete entry.lifetimeTax;
  }

  // Response curve: P10/P50/P90 ending wealth vs strategy order.
  const responseCurve = sweepPoints.map((pt) => ({
    id: pt.value,
    label: pt.label,
    p10: pt.bundle.summary.p10,
    p50: pt.bundle.summary.p50,
    p90: pt.bundle.summary.p90,
    taxP50: pt.bundle.summary.taxP50,
    beatBaselineRate: byStrategy[pt.value]?.beatBaselineRate ?? 0,
  }));

  // Best median strategy (may be zero).
  let bestId = 'zero';
  let bestP50 = -Infinity;
  for (const pt of responseCurve) {
    if (pt.p50 > bestP50) {
      bestP50 = pt.p50;
      bestId = pt.id;
    }
  }

  onProgress(1, 'Packaging results');

  const zeroP50 = responseCurve.find((r) => r.id === 'zero')?.p50 ?? 0;

  // Tax paid is household cash outflow (negative). Median path per strategy.
  /** @type {Record<string, number[]>} */
  const taxAnnualByStrategy = {};
  for (const id of Object.keys(byStrategy)) {
    const taxByYear = byStrategy[id]?.percentiles?.p50?.taxByYear || [];
    taxAnnualByStrategy[id] = taxByYear.map((v) => -(Number(v) || 0));
  }
  const cashflowSeries = buildCashflowSeries({
    sourceFeature: 'roth-convert',
    startAge: Number(input.ageA) || 0,
    sessionName: null,
    numYears,
    annualByStrategy: taxAnnualByStrategy,
  });

  return {
    strategies: strategies.map((s) => ({ id: s.id, label: s.label, kind: s.kind })),
    byStrategy,
    sweep: {
      schemaVersion: 1,
      variableId: 'conversionAggression',
      points: sweepPoints,
      percentileGrid: PERCENTILE_GRID,
    },
    responseCurve,
    recommendation: {
      bestStrategyId: bestId,
      bestP50,
      zeroP50,
      convertsHelp: bestId !== 'zero',
    },
    cashflowSeries,
    meta: {
      seed,
      numSimulations,
      numYears,
      returnMode: 'market',
      portfolioSource: input.portfolioSource || 'local',
      taxPayment: input.taxPayment === 'withhold' ? 'withhold' : 'fromTaxable',
      ratePremium: Number(input.ratePremium) || 0,
      taxNoiseStd: Number(input.taxNoiseStd) || 0,
    },
  };
}

export { ALLOCATION_ENGINE_KEYS };
