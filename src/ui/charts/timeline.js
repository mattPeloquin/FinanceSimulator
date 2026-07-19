// Balance and withdrawal timeline charts across the tracked percentiles.
import { Chart } from './chartSetup.js';
import { formatK } from '../format.js';
import {
  getChartTheme,
  percentileColors,
  sampleRunTooltipOptions,
} from './chartTheme.js';
import { onThemeChange, isDarkMode } from '../theme.js';
import { formatWithdrawnLine } from './withdrawalTooltipFormat.js';

function getColors() {
  return percentileColors(isDarkMode());
}
const SERIES = [
  { key: 'p85', label: '85th % (Strong)' },
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
let balanceLogControlWired = false;

const CLASSIC_SERIES_LABEL = '4% rule';
const BALANCE_LOG_STORAGE_KEY = 'sor:ui-balance-log-scale';
const POINT_RADIUS = 1.5;
const POINT_HOVER_RADIUS = 3;

// Absolute floor for the log axis (Chart.js cannot plot ≤ 0).
const BALANCE_LOG_HARD_MIN = 1000;

/** Read the Balance over time log-scale checkbox (defaults off). */
export function isBalanceLogScaleEnabled() {
  const el = document.getElementById('balanceLogScale');
  return Boolean(el?.checked);
}

function restoreBalanceLogScaleControl() {
  const el = document.getElementById('balanceLogScale');
  if (!el) return;
  try {
    el.checked = localStorage.getItem(BALANCE_LOG_STORAGE_KEY) === '1';
  } catch {
    el.checked = false;
  }
}

function redrawTimelineCharts() {
  if (!lastPercentiles) return;
  drawTimelineCharts(lastPercentiles, lastNumYears, {
    classicMedianPath: lastClassicMedianPath,
  });
}

function resizeTimelineCharts() {
  balanceChart?.resize();
  withdrawalChart?.resize();
}

/** Wire the log-scale checkbox once; redraws when toggled. */
export function setupBalanceLogScaleControl() {
  if (balanceLogControlWired) return;
  const el = document.getElementById('balanceLogScale');
  if (!el) return;
  balanceLogControlWired = true;
  restoreBalanceLogScaleControl();
  el.addEventListener('change', () => {
    try {
      localStorage.setItem(BALANCE_LOG_STORAGE_KEY, el.checked ? '1' : '0');
    } catch { /* ignore quota / private mode */ }
    redrawTimelineCharts();
  });
  // Charts are often first drawn while this <details> is closed; resize when opened
  // so the canvas matches the visible layout (and log toggles paint correctly).
  document.getElementById('details-average-timelines')?.addEventListener('toggle', (ev) => {
    if (ev.target.open) resizeTimelineCharts();
  });
}

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

/**
 * Point details for Average Timelines tooltips.
 * @param {'balance'|'withdrawal'} kind
 */
export function timelinePointDetails(path, dataIndex, kind) {
  if (!path) return null;
  if (kind === 'balance') {
    const bal = path.balances?.[dataIndex];
    if (bal == null || Number.isNaN(bal)) return null;
    if (dataIndex === 0) return { bal, wd: null, unadj: null, ret: null };
    const wdIdx = dataIndex - 1;
    return {
      bal,
      wd: path.withdrawals?.[wdIdx] ?? null,
      unadj: path.unadjustedWithdrawals?.[wdIdx] ?? 0,
      ret: path.returns?.[wdIdx] ?? null,
    };
  }
  const wd = path.withdrawals?.[dataIndex];
  if (wd == null || Number.isNaN(wd)) return null;
  return {
    wd,
    unadj: path.unadjustedWithdrawals?.[dataIndex] ?? 0,
    bal: path.balances?.[dataIndex + 1] ?? null,
    ret: path.returns?.[dataIndex] ?? null,
  };
}

function timelineTooltipCallbacks(kind) {
  return {
    title: (items) => {
      if (!items[0]) return null;
      return `${items[0].dataset.label} · ${items[0].label}`;
    },
    afterTitle: (items) => {
      if (!items[0]) return [];
      const details = timelinePointDetails(items[0].dataset._pathObj, items[0].dataIndex, kind);
      if (!details || details.wd == null) return [];
      return [formatWithdrawnLine(details.wd, details.unadj)];
    },
    label: () => null,
    afterBody: (items) => {
      if (!items[0]) return [];
      const details = timelinePointDetails(items[0].dataset._pathObj, items[0].dataIndex, kind);
      if (!details) return [];
      const lines = [];
      if (details.bal != null && !Number.isNaN(details.bal)) {
        lines.push(`Balance: ${formatK(details.bal)}`);
      }
      if (details.ret != null && !Number.isNaN(details.ret)) {
        lines.push(`Market Return: ${(details.ret * 100).toFixed(1)}%`);
      }
      return lines;
    },
  };
}

function pathDataset(label, pathObj, color, values) {
  return {
    label,
    data: values,
    _pathObj: pathObj,
    borderColor: color,
    backgroundColor: color + '10',
    borderWidth: 1,
    tension: 0.1,
    fill: false,
    pointBackgroundColor: color,
    pointBorderColor: color,
    pointBorderWidth: 0,
    pointStyle: 'circle',
    pointRadius: POINT_RADIUS,
    pointHoverRadius: POINT_HOVER_RADIUS,
  };
}

function fillBalanceLegend(datasets) {
  const el = document.getElementById('balanceChartLegend');
  if (!el) return;
  el.replaceChildren();
  for (const ds of datasets) {
    const item = document.createElement('span');
    item.className = 'inline-flex items-center gap-1 whitespace-nowrap';
    const swatch = document.createElement('span');
    swatch.className = 'inline-block w-3.5 shrink-0';
    swatch.style.height = '2px';
    swatch.style.backgroundColor = ds.borderColor;
    if (Array.isArray(ds.borderDash) && ds.borderDash.length) {
      swatch.style.backgroundImage =
        `repeating-linear-gradient(90deg, ${ds.borderColor} 0 4px, transparent 4px 7px)`;
      swatch.style.backgroundColor = 'transparent';
    }
    item.appendChild(swatch);
    item.appendChild(document.createTextNode(ds.label));
    el.appendChild(item);
  }
}

function axisScale(theme, extra = {}) {
  const { title: titleExtra, ticks: ticksExtra, grid: gridExtra, ...rest } = extra;
  const titleFont = { weight: 'bold', size: 12, ...titleExtra?.font };
  return {
    ...rest,
    ticks: { color: theme.axisTick, ...ticksExtra },
    title: {
      display: titleExtra?.display ?? titleExtra?.text != null,
      color: theme.axisTitle,
      ...titleExtra,
      font: titleFont,
    },
    grid: { color: theme.gridLine, ...gridExtra },
  };
}

function sharedChartChrome(theme, kind) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'nearest', intersect: true },
    plugins: {
      legend: { display: false },
      tooltip: sampleRunTooltipOptions(timelineTooltipCallbacks(kind)),
    },
  };
}

function buildBalanceOptions(useLog, logFloor, theme) {
  const yScale = useLog
    ? axisScale(theme, {
        type: 'logarithmic',
        min: logFloor,
        beginAtZero: false,
        title: {
          display: true,
          text: 'Portfolio balance ($000s)',
          color: theme.axisName,
        },
        ticks: { callback: (v) => formatK(v) },
      })
    : axisScale(theme, {
        beginAtZero: true,
        min: 0,
        title: {
          display: true,
          text: 'Portfolio balance ($000s)',
          color: theme.axisName,
        },
        ticks: { callback: (v) => formatK(v) },
      });

  return {
    ...sharedChartChrome(theme, 'balance'),
    scales: {
      x: axisScale(theme, {
        ticks: { display: false },
        grid: { display: false },
        title: { display: false },
      }),
      y: yScale,
    },
  };
}

function buildWithdrawalOptions(theme) {
  return {
    ...sharedChartChrome(theme, 'withdrawal'),
    scales: {
      x: axisScale(theme),
      y: axisScale(theme, {
        beginAtZero: true,
        min: 0,
        title: { display: true, text: 'Withdrawals ($000s)', color: theme.axisName },
        ticks: { callback: (v) => formatK(v) },
      }),
    },
  };
}

function classicOverlayDataset(path, color, values) {
  return {
    ...pathDataset(CLASSIC_SERIES_LABEL, path, color, values),
    borderDash: [6, 4],
    borderWidth: 1,
    pointRadius: 0,
    pointHoverRadius: POINT_HOVER_RADIUS,
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
  const useLog = isBalanceLogScaleEnabled();
  const logFloor = useLog ? niceBalanceLogFloor(startBalance) : 0;
  const theme = getChartTheme();
  const COLORS = getColors();
  const classicColor = theme.planLine;
  // Log axes cannot plot ≤ 0 or NaN (horizon padding); clamp / drop those points.
  const balanceValues = (balances) => (
    useLog
      ? balances.map((b) => (Number.isFinite(b) ? Math.max(logFloor, b) : null))
      : balances.slice()
  );

  const balanceDatasets = SERIES.map((s) => {
    const path = percentiles[s.key].path;
    return pathDataset(s.label, path, COLORS[s.key], balanceValues(path.balances));
  });
  if (classicMedianPath?.balances) {
    balanceDatasets.push(
      classicOverlayDataset(
        classicMedianPath,
        classicColor,
        balanceValues(classicMedianPath.balances),
      ),
    );
  }
  fillBalanceLegend(balanceDatasets);

  const balanceCtx = document.getElementById('balanceChart').getContext('2d');
  if (balanceChart) balanceChart.destroy();
  balanceChart = new Chart(balanceCtx, {
    type: 'line',
    data: {
      labels: balanceLabels,
      datasets: balanceDatasets,
    },
    options: buildBalanceOptions(useLog, logFloor, theme),
  });

  // Deposit years are stored as negative withdrawals; this chart only shows
  // outflows, so clamp those years to 0 rather than dipping below the axis.
  const clampWithdrawals = (values) => values.map((v) => Math.max(0, v));
  const withdrawalDatasets = SERIES.map((s) => {
    const path = percentiles[s.key].path;
    return pathDataset(s.label, path, COLORS[s.key], clampWithdrawals(path.withdrawals));
  });
  if (classicMedianPath?.withdrawals) {
    withdrawalDatasets.push(
      classicOverlayDataset(
        classicMedianPath,
        classicColor,
        clampWithdrawals(classicMedianPath.withdrawals),
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
