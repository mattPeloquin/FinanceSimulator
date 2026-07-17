// Balance and withdrawal timeline charts across the tracked percentiles.
import { Chart } from './chartSetup.js';
import { formatK } from '../format.js';
import { getChartTheme, chartJsTooltip, percentileColors } from './chartTheme.js';
import { onThemeChange, isDarkMode } from '../theme.js';

function getColors() {
  return percentileColors(isDarkMode());
}
const SERIES = [
  { key: 'p65', label: '65th % (Above Avg)' },
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
let lastClassicMedianPath = null;

const CLASSIC_SERIES_LABEL = '4% rule';

// Absolute floor for the log axis (Chart.js cannot plot ≤ 0).
const BALANCE_LOG_HARD_MIN = 1000;

// Log-axis floor near start÷10, snapped down to a 1–2–2.5–5 "nice" dollar
// amount so tick labels stay clean without leaving two empty decades under start.
export function niceBalanceLogFloor(startBalance) {
  if (!(startBalance > 0)) return BALANCE_LOG_HARD_MIN;
  const target = startBalance / 10;
  if (target <= BALANCE_LOG_HARD_MIN) return BALANCE_LOG_HARD_MIN;

  const exp = Math.floor(Math.log10(target));
  const mag = 10 ** exp;
  // Prior decade's 5× lets targets just above a power of 10 step down cleanly
  // (e.g. $110k → $100k rather than stalling at a coarser choice).
  const candidates = [5 * (mag / 10), 1 * mag, 2 * mag, 2.5 * mag, 5 * mag, 10 * mag];
  let nice = BALANCE_LOG_HARD_MIN;
  for (const value of candidates) {
    if (value <= target + 1e-9 && value > nice) nice = value;
  }
  return Math.max(BALANCE_LOG_HARD_MIN, nice);
}

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
    borderWidth: 1,
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
  const titleFont = { weight: 'bold', size: 12, ...extra.title?.font };
  return {
    ticks: { color: theme.axisTick, ...extra.ticks },
    title: {
      display: extra.title?.display ?? extra.title?.text != null,
      color: theme.axisTitle,
      ...extra.title,
      font: titleFont,
    },
    grid: { color: theme.gridLine, ...extra.grid },
    ...extra,
  };
}

function buildBalanceOptions(logFloor, theme) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      x: axisScale(theme, {
        ticks: { display: false },
        grid: { display: false },
        title: { display: false },
      }),
      y: {
        type: 'logarithmic',
        min: logFloor,
        ...axisScale(theme, {
          title: {
            display: true,
            text: 'Portfolio balance ($000s)',
            color: theme.axisName,
          },
          ticks: { callback: (v) => formatK(v) },
        }),
      },
    },
    plugins: {
      legend: {
        position: 'top',
        labels: { color: theme.legend, boxWidth: 14, boxHeight: 2, font: { size: 10 } },
      },
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
        min: 0,
        title: { display: true, text: 'Withdrawals ($000s)', color: theme.axisName },
        ticks: { callback: (v) => formatK(v) },
      }),
    },
    plugins: {
      legend: { display: false },
      tooltip: {
        ...chartJsTooltip(theme),
        callbacks: {
          label: (ctx) => {
            const ds = ctx.dataset;
            const ret = ds._pathObj?.returns?.[ctx.dataIndex];
            if (ret == null) return `${ds.label}: ${formatK(ctx.raw)}`;
            return `${ds.label}: ${formatK(ctx.raw)} (Nominal Return: ${(ret * 100).toFixed(1)}%)`;
          },
        },
      },
    },
  };
}

function classicOverlayDataset(path, color, values, returnOffset) {
  return {
    ...pathDataset(CLASSIC_SERIES_LABEL, path, color, values, returnOffset),
    borderDash: [6, 4],
    borderWidth: 1,
    pointRadius: 0,
    pointHoverRadius: 3,
    order: 0,
  };
}

export function drawTimelineCharts(percentiles, numYears, { classicMedianPath = null } = {}) {
  lastPercentiles = percentiles;
  lastNumYears = numYears;
  lastClassicMedianPath = classicMedianPath;

  const balanceLabels = Array.from({ length: numYears + 1 }, (_, i) => `Year ${i}`);
  const withdrawalLabels = Array.from({ length: numYears }, (_, i) => `Year ${i + 1}`);

  const startBalance = percentiles.p50?.path?.balances?.[0] ?? 0;
  const logFloor = niceBalanceLogFloor(startBalance);
  const theme = getChartTheme();
  const COLORS = getColors();
  const classicColor = theme.planLine;

  const balanceDatasets = SERIES.map((s) => {
    const path = percentiles[s.key].path;
    return pathDataset(s.label, path, COLORS[s.key], path.balances.map((b) => Math.max(logFloor, b)), -1);
  });
  if (classicMedianPath?.balances) {
    balanceDatasets.push(
      classicOverlayDataset(
        classicMedianPath,
        classicColor,
        classicMedianPath.balances.map((b) => Math.max(logFloor, b)),
        -1,
      ),
    );
  }

  const balanceCtx = document.getElementById('balanceChart').getContext('2d');
  if (balanceChart) balanceChart.destroy();
  balanceChart = new Chart(balanceCtx, {
    type: 'line',
    data: {
      labels: balanceLabels,
      datasets: balanceDatasets,
    },
    options: buildBalanceOptions(logFloor, theme),
  });

  // Deposit years are stored as negative withdrawals; this chart only shows
  // outflows, so clamp those years to 0 rather than dipping below the axis.
  const clampWithdrawals = (values) => values.map((v) => Math.max(0, v));
  const withdrawalDatasets = SERIES.map((s) => {
    const path = percentiles[s.key].path;
    return pathDataset(s.label, path, COLORS[s.key], clampWithdrawals(path.withdrawals), 0);
  });
  if (classicMedianPath?.withdrawals) {
    withdrawalDatasets.push(
      classicOverlayDataset(
        classicMedianPath,
        classicColor,
        clampWithdrawals(classicMedianPath.withdrawals),
        0,
      ),
    );
  }

  const withdrawalCtx = document.getElementById('withdrawalChart').getContext('2d');
  if (withdrawalChart) withdrawalChart.destroy();
  withdrawalChart = new Chart(withdrawalCtx, {
    type: 'line',
    data: {
      labels: withdrawalLabels,
      datasets: withdrawalDatasets,
    },
    options: buildWithdrawalOptions(theme),
  });

  if (import.meta.env.DEV) {
    window.__TEST_HOOKS__.balanceChart = balanceChart;
    window.__TEST_HOOKS__.withdrawalChart = withdrawalChart;
  }
}

onThemeChange(() => {
  if (lastPercentiles) {
    drawTimelineCharts(lastPercentiles, lastNumYears, {
      classicMedianPath: lastClassicMedianPath,
    });
  }
});
