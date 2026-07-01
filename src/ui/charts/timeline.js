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

function balanceDataset(label, pathObj, color) {
  return {
    label,
    data: pathObj.balances.map((b) => Math.max(100000, b)), // clamp for log scale
    _pathObj: pathObj,
    borderColor: color,
    backgroundColor: color + '10',
    borderWidth: 2,
    tension: 0.1,
    fill: false,
    pointBackgroundColor: color + '4D',
    pointBorderWidth: 0,
    pointStyle: (ctx) => {
      if (!ctx.dataIndex || !pathObj.returns) return 'circle';
      return pathObj.returns[ctx.dataIndex - 1] >= 0 ? 'circle' : 'triangle';
    },
    pointRotation: (ctx) => {
      if (!ctx.dataIndex || !pathObj.returns) return 0;
      return pathObj.returns[ctx.dataIndex - 1] < 0 ? 180 : 0;
    },
    pointRadius: (ctx) => {
      if (!ctx.dataIndex || !pathObj.returns) return 3;
      return 2 + Math.abs(pathObj.returns[ctx.dataIndex - 1]) * 10;
    },
  };
}

function withdrawalDataset(label, pathObj, color) {
  return {
    label,
    data: pathObj.withdrawals,
    _pathObj: pathObj,
    borderColor: color,
    backgroundColor: color + '10',
    borderWidth: 2,
    tension: 0.1,
    fill: false,
    pointBackgroundColor: color + '4D',
    pointBorderWidth: 0,
    pointStyle: (ctx) => {
      if (ctx.dataIndex === undefined || !pathObj.returns) return 'circle';
      return pathObj.returns[ctx.dataIndex] >= 0 ? 'circle' : 'triangle';
    },
    pointRotation: (ctx) => {
      if (ctx.dataIndex === undefined || !pathObj.returns) return 0;
      return pathObj.returns[ctx.dataIndex] < 0 ? 180 : 0;
    },
    pointRadius: (ctx) => {
      if (ctx.dataIndex === undefined || !pathObj.returns) return 2;
      return 2 + Math.abs(pathObj.returns[ctx.dataIndex]) * 10;
    },
  };
}

export function drawTimelineCharts(percentiles, numYears) {
  const balanceLabels = Array.from({ length: numYears + 1 }, (_, i) => `Year ${i}`);
  const withdrawalLabels = Array.from({ length: numYears }, (_, i) => `Year ${i + 1}`);

  const balanceCtx = document.getElementById('balanceChart').getContext('2d');
  if (balanceChart) balanceChart.destroy();
  balanceChart = new Chart(balanceCtx, {
    type: 'line',
    data: { labels: balanceLabels, datasets: SERIES.map((s) => balanceDataset(s.label, percentiles[s.key].path, COLORS[s.key])) },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: { y: { type: 'logarithmic', min: 100000, title: { display: true, text: '$000s' }, ticks: { callback: (v) => formatK(v) } } },
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
    data: { labels: withdrawalLabels, datasets: SERIES.map((s) => withdrawalDataset(s.label, percentiles[s.key].path, COLORS[s.key])) },
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
