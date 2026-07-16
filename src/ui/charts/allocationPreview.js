// Live stacked-bar preview of Adjust allocation over time: each bar is one
// simulation year, stacked by asset category. Uses the same interpolated
// series the Monte Carlo engine consumes so the chart matches the run.
import { Chart } from './chartSetup.js';
import {
  ALLOCATION_KEYS,
  ALLOCATION_LABELS,
  ALLOCATION_CHART_KEYS,
  normalizeAllocationOverTimeTiers,
  readAllocationOverTimeTiersFromDom,
  readStaticAllocationFromDom,
} from '../../state/scenario.js';
import {
  buildAllocationOverTimeSeries,
  allocationKeyToEngine,
} from '../../core/allocation.js';
import { getChartTheme, chartJsTooltip } from './chartTheme.js';
import { onThemeChange, themeTokens } from '../theme.js';

let previewChart = null;
let pendingFrame = null;

function isPreviewHostVisible() {
  const details = document.getElementById('details-allocation-over-time');
  return details?.open;
}

function readPreviewInputs() {
  const numYears = parseInt(document.getElementById('numYears')?.value, 10) || 40;
  const tiers = normalizeAllocationOverTimeTiers(readAllocationOverTimeTiersFromDom());
  const staticPct = readStaticAllocationFromDom();
  const startAllocation = {};
  for (const key of ALLOCATION_KEYS) {
    startAllocation[allocationKeyToEngine(key)] = (staticPct[key] || 0) / 100;
  }
  return { numYears, tiers, startAllocation };
}

function buildChart(canvas, series) {
  const theme = getChartTheme();
  const labels = series.map((_, j) => j + 1);
  // Chart.js stacks the first dataset at the bottom. Reverse so the UI's
  // first category (US Lg Growth) sits at the top of each bar, matching the
  // Asset Allocation list order top → bottom.
  const stackOrder = [...ALLOCATION_KEYS].reverse();
  const datasets = stackOrder.map((scenarioKey) => {
    const engineKey = allocationKeyToEngine(scenarioKey);
    const chartKey = ALLOCATION_CHART_KEYS[scenarioKey];
    const color = themeTokens.chartAssets[chartKey];
    return {
      label: ALLOCATION_LABELS[scenarioKey] || scenarioKey,
      data: series.map((mix) => (mix[engineKey] || 0) * 100),
      backgroundColor: color,
      borderWidth: 0,
      stack: 'alloc',
    };
  });

  return new Chart(canvas.getContext('2d'), {
    type: 'bar',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: {
          stacked: true,
          title: { display: true, text: 'Year', font: { size: 9 }, color: theme.axisTitle },
          ticks: { maxTicksLimit: 8, font: { size: 9 }, color: theme.axisTick },
          grid: { display: false },
        },
        y: {
          stacked: true,
          min: 0,
          max: 100,
          ticks: {
            maxTicksLimit: 5,
            font: { size: 9 },
            color: theme.axisTick,
            callback: (v) => `${v}%`,
          },
          grid: { color: theme.gridLine },
        },
      },
      plugins: {
        legend: {
          display: true,
          position: 'bottom',
          // Datasets are reversed for stacking; flip the legend back so it
          // still reads Growth → … → Cash like the form.
          reverse: true,
          labels: { boxWidth: 8, font: { size: 9 }, color: theme.axisTick, padding: 6 },
        },
        tooltip: {
          ...chartJsTooltip(theme),
          itemSort: (a, b) => b.datasetIndex - a.datasetIndex,
          callbacks: {
            title: (items) => (items.length ? `Year ${items[0].label}` : ''),
            label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y.toFixed(1)}%`,
          },
        },
      },
    },
  });
}

function renderPreview() {
  const wrapper = document.getElementById('allocation-over-time-preview');
  const canvas = document.getElementById('allocationOverTimePreviewChart');
  if (!wrapper || !canvas) return;

  const { numYears, tiers, startAllocation } = readPreviewInputs();
  if (numYears <= 0) {
    if (previewChart) {
      previewChart.destroy();
      previewChart = null;
    }
    return;
  }

  if (!isPreviewHostVisible()) return;

  if (canvas.clientWidth === 0 || canvas.clientHeight === 0) {
    pendingFrame = requestAnimationFrame(renderPreview);
    return;
  }

  const fallbackMix = readStaticAllocationFromDom();
  const series = buildAllocationOverTimeSeries(
    normalizeAllocationOverTimeTiers(tiers, fallbackMix),
    numYears,
    startAllocation,
    ALLOCATION_KEYS,
  );

  if (previewChart) {
    previewChart.destroy();
    previewChart = null;
  }
  previewChart = buildChart(canvas, series);
}

export function destroyAllocationPreviewChart() {
  if (pendingFrame) {
    cancelAnimationFrame(pendingFrame);
    pendingFrame = null;
  }
  if (previewChart) {
    previewChart.destroy();
    previewChart = null;
  }
}

export function syncAllocationPreview() {
  if (pendingFrame) cancelAnimationFrame(pendingFrame);
  pendingFrame = requestAnimationFrame(() => {
    pendingFrame = requestAnimationFrame(() => {
      pendingFrame = null;
      renderPreview();
    });
  });
}

onThemeChange(() => {
  if (isPreviewHostVisible()) renderPreview();
});
