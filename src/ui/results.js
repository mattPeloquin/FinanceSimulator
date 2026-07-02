// Renders the results section: headline metrics, percentile cards, and charts.
import { formatK, formatPercent } from './format.js';
import { drawTimelineCharts } from './charts/timeline.js';
import { drawDistributionChart } from './charts/distribution.js';
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
  el.classList.remove('text-green-600', 'text-red-600', 'text-slate-400', 'dark:text-slate-500');
  if (display === '0') {
    el.textContent = 'on plan';
    el.classList.add('text-slate-400', 'dark:text-slate-500');
  } else if (delta > 0) {
    el.textContent = `+${display} vs plan`;
    el.classList.add('text-green-600');
  } else {
    el.textContent = `${display} vs plan`;
    el.classList.add('text-red-600');
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
  el.classList.remove('text-red-500', 'text-slate-400', 'dark:text-slate-500');
  if (depletedYear !== null) {
    el.textContent = `ran out year ${depletedYear}`;
    el.classList.add('text-red-500');
  } else {
    el.textContent = `year ${numYears}`;
    el.classList.add('text-slate-400', 'dark:text-slate-500');
  }
}

export function renderResults(result, params) {
  setText('successRate', formatPercent(result.successRate, 1));
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
  drawDistributionChart(result.histogram);
  // 3D chart loads its heavy libs lazily; don't block the rest of the render.
  drawSurfaceChart(result.surfacePaths, result.numYears, {
    params,
    seed: result.seed,
    surfaceMeta: result.surfaceMeta,
  }).catch((err) => {
    console.error('3D chart failed to render:', err);
  });
}
