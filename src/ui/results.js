// Renders the results section: headline metrics, percentile cards, and charts.
import { formatK, formatPercent } from './format.js';
import { drawTimelineCharts } from './charts/timeline.js';
import { drawDistributionChart, drawAllYearsDistributionChart } from './charts/distribution.js';
import { drawSurfaceChart } from './charts/surface3d.js';

const PERCENTILE_KEYS = ['p10', 'p20', 'p30', 'p40', 'p50', 'p60'];

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

// Show how far a percentile's total withdrawn landed from the planned schedule:
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
function setEndYear(id, balances, numYears) {
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
    el.textContent = `year ${numYears}`;
    el.classList.add('text-theme-faint');
  }
}

// Show (or hide) the "Goal Seek Result" card summarizing which levers were
// solved and what success rate the search achieved during its (reduced-
// simulation) search — separate from the headline metrics below, which come
// from the full-fidelity confirmation run.
function renderGoalSeekSummary(summary) {
  const card = document.getElementById('goalSeekSummaryCard');
  const text = document.getElementById('goalSeekSummaryText');
  if (!card || !text) return;

  if (!summary) {
    card.classList.add('hidden');
    return;
  }

  const formatBalanceOverride = (dollars) => (dollars == null ? 'off' : formatK(dollars));
  const lines = [`Base withdrawal: <strong>${formatK(summary.baseWithdrawal)}</strong> (000s)`];

  if (summary.goGoYears !== undefined) {
    lines.push(`Bonus years: <strong>${summary.goGoYears}</strong>`);
  }
  if (summary.marketAdjustments) {
    const { low, med, high } = summary.marketAdjustments;
    lines.push(
      `Market adjustments (000s) — Low: <strong>${formatK(low)}</strong>, Expected: <strong>${formatK(med)}</strong>, High: <strong>${formatK(high)}</strong>`,
    );
  }
  if (summary.marketBalanceOverrides) {
    const { low, med, high } = summary.marketBalanceOverrides;
    lines.push(
      `Market balance overrides (000s) — Low: <strong>${formatBalanceOverride(low)}</strong>, Expected: <strong>${formatBalanceOverride(med)}</strong>, High: <strong>${formatBalanceOverride(high)}</strong>`,
    );
  }
  if (summary.balanceAdjustment) {
    const { floorBalance, ceilingBalance, floorPenalty, ceilingBonus } = summary.balanceAdjustment;
    lines.push(
      `Balance adjustment — Floor: <strong>${formatBalanceOverride(floorBalance || null)}</strong>, Ceiling: <strong>${formatBalanceOverride(ceilingBalance)}</strong>, Max Cut: <strong>${formatPercent(floorPenalty, 0)}</strong>, Boost Rate: <strong>${formatPercent(ceilingBonus, 0)}</strong>`,
    );
  }
  lines.push(`Success rate found during search: <strong>${formatPercent(summary.achievedSuccessRate, 1)}</strong>`);
  if (summary.roundsUsed > 1) {
    lines.push(`Converged after <strong>${summary.roundsUsed}</strong> rounds of tuning.`);
  }

  text.innerHTML = lines.join('<br>');
  card.classList.remove('hidden');
}

export function renderResults(result, params, goalSeekSummary) {
  renderGoalSeekSummary(goalSeekSummary);

  setText('successRate', formatPercent(result.successRate, 1));
  setText(
    'withdrawalTargetSuccessRate',
    result.withdrawalTargetSuccessRate == null ? '—' : formatPercent(result.withdrawalTargetSuccessRate, 1),
  );
  setText('medianBalance', formatK(result.medianBalance));
  setText('medianWithdrawn', formatK(result.medianWithdrawn));
  setText('plannedWithdrawn', formatK(result.plannedWithdrawn));

  for (const key of PERCENTILE_KEYS) {
    const p = result.percentiles[key];
    setText(`${key}Wd`, formatK(p.totalWithdrawn));
    setDelta(`${key}Delta`, p.totalWithdrawn - result.plannedWithdrawn);
    setText(`${key}Bal`, formatK(p.finalBalance));
    setEndYear(`${key}EndYear`, p.path.balances, result.numYears);
    setText(`${key}Ret`, formatPercent(p.avgReturn));
  }

  drawTimelineCharts(result.percentiles, result.numYears);

  const rs = result.returnSummary;
  setText('returnMean', formatPercent(rs.mean));
  setText('returnMedian', formatPercent(rs.median));
  setText('returnMin', formatPercent(rs.min));
  setText('returnMax', formatPercent(rs.max));
  setText('returnStdDev', formatPercent(rs.stdDev));

  drawDistributionChart(result.histogram, result.returnSummary);

  const ay = result.allYearsSummary;
  setText('allYearsMean', formatPercent(ay.mean));
  setText('allYearsMedian', formatPercent(ay.median));
  setText('allYearsMin', formatPercent(ay.min));
  setText('allYearsMax', formatPercent(ay.max));
  setText('allYearsStdDev', formatPercent(ay.stdDev));
  drawAllYearsDistributionChart(result.allYearsHistogram, result.allYearsSummary);

  // 3D chart loads its heavy libs lazily; don't block the rest of the render.
  drawSurfaceChart(result.surfacePaths, result.numYears, {
    params,
    seed: result.seed,
    surfaceMeta: result.surfaceMeta,
  }).catch((err) => {
    console.error('3D chart failed to render:', err);
  });
}
