// Accumulation projector — deposit + allocation Monte Carlo (real / today's $).
//
// Unlike simulation.js (withdrawal / success-rate engine), this module only
// grows sleeves with contributions, market returns, optional after-tax drag,
// and one-time events. No retirement withdrawals.
//
// Units:
//   • Tier `amount` fields in state/UI are $000s/year (Plan convention).
//   • Engine series and balances are dollars.
//   • Returns and growthPct are decimals inside the year loop (UI uses %).
//   • All dollars are real / purchasing-power constant.

import {
  ALLOCATION_ENGINE_KEYS,
  buildAllocationOverTimeSeries,
  copyAllocation,
  renormalizeAllocation,
  tierMixToDecimal,
} from './allocation.js';
import { createRng, deriveSeed, logNormalMuSigma, applyLogNormalMuSigma } from './rng.js';
import { mean, median, percentileValue, stdDev } from './statistics.js';

/** Sleeve ids used throughout Accumulation state and results. */
export const SLEEVE_IDS = Object.freeze(['ira', 'roth', 'afterTax']);

/** Low / Med / High savings intensity multipliers on contribution amounts. */
export const SAVINGS_SCALES = Object.freeze([
  { id: 'low', label: 'Low', factor: 0.5 },
  { id: 'med', label: 'Med', factor: 1.0 },
  { id: 'high', label: 'High', factor: 1.5 },
]);

/** Coarse simplex step (20%). Ceiling keeps interactive runs from implying a fine optimum. */
export const DEFAULT_WEIGHT_GRID_STEP = 0.2;
export const DEFAULT_WEIGHT_GRID_CEILING = 48;

const LOGNORMAL_ASSET_ORDER = [
  'usLgGrowth',
  'usLgValue',
  'usSmMid',
  'exUs',
  'bond',
  'cash',
  'inflation',
];

const THOUSANDS_TO_DOLLARS = 1000;

// ---- Contribution tiers -----------------------------------------------------

/**
 * Multiply every tier's annual `amount` by `factor` (Low/Med/High savings).
 * Leaves growthPct and years unchanged.
 */
export function scaleContributionTiers(tiers, factor) {
  const f = Number(factor);
  if (!Array.isArray(tiers)) return [];
  if (!Number.isFinite(f)) return tiers.map((t) => ({ ...t }));
  return tiers.map((tier) => ({
    ...tier,
    amount: (Number(tier?.amount) || 0) * f,
  }));
}

/**
 * Expand Plan-style contribution tiers into a per-year dollar series.
 *
 * Each tier: `{ amount ($000s/yr), growthPct, years? }`.
 * Intermediate tiers run for `years`; the last fills the horizon.
 * Within a tier, year 0 uses `amount`; each later year compounds by growthPct.
 */
export function buildContributionSeries(tiers, numYears) {
  const series = new Array(Math.max(0, numYears)).fill(0);
  if (numYears <= 0 || !Array.isArray(tiers) || tiers.length === 0) return series;

  let yearIndex = 0;
  for (let i = 0; i < tiers.length && yearIndex < numYears; i++) {
    const isLast = i === tiers.length - 1;
    const span = isLast
      ? numYears - yearIndex
      : Math.max(0, parseInt(tiers[i].years, 10) || 0);
    // Convert $000s → dollars for the engine.
    let annual = (Number(tiers[i].amount) || 0) * THOUSANDS_TO_DOLLARS;
    const growthRate = (Number(tiers[i].growthPct) || 0) / 100;
    for (let k = 0; k < span && yearIndex < numYears; k++) {
      series[yearIndex++] = annual;
      // Next year inside this tier grows in real purchasing power.
      annual *= 1 + growthRate;
    }
  }
  return series;
}

/** Build per-sleeve contribution series (dollars/year). */
export function buildAllContributionSeries(sleeves, numYears, amountScale = 1) {
  const out = {};
  for (const id of SLEEVE_IDS) {
    const tiers = scaleContributionTiers(sleeves?.[id]?.contributionTiers || [], amountScale);
    out[id] = buildContributionSeries(tiers, numYears);
  }
  return out;
}

// ---- One-time events --------------------------------------------------------

/**
 * Expand signed major-event rows into a per-year dollar series.
 * Each event: `{ amount ($000s), startYear (1-based), years? }`.
 * Positive = deposit; negative = withdrawal / purchase.
 */
export function buildEventSeries(events, numYears) {
  const series = new Array(Math.max(0, numYears)).fill(0);
  if (!Array.isArray(events) || numYears <= 0) return series;
  for (const event of events) {
    const amount = (Number(event?.amount) || 0) * THOUSANDS_TO_DOLLARS;
    const start = Math.max(1, parseInt(event?.startYear, 10) || 1) - 1;
    const spanRaw = event?.years;
    const span = spanRaw === '' || spanRaw == null
      ? 1
      : Math.max(1, parseInt(spanRaw, 10) || 1);
    for (let k = 0; k < span; k++) {
      const j = start + k;
      if (j >= 0 && j < numYears) series[j] += amount;
    }
  }
  return series;
}

// ---- Return sampling (mirrors simulation.js modes, deposit-only consumer) ---

function nextBootstrapIndex(rng, currentIndex, poolLen, blockSize) {
  const restartProb = blockSize > 1 ? 1 / blockSize : 1;
  if (currentIndex < 0 || rng.uniform() < restartProb) {
    return Math.floor(rng.uniform() * poolLen);
  }
  return (currentIndex + 1) % poolLen;
}

function matVec(L, v) {
  const N = v.length;
  const out = new Array(N);
  for (let i = 0; i < N; i++) {
    let sum = 0;
    for (let k = 0; k <= i; k++) sum += L[i][k] * v[k];
    out[i] = sum;
  }
  return out;
}

/**
 * Stateful year-by-year real portfolio return sampler.
 * Mutates `state` (bootstrap cursor / AR(1) z) across years on one path.
 * Exported for Roth Convert and other real-dollar path engines that share
 * the same market sampling contract.
 */
export function sampleRealPortfolioReturn(params, rng, yearAlloc, yearIndex, state) {
  const {
    distMethod,
    logNormal,
    samples,
    scaledHistoricalShocks,
    scaledHistoricalSmoothing,
    blockSize,
    sequenceStart,
  } = params;

  const weights = [
    yearAlloc.usLgGrowth,
    yearAlloc.usLgValue,
    yearAlloc.usSmMid,
    yearAlloc.exUs,
    yearAlloc.bond,
    yearAlloc.cash,
  ];

  let portfolioReturn = 0;
  let inflation;

  if (distMethod === 'lognormal') {
    const eps = new Array(7);
    for (let k = 0; k < 7; k++) eps[k] = rng.normal();
    const c = logNormal?.chol ? matVec(logNormal.chol, eps) : eps;
    const phi = blockSize > 1 ? 1 - 1 / blockSize : 0;
    let z;
    if (!state.lnPrevZ || phi === 0) {
      z = c;
    } else {
      const a = Math.sqrt(1 - phi * phi);
      z = new Array(7);
      for (let k = 0; k < 7; k++) z[k] = phi * state.lnPrevZ[k] + a * c[k];
    }
    state.lnPrevZ = z;
    for (let k = 0; k < 6; k++) {
      const key = LOGNORMAL_ASSET_ORDER[k];
      const { mu, sigma } = logNormalMuSigma(logNormal[key].mean, logNormal[key].stdDev);
      portfolioReturn += applyLogNormalMuSigma(mu, sigma, z[k]) * weights[k];
    }
    const inf = logNormalMuSigma(logNormal.inflation.mean, logNormal.inflation.stdDev);
    inflation = applyLogNormalMuSigma(inf.mu, inf.sigma, z[6]);
  } else if (distMethod === 'scaledHistorical') {
    const shockPool = scaledHistoricalShocks;
    const shockLen = shockPool ? shockPool.length : 0;
    state.bootIndex = nextBootstrapIndex(rng, state.bootIndex, shockLen, blockSize || 1);
    const z = shockPool[state.bootIndex];
    const smoothing = scaledHistoricalSmoothing ?? 0;
    const targets = LOGNORMAL_ASSET_ORDER.map((key) => logNormal[key]);
    for (let k = 0; k < 6; k++) {
      const { mean: m, stdDev: s } = targets[k];
      const jitter = smoothing > 0 ? rng.normal() * smoothing * s : 0;
      portfolioReturn += (m + z[k] * s + jitter) * weights[k];
    }
    const inf = targets[6];
    const infJitter = smoothing > 0 ? rng.normal() * smoothing * inf.stdDev : 0;
    inflation = inf.mean + z[6] * inf.stdDev + infJitter;
  } else {
    const sampleYears = samples?.years || [];
    const sampleLen = sampleYears.length;
    if (sampleLen === 0) {
      return { realReturn: 0, portfolioReturn: 0, inflation: 0 };
    }
    state.bootIndex =
      distMethod === 'historicalSequence'
        ? ((sequenceStart ?? 0) + yearIndex) % sampleLen
        : nextBootstrapIndex(rng, state.bootIndex, sampleLen, blockSize || 1);
    const yearData = sampleYears[state.bootIndex];
    const assetReturns = [
      yearData.us_lg_growth / 100,
      yearData.us_lg_value / 100,
      yearData.us_sm_mid / 100,
      yearData.ex_us / 100,
      yearData.bond / 100,
      yearData.cash / 100,
    ];
    inflation = yearData.inflation / 100;
    for (let k = 0; k < 6; k++) portfolioReturn += assetReturns[k] * weights[k];
  }

  // Convert nominal portfolio growth + inflation into a real (purchasing-power) return.
  const realReturn = (1 + portfolioReturn) / (1 + inflation) - 1;
  return { realReturn, portfolioReturn, inflation };
}

// ---- Path simulation --------------------------------------------------------

/**
 * Simulate one accumulation path.
 * Year order: contribute → grow (real) → after-tax drag on gains → events on after-tax.
 *
 * @returns {{ balancesByYear: number[], ending: object, sleeveBalancesByYear: object }}
 */
export function simulateAccumulationPath(params, rng) {
  const numYears = Math.max(0, params.numYears | 0);
  const dragRate = Math.max(0, Math.min(1, Number(params.afterTaxDragRate) || 0));
  const contributionSeries = params.contributionSeries
    || buildAllContributionSeries(params.sleeves, numYears, params.amountScale ?? 1);
  const eventSeries = params.eventSeries || buildEventSeries(params.events, numYears);
  const allocationSeries = params.allocationSeries
    || buildAllocationOverTimeSeries(
      params.allocationOverTimeTiers || [],
      numYears,
      params.allocation,
      params.allocationKeys,
    );

  const balances = {};
  for (const id of SLEEVE_IDS) {
    balances[id] = Number(params.sleeves?.[id]?.startBalance) || 0;
    // Start balances in state are $000s when coming from UI params builder.
    if (params.balancesInThousands) {
      balances[id] *= THOUSANDS_TO_DOLLARS;
    }
  }
  // Cost basis for the after-tax sleeve (dollars). Grows with contributions / deposits.
  let afterTaxBasis = Number(params.sleeves?.afterTax?.basis) || 0;
  if (params.balancesInThousands) afterTaxBasis *= THOUSANDS_TO_DOLLARS;
  if (afterTaxBasis <= 0) afterTaxBasis = balances.afterTax;

  const balancesByYear = new Array(numYears + 1);
  const sleeveBalancesByYear = {
    ira: new Array(numYears + 1),
    roth: new Array(numYears + 1),
    afterTax: new Array(numYears + 1),
  };
  const total0 = balances.ira + balances.roth + balances.afterTax;
  balancesByYear[0] = total0;
  for (const id of SLEEVE_IDS) sleeveBalancesByYear[id][0] = balances[id];

  const sampleState = { bootIndex: -1, lnPrevZ: null };

  for (let j = 0; j < numYears; j++) {
    // 1) Deposit this year's scheduled contributions into each sleeve.
    for (const id of SLEEVE_IDS) {
      const contrib = contributionSeries[id]?.[j] || 0;
      balances[id] += contrib;
      if (id === 'afterTax' && contrib > 0) afterTaxBasis += contrib;
    }

    // 2) Grow every sleeve by the same real portfolio return for this year.
    const yearAlloc = allocationSeries[j] || params.allocation;
    const { realReturn } = sampleRealPortfolioReturn(params, rng, yearAlloc, j, sampleState);

    for (const id of SLEEVE_IDS) {
      const before = balances[id];
      const afterGrowth = before * (1 + realReturn);
      balances[id] = afterGrowth;

      // 3) After-tax sleeve only: apply a simple drag on that year's gain.
      //    Basis is unchanged by market moves (unrealized), so drag is illustrative.
      if (id === 'afterTax' && dragRate > 0 && realReturn > 0) {
        const gain = afterGrowth - before;
        const drag = gain * dragRate;
        balances.afterTax -= drag;
      }
    }

    // 4) One-time events hit the after-tax sleeve (household cash / purchase).
    const eventAmount = eventSeries[j] || 0;
    if (eventAmount !== 0) {
      balances.afterTax += eventAmount;
      if (eventAmount > 0) afterTaxBasis += eventAmount;
      // Large purchases can push the sleeve negative; clamp at zero for display.
      if (balances.afterTax < 0) {
        afterTaxBasis = Math.max(0, afterTaxBasis + balances.afterTax);
        balances.afterTax = 0;
      }
    }

    const total = balances.ira + balances.roth + balances.afterTax;
    balancesByYear[j + 1] = total;
    for (const id of SLEEVE_IDS) sleeveBalancesByYear[id][j + 1] = balances[id];
  }

  return {
    balancesByYear,
    sleeveBalancesByYear,
    ending: {
      total: balances.ira + balances.roth + balances.afterTax,
      ira: balances.ira,
      roth: balances.roth,
      afterTax: balances.afterTax,
      afterTaxBasis,
    },
  };
}

// ---- Bridge portfolio (SS opportunity-cost of delaying a claim) -------------

/**
 * Simulate one bridge path: start with a portfolio, spend a fixed real annual
 * amount each year until the claim age (or balance hits zero), growing with
 * the shared market sampler between withdrawals.
 *
 * Year order: withdraw bridge spend → grow remaining balance (real return).
 * No Plan withdrawal strategies / floors / guardrails — intentional.
 *
 * @param {object} params - needs distMethod/samples/logNormal/allocation + …
 * @param {number} params.startBalance - real $
 * @param {number} params.bridgeSpend - real $/year spent until claim
 * @param {number} params.numYears - years from "now" until claim (bridge length)
 * @param {object} rng - createRng instance
 * @returns {{ endingBalance: number, depleted: boolean, balancesByYear: number[] }}
 */
export function simulateBridgePath(params, rng) {
  const numYears = Math.max(0, params.numYears | 0);
  const bridgeSpend = Math.max(0, Number(params.bridgeSpend) || 0);
  let balance = Math.max(0, Number(params.startBalance) || 0);
  const allocationSeries = params.allocationSeries
    || buildAllocationOverTimeSeries(
      params.allocationOverTimeTiers || [],
      Math.max(1, numYears),
      renormalizeAllocation(params.allocation),
      params.allocationKeys,
    );
  const state = { bootIndex: -1, lnPrevZ: null };
  const balancesByYear = [balance];
  let depleted = false;

  for (let y = 0; y < numYears; y++) {
    // Spend first (opportunity cost of waiting to claim), then invest what remains.
    balance = Math.max(0, balance - bridgeSpend);
    if (balance <= 1e-9) {
      depleted = true;
      balance = 0;
      balancesByYear.push(0);
      // Still advance sampler state for CRN alignment across strategies.
      const yearAlloc = allocationSeries[Math.min(y, allocationSeries.length - 1)]
        || renormalizeAllocation(params.allocation);
      sampleRealPortfolioReturn(params, rng, yearAlloc, y, state);
      continue;
    }
    const yearAlloc = allocationSeries[Math.min(y, allocationSeries.length - 1)]
      || renormalizeAllocation(params.allocation);
    const { realReturn } = sampleRealPortfolioReturn(params, rng, yearAlloc, y, state);
    balance *= 1 + realReturn;
    balancesByYear.push(balance);
  }

  return { endingBalance: balance, depleted, balancesByYear };
}

/**
 * Monte Carlo over bridge paths. CRN via deriveSeed(base, i).
 */
export function runBridgeMonteCarlo(params, { onProgress, startIndex = 0 } = {}) {
  const numSimulations = Math.max(0, params.numSimulations | 0);
  const numYears = Math.max(0, params.numYears | 0);
  const baseSeed = (params.seed >>> 0) || 0;
  const allocationSeries = buildAllocationOverTimeSeries(
    params.allocationOverTimeTiers || [],
    Math.max(1, numYears),
    renormalizeAllocation(params.allocation),
    params.allocationKeys,
  );
  const pathParams = {
    ...params,
    allocationSeries,
    allocation: renormalizeAllocation(params.allocation),
  };

  const ending = new Float64Array(numSimulations);
  let depletedCount = 0;

  for (let i = 0; i < numSimulations; i++) {
    const rng = createRng(deriveSeed(baseSeed, startIndex + i));
    const path = simulateBridgePath(pathParams, rng);
    ending[i] = path.endingBalance;
    if (path.depleted) depletedCount += 1;
    if (onProgress && (i % 64 === 0 || i === numSimulations - 1)) {
      onProgress((i + 1) / numSimulations);
    }
  }

  const sorted = Float64Array.from(ending);
  sorted.sort();
  const at = (p) => {
    if (sorted.length === 0) return 0;
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))));
    return sorted[idx];
  };

  return {
    numSimulations,
    numYears,
    depletedCount,
    successRate: numSimulations > 0 ? 1 - depletedCount / numSimulations : 0,
    ending: {
      p10: at(0.10),
      p50: at(0.50),
      p90: at(0.90),
      mean: ending.length
        ? Array.from(ending).reduce((s, v) => s + v, 0) / ending.length
        : 0,
    },
  };
}

// ---- Monte Carlo ------------------------------------------------------------

/**
 * Run N accumulation paths with CRN-friendly seeds (`deriveSeed(base, i)`).
 */
export function runAccumulationMonteCarlo(params, { onProgress, startIndex = 0 } = {}) {
  const numSimulations = Math.max(0, params.numSimulations | 0);
  const numYears = Math.max(0, params.numYears | 0);
  const baseSeed = (params.seed >>> 0) || 0;

  // Pre-expand series once so every path shares the same contribution schedule.
  const contributionSeries = buildAllContributionSeries(
    params.sleeves,
    numYears,
    params.amountScale ?? 1,
  );
  const eventSeries = buildEventSeries(params.events, numYears);
  const allocationSeries = params.allocationSeries || buildAllocationOverTimeSeries(
    params.allocationOverTimeTiers || [],
    numYears,
    renormalizeAllocation(params.allocation),
    params.allocationKeys,
  );

  const pathParams = {
    ...params,
    contributionSeries,
    eventSeries,
    allocationSeries,
    allocation: renormalizeAllocation(params.allocation),
  };

  const finalBalance = new Float64Array(numSimulations);
  const allYearsBalances = new Float64Array(numSimulations * (numYears + 1));

  for (let i = 0; i < numSimulations; i++) {
    const globalIndex = startIndex + i;
    const rng = createRng(deriveSeed(baseSeed, globalIndex));
    const path = simulateAccumulationPath(pathParams, rng);
    finalBalance[i] = path.ending.total;
    for (let y = 0; y <= numYears; y++) {
      allYearsBalances[i * (numYears + 1) + y] = path.balancesByYear[y];
    }
    if (onProgress && (i % 64 === 0 || i === numSimulations - 1)) {
      onProgress((i + 1) / numSimulations);
    }
  }

  return {
    baseSeed,
    numSimulations,
    numYears,
    finalBalance,
    allYearsBalances,
  };
}

/**
 * Build percentile cone + ending-balance stats from a Monte Carlo raw pack.
 */
export function summarizeAccumulationPaths(raw) {
  const { numSimulations, numYears, finalBalance, allYearsBalances } = raw;
  const years = [];
  for (let y = 0; y <= numYears; y++) {
    const col = new Float64Array(numSimulations);
    for (let i = 0; i < numSimulations; i++) {
      col[i] = allYearsBalances[i * (numYears + 1) + y];
    }
    years.push({
      year: y,
      p10: percentileValue(col, 0.10),
      p50: percentileValue(col, 0.50),
      p90: percentileValue(col, 0.90),
      mean: mean(col),
    });
  }
  return {
    cone: years,
    ending: {
      p10: percentileValue(finalBalance, 0.10),
      p50: percentileValue(finalBalance, 0.50),
      p90: percentileValue(finalBalance, 0.90),
      mean: mean(finalBalance),
      stdDev: stdDev(finalBalance),
      median: median(finalBalance),
    },
  };
}

export function summarizeAccumulationSweepPoint(raw) {
  const summary = summarizeAccumulationPaths(raw);
  return {
    endingBalance: {
      mean: summary.ending.mean,
      median: summary.ending.median,
      p10: summary.ending.p10,
      p50: summary.ending.p50,
      p90: summary.ending.p90,
      stdDev: summary.ending.stdDev,
    },
  };
}

// ---- Weight grid & tornado helpers ------------------------------------------

/**
 * Enumerate coarse 6-class mixes that sum to 1, stepping by `step`.
 * Stops at `ceiling` points so the UI cannot imply a fine optimum.
 */
export function buildWeightGrid(step = DEFAULT_WEIGHT_GRID_STEP, ceiling = DEFAULT_WEIGHT_GRID_CEILING) {
  const stepN = Math.max(1, Math.round(1 / step));
  const unit = 1 / stepN;
  const points = [];
  const keys = ALLOCATION_ENGINE_KEYS;
  const partial = new Array(keys.length).fill(0);

  function rec(index, remainingUnits) {
    if (points.length >= ceiling) return;
    if (index === keys.length - 1) {
      partial[index] = remainingUnits * unit;
      const mix = {};
      for (let k = 0; k < keys.length; k++) mix[keys[k]] = partial[k];
      points.push(renormalizeAllocation(mix));
      return;
    }
    for (let u = 0; u <= remainingUnits; u++) {
      partial[index] = u * unit;
      rec(index + 1, remainingUnits - u);
      if (points.length >= ceiling) return;
    }
  }

  rec(0, stepN);
  return points;
}

/** One-at-a-time ±delta weight perturbations around a baseline mix (renormalized). */
export function buildWeightTornadoPoints(baseline, delta = 0.1) {
  const base = renormalizeAllocation(baseline);
  const points = [];
  for (const key of ALLOCATION_ENGINE_KEYS) {
    for (const sign of [-1, 1]) {
      const mix = copyAllocation(base);
      mix[key] = Math.max(0, (mix[key] || 0) + sign * delta);
      points.push({
        variableId: key,
        label: key,
        direction: sign < 0 ? 'low' : 'high',
        value: mix[key],
        allocation: renormalizeAllocation(mix),
      });
    }
  }
  return points;
}

/**
 * Convert scenario-% allocation object into engine decimals.
 * Accepts either engine keys or `*Allocation` scenario keys.
 */
export function allocationFromConfig(allocation, allocationKeys) {
  if (!allocation || typeof allocation !== 'object') {
    return renormalizeAllocation({});
  }
  if (allocationKeys && allocationKeys.some((k) => k in allocation)) {
    return renormalizeAllocation(tierMixToDecimal(allocation, allocationKeys));
  }
  return renormalizeAllocation(allocation);
}

export { buildAllocationOverTimeSeries, ALLOCATION_ENGINE_KEYS, copyAllocation, renormalizeAllocation };
