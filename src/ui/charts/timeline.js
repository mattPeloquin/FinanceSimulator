// Balance and withdrawal timeline charts across the tracked percentiles.
import { Chart } from './chartSetup.js';
import { formatK } from '../format.js';
import { getChartTheme, chartJsTooltip, percentileColors } from './chartTheme.js';
import { onThemeChange, isDarkMode } from '../theme.js';

function getColors() {
  return percentileColors(isDarkMode());
}
const SERIES = [
  { key: 'p60', label: '60th % (Above Avg)' },
  { key: 'p50', label: '50th % (Median)' },
  { key: 'p40', label: '40th % (Avg)' },
  { key: 'p30', label: '30th % (Below Avg)' },
  { key: 'p20', label: '20th % (Weak)' },
  { key: 'p10', label: '10th % (Cautionary)' },
  { key: 'p5', label: '5th % (Stress)' },
];

let balanceChart = null;
let withdrawalChart = null;
let lastPercentiles = null;
let lastNumYears = 0;

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

function axisScale(theme, extra = {}) {
  return {
    ticks: { color: theme.axisTick, ...extra.ticks },
    title: { display: extra.title?.text != null, color: theme.axisTitle, ...extra.title },
    grid: { color: theme.gridLine, ...extra.grid },
    ...extra,
  };
}

function buildBalanceOptions(logFloor, theme) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      x: axisScale(theme),
      y: {
        type: 'logarithmic',
        min: logFloor,
        ...axisScale(theme, { title: { display: true, text: '$000s' }, ticks: { callback: (v) => formatK(v) } }),
      },
    },
    plugins: {
      legend: { labels: { color: theme.legend } },
      tooltip: {
        ...chartJsTooltip(theme),
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
  };
}

function buildWithdrawalOptions(theme) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      x: axisScale(theme),
      y: axisScale(theme, {
        beginAtZero: true,
        title: { display: true, text: '$000s' },
        ticks: { callback: (v) => formatK(v) },
      }),
    },
    plugins: {
      legend: { labels: { color: theme.legend } },
      tooltip: {
        ...chartJsTooltip(theme),
        callbacks: {
          label: (ctx) => {
            const ds = ctx.dataset;
            const ret = ds._pathObj.returns[ctx.dataIndex];
            return `${ds.label}: ${formatK(ctx.raw)} (Nominal Return: ${(ret * 100).toFixed(1)}%)`;
          },
        },
      },
    },
  };
}

export function drawTimelineCharts(percentiles, numYears) {
  lastPercentiles = percentiles;
  lastNumYears = numYears;

  const balanceLabels = Array.from({ length: numYears + 1 }, (_, i) => `Year ${i}`);
  const withdrawalLabels = Array.from({ length: numYears }, (_, i) => `Year ${i + 1}`);

  const startBalance = percentiles.p50?.path?.balances?.[0] ?? 0;
  const logFloor = Math.max(1000, startBalance / 100);
  const theme = getChartTheme();
  const COLORS = getColors();

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
    options: buildBalanceOptions(logFloor, theme),
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
    options: buildWithdrawalOptions(theme),
  });

  if (import.meta.env.DEV) {
    window.__TEST_HOOKS__.balanceChart = balanceChart;
    window.__TEST_HOOKS__.withdrawalChart = withdrawalChart;
  }
}

onThemeChange(() => {
  if (lastPercentiles) drawTimelineCharts(lastPercentiles, lastNumYears);
});
