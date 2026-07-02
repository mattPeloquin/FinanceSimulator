// 3D topography column chart. ECharts + ECharts-GL are heavy, so they are
// lazy-loaded (dynamic import) the first time this chart is drawn.
import { formatK } from '../format.js';
import { Chart } from './chartSetup.js';
import {
  rankForOverviewColumn,
  buildDrilldownPaths,
  percentileLabelForRank,
} from '../../core/surfaceDrilldown.js';
import { getChartTheme } from './chartTheme.js';
import { onThemeChange } from '../theme.js';

let echartsModule = null;
let chartInstance = null;

const BOX_WIDTH = 280;
const BOX_DEPTH = 120;
const BOX_HEIGHT = 60;

// Initial view — orbit angles, zoom, and pan pivot (maps to grid3D.viewControl).
// Adjust in the browser, then copy from __SOR_SURFACE__.getOption().grid3D[0].viewControl.
const CAMERA_ALPHA = 15; // vertical tilt (°); higher = more top-down
const CAMERA_BETA = 220; // horizontal orbit (°); spins the scene left/right
const CAMERA_DISTANCE = 220; // zoom; lower = closer to the grid
const PAN_CENTER_X = -20; // pan pivot X (scene units)
const PAN_CENTER_Y = -30; // pan pivot Y; negative shifts plot upward on screen
const PAN_CENTER_Z = 0; // pan pivot Z (scene units)

const RETURN_MIN = -0.5;
const RETURN_MAX = 0.5;

// Z axis is capped at this multiple of the starting portfolio value.
const Z_CAP_MULTIPLE = 2;

const DIM_OPACITY = 0.02; // opacity of non-focused columns
const POP_FRACTION = 0; // how far the focused row floats up (fraction of zCap)

const FLOAT_PANEL_WIDTH = 221;
const FLOAT_PANEL_CHART_HEIGHT = 102;
const FLOAT_THEME = {
  ok: { line: '#16a34a', fill: 'rgba(22,163,74,0.14)', point: '#16a34a' },
  depleted: { line: '#ea580c', fill: 'rgba(249,115,22,0.2)', point: '#f97316' },
};

const CLICK_WAIT_MS = 400; // window to distinguish single vs double click (ECharts GL bar3D has no reliable dblclick)

const OVERVIEW_TITLE = 'Explore specific paths';
const OVERVIEW_DESCRIPTION =
  'A 3D plot of representative paths from the 10th to 60th percentiles. Column height represents portfolio balance, color reflects the <strong>annual market return</strong> for that year (Red = crash, Green = boom). <strong>Drag</strong> to rotate, <strong>scroll</strong> to zoom, <strong>right-drag</strong> to pan. <strong>Single-click</strong> a column to pin that simulation and mouse over each year for values; click the column again or empty space to release. <strong>Double-click</strong> a column to explore ~200 nearby simulations; double-click again to return.';

// Interaction + layout state shared with the event handlers (one chart instance).
const surfaceState = {
  columns: [], // columns[x] = array of data points for that simulation
  depletedCols: [], // parallel to columns: true when the path runs out of money
  barWidth: 1,
  barDepth: 1,
  zCap: 0,
  numYears: 0,
  pinnedCol: null,
  largeChartCol: null,
  columnClickHandled: false,
  eventsBound: false,
  viewMode: 'overview',
  overviewPaths: [],
  simParams: null,
  seed: 0,
  surfaceMeta: null,
  drilldownCenterRank: null,
  drilldownLo: null,
  drilldownHi: null,
  lastContext: null,
};

async function loadEcharts() {
  if (echartsModule) return echartsModule;
  const echarts = await import('echarts');
  await import('echarts-gl');
  echartsModule = echarts;
  return echarts;
}

function lerpColor(a, b, t) {
  const r = Math.round(a[0] + (b[0] - a[0]) * t);
  const g = Math.round(a[1] + (b[1] - a[1]) * t);
  const bl = Math.round(a[2] + (b[2] - a[2]) * t);
  return `rgb(${r}, ${g}, ${bl})`;
}

// Map a nominal return to the red/green ramp color at that value.
function colorForReturn(v) {
  const clamped = Math.max(RETURN_MIN, Math.min(RETURN_MAX, v));
  const deepRed = [127, 29, 29];
  const lightRed = [248, 113, 113];
  const lightGreen = [134, 239, 172];
  const deepGreen = [21, 128, 61];

  if (clamped < 0) {
    const t = (clamped - RETURN_MIN) / (0 - RETURN_MIN);
    return lerpColor(deepRed, lightRed, t);
  }
  return lerpColor(lightGreen, deepGreen, clamped / RETURN_MAX);
}

// Depleted paths: warning orange with a narrow return span so variance stays vivid.
const DEPLETED_RETURN_SPAN = 0.12; // ±12% maps to the full orange ramp

function colorForDepletedReturn(v) {
  const clamped = Math.max(-DEPLETED_RETURN_SPAN, Math.min(DEPLETED_RETURN_SPAN, v));
  const t = (clamped + DEPLETED_RETURN_SPAN) / (2 * DEPLETED_RETURN_SPAN);
  const lowBright = [234, 88, 12];   // orange-600
  const highBright = [253, 186, 116]; // orange-300
  return lerpColor(lowBright, highBright, t);
}

// Continuous red -> green ramp for the visualMap legend scale.
function buildReturnColorRamp(samples = 363) {
  const colors = [];
  for (let i = 0; i < samples; i++) {
    const v = RETURN_MIN + ((RETURN_MAX - RETURN_MIN) * i) / (samples - 1);
    colors.push(colorForReturn(v));
  }
  return colors;
}

function pathDepleted(balances) {
  return balances.some((b, i) => i > 0 && b <= 0);
}

// Columns are sampled evenly from the 10th to the 60th percentile, so the first
// column is P10 and the LAST column is P60 (hence numCols - 1 in the divisor).
function percentileLabel(col, numCols) {
  const fraction = numCols > 1 ? col / (numCols - 1) : 0;
  return 'P' + Math.round(10 + fraction * 50);
}

const DRILLDOWN_PERCENTILE_DECIMALS = 2;

function columnPercentileLabel(col, numCols) {
  if (surfaceState.viewMode === 'drilldown' && surfaceState.surfaceMeta) {
    const { drilldownLo, drilldownHi } = surfaceState;
    const n = surfaceState.surfaceMeta.numSimulations;
    const rank = numCols > 1
      ? drilldownLo + (col / (numCols - 1)) * (drilldownHi - drilldownLo)
      : drilldownLo;
    return percentileLabelForRank(rank, n, DRILLDOWN_PERCENTILE_DECIMALS);
  }
  return percentileLabel(col, numCols);
}

function updateSurfaceChrome({ mode, centerRank, lo, hi, n }) {
  const titleEl = document.getElementById('surfaceChartTitle');
  const descEl = document.getElementById('surfaceChartDescription');
  if (!titleEl || !descEl) return;

  if (mode === 'drilldown' && surfaceState.surfaceMeta) {
    const centerLabel = percentileLabelForRank(centerRank, n);
    const loLabel = percentileLabelForRank(lo, n, DRILLDOWN_PERCENTILE_DECIMALS);
    const hiLabel = percentileLabelForRank(hi, n, DRILLDOWN_PERCENTILE_DECIMALS);
    titleEl.textContent = `Explore paths near ${centerLabel}`;
    descEl.innerHTML =
      `Showing ~200 simulations with total-withdrawn ranks between ${loLabel} and ${hiLabel} (centered on ${centerLabel}). ` +
      'Column height represents portfolio balance; color reflects each year\'s market return. ' +
      '<strong>Single-click</strong> a column to pin it; <strong>double-click</strong> any column to return to the P10–P60 overview.';
    return;
  }

  titleEl.textContent = OVERVIEW_TITLE;
  descEl.innerHTML = OVERVIEW_DESCRIPTION;
}

function buildXAxisConfig(numCols) {
  const isDrilldown = surfaceState.viewMode === 'drilldown';
  const n = surfaceState.surfaceMeta?.numSimulations;
  const centerLabel = isDrilldown && n != null
    ? percentileLabelForRank(surfaceState.drilldownCenterRank, n)
    : null;

  return axisConfig(isDrilldown ? `Percentile (near ${centerLabel})` : 'Percentile', {
    min: 0,
    max: numCols - 1,
    splitNumber: 5,
    axisLabel: {
      show: true,
      fontSize: 9,
      margin: 4,
      formatter: (v) => columnPercentileLabel(v, numCols),
    },
  });
}

function makeBarPoint(x, y, height, ret, balance, withdrawal, totalWithdrawn, avgReturn, depleted, unadjusted) {
  const value = [x, y, height, ret, balance, withdrawal, totalWithdrawn, avgReturn, unadjusted];
  if (depleted) {
    return { value, itemStyle: { color: colorForDepletedReturn(ret) } };
  }
  return value;
}

function pointValue(p) {
  return Array.isArray(p) ? p : p.value;
}

function zAxisLabel(formatter) {
  const theme = getChartTheme();
  return { show: true, color: theme.axisLabel, fontSize: 9, margin: 4, formatter };
}

function applySurfaceTheme() {
  if (!chartInstance || !surfaceState.columns.length) return;
  const theme = getChartTheme();
  const numCols = surfaceState.columns.length;
  chartInstance.setOption({
    xAxis3D: buildXAxisConfig(numCols),
    yAxis3D: axisConfig('Year', { min: 0, max: surfaceState.numYears, splitNumber: 5, inverse: true }),
    zAxis3D: {
      min: 0,
      max: surfaceState.zCap,
      ...axisConfig('Balance'),
      axisLabel: zAxisLabel((v) => formatK(v)),
    },
    grid3D: { environment: theme.sceneBg },
  });
  if (floatPanel) {
    floatPanel.style.background = theme.floatPanelBg;
    floatPanel.style.borderLeftColor = theme.floatPanelBorder;
    floatPanel.style.borderBottomColor = theme.floatPanelBorder;
  }
  if (floatTitle) floatTitle.style.color = theme.floatTitleText;
  if (floatChart) {
    Object.assign(floatChart.options, floatChartOptions());
    floatChart.update('none');
  }
  if (largeChart) {
    Object.assign(largeChart.options.scales.x.ticks, { color: theme.axisTick });
    Object.assign(largeChart.options.scales.y.ticks, { color: theme.axisTick, callback: (v) => formatK(v) });
    Object.assign(largeChart.options.scales.y.title, { color: theme.axisTitle });
    largeChart.update('none');
  }
  if (largeBalanceChart) {
    Object.assign(largeBalanceChart.options, balanceBarOptions());
    largeBalanceChart.update('none');
  }
  if (surfaceState.pinnedCol != null) showFloatWithdrawal(surfaceState.pinnedCol);
}

function axisConfig(name, extra = {}) {
  const theme = getChartTheme();
  return {
    type: 'value',
    name,
    nameTextStyle: { color: theme.axisName, fontSize: 11 },
    axisLabel: { show: true, color: theme.axisLabel, fontSize: 9, margin: 4, ...extra.axisLabel },
    axisTick: { show: false },
    axisLine: { lineStyle: { color: theme.axisLine } },
    splitLine: { show: false },
    ...extra,
  };
}

// ---- Floating 2D withdrawals chart (shown while a row is pinned) ------------

let floatPanel = null;
let floatTitle = null;
let floatCanvas = null;
let floatChart = null;

function ensureFloatPanel() {
  if (floatPanel) return;
  const container = document.getElementById('surfaceChart');
  if (!container) return;
  container.style.position = 'relative';
  const theme = getChartTheme();

  floatPanel = document.createElement('div');
  floatPanel.style.cssText =
    `position:absolute;top:0;right:0;width:${FLOAT_PANEL_WIDTH}px;` +
    `background:${theme.floatPanelBg};border-left:1px solid ${theme.floatPanelBorder};border-bottom:1px solid ${theme.floatPanelBorder};` +
    'border-radius:0 0 0 6px;box-shadow:0 2px 6px rgba(0,0,0,0.08);' +
    'padding:5px 6px;z-index:10;pointer-events:auto;display:none;';

  floatTitle = document.createElement('div');
  floatTitle.style.cssText = `font-size:10px;font-weight:600;color:${theme.floatTitleText};margin-bottom:3px;line-height:1.2;`;

  const wrap = document.createElement('div');
  wrap.style.cssText = `height:${FLOAT_PANEL_CHART_HEIGHT}px;`;
  floatCanvas = document.createElement('canvas');
  wrap.appendChild(floatCanvas);

  floatPanel.appendChild(floatTitle);
  floatPanel.appendChild(wrap);
  container.appendChild(floatPanel);
}

function getTooltipLines(col, dataIndex) {
  const points = surfaceState.columns[col];
  if (!points) return [];
  const p = points[dataIndex + 1];
  if (!p) return [];
  const vals = pointValue(p);
  const y = vals[1];
  const ret = vals[3];
  const bal = vals[4];
  const wd = vals[5];
  const unadj = vals[8];
  const delta = wd - unadj;
  const deltaStr = delta === 0 ? '' : ` (Delta: ${delta > 0 ? '+' : ''}${formatK(delta)})`;
  return [
    `Year: ${y}`,
    `Withdrawn: ${formatK(wd)}${deltaStr}`,
    `Original Plan: ${formatK(unadj)}`,
    `Balance: ${formatK(bal)}`,
    `Market Return: ${(ret * 100).toFixed(1)}%`
  ];
}

// Pull the year-by-year withdrawal series out of one pinned column's points.
function extractWithdrawalSeries(col) {
  const points = surfaceState.columns[col];
  if (!points) return null;

  const labels = [];
  const actualData = [];
  const unadjustedData = [];
  const balanceData = [];
  let totalUnadjusted = 0;
  for (const p of points) {
    const vals = pointValue(p);
    if (vals[1] === 0) continue; // skip year 0 (no withdrawal)
    labels.push(vals[1]);
    actualData.push(vals[5]);
    unadjustedData.push(vals[8]);
    balanceData.push(vals[4]);
    totalUnadjusted += vals[8];
  }

  return {
    depleted: surfaceState.depletedCols[col] ?? false,
    labels,
    actualData,
    unadjustedData,
    balanceData,
    totalUnadjusted,
    total: points[0] ? pointValue(points[0])[6] : 0,
    avg: points[0] ? pointValue(points[0])[7] : 0,
  };
}

// Chart.js datasets comparing the original withdrawal plan against what was
// actually withdrawn. Shared by the small float panel and the large dialog;
// `large` just scales line and point sizes up.
function withdrawalComparisonDatasets(series, { large = false } = {}) {
  const theme = getChartTheme();
  const floatTheme = series.depleted ? FLOAT_THEME.depleted : FLOAT_THEME.ok;
  return [
    {
      label: 'Original Plan',
      data: series.unadjustedData,
      borderColor: theme.planLine,
      borderWidth: large ? 2 : 1.5,
      borderDash: large ? [5, 5] : [4, 4],
      tension: 0.1,
      fill: { target: 'origin' },
      backgroundColor: theme.planFill,
      pointRadius: 0,
      pointHoverRadius: 0,
    },
    {
      label: 'Actual Withdrawal',
      data: series.actualData,
      borderColor: floatTheme.line,
      borderWidth: large ? 2 : 1.5,
      tension: 0.1,
      fill: {
        target: '-1',
        above: 'rgba(22, 163, 74, 0.2)',
        below: 'rgba(234, 88, 12, 0.2)',
      },
      pointRadius: large ? 3 : 1.5,
      pointHoverRadius: large ? 5 : 2.5,
      pointBackgroundColor: floatTheme.point,
      pointBorderColor: '#fff',
      pointBorderWidth: 1,
    },
  ];
}

function floatChartOptions() {
  const theme = getChartTheme();
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    interaction: { mode: 'index', intersect: false },
    scales: {
      x: {
        title: { display: false },
        ticks: { maxTicksLimit: 5, font: { size: 8 }, padding: 0, color: theme.axisTick },
        grid: { display: false },
      },
      y: {
        beginAtZero: true,
        ticks: { maxTicksLimit: 4, callback: (v) => formatK(v), font: { size: 8 }, padding: 0, color: theme.axisTick },
        grid: { color: theme.gridLine },
      },
    },
    plugins: {
      legend: { display: false },
      tooltip: {
        displayColors: false,
        bodyFont: { size: 9 },
        padding: 4,
        callbacks: {
          title: () => null,
          label: (ctx) => {
            if (ctx.datasetIndex !== 1) return null;
            return getTooltipLines(surfaceState.pinnedCol, ctx.dataIndex);
          },
        },
      },
    },
  };
}

function applyFloatChartTheme(depleted) {
  if (!floatChart) return;
  const theme = depleted ? FLOAT_THEME.depleted : FLOAT_THEME.ok;
  const dsActual = floatChart.data.datasets[1];
  dsActual.borderColor = theme.line;
  dsActual.pointBackgroundColor = theme.point;
}

function showFloatWithdrawal(col) {
  ensureFloatPanel();
  const series = extractWithdrawalSeries(col);
  if (!floatPanel || !series) return;

  const pLabel = columnPercentileLabel(col, surfaceState.columns.length);
  const status = series.depleted ? 'Depleted' : 'Funded';
  const muted = getChartTheme().floatMutedText;
  floatTitle.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:flex-start;">
      <div style="color:${series.depleted ? '#c2410c' : '#15803d'}">${pLabel} · ${status}</div>
      <div style="font-weight:normal;color:${muted};">Avg Return: ${(series.avg * 100).toFixed(2)}%</div>
    </div>
    <div style="font-weight:normal;color:${muted};margin-top:1px">Withdrawn: ${formatK(series.total)} (Plan: ${formatK(series.totalUnadjusted)})</div>
  `;
  floatTitle.style.color = '';

  if (floatChart) {
    floatChart.data.labels = series.labels;
    floatChart.data.datasets[0].data = series.unadjustedData;
    floatChart.data.datasets[1].data = series.actualData;
    applyFloatChartTheme(series.depleted);
    floatChart.update('none');
  } else {
    floatChart = new Chart(floatCanvas.getContext('2d'), {
      type: 'line',
      data: { labels: series.labels, datasets: withdrawalComparisonDatasets(series) },
      options: floatChartOptions(),
    });
  }

  floatPanel.style.display = 'block';
  floatPanel.style.cursor = 'pointer';
  floatPanel.onclick = () => openLargeWithdrawalChart(col);
}

let largeChart = null;
let largeBalanceChart = null;

function balanceBarColors(series) {
  const okBar = 'rgba(22, 163, 74, 0.72)';
  const depletedBar = 'rgba(234, 88, 12, 0.72)';
  const zeroBar = 'rgba(234, 88, 12, 0.35)';
  const activeBar = series.depleted ? depletedBar : okBar;
  return series.balanceData.map((balance) => (balance <= 0 ? zeroBar : activeBar));
}

function balanceBarOptions() {
  const theme = getChartTheme();
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    interaction: { mode: 'index', intersect: false },
    scales: {
      x: {
        title: { display: true, text: 'Year', color: theme.axisTitle },
        ticks: { color: theme.axisTick },
        grid: { display: false },
      },
      y: {
        beginAtZero: true,
        title: { display: true, text: 'Balance ($)', color: theme.axisTitle },
        ticks: { callback: (v) => formatK(v), maxTicksLimit: 4, color: theme.axisTick },
        grid: { color: theme.gridLine },
      },
    },
    plugins: {
      legend: { display: false },
      tooltip: {
        displayColors: false,
        callbacks: {
          title: () => null,
          label: (ctx) => `Balance: ${formatK(ctx.raw)}`,
        },
      },
    },
  };
}

function openLargeWithdrawalChart(col) {
  const dialog = document.getElementById('withdrawalChartDialog');
  if (!dialog) return;

  surfaceState.largeChartCol = col;

  const series = extractWithdrawalSeries(col);
  if (!series) return;

  const pLabel = columnPercentileLabel(col, surfaceState.columns.length);

  const title = document.getElementById('withdrawalChartDialogTitle');
  if (title) title.textContent = `Withdrawal Analysis - ${pLabel}`;
  
  const subtitle = document.getElementById('withdrawalChartDialogSubtitle');
  if (subtitle) subtitle.textContent = `Withdrawn: ${formatK(series.total)} | Plan: ${formatK(series.totalUnadjusted)}`;
  
  const avgReturnEl = document.getElementById('withdrawalChartDialogAvgReturn');
  if (avgReturnEl) avgReturnEl.textContent = `Avg Return: ${(series.avg * 100).toFixed(2)}%`;

  const canvas = document.getElementById('largeWithdrawalCanvas');
  const balanceCanvas = document.getElementById('largeBalanceCanvas');
  const theme = series.depleted ? FLOAT_THEME.depleted : FLOAT_THEME.ok;

  if (largeChart) {
    largeChart.data.labels = series.labels;
    largeChart.data.datasets[0].data = series.unadjustedData;
    largeChart.data.datasets[1].data = series.actualData;
    largeChart.data.datasets[1].borderColor = theme.line;
    largeChart.data.datasets[1].pointBackgroundColor = theme.point;
    largeChart.update();
  } else {
    const chartTheme = getChartTheme();
    largeChart = new Chart(canvas.getContext('2d'), {
      type: 'line',
      data: { labels: series.labels, datasets: withdrawalComparisonDatasets(series, { large: true }) },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        scales: {
          x: {
            title: { display: false },
            ticks: { display: false, color: chartTheme.axisTick },
            grid: { display: false },
          },
          y: {
            beginAtZero: true,
            title: { display: true, text: 'Withdrawal Amount ($)', color: chartTheme.axisTitle },
            ticks: { callback: (v) => formatK(v), color: chartTheme.axisTick },
            grid: { color: chartTheme.gridLine },
          },
        },
        plugins: {
          legend: { position: 'top', labels: { color: chartTheme.legend } },
          tooltip: {
            displayColors: false,
            callbacks: {
              title: () => null,
              label: (ctx) => {
                if (ctx.datasetIndex !== 1) return null;
                return getTooltipLines(surfaceState.largeChartCol, ctx.dataIndex);
              },
            },
          },
        },
      },
    });
  }

  if (largeBalanceChart) {
    largeBalanceChart.data.labels = series.labels;
    largeBalanceChart.data.datasets[0].data = series.balanceData;
    largeBalanceChart.data.datasets[0].backgroundColor = balanceBarColors(series);
    largeBalanceChart.update();
  } else if (balanceCanvas) {
    largeBalanceChart = new Chart(balanceCanvas.getContext('2d'), {
      type: 'bar',
      data: {
        labels: series.labels,
        datasets: [{
          label: 'Balance',
          data: series.balanceData,
          backgroundColor: balanceBarColors(series),
          borderWidth: 0,
          borderRadius: 2,
        }],
      },
      options: balanceBarOptions(),
    });
  }

  dialog.showModal();
}

function hideFloatPanel() {
  if (floatPanel) floatPanel.style.display = 'none';
}

function tooltipFormatter(params) {
  const vals = pointValue(params.value);
  const y = vals[1];
  const ret = vals[3];
  const bal = vals[4];
  const wd = vals[5];
  const total = vals[6];
  const avg = vals[7];
  const unadj = vals[8];
  const delta = wd - unadj;
  const deltaStr = delta === 0 ? '' : ` (Delta: ${delta > 0 ? '+' : ''}${formatK(delta)})`;
  return (
    `Total Withdrawn: <b>${formatK(total)}</b>` +
    `<br>Avg Annual Return: <b>${(avg * 100).toFixed(2)}%</b>` +
    `<br>Year: ${y}` +
    `<br>Withdrawn: ${formatK(wd)}${deltaStr}` +
    `<br>Original Plan: ${formatK(unadj)}` +
    `<br>Balance: ${formatK(bal)}` +
    `<br>Market Return: ${(ret * 100).toFixed(1)}%`
  );
}

// Update the dim/highlight overlay without rebuilding the whole chart.
// Only the pinned row is highlighted; it floats up above the (dimmed) field.
function applyFocus() {
  if (!chartInstance) return;
  const col = surfaceState.pinnedCol;
  const { columns, zCap } = surfaceState;

  if (col == null || !columns[col]) {
    // Nothing pinned: the full field is interactive for exploration.
    hideFloatPanel();
    chartInstance.setOption({
      zAxis3D: { max: zCap },
      series: [{ itemStyle: { opacity: 1 }, silent: false }, { data: [] }],
    });
    return;
  }

  // Lift every bar in the focused column by a constant offset so the whole
  // path pops up as a unit, and raise the axis ceiling so nothing clips.
  const lift = zCap * POP_FRACTION;
  // Pinned column uses plain data so the visualMap red/green ramp applies.
  const lifted = columns[col].map((p) => {
    const q = pointValue(p).slice();
    q[2] = q[2] + lift;
    return q;
  });

  // While pinned, only the lifted row responds to the cursor. This prevents the
  // tooltip from drifting onto neighbouring columns (a different simulation),
  // so the per-row "Total Withdrawn" stays constant as you mouse along it.
  chartInstance.setOption({
    zAxis3D: { max: zCap + lift },
    series: [
      { itemStyle: { opacity: DIM_OPACITY }, silent: true },
      { data: lifted, itemStyle: { opacity: 1 }, silent: false },
    ],
  });

  showFloatWithdrawal(col);
}

function handleSurfaceSingleClick(col) {
  surfaceState.pinnedCol = surfaceState.pinnedCol === col ? null : col;
  surfaceState.columnClickHandled = true;
  applyFocus();
}

function handleSurfaceDoubleClick(col) {
  surfaceState.columnClickHandled = true;
  surfaceState.pinnedCol = null;
  hideFloatPanel();
  if (surfaceState.viewMode === 'overview') {
    enterDrilldown(col);
  } else {
    exitDrilldown();
  }
}

function bindEvents() {
  if (surfaceState.eventsBound || !chartInstance) return;

  let singleClickTimer = null;
  let pendingClickCol = null;
  let lastClickCol = null;
  let lastDoubleClickAt = 0;

  const cancelPendingSingleClick = () => {
    if (singleClickTimer) {
      clearTimeout(singleClickTimer);
      singleClickTimer = null;
    }
  };

  const isSameColumn = (a, b) => a != null && b != null && Math.abs(a - b) <= 1;

  const runDoubleClick = (col) => {
    const now = Date.now();
    if (now - lastDoubleClickAt < 300) return;
    lastDoubleClickAt = now;
    cancelPendingSingleClick();
    pendingClickCol = null;
    surfaceState.columnClickHandled = true;
    handleSurfaceDoubleClick(col);
  };

  chartInstance.on('click', (params) => {
    if (!params || !params.value) return;
    // Must be set before the zr click handler runs, or it clears our pending click.
    surfaceState.columnClickHandled = true;
    const col = Math.round(pointValue(params.value)[0]);
    lastClickCol = col;

    if (isSameColumn(pendingClickCol, col)) {
      runDoubleClick(pendingClickCol);
      return;
    }

    pendingClickCol = col;
    cancelPendingSingleClick();
    singleClickTimer = setTimeout(() => {
      singleClickTimer = null;
      pendingClickCol = null;
      handleSurfaceSingleClick(col);
    }, CLICK_WAIT_MS);
  });

  // Fallback when two series clicks do not land on the exact same column index.
  chartInstance.getZr().on('dblclick', () => {
    const col = pendingClickCol ?? lastClickCol;
    if (col == null) return;
    runDoubleClick(col);
  });

  // Any click that does NOT land on a column unpins. The series 'click' above
  // fires first and sets a flag; if it didn't, this was empty space.
  chartInstance.getZr().on('click', () => {
    if (surfaceState.columnClickHandled) {
      surfaceState.columnClickHandled = false;
      return;
    }
    cancelPendingSingleClick();
    pendingClickCol = null;
    lastClickCol = null;
    if (surfaceState.pinnedCol != null) {
      surfaceState.pinnedCol = null;
      applyFocus();
    }
  });

  surfaceState.eventsBound = true;
}

function buildColumnsFromPaths(surfacePaths, numYears) {
  const numCols = surfacePaths.length;
  const numRows = numYears + 1;
  const startBalance = surfacePaths[0] ? surfacePaths[0].balances[0] : 0;
  const zCap = startBalance * Z_CAP_MULTIPLE;

  const data3D = [];
  const columns = [];
  const depletedCols = [];
  for (let x = 0; x < numCols; x++) {
    const { balances, returns, withdrawals, unadjustedWithdrawals, totalWithdrawn, avgReturn } = surfacePaths[x];
    const depleted = pathDepleted(balances);
    depletedCols.push(depleted);
    const colPoints = [];
    for (let y = 0; y <= numYears; y++) {
      const balance = Math.max(0, balances[y]);
      const height = Math.min(balance, zCap);
      const ret = y > 0 ? returns[y - 1] : returns[0] || 0;
      const withdrawal = y > 0 && withdrawals ? withdrawals[y - 1] : 0;
      const unadjusted = y > 0 && unadjustedWithdrawals ? unadjustedWithdrawals[y - 1] : 0;
      const point = makeBarPoint(
        x, y, height, ret, balance, withdrawal, totalWithdrawn || 0, avgReturn || 0, depleted, unadjusted
      );
      data3D.push(point);
      colPoints.push(point);
    }
    columns.push(colPoints);
  }

  const barWidth = BOX_WIDTH / numCols;
  const barDepth = BOX_DEPTH / numRows;

  return { data3D, columns, depletedCols, zCap, barWidth, barDepth, numCols };
}

function applySurfaceDataset(surfacePaths, numYears) {
  if (!chartInstance) return;

  const { data3D, columns, depletedCols, zCap, barWidth, barDepth, numCols } =
    buildColumnsFromPaths(surfacePaths, numYears);

  surfaceState.columns = columns;
  surfaceState.depletedCols = depletedCols;
  surfaceState.barWidth = barWidth;
  surfaceState.barDepth = barDepth;
  surfaceState.zCap = zCap;
  surfaceState.numYears = numYears;
  surfaceState.pinnedCol = null;
  surfaceState.columnClickHandled = false;
  hideFloatPanel();

  chartInstance.setOption({
    xAxis3D: buildXAxisConfig(numCols),
    zAxis3D: {
      min: 0,
      max: zCap,
      axisLabel: zAxisLabel((v) => formatK(v)),
    },
    series: [
      {
        name: 'paths',
        data: data3D,
        barSize: [barWidth, barDepth],
        itemStyle: { opacity: 1 },
        silent: false,
      },
      {
        name: 'focus',
        data: [],
        barSize: [barWidth, barDepth],
        itemStyle: { opacity: 1 },
        silent: false,
      },
    ],
  });
}

function enterDrilldown(col) {
  if (!surfaceState.surfaceMeta || !surfaceState.simParams) {
    console.warn('3D drill-down unavailable: simulation metadata missing. Re-run the simulation.');
    return;
  }

  const centerRank = rankForOverviewColumn(col, surfaceState.surfaceMeta);
  const { paths, lo, hi, centerRank: resolvedCenter } = buildDrilldownPaths(
    centerRank,
    surfaceState.surfaceMeta,
    surfaceState.simParams,
    surfaceState.seed
  );

  surfaceState.viewMode = 'drilldown';
  surfaceState.drilldownCenterRank = resolvedCenter;
  surfaceState.drilldownLo = lo;
  surfaceState.drilldownHi = hi;

  applySurfaceDataset(paths, surfaceState.numYears);
  updateSurfaceChrome({
    mode: 'drilldown',
    centerRank: resolvedCenter,
    lo,
    hi,
    n: surfaceState.surfaceMeta.numSimulations,
  });
}

function exitDrilldown() {
  if (!surfaceState.overviewPaths.length) return;

  surfaceState.viewMode = 'overview';
  surfaceState.drilldownCenterRank = null;
  surfaceState.drilldownLo = null;
  surfaceState.drilldownHi = null;

  applySurfaceDataset(surfaceState.overviewPaths, surfaceState.numYears);
  updateSurfaceChrome({ mode: 'overview' });
}

export async function drawSurfaceChart(surfacePaths, numYears, context = {}) {
  const echarts = await loadEcharts();
  const dom = document.getElementById('surfaceChart');
  if (!chartInstance) {
    chartInstance = echarts.init(dom);
    dom.oncontextmenu = (e) => e.preventDefault();
    if (import.meta.env.DEV) {
      // Exposed for quick camera-angle inspection from the console:
      //   __SOR_SURFACE__.getOption().grid3D[0].viewControl
      window.__SOR_SURFACE__ = chartInstance;
    }
  }

  const { params = null, seed = 0, surfaceMeta = null } = context;

  surfaceState.viewMode = 'overview';
  surfaceState.overviewPaths = surfacePaths;
  surfaceState.simParams = params;
  surfaceState.seed = seed;
  surfaceState.surfaceMeta = surfaceMeta;
  surfaceState.drilldownCenterRank = null;
  surfaceState.drilldownLo = null;
  surfaceState.drilldownHi = null;
  surfaceState.numYears = numYears;
  surfaceState.lastContext = { surfacePaths, numYears, context };

  const { data3D, columns, depletedCols, zCap, barWidth, barDepth, numCols } =
    buildColumnsFromPaths(surfacePaths, numYears);

  surfaceState.columns = columns;
  surfaceState.depletedCols = depletedCols;
  surfaceState.barWidth = barWidth;
  surfaceState.barDepth = barDepth;
  surfaceState.zCap = zCap;
  surfaceState.pinnedCol = null;
  surfaceState.columnClickHandled = false;
  hideFloatPanel();
  updateSurfaceChrome({ mode: 'overview' });
  const theme = getChartTheme();

  chartInstance.setOption(
    {
      tooltip: { formatter: tooltipFormatter },
      visualMap: {
        show: false,
        dimension: 3,
        min: RETURN_MIN,
        max: RETURN_MAX,
        inRange: { color: buildReturnColorRamp() },
      },
      xAxis3D: buildXAxisConfig(numCols),
      yAxis3D: axisConfig('Year', { min: 0, max: numYears, splitNumber: 5, inverse: true }),
      zAxis3D: axisConfig('Balance', {
        min: 0,
        max: zCap,
        axisLabel: zAxisLabel((v) => formatK(v)),
      }),
      grid3D: {
        boxWidth: BOX_WIDTH,
        boxDepth: BOX_DEPTH,
        boxHeight: BOX_HEIGHT,
        viewControl: {
          alpha: CAMERA_ALPHA,
          beta: CAMERA_BETA,
          distance: CAMERA_DISTANCE,
          center: [PAN_CENTER_X, PAN_CENTER_Y, PAN_CENTER_Z],
          autoRotate: false,
          rotateMouseButton: 'left',
          panMouseButton: 'right',
          rotateSensitivity: 1,
          zoomSensitivity: 1,
          panSensitivity: 1,
        },
        environment: theme.sceneBg,
        light: {
          main: { intensity: 1.2, shadow: false, alpha: 40, beta: 225 },
          ambient: { intensity: 0.35 },
        },
        axisPointer: { show: false },
      },
      series: [
        {
          type: 'bar3D',
          name: 'paths',
          data: data3D,
          shading: 'lambert',
          barSize: [barWidth, barDepth],
          bevelSize: 0,
          animation: false,
          itemStyle: { opacity: 1 },
          emphasis: { label: { show: false } },
        },
        {
          type: 'bar3D',
          name: 'focus',
          data: [],
          shading: 'lambert',
          animation: false,
          barSize: [barWidth, barDepth],
          bevelSize: 0,
          itemStyle: { opacity: 1 },
          silent: false,
          emphasis: { label: { show: false } },
        },
      ],
    },
    true
  );

  bindEvents();

  window.__TEST_HOOKS__ = window.__TEST_HOOKS__ || {};
  window.__TEST_HOOKS__.surfaceChart = chartInstance;
  window.__TEST_HOOKS__.surfaceViewMode = () => surfaceState.viewMode;
  window.__TEST_HOOKS__.enterSurfaceDrilldown = (col) => enterDrilldown(col);
  window.__TEST_HOOKS__.exitSurfaceDrilldown = () => exitDrilldown();
  window.__TEST_HOOKS__.surfaceXAxisLabel = (col) =>
    columnPercentileLabel(col, surfaceState.columns.length);

  if (!window.__sorSurfaceResizeBound) {
    window.addEventListener('resize', () => chartInstance && chartInstance.resize());
    window.__sorSurfaceResizeBound = true;
  }
}

onThemeChange(() => {
  applySurfaceTheme();
});
