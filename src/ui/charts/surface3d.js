// 3D topography column chart. ECharts + ECharts-GL are heavy, so they are
// lazy-loaded (dynamic import) the first time this chart is drawn.
import { formatK } from '../format.js';
import { Chart } from './chartSetup.js';

let echartsModule = null;
let chartInstance = null;

const BOX_WIDTH = 280;
const BOX_DEPTH = 120;
const BOX_HEIGHT = 80;

const RETURN_MIN = -0.3;
const RETURN_MAX = 0.3;

// Z axis is capped at this multiple of the starting portfolio value.
const Z_CAP_MULTIPLE = 2;

// Background matches the app's page background so the plot is framed in its section.
const SCENE_BG = '#f1f5f9'; // slate-100
const AXIS_NAME_COLOR = '#475569'; // slate-600
const AXIS_LABEL_COLOR = '#64748b'; // slate-500
const AXIS_LINE_COLOR = '#cbd5e1'; // slate-300

const DIM_OPACITY = 0.02; // opacity of non-focused columns
const POP_FRACTION = 0; // how far the focused row floats up (fraction of zCap)

// Interaction + layout state shared with the event handlers (one chart instance).
const surfaceState = {
  columns: [], // columns[x] = array of data points for that simulation
  barWidth: 1,
  barDepth: 1,
  zCap: 0,
  pinnedCol: null,
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

// Continuous red -> green ramp (no yellow): deep red at -30%, fading through
// light red to light green at the zero crossing, up to deep green at +30%.
function buildReturnColorRamp(samples = 363) {
  const deepRed = [127, 29, 29];
  const lightRed = [248, 113, 113];
  const lightGreen = [134, 239, 172];
  const deepGreen = [21, 128, 61];

  const colors = [];
  for (let i = 0; i < samples; i++) {
    const v = RETURN_MIN + ((RETURN_MAX - RETURN_MIN) * i) / (samples - 1);
    if (v < 0) {
      colors.push(lerpColor(deepRed, lightRed, (v - RETURN_MIN) / (0 - RETURN_MIN)));
    } else {
      colors.push(lerpColor(lightGreen, deepGreen, v / RETURN_MAX));
    }
  }
  return colors;
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
    'position:absolute;top:12px;right:12px;width:320px;background:rgba(255,255,255,0.96);' +
    'border:1px solid #e2e8f0;border-radius:8px;box-shadow:0 4px 14px rgba(0,0,0,0.15);' +
    'padding:10px;z-index:10;pointer-events:none;display:none;';

  floatTitle = document.createElement('div');
  floatTitle.style.cssText = 'font-size:12px;font-weight:600;color:#334155;margin-bottom:6px;';

  const wrap = document.createElement('div');
  wrap.style.cssText = 'height:150px;';
  floatCanvas = document.createElement('canvas');
  wrap.appendChild(floatCanvas);

  floatPanel.appendChild(floatTitle);
  floatPanel.appendChild(wrap);
  container.appendChild(floatPanel);
}

function showFloatWithdrawal(col) {
  ensureFloatPanel();
  const points = surfaceState.columns[col];
  if (!floatPanel || !points) return;

  const labels = [];
  const data = [];
  for (const p of points) {
    if (p[1] === 0) continue; // skip year 0 (no withdrawal)
    labels.push(p[1]);
    data.push(p[5]);
  }

  const total = points[0] ? points[0][6] : 0;
  const numCols = surfaceState.columns.length;
  const pLabel = 'P' + Math.round(10 + (col / numCols) * 50);
  floatTitle.textContent = `${pLabel} · Withdrawals over time (Total ${formatK(total)})`;

  if (floatChart) {
    floatChart.data.labels = labels;
    floatChart.data.datasets[0].data = data;
    floatChart.update('none');
  } else {
    floatChart = new Chart(floatCanvas.getContext('2d'), {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Withdrawal',
            data,
            borderColor: '#4f46e5',
            backgroundColor: 'rgba(79,70,229,0.12)',
            borderWidth: 2,
            tension: 0.1,
            pointRadius: 0,
            fill: true,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        scales: {
          x: { title: { display: true, text: 'Year', font: { size: 9 } }, ticks: { maxTicksLimit: 8, font: { size: 9 } } },
          y: { beginAtZero: true, ticks: { callback: (v) => formatK(v), font: { size: 9 } } },
        },
        plugins: { legend: { display: false } },
      },
    });
  }

  floatPanel.style.display = 'block';
}

function hideFloatPanel() {
  if (floatPanel) floatPanel.style.display = 'none';
}

function tooltipFormatter(params) {
  const y = params.value[1];
  const ret = params.value[3];
  const bal = params.value[4];
  const wd = params.value[5];
  const total = params.value[6];
  const avg = params.value[7];
  return (
    `Total Withdrawn: <b>${formatK(total)}</b>` +
    `<br>Avg Annual Return: <b>${(avg * 100).toFixed(2)}%</b>` +
    `<br>Year: ${y}` +
    `<br>Withdrawn: ${formatK(wd)}` +
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
  const lifted = columns[col].map((p) => {
    const q = p.slice();
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
    const col = params.value[0];
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
    // Exposed for quick camera-angle inspection from the console:
    //   __SOR_SURFACE__.getOption().grid3D[0].viewControl
    window.__SOR_SURFACE__ = chartInstance;
  }

  const numCols = surfacePaths.length;
  const numRows = numYears + 1;

  // Every path starts from the same portfolio value; cap the Z axis at 2x it.
  const startBalance = surfacePaths[0] ? surfacePaths[0].balances[0] : 0;
  const zCap = startBalance * Z_CAP_MULTIPLE;

  // Data dims: [x, y, cappedHeight, return, realBalance, withdrawal, totalWithdrawn, avgReturn]
  const data3D = [];
  const columns = [];
  for (let x = 0; x < numCols; x++) {
    const { balances, returns, withdrawals, totalWithdrawn, avgReturn } = surfacePaths[x];
    const colPoints = [];
    for (let y = 0; y <= numYears; y++) {
      const balance = Math.max(0, balances[y]);
      const height = Math.min(balance, zCap);
      const ret = y > 0 ? returns[y - 1] : returns[0] || 0;
      const withdrawal = y > 0 && withdrawals ? withdrawals[y - 1] : 0;
      const point = [x, y, height, ret, balance, withdrawal, totalWithdrawn || 0, avgReturn || 0];
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
          formatter: (v) => 'P' + Math.round(10 + (v / numCols) * 50),
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
        viewControl: { alpha: 24.29, beta: 225.41, distance: 279.91, autoRotate: false },
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

  if (!window.__sorSurfaceResizeBound) {
    window.addEventListener('resize', () => chartInstance && chartInstance.resize());
    window.__sorSurfaceResizeBound = true;
  }
}
