// 3D topography column chart. ECharts + ECharts-GL are heavy, so they are
// lazy-loaded (dynamic import) the first time this chart is drawn.
import { formatK } from '../format.js';
import { Chart } from './chartSetup.js';

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

// Background matches the app's page background so the plot is framed in its section.
const SCENE_BG = '#f1f5f9'; // slate-100
const AXIS_NAME_COLOR = '#475569'; // slate-600
const AXIS_LABEL_COLOR = '#64748b'; // slate-500
const AXIS_LINE_COLOR = '#cbd5e1'; // slate-300

const DIM_OPACITY = 0.02; // opacity of non-focused columns
const POP_FRACTION = 0; // how far the focused row floats up (fraction of zCap)

const FLOAT_PANEL_WIDTH = 221;
const FLOAT_PANEL_CHART_HEIGHT = 102;
const FLOAT_THEME = {
  ok: { line: '#16a34a', fill: 'rgba(22,163,74,0.14)', point: '#16a34a' },
  depleted: { line: '#ea580c', fill: 'rgba(249,115,22,0.2)', point: '#f97316' },
};

// Interaction + layout state shared with the event handlers (one chart instance).
const surfaceState = {
  columns: [], // columns[x] = array of data points for that simulation
  depletedCols: [], // parallel to columns: true when the path runs out of money
  barWidth: 1,
  barDepth: 1,
  zCap: 0,
  pinnedCol: null,
  largeChartCol: null,
  columnClickHandled: false,
  eventsBound: false,
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

function axisConfig(name, extra = {}) {
  return {
    type: 'value',
    name,
    nameTextStyle: { color: AXIS_NAME_COLOR, fontSize: 11 },
    axisLabel: { show: true, color: AXIS_LABEL_COLOR, fontSize: 9, margin: 4 },
    axisTick: { show: false },
    axisLine: { lineStyle: { color: AXIS_LINE_COLOR } },
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

  floatPanel = document.createElement('div');
  floatPanel.style.cssText =
    `position:absolute;top:0;right:0;width:${FLOAT_PANEL_WIDTH}px;` +
    'background:rgba(255,255,255,0.94);border-left:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0;' +
    'border-radius:0 0 0 6px;box-shadow:0 2px 6px rgba(0,0,0,0.08);' +
    'padding:5px 6px;z-index:10;pointer-events:auto;display:none;';

  floatTitle = document.createElement('div');
  floatTitle.style.cssText = 'font-size:10px;font-weight:600;color:#334155;margin-bottom:3px;line-height:1.2;';

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
  let totalUnadjusted = 0;
  for (const p of points) {
    const vals = pointValue(p);
    if (vals[1] === 0) continue; // skip year 0 (no withdrawal)
    labels.push(vals[1]);
    actualData.push(vals[5]);
    unadjustedData.push(vals[8]);
    totalUnadjusted += vals[8];
  }

  return {
    depleted: surfaceState.depletedCols[col] ?? false,
    labels,
    actualData,
    unadjustedData,
    totalUnadjusted,
    total: points[0] ? pointValue(points[0])[6] : 0,
    avg: points[0] ? pointValue(points[0])[7] : 0,
  };
}

// Chart.js datasets comparing the original withdrawal plan against what was
// actually withdrawn. Shared by the small float panel and the large dialog;
// `large` just scales line and point sizes up.
function withdrawalComparisonDatasets(series, { large = false } = {}) {
  const theme = series.depleted ? FLOAT_THEME.depleted : FLOAT_THEME.ok;
  return [
    {
      label: 'Original Plan',
      data: series.unadjustedData,
      borderColor: '#94a3b8',
      borderWidth: large ? 2 : 1.5,
      borderDash: large ? [5, 5] : [4, 4],
      tension: 0.1,
      fill: { target: 'origin' },
      backgroundColor: 'rgba(148, 163, 184, 0.2)',
      pointRadius: 0,
      pointHoverRadius: 0,
    },
    {
      label: 'Actual Withdrawal',
      data: series.actualData,
      borderColor: theme.line,
      borderWidth: large ? 2 : 1.5,
      tension: 0.1,
      fill: {
        target: '-1',
        above: 'rgba(22, 163, 74, 0.2)',
        below: 'rgba(234, 88, 12, 0.2)',
      },
      pointRadius: large ? 3 : 1.5,
      pointHoverRadius: large ? 5 : 2.5,
      pointBackgroundColor: theme.point,
      pointBorderColor: '#fff',
      pointBorderWidth: 1,
    },
  ];
}

function floatChartOptions() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    interaction: { mode: 'index', intersect: false },
    scales: {
      x: {
        title: { display: false },
        ticks: { maxTicksLimit: 5, font: { size: 8 }, padding: 0 },
        grid: { display: false },
      },
      y: {
        beginAtZero: true,
        ticks: { maxTicksLimit: 4, callback: (v) => formatK(v), font: { size: 8 }, padding: 0 },
        grid: { color: 'rgba(148,163,184,0.2)' },
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

  const pLabel = percentileLabel(col, surfaceState.columns.length);
  const status = series.depleted ? 'Depleted' : 'Funded';
  floatTitle.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:flex-start;">
      <div style="color:${series.depleted ? '#c2410c' : '#15803d'}">${pLabel} · ${status}</div>
      <div style="font-weight:normal;color:#64748b;">Avg Return: ${(series.avg * 100).toFixed(2)}%</div>
    </div>
    <div style="font-weight:normal;color:#64748b;margin-top:1px">Withdrawn: ${formatK(series.total)} (Plan: ${formatK(series.totalUnadjusted)})</div>
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

function openLargeWithdrawalChart(col) {
  const dialog = document.getElementById('withdrawalChartDialog');
  if (!dialog) return;

  surfaceState.largeChartCol = col;

  const series = extractWithdrawalSeries(col);
  if (!series) return;

  const pLabel = percentileLabel(col, surfaceState.columns.length);

  const title = document.getElementById('withdrawalChartDialogTitle');
  if (title) title.textContent = `Withdrawal Analysis - ${pLabel}`;
  
  const subtitle = document.getElementById('withdrawalChartDialogSubtitle');
  if (subtitle) subtitle.textContent = `Withdrawn: ${formatK(series.total)} | Plan: ${formatK(series.totalUnadjusted)}`;
  
  const avgReturnEl = document.getElementById('withdrawalChartDialogAvgReturn');
  if (avgReturnEl) avgReturnEl.textContent = `Avg Return: ${(series.avg * 100).toFixed(2)}%`;

  const canvas = document.getElementById('largeWithdrawalCanvas');
  const theme = series.depleted ? FLOAT_THEME.depleted : FLOAT_THEME.ok;

  if (largeChart) {
    largeChart.data.labels = series.labels;
    largeChart.data.datasets[0].data = series.unadjustedData;
    largeChart.data.datasets[1].data = series.actualData;
    largeChart.data.datasets[1].borderColor = theme.line;
    largeChart.data.datasets[1].pointBackgroundColor = theme.point;
    largeChart.update();
  } else {
    largeChart = new Chart(canvas.getContext('2d'), {
      type: 'line',
      data: { labels: series.labels, datasets: withdrawalComparisonDatasets(series, { large: true }) },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        scales: {
          x: {
            title: { display: true, text: 'Year' },
            grid: { display: false },
          },
          y: {
            beginAtZero: true,
            title: { display: true, text: 'Withdrawal Amount ($)' },
            ticks: { callback: (v) => formatK(v) },
          },
        },
        plugins: {
          legend: { position: 'top' },
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

function bindEvents() {
  if (surfaceState.eventsBound || !chartInstance) return;

  // Single-click a column to pin it popped-up so you can mouse over each year
  // to read its values; click the same column again to release.
  chartInstance.on('click', (params) => {
    if (!params || !params.value) return;
    const col = pointValue(params.value)[0];
    surfaceState.pinnedCol = surfaceState.pinnedCol === col ? null : col;
    surfaceState.columnClickHandled = true;
    applyFocus();
  });

  // Any click that does NOT land on a column unpins. The series 'click' above
  // fires first and sets a flag; if it didn't, this was empty space.
  chartInstance.getZr().on('click', () => {
    if (surfaceState.columnClickHandled) {
      surfaceState.columnClickHandled = false;
      return;
    }
    if (surfaceState.pinnedCol != null) {
      surfaceState.pinnedCol = null;
      applyFocus();
    }
  });

  surfaceState.eventsBound = true;
}

export async function drawSurfaceChart(surfacePaths, numYears) {
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

  const numCols = surfacePaths.length;
  const numRows = numYears + 1;

  // Every path starts from the same portfolio value; cap the Z axis at 2x it.
  const startBalance = surfacePaths[0] ? surfacePaths[0].balances[0] : 0;
  const zCap = startBalance * Z_CAP_MULTIPLE;

  // Data dims: [x, y, cappedHeight, return, realBalance, withdrawal, totalWithdrawn, avgReturn]
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

  // Size each column to exactly fill its cell so there is no gap between them.
  const barWidth = BOX_WIDTH / numCols;
  const barDepth = BOX_DEPTH / numRows;

  // Reset interaction state for the new dataset.
  surfaceState.columns = columns;
  surfaceState.depletedCols = depletedCols;
  surfaceState.barWidth = barWidth;
  surfaceState.barDepth = barDepth;
  surfaceState.zCap = zCap;
  surfaceState.pinnedCol = null;
  surfaceState.columnClickHandled = false;
  hideFloatPanel();

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
      xAxis3D: axisConfig('Percentile', {
        min: 0,
        max: numCols - 1,
        splitNumber: 5,
        axisLabel: {
          show: true,
          color: AXIS_LABEL_COLOR,
          fontSize: 9,
          margin: 4,
          formatter: (v) => percentileLabel(v, numCols),
        },
      }),
      yAxis3D: axisConfig('Year', { min: 0, max: numYears, splitNumber: 5, inverse: true }),
      zAxis3D: axisConfig('Balance', {
        min: 0,
        max: zCap,
        axisLabel: { show: true, color: AXIS_LABEL_COLOR, fontSize: 9, margin: 4, formatter: (v) => formatK(v) },
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
        environment: SCENE_BG,
        // Light from behind the opening camera view (matching its azimuth),
        // lifted slightly above so the front faces are well lit.
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
          // Overlay used to highlight / blow up the focused simulation row.
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

  if (import.meta.env.DEV) {
    window.__TEST_HOOKS__ = window.__TEST_HOOKS__ || {};
    window.__TEST_HOOKS__.surfaceChart = chartInstance;
  }

  if (!window.__sorSurfaceResizeBound) {
    window.addEventListener('resize', () => chartInstance && chartInstance.resize());
    window.__sorSurfaceResizeBound = true;
  }
}
