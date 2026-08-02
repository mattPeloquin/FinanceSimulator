// Pure Plan Snapshot report model — no DOM.
// Builds the structured data the report UI / charts render from a packaged
// run result, the current scenario, and an optional classic-4% comparison.

import { percentileLinear } from './resultPackaging.js';
import { meanYearlyWithdrawals } from './statistics.js';
import { MONEY_SCALE, ALLOCATION_KEYS } from '../state/scenario.js';
import { presetForLevel } from '../state/presets/index.js';

const STOCK_ALLOCATION_KEYS = [
  'usLgGrowthAllocation',
  'usLgValueAllocation',
  'usSmMidAllocation',
  'exUsAllocation',
];
const BOND_CASH_KEYS = ['bondAllocation', 'cashAllocation'];

/** Format dollars as a short $000s string for report sentences (with $ prefix). */
function dollarK(dollars) {
  if (dollars == null || Number.isNaN(dollars)) return '—';
  const k = Math.round(dollars / MONEY_SCALE);
  return `$${k.toLocaleString('en-US')}k`;
}

/**
 * Per-year withdrawal envelope at pLow / P50 / pHigh across all sims.
 * Sorts each year's column independently — overall heatmap rank order is by
 * total metric, not per-year spend, so we must not assume row order.
 *
 * Also returns sorted per-year columns (NaN-stripped, deposits clamped to 0)
 * so the band chart can paint density between low and high without re-sorting.
 */
export function bandPercentileSeries(heatmap, pLow, pHigh) {
  const numYears = heatmap.numYears;
  const span = heatmap.sourceSpan;
  const values = heatmap.sourceValues;
  const plan = heatmap.targetByYear
    ? Array.from(heatmap.targetByYear, (v) => (Number.isFinite(v) ? Math.max(0, v) : 0))
    : new Array(numYears).fill(0);
  // Flat classic 4% schedule (start × 0.04 every year) — drawn on the hero as
  // a light dotted reference line. Same dollar scale as the band values.
  const classic = heatmap.classicByYear
    ? Array.from(heatmap.classicByYear, (v) => (Number.isFinite(v) ? Math.max(0, v) : 0))
    : new Array(numYears).fill(0);

  const years = Array.from({ length: numYears }, (_, i) => i + 1);
  const low = new Array(numYears).fill(NaN);
  const median = new Array(numYears).fill(NaN);
  const high = new Array(numYears).fill(NaN);
  const columns = new Array(numYears);
  // Per-year share of simulations that ended up depleted ($0 withdrawal that
  // year). Computed from the RAW values (before the deposit clamp below) so
  // deposit years — stored as negative withdrawals — are not mistaken for
  // depletion. The hero band chart paints these as red strips at the bottom
  // of each year so the "depleted" legend swatch has something behind it.
  const depletedFraction = new Array(numYears).fill(0);

  for (let year = 0; year < numYears; year++) {
    const col = [];
    let depleted = 0;
    let total = 0;
    for (let row = 0; row < span; row++) {
      const raw = values[row * numYears + year];
      if (Number.isNaN(raw)) continue;
      total++;
      // Exact $0 = portfolio had nothing left to spend that year (depleted).
      if (raw === 0) depleted++;
      // Deposit years appear as negative withdrawals — clamp for the spend band.
      col.push(Math.max(0, raw));
    }
    col.sort((a, b) => a - b);
    columns[year] = Float64Array.from(col);
    if (col.length === 0) continue;
    depletedFraction[year] = total > 0 ? depleted / total : 0;
    low[year] = percentileLinear(col, pLow / 100);
    median[year] = percentileLinear(col, 0.5);
    high[year] = percentileLinear(col, pHigh / 100);
  }

  return {
    years,
    low,
    median,
    high,
    plan,
    classic,
    columns,
    depletedFraction,
    pLow,
    pHigh,
    lowLabel: `P${pLow}`,
    highLabel: `P${pHigh}`,
  };
}

/**
 * Balance fan from packaged P5-increment series. Any multiple of 5 works —
 * no clamping needed because packaging computed P0…P100 in steps of 5.
 */
export function balanceFanSeries(balancePercentiles, pLow, pHigh) {
  if (!balancePercentiles?.levels || !balancePercentiles?.series) {
    return {
      median: [],
      low: [],
      high: [],
      lowLabel: `P${pLow}`,
      highLabel: `P${pHigh}`,
      years: [],
    };
  }
  const { levels, series, numYears } = balancePercentiles;
  const loIdx = levels.indexOf(pLow);
  const midIdx = levels.indexOf(50);
  const hiIdx = levels.indexOf(pHigh);
  const pick = (idx) => (idx >= 0 ? Array.from(series[idx]) : new Array(numYears).fill(NaN));
  return {
    median: pick(midIdx),
    low: pick(loIdx),
    high: pick(hiIdx),
    lowLabel: `P${pLow}`,
    highLabel: `P${pHigh}`,
    years: Array.from({ length: numYears }, (_, i) => i + 1),
  };
}

/**
 * P-low / median / P-high of a per-run series (sorted ascending, linear
 * interpolation). Finite values only — NaN paths are dropped so a depleted
 * run's missing return does not drag the band.
 */
export function seriesPercentileBand(values, pLow, pHigh) {
  const sorted = [];
  if (values) {
    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      if (Number.isFinite(v)) sorted.push(v);
    }
  }
  sorted.sort((a, b) => a - b);
  if (sorted.length === 0) {
    return { low: NaN, median: NaN, high: NaN };
  }
  return {
    low: percentileLinear(sorted, pLow / 100),
    median: percentileLinear(sorted, 0.5),
    high: percentileLinear(sorted, pHigh / 100),
  };
}

/**
 * Deterministic "Plan" column values for the snapshot metric grid.
 * Spending rows use the planned net schedule (what you spend / receive) so they
 * stay on the same after-tax dollar scale as the simulation bands when tax is on.
 * End Balance is the Target Ending Balance from Find Best Plan ($000s on the
 * scenario → dollars here). Avg Return is the break-even / required IRR that
 * funds the planned schedule — the plan's natural return counterpart.
 */
function planMetricValues(result, scenario) {
  const planTotal = result?.plannedWithdrawn;
  const planMean = result?.plannedMeanYearly;

  const targetK = scenario?.goalSeekTargetEndingBalance;
  const targetNum = targetK == null || targetK === '' ? NaN : Number(targetK);
  const planEnd = Number.isFinite(targetNum) ? targetNum * MONEY_SCALE : NaN;

  const planReturn = result?.returnScatter?.requiredIrr;
  return {
    meanYear: Number.isFinite(planMean) ? planMean : NaN,
    total: Number.isFinite(planTotal) ? planTotal : NaN,
    endBalance: planEnd,
    avgReturn: planReturn == null || Number.isNaN(planReturn) ? NaN : planReturn,
  };
}

/**
 * Compact headline bands for the Plan Snapshot verdict card: Mean / Year,
 * Total Withdrawn, End Balance, and Avg Return. Columns are Plan (deterministic
 * schedule) then P-low / median / P-high from the report sliders. When withdrawal
 * tax is active, spending rows use after-tax net spend (same basis as Outcomes).
 */
export function snapshotMetricBands(result, pLow, pHigh, scenario = null) {
  const scatter = result?.returnScatter;
  if (!scatter?.totalWithdrawn || !scatter?.finalBalance || !scatter?.avgReturn) {
    return {
      planLabel: 'Plan',
      lowLabel: `P${pLow}`,
      medianLabel: 'Med',
      highLabel: `P${pHigh}`,
      pLow,
      pHigh,
      rows: [],
    };
  }

  const taxActive = !!result?.withdrawalTaxActive;
  // Net spend when tax is on; otherwise portfolio withdrawals (= net with tax off).
  const spendTotals = taxActive
    ? (scatter.totalNetSpend ?? scatter.totalWithdrawn)
    : scatter.totalWithdrawn;

  const plan = planMetricValues(result, scenario);
  const meanYearly = meanYearlyWithdrawals(spendTotals, scatter.horizonYears);
  const rows = [
    { id: 'meanYear', label: 'Mean / Year', kind: 'dollars', plan: plan.meanYear, ...seriesPercentileBand(meanYearly, pLow, pHigh) },
    { id: 'total', label: 'Total Withdrawn', kind: 'dollars', plan: plan.total, ...seriesPercentileBand(spendTotals, pLow, pHigh) },
    { id: 'endBalance', label: 'End Balance', kind: 'dollars', plan: plan.endBalance, ...seriesPercentileBand(scatter.finalBalance, pLow, pHigh) },
    { id: 'avgReturn', label: 'Avg Return', kind: 'percent', plan: plan.avgReturn, ...seriesPercentileBand(scatter.avgReturn, pLow, pHigh) },
  ];

  return {
    planLabel: 'Plan',
    lowLabel: `P${pLow}`,
    medianLabel: 'Med',
    highLabel: `P${pHigh}`,
    pLow,
    pHigh,
    rows,
  };
}

export function allocationSummary(scenario) {
  let stocks = 0;
  let bondCash = 0;
  for (const key of STOCK_ALLOCATION_KEYS) stocks += Number(scenario[key]) || 0;
  for (const key of BOND_CASH_KEYS) bondCash += Number(scenario[key]) || 0;
  return {
    stocksPct: Math.round(stocks),
    bondCashPct: Math.round(bondCash),
    label: `${Math.round(stocks)}% stocks / ${Math.round(bondCash)}% bonds/cash`,
    sleeves: ALLOCATION_KEYS.map((key) => ({
      key,
      pct: Number(scenario[key]) || 0,
    })),
  };
}

function headerFromScenario(scenario, result) {
  const startDollars = (Number(scenario.startBalance) || 0) * MONEY_SCALE;
  const numYears = Number(scenario.numYears) || result.numYears;
  const plus = Number(scenario.horizonPlusYears) || 0;
  const minus = Number(scenario.horizonMinusYears) || 0;
  const horizonLabel = plus > 0 || minus > 0
    ? `${numYears} yrs (−${minus}/+${plus})`
    : `${numYears} yrs`;
  let presetName = null;
  if (scenario.presetActive) {
    const preset = presetForLevel(scenario.presetLevel);
    presetName = preset?.name ?? null;
  }
  const alloc = allocationSummary(scenario);
  const generated = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
  return {
    presetName,
    startBalance: startDollars,
    startBalanceLabel: dollarK(startDollars),
    horizonLabel,
    numYears,
    numSimulations: result.numSimulations,
    generated,
    allocationLabel: alloc.label,
    stocksPct: alloc.stocksPct,
    bondCashPct: alloc.bondCashPct,
    distMethod: scenario.distMethod || '—',
    // Header keeps only the starting balance and horizon on one line; the
    // preset ("easy mode") tag and allocation label live elsewhere now.
    line1: [dollarK(startDollars) + ' start', horizonLabel].filter(Boolean).join(' · '),
    // Footer carries the generated date + simulation count (moved out of the header).
    footerLine: `generated ${generated} · ${result.numSimulations.toLocaleString('en-US')} simulations`,
  };
}

function buildFourPct(comparison) {
  if (!comparison) return null;
  // Spend bars show mean $/year (spend-only / net), not lifetime median totals.
  const userMeanYearly = comparison.withdrawalTaxActive
    ? (comparison.userMeanYearlyNetSpend ?? comparison.userMeanYearlyWithdrawn ?? 0)
    : (comparison.userMeanYearlyWithdrawn ?? 0);
  const classicMeanYearly = comparison.classicMeanYearlyWithdrawn ?? 0;
  return {
    userSpend: userMeanYearly,
    classicSpend: classicMeanYearly,
    userPrimary: userMeanYearly,
    classicPrimary: classicMeanYearly,
    userSurvival: comparison.userSuccessRate ?? 0,
    classicSurvival: comparison.classicSuccessRate ?? 0,
    userYear1Rate: comparison.userYear1Rate ?? 0,
    classicRate: comparison.classicRate ?? 0.04,
    equivalent: !!comparison.equivalent,
  };
}

function buildPlanBullets(scenario, goalSeekWarning) {
  const bullets = [];
  const strategy = scenario.withdrawalStrategy || 'base';
  if (strategy === 'specific') {
    bullets.push('Withdrawal strategy: specific year-by-year schedule.');
  } else {
    const base = Number(scenario.baseWithdrawal) || 0;
    bullets.push(`Withdrawal strategy: base ${dollarK(base * MONEY_SCALE)}/yr.`);
  }

  if (scenario.enableDynamicAdjustments) {
    bullets.push(
      `Market adjustments on (low ${scenario.dynLowRet}% → ${scenario.dynLowAdj ?? 0}k; `
      + `high ${scenario.dynHighRet}% → ${scenario.dynHighAdj ?? 0}k).`,
    );
  }

  if (scenario.floorBalance != null && scenario.floorBalance > 0) {
    bullets.push(
      `Balance floor at ${dollarK(scenario.floorBalance * MONEY_SCALE)} `
      + `(cut scale ${scenario.floorPenalty ?? 0}%).`,
    );
  }
  if (scenario.ceilingBalance != null && scenario.ceilingBalance > 0) {
    bullets.push(
      `Balance ceiling at ${dollarK(scenario.ceilingBalance * MONEY_SCALE)} `
      + `(boost ${scenario.ceilingBonus ?? 0}%).`,
    );
  }

  const floors = scenario.withdrawalFloors;
  if (Array.isArray(floors) && floors.some((t) => (t?.amount ?? 0) > 0)) {
    const first = floors.find((t) => (t?.amount ?? 0) > 0);
    bullets.push(`Minimum withdrawal tiers on (first floor ${dollarK((first.amount || 0) * MONEY_SCALE)}).`);
  }

  const spendingTiers = scenario.spendingOverTimeTiers;
  if (Array.isArray(spendingTiers) && spendingTiers.some((t) => (t?.changePct ?? 0) !== 0 || (t?.extra ?? 0) !== 0)) {
    bullets.push('Spending-over-time tiers adjust the base schedule.');
  }

  if ((scenario.glideTarget ?? 0) > 0 || (scenario.glideFraction ?? 0) > 0) {
    bullets.push(
      `Glide path toward ${dollarK((scenario.glideTarget || 0) * MONEY_SCALE)} `
      + `(${scenario.glideFraction ?? 0}% fraction).`,
    );
  }

  if (scenario.enableFeesTaxes) {
    const fee = Number(scenario.advisorFeePct) || 0;
    const taxTiers = Array.isArray(scenario.withdrawalTaxTiers)
      ? scenario.withdrawalTaxTiers.length
      : 0;
    const parts = [];
    if (fee > 0) parts.push(`${fee}% advisor/fund fee`);
    if (taxTiers > 0) parts.push(`${taxTiers} withdrawal-tax tier${taxTiers === 1 ? '' : 's'}`);
    if (parts.length) bullets.push(`Fees & taxes: ${parts.join(', ')}.`);
  }

  if (scenario.goalSeekMode && goalSeekWarning) {
    bullets.push(`Find Best Plan warning: ${goalSeekWarning}`);
  }

  return bullets.slice(0, 10);
}

/**
 * Assemble the full Plan Snapshot model for the report UI.
 * @param {object} result - packaged buildRunResult output
 * @param {object} scenario - readScenarioFromDom() shape ($000s currency fields)
 * @param {object|null} fourPercentComparison
 * @param {{ pLow: number, pHigh: number, goalSeekWarning?: string|null }} options
 */
export function buildPlanSnapshot(result, scenario, fourPercentComparison, {
  pLow = 10,
  pHigh = 90,
  goalSeekWarning = null,
} = {}) {
  const header = headerFromScenario(scenario || {}, result);
  const band = result.withdrawalHeatmap
    ? bandPercentileSeries(result.withdrawalHeatmap, pLow, pHigh)
    : null;
  const fan = balanceFanSeries(result.balancePercentiles, pLow, pHigh);
  const depletionRaw = result.depletionByYear || {
    counts: [],
    totalDepleted: 0,
    totalRuns: result.numSimulations || 0,
  };
  const depletion = {
    ...depletionRaw,
    note: depletionRaw.totalDepleted === 0
      ? `No depletions in ${depletionRaw.totalRuns.toLocaleString('en-US')} simulations`
      : null,
  };

  return {
    header,
    footerLine: header.footerLine,
    // Verdict prose was removed; empty array keeps the model shape stable.
    verdict: [],
    // Left-column headline bands (Plan + P-low / median / P-high) on the verdict card.
    metrics: snapshotMetricBands(result, pLow, pHigh, scenario),
    band,
    fan,
    depletion,
    fourPct: buildFourPct(fourPercentComparison),
    planBullets: buildPlanBullets(scenario || {}, goalSeekWarning),
    success: {
      successRate: result.successRate ?? 0,
      onTargetRate: result.withdrawalTargetSuccessRate ?? 0,
      onTargetMeasure: result.onTargetMeasure ?? 'blend',
    },
    // Same Plan Risk Tolerance fraction used for the on-plan rate —
    // the withdrawal band chart uses it as the near-plan color width.
    shortfallTolerance: result.shortfallTolerance ?? 0.05,
    onTargetMeasure: result.onTargetMeasure ?? 'blend',
    allocation: allocationSummary(scenario || {}),
    taxActive: !!result.withdrawalTaxActive,
    pLow,
    pHigh,
  };
}
