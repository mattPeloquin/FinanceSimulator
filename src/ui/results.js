// Renders the results section: headline metrics, percentile cards, and charts.
import { formatK, formatPercent } from './format.js';
import { drawTimelineCharts } from './charts/timeline.js';
import { drawDistributionChart, drawAllYearsDistributionChart, drawIrrDistributionChart } from './charts/distribution.js';
import { drawIrrScatter } from './charts/irrScatter.js';
import { drawWithdrawalHeatmap } from './charts/withdrawalHeatmap.js';
import { drawSurfaceChart } from './charts/surface3d.js';
import {
  isMedianYearlyMetric,
  isMeanYearlyMetric,
  isEarlyWeightingActive,
  median,
  withdrawalMetricLabels,
} from '../core/statistics.js';

const PERCENTILE_KEYS = ['p10', 'p20', 'p30', 'p40', 'p50', 'p60'];

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function percentileWithdrawal(path) {
  const withdrawals = path?.withdrawals;
  if (!withdrawals || withdrawals.length === 0) return 0;
  return median(withdrawals);
}

// The two non-primary metrics share one line under an outcome card's main
// value: median stays on the left and total on the right, with mean/yr
// filling whichever slot the primary metric vacates.
function secondaryMetricSlots(metric) {
  if (isMedianYearlyMetric(metric)) return ['meanYearly', 'total'];
  if (isMeanYearlyMetric(metric)) return ['medianYearly', 'total'];
  return ['medianYearly', 'meanYearly'];
}

const METRIC_SHORT_LABELS = {
  total: 'Total Withdrawn',
  medianYearly: 'Median / Year',
  meanYearly: 'Mean / Year',
};

// Show how far a percentile's withdrawals landed from the planned schedule:
// green = withdrew more than planned, red = fell short of the plan.
function setDelta(id, delta) {
  const el = document.getElementById(id);
  if (!el) return;
  const display = formatK(delta); // rounds to $000s; '0' means "no visible difference"
  el.classList.remove('text-theme-success', 'text-theme-danger', 'text-theme-faint');
  if (display === '0') {
    el.textContent = 'on plan';
    el.classList.add('text-theme-faint');
  } else if (delta > 0) {
    el.textContent = `+${display} vs plan`;
    el.classList.add('text-theme-success');
  } else {
    el.textContent = `${display} vs plan`;
    el.classList.add('text-theme-danger');
  }
}

// Show which year the shown End Balance belongs to. Normally that's the last
// year of the horizon, but if the path's money ran out early, show that year
// (in red) instead — e.g. "ran out year 23".
function setEndYear(id, balances, numYears, horizonYears) {
  const el = document.getElementById(id);
  if (!el) return;
  let depletedYear = null;
  for (let year = 1; year < balances.length; year++) {
    if (balances[year] <= 1e-6) {
      depletedYear = year;
      break;
    }
  }
  el.classList.remove('text-theme-danger', 'text-theme-faint');
  if (depletedYear !== null) {
    el.textContent = `ran out year ${depletedYear}`;
    el.classList.add('text-theme-danger');
  } else {
    const endYear = horizonYears ?? numYears;
    el.textContent = `year ${endYear}`;
    el.classList.add('text-theme-faint');
  }
}

function setSecondaryMetric(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = formatK(value);
}

function applyMetricLabels(metric, horizonVariable, weighting = null) {
  const earlyWeighted = isEarlyWeightingActive(weighting);
  const useMedianYearly = !earlyWeighted && isMedianYearlyMetric(metric);
  const useMeanYearly = isMeanYearlyMetric(metric);
  const { primary } = withdrawalMetricLabels(metric, weighting);
  const [secondary1, secondary2] = secondaryMetricSlots(metric);
  setText(
    'medianWithdrawnLabel',
    earlyWeighted
      ? (useMeanYearly ? 'Early-weighted Mean / Year' : 'Early-weighted Spending')
      : useMedianYearly
        ? 'Median Withdrawal / Year'
        : useMeanYearly
          ? 'Mean Withdrawal / Year'
          : 'Median Total Withdrawn',
  );
  setText('medianWithdrawnSecondaryLabel', METRIC_SHORT_LABELS[secondary1]);
  setText('medianWithdrawnSecondary2Label', METRIC_SHORT_LABELS[secondary2]);
  setText(
    'plannedWithdrawnLabel',
    earlyWeighted
      ? (useMeanYearly ? 'Planned Early-weighted Mean / Year' : 'Planned Early-weighted Spending')
      : useMedianYearly
        ? 'Planned Median / Year'
        : useMeanYearly
          ? 'Planned Mean / Year'
          : 'Planned Total Withdrawal',
  );
  setText('plannedWithdrawnSecondaryLabel', METRIC_SHORT_LABELS[secondary1]);
  setText('plannedWithdrawnSecondary2Label', METRIC_SHORT_LABELS[secondary2]);
  setText(
    'outcomesDescription',
    earlyWeighted
      ? 'Shows the combined outcomes of the 10th to 60th percentile paths, ranked by early-weighted spending.'
      : useMedianYearly
        ? 'Shows the combined outcomes of the 10th to 60th percentile paths, ranked by median withdrawal per year.'
        : useMeanYearly
          ? 'Shows the combined outcomes of the 10th to 60th percentile paths, ranked by mean withdrawal per year.'
          : 'Shows the combined outcomes of the 10th to 60th percentile paths, ranked by total withdrawn.',
  );
  const horizonNote = horizonVariable ? ' Horizons vary across runs.' : '';
  const descEl = document.getElementById('outcomesDescription');
  if (descEl && horizonNote) descEl.textContent += horizonNote;

  const deltaTitle = earlyWeighted
    ? 'Difference from the planned early-weighted spending'
    : useMedianYearly
      ? 'Difference from the planned median per year'
      : useMeanYearly
        ? 'Difference from the planned mean per year'
        : 'Difference from the planned withdrawal total';
  for (const key of PERCENTILE_KEYS) {
    setText(`${key}WdLabel`, primary);
    setText(`${key}WdSecondaryLabel`, METRIC_SHORT_LABELS[secondary1]);
    setText(`${key}WdSecondary2Label`, METRIC_SHORT_LABELS[secondary2]);
    const deltaEl = document.getElementById(`${key}Delta`);
    if (deltaEl) deltaEl.title = deltaTitle;
  }
}

function setGoalSeekWarning(message) {
  const banner = document.getElementById('goalSeekWarning');
  const text = document.getElementById('goalSeekWarningMessage');
  if (!banner || !text) return;
  if (message) {
    text.textContent = message;
    banner.classList.remove('hidden');
  } else {
    text.textContent = '';
    banner.classList.add('hidden');
  }
}

function formatRatePct(rate) {
  if (rate == null || Number.isNaN(rate)) return '—';
  return `${(rate * 100).toFixed(1)}%`;
}

/** Dollar amounts for the 4% note ($000s scale, with a leading $). */
function formatDollarK(val) {
  const display = formatK(val);
  if (display === '' || display === '0') return '$0';
  return `$${display}`;
}

/** Signed $000s delta for prose (e.g. +$800 / −$120). */
function formatSignedDollarK(val) {
  const abs = formatDollarK(Math.abs(val));
  if (abs === '$0') return '$0';
  return val > 0 ? `+${abs}` : `−${abs}`;
}

/** Fill the classic 4% note under the summary cards from dual-run metrics. */
function setFourPercentVerdict(comparison) {
  const banner = document.getElementById('fourPercentVerdict');
  const headline = document.getElementById('fourPercentVerdictHeadline');
  const body = document.getElementById('fourPercentVerdictBody');
  if (!banner || !headline || !body) return;

  if (!comparison) {
    headline.textContent = '';
    body.textContent = '';
    banner.classList.add('hidden');
    return;
  }

  banner.classList.remove('hidden');

  const classicSuccess = formatPercent(comparison.classicSuccessRate, 0);
  headline.textContent =
    `Median withdrawn ${formatDollarK(comparison.classicMedianWithdrawn)}  ·  ` +
    `Mean withdrawal ${formatDollarK(comparison.classicMeanYearlyWithdrawn)}/yr  ·  ` +
    `Not depleted ${classicSuccess || '—'}  ·  ` +
    `Median end balance ${formatDollarK(comparison.classicLeftover)}`;

  if (comparison.equivalent) {
    body.textContent =
      'You are already on this flat 4% schedule (no market cuts or boosts). ' +
      'See the dashed path on Average Timelines. Delta unspent $0 vs your plan.';
    return;
  }

  const unspentDelta = comparison.leftoverDelta;
  const unspentFact =
    unspentDelta > 0
      ? `${formatDollarK(unspentDelta)} more left behind than your plan.`
      : unspentDelta < 0
        ? `Delta unspent ${formatSignedDollarK(unspentDelta)} — your plan left more behind than the 4% rule.`
        : 'Delta unspent $0 vs your plan.';

  const totalDelta = comparison.totalWithdrawnDelta ?? comparison.withdrawnDelta;
  const meanDelta = comparison.meanYearlyDelta ?? 0;
  const spendFact =
    totalDelta === 0 && meanDelta === 0
      ? 'Spending matched the rule.'
      : `Spending delta ${formatSignedDollarK(totalDelta)} total ` +
        `(${formatSignedDollarK(meanDelta)}/yr mean) for your plan vs the 4% rule.`;

  const userSuccess = formatPercent(comparison.userSuccessRate, 0);
  const userRate = formatRatePct(comparison.userYear1Rate);

  body.textContent =
    `${spendFact} ` +
    `Survival: your plan ${userSuccess} vs ${classicSuccess}. ` +
    `Your plan starts at ${userRate}; the rule always uses 4.0%. ` +
    `${unspentFact}`;
}

export function renderResults(result, params, { goalSeekWarning, fourPercentComparison, classicResult } = {}) {
  setGoalSeekWarning(goalSeekWarning ?? null);
  setFourPercentVerdict(fourPercentComparison ?? null);
  const metric = result.withdrawalMetric;
  const rankingWeighting = {
    strengthPct: result.earlyWeightStrengthPct ?? 0,
    earlyEmphasisPct: result.earlyWeightEmphasisPct ?? 30,
    lateFloorPct: result.earlyWeightLateFloorPct ?? 40,
  };
  const earlyWeighted = isEarlyWeightingActive(rankingWeighting);
  const useMedianYearly = !earlyWeighted && isMedianYearlyMetric(metric);
  const useMeanYearly = isMeanYearlyMetric(metric);
  const plannedBenchmark = result.onPlanBenchmark
    ?? (useMedianYearly ? result.plannedMedianYearly : useMeanYearly ? result.plannedMeanYearly : result.plannedWithdrawn);
  const medianActual = earlyWeighted
    ? (result.medianEarlyWeightedWithdrawn ?? result.medianWithdrawn)
    : useMedianYearly
      ? result.medianYearlyWithdrawn
      : useMeanYearly
        ? result.meanYearlyWithdrawn
        : result.medianWithdrawn;
  // Same slotting as the outcome cards: the two non-primary metrics share
  // one line, median left of total.
  const actualValues = {
    total: result.medianWithdrawn,
    medianYearly: result.medianYearlyWithdrawn,
    meanYearly: result.meanYearlyWithdrawn,
  };
  const plannedValues = {
    total: result.plannedWithdrawn,
    medianYearly: result.plannedMedianYearly,
    meanYearly: result.plannedMeanYearly,
  };
  const chartYears = result.maxYears ?? result.numYears;
  const tolerancePct = Math.round((result.shortfallTolerance ?? 0.05) * 100);
  const onPlanLabel = document.getElementById('withdrawalTargetSuccessRateLabel');
  if (onPlanLabel) {
    onPlanLabel.textContent = `Success Rate (within ${tolerancePct}% of plan)`;
  }
  const onPlanCard = onPlanLabel?.closest('.rounded-lg');
  if (onPlanCard) {
    onPlanCard.title = earlyWeighted
      ? `Share of runs whose early-weighted spending reached at least ${100 - tolerancePct}% of the early-weighted plan`
      : useMedianYearly
        ? `Share of runs whose median yearly withdrawal reached at least ${100 - tolerancePct}% of the planned median per year`
        : useMeanYearly
          ? `Share of runs whose mean yearly withdrawal reached at least ${100 - tolerancePct}% of the planned mean per year`
          : `Share of runs whose total withdrawn reached at least ${100 - tolerancePct}% of the planned schedule`;
  }

  applyMetricLabels(metric, result.horizonVariable, rankingWeighting);

  // Whole percents only: a tenth of a percent of runs is Monte Carlo noise, not signal.
  setText('successRate', formatPercent(result.successRate, 0));
  setText(
    'withdrawalTargetSuccessRate',
    result.withdrawalTargetSuccessRate == null ? '—' : formatPercent(result.withdrawalTargetSuccessRate, 0),
  );
  setText('medianBalance', formatK(result.medianBalance));
  setText('medianReturn', formatPercent(result.returnSummary.median));
  setText('medianIrr', formatPercent(result.irrSummary.median) || '—');
  const [secondarySlot1, secondarySlot2] = secondaryMetricSlots(metric);
  setText('medianWithdrawn', formatK(medianActual));
  setSecondaryMetric('medianWithdrawnSecondary', actualValues[secondarySlot1]);
  setSecondaryMetric('medianWithdrawnSecondary2', actualValues[secondarySlot2]);
  setText('plannedWithdrawn', formatK(plannedBenchmark));
  setSecondaryMetric('plannedWithdrawnSecondary', plannedValues[secondarySlot1]);
  setSecondaryMetric('plannedWithdrawnSecondary2', plannedValues[secondarySlot2]);
  for (const key of PERCENTILE_KEYS) {
    const p = result.percentiles[key];
    const metricValues = {
      total: p.totalWithdrawn,
      medianYearly: p.medianYearlyWithdrawal ?? percentileWithdrawal(p.path),
      meanYearly: p.horizonYears > 0 ? p.totalWithdrawn / p.horizonYears : 0,
    };
    const actual = earlyWeighted
      ? (p.earlyWeightedWithdrawn ?? p.totalWithdrawn)
      : useMedianYearly
        ? metricValues.medianYearly
        : useMeanYearly
          ? metricValues.meanYearly
          : metricValues.total;
    setText(`${key}Wd`, formatK(actual));
    setSecondaryMetric(`${key}WdSecondary`, metricValues[secondarySlot1]);
    setSecondaryMetric(`${key}WdSecondary2`, metricValues[secondarySlot2]);
    setDelta(`${key}Delta`, actual - plannedBenchmark);
    setText(`${key}Bal`, formatK(p.finalBalance));
    setEndYear(`${key}EndYear`, p.path.balances, result.numYears, p.horizonYears);
    setText(`${key}Ret`, formatPercent(p.avgReturn));
    setText(`${key}Irr`, `IRR ${formatPercent(p.irr) || '—'}`);
  }

  const classicMedianPath = classicResult?.percentiles?.p50?.path ?? null;
  drawTimelineCharts(result.percentiles, chartYears, { classicMedianPath });

  const rs = result.returnSummary;
  setText('returnMean', formatPercent(rs.mean));
  setText('returnMedian', formatPercent(rs.median));
  setText('returnMin', formatPercent(rs.min));
  setText('returnMax', formatPercent(rs.max));
  setText('returnStdDev', formatPercent(rs.stdDev));

  const irs = result.irrSummary;
  setText('returnMeanIrr', formatPercent(irs.mean) || '—');
  setText('returnMedianIrr', formatPercent(irs.median) || '—');
  setText('returnMinIrr', formatPercent(irs.min) || '—');
  setText('returnMaxIrr', formatPercent(irs.max) || '—');
  setText('returnStdDevIrr', formatPercent(irs.stdDev) || '—');

  drawDistributionChart(result.histogram, result.returnSummary);
  drawIrrScatter(result.returnScatter, { params, seed: result.seed, meta: result.surfaceMeta });
  drawWithdrawalHeatmap(result.withdrawalHeatmap, {
    params,
    seed: result.seed,
    outcome: result.returnScatter.outcome,
  });

  const ay = result.allYearsSummary;
  setText('allYearsMean', formatPercent(ay.mean));
  setText('allYearsMedian', formatPercent(ay.median));
  setText('allYearsMin', formatPercent(ay.min));
  setText('allYearsMax', formatPercent(ay.max));
  setText('allYearsStdDev', formatPercent(ay.stdDev));
  drawAllYearsDistributionChart(result.allYearsHistogram, result.allYearsSummary);
  drawIrrDistributionChart(result.irrHistogram, result.irrSummary);

  // 3D chart loads its heavy libs lazily; don't block the rest of the render.
  drawSurfaceChart(result.surfacePaths, chartYears, {
    params,
    seed: result.seed,
    surfaceMeta: result.surfaceMeta,
    shortfallTolerance: result.shortfallTolerance ?? 0.05,
    plannedWithdrawn: result.plannedWithdrawn,
    plannedMedianYearly: result.plannedMedianYearly,
    onPlanBenchmark: plannedBenchmark,
    withdrawalMetric: result.withdrawalMetric ?? 'total',
    horizonVariable: !!result.horizonVariable,
  }).catch((err) => {
    console.error('3D chart failed to render:', err);
  });
}
