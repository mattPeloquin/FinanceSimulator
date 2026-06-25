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

export function renderResults(result) {
  setText('successRate', formatPercent(result.successRate, 1));
  setText('medianBalance', formatK(result.medianBalance));
  setText('medianWithdrawn', formatK(result.medianWithdrawn));

  for (const key of PERCENTILE_KEYS) {
    const p = result.percentiles[key];
    setText(`${key}Wd`, formatK(p.totalWithdrawn));
    setText(`${key}Bal`, formatK(p.finalBalance));
    setText(`${key}Ret`, formatPercent(p.avgReturn));
  }

  drawTimelineCharts(result.percentiles, result.numYears);
  drawDistributionChart(result.histogram);
  // 3D chart loads its heavy libs lazily; don't block the rest of the render.
  drawSurfaceChart(result.surfacePaths, result.numYears).catch((err) => {
    console.error('3D chart failed to render:', err);
  });
}
