// Renders the results section: headline metrics, percentile cards, and charts.
import { formatK, formatPercent } from './format.js';
import { drawTimelineCharts } from './charts/timeline.js';
import { drawDistributionChart, drawAllYearsDistributionChart, drawIrrDistributionChart } from './charts/distribution.js';
import { drawIrrScatter } from './charts/irrScatter.js';
import { drawSurfaceChart } from './charts/surface3d.js';
import { isMedianYearlyMetric, median, withdrawalMetricLabels } from '../core/statistics.js';

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

function applyMetricLabels(useMedianYearly, horizonVariable) {
  const { primary, secondary } = withdrawalMetricLabels(useMedianYearly);
  setText(
    'medianWithdrawnLabel',
    useMedianYearly ? 'Median Withdrawal / Year' : 'Median Total Withdrawn',
  );
  setText('medianWithdrawnSecondaryLabel', secondary);
  setText(
    'plannedWithdrawnLabel',
    useMedianYearly ? 'Planned Median / Year' : 'Planned Total Withdrawal',
  );
  setText('plannedWithdrawnSecondaryLabel', secondary);
  setText(
    'outcomesDescription',
    useMedianYearly
      ? 'Shows the combined outcomes of the 10th to 60th percentile paths, ranked by median withdrawal per year.'
      : 'Shows the combined outcomes of the 10th to 60th percentile paths, ranked by total withdrawn.',
  );
  const horizonNote = horizonVariable ? ' Horizons vary across runs.' : '';
  const descEl = document.getElementById('outcomesDescription');
  if (descEl && horizonNote) descEl.textContent += horizonNote;

  const deltaTitle = useMedianYearly
    ? 'Difference from the planned median per year'
    : 'Difference from the planned withdrawal total';
  for (const key of PERCENTILE_KEYS) {
    setText(`${key}WdLabel`, primary);
    setText(`${key}WdSecondaryLabel`, secondary);
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

export function renderResults(result, params, { goalSeekWarning } = {}) {
  setGoalSeekWarning(goalSeekWarning ?? null);
  const useMedianYearly = isMedianYearlyMetric(result.withdrawalMetric);
  const plannedBenchmark = result.onPlanBenchmark ?? (useMedianYearly ? result.plannedMedianYearly : result.plannedWithdrawn);
  const medianActual = useMedianYearly ? result.medianYearlyWithdrawn : result.medianWithdrawn;
  const secondaryActual = useMedianYearly ? result.medianWithdrawn : result.medianYearlyWithdrawn;
  const secondaryPlanned = useMedianYearly ? result.plannedWithdrawn : result.plannedMedianYearly;
  const chartYears = result.maxYears ?? result.numYears;
  const tolerancePct = Math.round((result.shortfallTolerance ?? 0.05) * 100);
  const onPlanLabel = document.getElementById('withdrawalTargetSuccessRateLabel');
  if (onPlanLabel) {
    onPlanLabel.textContent = `Success Rate (within ${tolerancePct}% of plan)`;
  }
  const onPlanCard = onPlanLabel?.closest('.rounded-lg');
  if (onPlanCard) {
    onPlanCard.title = useMedianYearly
      ? `Share of runs whose median yearly withdrawal reached at least ${100 - tolerancePct}% of the planned median per year`
      : `Share of runs whose total withdrawn reached at least ${100 - tolerancePct}% of the planned schedule`;
  }

  applyMetricLabels(useMedianYearly, result.horizonVariable);

  setText('successRate', formatPercent(result.successRate));
  setText(
    'withdrawalTargetSuccessRate',
    result.withdrawalTargetSuccessRate == null ? '—' : formatPercent(result.withdrawalTargetSuccessRate),
  );
  setText('medianBalance', formatK(result.medianBalance));
  setText('medianReturn', formatPercent(result.returnSummary.median));
  setText('medianIrr', formatPercent(result.irrSummary.median) || '—');
  setText('medianWithdrawn', formatK(medianActual));
  setSecondaryMetric('medianWithdrawnSecondary', secondaryActual);
  setText('plannedWithdrawn', formatK(plannedBenchmark));
  setSecondaryMetric('plannedWithdrawnSecondary', secondaryPlanned);

  for (const key of PERCENTILE_KEYS) {
    const p = result.percentiles[key];
    const actual = useMedianYearly ? (p.medianYearlyWithdrawal ?? percentileWithdrawal(p.path)) : p.totalWithdrawn;
    const secondary = useMedianYearly ? p.totalWithdrawn : (p.medianYearlyWithdrawal ?? percentileWithdrawal(p.path));
    setText(`${key}Wd`, formatK(actual));
    setSecondaryMetric(`${key}WdSecondary`, secondary);
    setDelta(`${key}Delta`, actual - plannedBenchmark);
    setText(`${key}Bal`, formatK(p.finalBalance));
    setEndYear(`${key}EndYear`, p.path.balances, result.numYears, p.horizonYears);
    setText(`${key}Ret`, formatPercent(p.avgReturn));
    setText(`${key}Irr`, `IRR ${formatPercent(p.irr) || '—'}`);
  }

  drawTimelineCharts(result.percentiles, chartYears);

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
  drawIrrScatter(result.returnScatter, { params, seed: result.seed });

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
