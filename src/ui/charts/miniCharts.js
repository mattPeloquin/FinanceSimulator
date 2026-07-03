// Allocation sparkline mini-charts showing each asset class vs inflation.
import { Chart } from './chartSetup.js';
import { getMiniChartSeries } from '../../core/history.js';
import { getChartTheme, chartJsTooltip } from './chartTheme.js';
import { onThemeChange, isDarkMode, themeRgba, themeTokens } from '../theme.js';

const MINI_CHARTS = [
  { canvasId: 'us-lg-growth-mini-chart', key: 'us_lg_growth', color: themeTokens.chartAssets.us_lg_growth, name: 'US Lg Growth' },
  { canvasId: 'us-lg-value-mini-chart', key: 'us_lg_value', color: themeTokens.chartAssets.us_lg_value, name: 'US Lg Value' },
  { canvasId: 'us-sm-mid-mini-chart', key: 'us_sm_mid', color: themeTokens.chartAssets.us_sm_mid, name: 'US Sm/Mid' },
  { canvasId: 'ex-us-mini-chart', key: 'ex_us', color: themeTokens.chartAssets.ex_us, name: 'ex-US' },
  { canvasId: 'bond-mini-chart', key: 'bond', color: themeTokens.chartAssets.bond, name: 'Bond' },
  { canvasId: 'cash-mini-chart', key: 'cash', color: themeTokens.chartAssets.cash, name: 'Cash' },
];

const instances = {};
let lastStartYear = null;
let lastEndYear = null;
let resizeTimer = null;

function buildMiniChart(canvas, labels, assetData, inflationData, color, assetName) {
  const theme = getChartTheme();
  const zeroLineData = labels.map(() => 0);

  return new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Zero Line', data: zeroLineData, borderColor: theme.zeroLine, borderWidth: 1, fill: false, pointRadius: 0 },
        {
          label: 'Inflation',
          data: inflationData,
          borderColor: themeRgba('status.danger', isDarkMode() ? 'dark' : 'light', 0.5),
          borderWidth: 1,
          fill: false,
          pointRadius: 0,
        },
        { label: assetName, data: assetData, borderColor: color, borderWidth: 1.5, fill: false, tension: 0.1, pointRadius: 0 },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      scales: { x: { display: false }, y: { display: false } },
      plugins: {
        legend: { display: false },
        tooltip: {
          ...chartJsTooltip(theme),
          intersect: false,
          mode: 'index',
          filter: (ti) => ti.datasetIndex !== 0,
          callbacks: {
            title: (c) => `Year: ${c[0].label}`,
            label: (c) =>
              c.datasetIndex === 1
                ? `Inflation: ${c.raw.toFixed(2)}%`
                : `${assetName} Return: ${c.raw.toFixed(2)}%`,
          },
        },
      },
      interaction: { mode: 'nearest', axis: 'x', intersect: false },
    },
  });
}

function drawMiniChart(canvasId, labels, assetData, inflationData, color, assetName) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  if (canvas.clientWidth === 0 || canvas.clientHeight === 0) {
    requestAnimationFrame(() => {
      drawMiniChart(canvasId, labels, assetData, inflationData, color, assetName);
    });
    return;
  }

  if (instances[canvasId]) instances[canvasId].destroy();
  instances[canvasId] = buildMiniChart(canvas, labels, assetData, inflationData, color, assetName);
}

export function resizeMiniCharts() {
  for (const cfg of MINI_CHARTS) {
    const canvas = document.getElementById(cfg.canvasId);
    Chart.getChart(canvas)?.resize();
  }
}

function scheduleResize() {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(resizeMiniCharts, 100);
}

function setupResizeHandling() {
  window.addEventListener('resize', scheduleResize);

  const allocationSection = document.getElementById('us-lg-growth-mini-chart')?.closest('.space-y-1');
  if (allocationSection && typeof ResizeObserver !== 'undefined') {
    const observer = new ResizeObserver(scheduleResize);
    observer.observe(allocationSection);
  }
}

export function updateMiniCharts(startYear, endYear) {
  lastStartYear = startYear;
  lastEndYear = endYear;
  const series = getMiniChartSeries(startYear, endYear);
  for (const cfg of MINI_CHARTS) {
    drawMiniChart(cfg.canvasId, series.years, series[cfg.key], series.inflation, cfg.color, cfg.name);
  }
  return series.years;
}

onThemeChange(() => {
  if (lastStartYear != null && lastEndYear != null) {
    updateMiniCharts(lastStartYear, lastEndYear);
  }
});

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupResizeHandling);
  } else {
    setupResizeHandling();
  }
}
