// Balance and withdrawal timeline charts across the tracked percentiles.
import { Chart } from './chartSetup.js';
import { formatK } from '../format.js';

const COLORS = { p60: '#0d9488', p50: '#16a34a', p40: '#84cc16', p30: '#eab308', p20: '#f97316', p10: '#dc2626' };
const SERIES = [
  { key: 'p60', label: '60th % (Above Avg)' },
  { key: 'p50', label: '50th % (Median)' },
  { key: 'p40', label: '40th % (Avg)' },
  { key: 'p30', label: '30th % (Below Avg)' },
  { key: 'p20', label: '20th % (Weak)' },
  { key: 'p10', label: '10th % (Cautionary)' },
];

let balanceChart = null;
let withdrawalChart = null;

// Build one line-chart dataset for a percentile path. `values` are the numbers
// actually plotted; `returnOffset` maps a point index to the year's market
// return that produced it (balances include a Year-0 point with no return, so
// they use -1; withdrawals start at Year 1, so they use 0).
function pathDataset(label, pathObj, color, values, returnOffset) {
  const returnAt = (dataIndex) => {
    if (!pathObj.returns || dataIndex + returnOffset < 0) return null;
    return pathObj.returns[dataIndex + returnOffset];
  };
  return {
    label,
    data: values,
    _pathObj: pathObj,
    borderColor: color,
    backgroundColor: color + '10',
    borderWidth: 2,
    tension: 0.1,
    fill: false,
    pointBackgroundColor: color + '4D',
    pointBorderWidth: 0,
    // Point markers encode that year's market: circle = up year, upside-down
    // triangle = down year, sized by how large the move was.
    pointStyle: (ctx) => {
      const r = returnAt(ctx.dataIndex);
      return r == null || r >= 0 ? 'circle' : 'triangle';
    },
    pointRotation: (ctx) => {
      const r = returnAt(ctx.dataIndex);
      return r != null && r < 0 ? 180 : 0;
    },
    pointRadius: (ctx) => {
      const r = returnAt(ctx.dataIndex);
      return r == null ? 3 : 2 + Math.abs(r) * 10;
    },
  };
}

export function drawTimelineCharts(percentiles, numYears) {
  const balanceLabels = Array.from({ length: numYears + 1 }, (_, i) => `Year ${i}`);
  const withdrawalLabels = Array.from({ length: numYears }, (_, i) => `Year ${i + 1}`);

  // A logarithmic axis cannot display zero, so depleted paths are clamped to a
  // small floor. Derive it from the starting balance (1%, at least $1k) so the
  // chart works for small portfolios instead of assuming ~$10M scale.
  const startBalance = percentiles.p50?.path?.balances?.[0] ?? 0;
  const logFloor = Math.max(1000, startBalance / 100);

  const balanceCtx = document.getElementById('balanceChart').getContext('2d');
  if (balanceChart) balanceChart.destroy();
  balanceChart = new Chart(balanceCtx, {
    type: 'line',
    data: {
      labels: balanceLabels,
      datasets: SERIES.map((s) => {
        const path = percentiles[s.key].path;
        return pathDataset(s.label, path, COLORS[s.key], path.balances.map((b) => Math.max(logFloor, b)), -1);
      }),
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: { y: { type: 'logarithmic', min: logFloor, title: { display: true, text: '$000s' }, ticks: { callback: (v) => formatK(v) } } },
      plugins: {
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const ds = ctx.dataset;
              const actual = ds._pathObj.balances[ctx.dataIndex];
              if (ctx.dataIndex === 0) return `${ds.label}: ${formatK(actual)}`;
              const ret = ds._pathObj.returns[ctx.dataIndex - 1];
              return `${ds.label}: ${formatK(actual)} (Nominal Return: ${(ret * 100).toFixed(1)}%)`;
            },
          },
        },
      },
    },
  });

  const withdrawalCtx = document.getElementById('withdrawalChart').getContext('2d');
  if (withdrawalChart) withdrawalChart.destroy();
  withdrawalChart = new Chart(withdrawalCtx, {
    type: 'line',
    data: {
      labels: withdrawalLabels,
      datasets: SERIES.map((s) => {
        const path = percentiles[s.key].path;
        return pathDataset(s.label, path, COLORS[s.key], path.withdrawals, 0);
      }),
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: { y: { beginAtZero: true, title: { display: true, text: '$000s' }, ticks: { callback: (v) => formatK(v) } } },
      plugins: {
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const ds = ctx.dataset;
              const ret = ds._pathObj.returns[ctx.dataIndex];
              return `${ds.label}: ${formatK(ctx.raw)} (Nominal Return: ${(ret * 100).toFixed(1)}%)`;
            },
          },
        },
      },
    },
  });

  if (import.meta.env.DEV) {
    window.__TEST_HOOKS__.balanceChart = balanceChart;
    window.__TEST_HOOKS__.withdrawalChart = withdrawalChart;
  }
}
