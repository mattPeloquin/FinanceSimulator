// Allocation sparkline mini-charts showing each asset class vs inflation.
import { Chart } from './chartSetup.js';
import { getMiniChartSeries } from '../../core/history.js';

const MINI_CHARTS = [
  { canvasId: 'us-lg-growth-mini-chart', key: 'us_lg_growth', color: '#4338ca', name: 'US Lg Growth' },
  { canvasId: 'us-lg-value-mini-chart', key: 'us_lg_value', color: '#be123c', name: 'US Lg Value' },
  { canvasId: 'us-sm-mid-mini-chart', key: 'us_sm_mid', color: '#0f766e', name: 'US Sm/Mid' },
  { canvasId: 'ex-us-mini-chart', key: 'ex_us', color: '#c2410c', name: 'ex-US' },
  { canvasId: 'bond-mini-chart', key: 'bond', color: '#16a34a', name: 'Bond' },
  { canvasId: 'cash-mini-chart', key: 'cash', color: '#64748b', name: 'Cash' },
];

const instances = {};

function drawMiniChart(canvasId, labels, assetData, inflationData, color, assetName) {
  if (instances[canvasId]) instances[canvasId].destroy();
  const ctx = document.getElementById(canvasId).getContext('2d');
  const zeroLineData = labels.map(() => 0);

  instances[canvasId] = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Zero Line', data: zeroLineData, borderColor: 'rgba(203, 213, 225, 1)', borderWidth: 1, fill: false, pointRadius: 0 },
        { label: 'Inflation', data: inflationData, borderColor: 'rgba(239, 68, 68, 0.5)', borderWidth: 1, fill: false, pointRadius: 0 },
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

// Returns the year array used (so the caller can render axis labels).
export function updateMiniCharts(startYear, endYear) {
  const series = getMiniChartSeries(startYear, endYear);
  for (const cfg of MINI_CHARTS) {
    drawMiniChart(cfg.canvasId, series.years, series[cfg.key], series.inflation, cfg.color, cfg.name);
  }
  return series.years;
}
