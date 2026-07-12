// Withdrawal Heatmap: how the distribution of simulation outcomes shapes
// spending over time. Each COLUMN is one simulation (or a narrow band of
// adjacent ones) placed by its lifetime-withdrawal rank from P5 to P65 — the
// same run-coherent ordering as the 3D surface — so a lean year inside an
// otherwise-good run stays visible as a dark cell in a light column. Each ROW
// is a year (year 1 at the top, where sequence risk bites). Cell color encodes
// either the absolute withdrawal (sequential blue ramp) or the deviation from
// the planned schedule (diverging red-cut / blue-boost ramp), switched by a
// segmented toggle.
//
// Rendered straight to a canvas: cells are painted once into an offscreen
// canvas at exactly numCols × numYears pixels, then blitted scaled with
// nearest-neighbor so columns stay crisp. Data arrives pre-aggregated from
// resultPackaging.buildWithdrawalHeatmap — the renderer never touches the raw
// per-run matrix.
import { Chart } from './chartSetup.js';
import { withdrawalComparisonDatasets, withdrawalChartTooltipCallbacks } from './surface3d.js';
import { getChartTheme, chartJsCartesianScales, sampleRunTooltipOptions } from './chartTheme.js';
import { onThemeChange, isDarkMode } from '../theme.js';
import { formatK, formatPercent } from '../format.js';
import { regeneratePath } from '../../core/simulation.js';
import { percentileLabelForRank } from '../../core/surfaceDrilldown.js';
import { createLinkedBalanceBars } from './balanceBars.js';

const MARGIN = { top: 10, right: 14, bottom: 40, left: 52 };

// Sequential ramp (absolute withdrawal $): single blue hue, validated ramp
// steps. Light mode runs light→dark so bigger withdrawals read darker; dark
// mode inverts lightness so small values recede into the dark surface.
const SEQ_STOPS = {
  light: ['#cde2fb', '#86b6ef', '#3987e5', '#1c5cab', '#0d366b'],
  dark: ['#16283c', '#1c4570', '#2a78d6', '#6da7ec', '#b7d3f6'],
};

// Diverging ramp (Δ vs plan): red = spending cut, neutral gray = on plan,
// blue = boost. Red matches the app's danger semantics; blue (not green) keeps
// the pair colorblind-safe. The midpoint is a hue-less gray so "on plan"
// recedes rather than reading as a third category.
const DIV_STOPS = {
  light: { cut: '#b91c1c', mid: '#f0efec', boost: '#1c5cab' },
  dark: { cut: '#f87171', mid: '#383835', boost: '#6da7ec' },
};

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

const SEQ_RGB = {
  light: SEQ_STOPS.light.map(hexToRgb),
  dark: SEQ_STOPS.dark.map(hexToRgb),
};
const DIV_RGB = {
  light: { cut: hexToRgb(DIV_STOPS.light.cut), mid: hexToRgb(DIV_STOPS.light.mid), boost: hexToRgb(DIV_STOPS.light.boost) },
  dark: { cut: hexToRgb(DIV_STOPS.dark.cut), mid: hexToRgb(DIV_STOPS.dark.mid), boost: hexToRgb(DIV_STOPS.dark.boost) },
};

function lerpRgb(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

// Piecewise-linear interpolation across the sequential stops. `t` in [0,1].
function seqRampRgb(t, isDark) {
  const stops = SEQ_RGB[isDark ? 'dark' : 'light'];
  const pos = Math.max(0, Math.min(1, t)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(pos));
  return lerpRgb(stops[i], stops[i + 1], pos - i);
}

// Absolute-dollar cell color. The domain is the P2–P98 of all cells (computed
// in the worker); values beyond it clamp to the ramp ends.
export function sequentialRgb(value, domain, isDark = isDarkMode()) {
  const t = (value - domain.lo) / (domain.hi - domain.lo);
  return seqRampRgb(t, isDark);
}

export function sequentialColor(value, domain, isDark = isDarkMode()) {
  const [r, g, b] = sequentialRgb(value, domain, isDark);
  return `rgb(${r}, ${g}, ${b})`;
}

// Deviation-from-plan cell color. `delta` = actual − plan; negative (a cut)
// runs toward the red pole, positive (a boost) toward the blue pole, and zero
// sits exactly on the neutral gray. Symmetric domain ±deltaMax, clamped.
export function divergingRgb(delta, deltaMax, isDark = isDarkMode()) {
  const pair = DIV_RGB[isDark ? 'dark' : 'light'];
  const t = Math.max(-1, Math.min(1, deltaMax > 0 ? delta / deltaMax : 0));
  if (t < 0) return lerpRgb(pair.mid, pair.cut, -t);
  return lerpRgb(pair.mid, pair.boost, t);
}

export function divergingColor(delta, deltaMax, isDark = isDarkMode()) {
  const [r, g, b] = divergingRgb(delta, deltaMax, isDark);
  return `rgb(${r}, ${g}, ${b})`;
}

// Pixel → column index within the plot rect, or -1 outside it.
export function heatmapColumnAtX(x, geom, numCols) {
  if (x < geom.plotX || x >= geom.plotX + geom.plotW) return -1;
  return Math.min(numCols - 1, Math.floor(((x - geom.plotX) / geom.plotW) * numCols));
}

// Pixel → year index (0-based, year 1 at the top), or -1 outside the plot.
export function heatmapYearAtY(y, geom, numYears) {
  if (y < geom.plotY || y >= geom.plotY + geom.plotH) return -1;
  return Math.min(numYears - 1, Math.floor(((y - geom.plotY) / geom.plotH) * numYears));
}

// Tooltip content as plain data so it is unit-testable without a DOM.
export function formatHeatmapTooltip({ year, pctLabel, simIndex, value, plan, runCount }) {
  const delta = value - plan;
  const rows = [
    `Withdrawal ${formatK(value)}`,
    `Plan ${formatK(plan)}`,
    `${delta >= 0 ? '+' : '−'}${formatK(Math.abs(delta))} vs plan`,
  ];
  if (runCount > 1) rows.push(`avg of ${runCount} runs`);
  const title = runCount > 1
    ? `Year ${year} · ${pctLabel}`
    : `Year ${year} · ${pctLabel} · Simulation #${simIndex + 1}`;
  return { title, rows, footer: 'Click to see this path' };
}

const state = {
  heatmap: null,
  params: null,
  seed: null,
  outcome: null, // per-sim outcome tags from returnScatter (0 met / 1 below / 2 ran out)
  encoding: 'absolute', // 'absolute' | 'deviation'
  hovered: null, // { col, year } under the cursor
  selectedCol: null,
  geom: null,
  offscreen: null,
  offscreenKey: null, // encoding+mode the offscreen was painted for
  pathChart: null,
  balanceBars: null,
  resizeObserver: null,
  eventsBound: false,
};

function plotGeometry(canvas) {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  return {
    width,
    height,
    plotX: MARGIN.left,
    plotY: MARGIN.top,
    plotW: width - MARGIN.left - MARGIN.right,
    plotH: height - MARGIN.top - MARGIN.bottom,
  };
}

// Paint every cell once into a numCols × numYears offscreen canvas (one pixel
// per cell). NaN cells (no run active that year) stay transparent so the
// past-horizon region recedes to the page background.
function buildOffscreen() {
  const hm = state.heatmap;
  const isDark = isDarkMode();
  const key = `${state.encoding}:${isDark ? 'dark' : 'light'}`;
  if (state.offscreen && state.offscreenKey === key) return state.offscreen;

  const off = document.createElement('canvas');
  off.width = hm.numCols;
  off.height = hm.numYears;
  const ctx = off.getContext('2d');
  const img = ctx.createImageData(hm.numCols, hm.numYears);
  const data = img.data;

  for (let c = 0; c < hm.numCols; c++) {
    for (let j = 0; j < hm.numYears; j++) {
      const v = hm.values[c * hm.numYears + j];
      // ImageData is row-major: pixel (x=c, y=j).
      const p = (j * hm.numCols + c) * 4;
      if (Number.isNaN(v)) {
        data[p + 3] = 0;
        continue;
      }
      const rgb = state.encoding === 'deviation'
        ? divergingRgb(v - hm.planByYear[j], hm.deltaDomain.max, isDark)
        : sequentialRgb(v, hm.absDomain, isDark);
      data[p] = rgb[0];
      data[p + 1] = rgb[1];
      data[p + 2] = rgb[2];
      data[p + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  state.offscreen = off;
  state.offscreenKey = key;
  return off;
}

function drawAxes(ctx, theme, geom) {
  const hm = state.heatmap;
  ctx.fillStyle = theme.axisTick;
  ctx.font = '10px sans-serif';

  // X axis: percentile labels. Ranks map linearly onto the plot because the
  // columns partition the P5..P65 rank window evenly.
  const span = Math.max(1, hm.p65Rank - hm.p5Rank + 1);
  const xForRank = (rank) => geom.plotX + ((rank - hm.p5Rank + 0.5) / span) * geom.plotW;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.strokeStyle = theme.gridLine;
  ctx.lineWidth = 1;
  for (const pct of [5, 15, 25, 35, 45, 55, 65]) {
    const rank = Math.min(hm.p65Rank, Math.floor((hm.numSimulations * pct) / 100));
    if (rank < hm.p5Rank) continue;
    const x = xForRank(rank);
    ctx.beginPath();
    ctx.moveTo(x, geom.plotY + geom.plotH);
    ctx.lineTo(x, geom.plotY + geom.plotH + 4);
    ctx.stroke();
    ctx.fillText(`P${pct}`, x, geom.plotY + geom.plotH + 6);
  }

  // Y axis: years, year 1 at the top.
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  const yearStep = hm.numYears > 15 ? 5 : 1;
  for (let year = 1; year <= hm.numYears; year += yearStep) {
    const y = geom.plotY + ((year - 0.5) / hm.numYears) * geom.plotH;
    ctx.fillText(String(year), geom.plotX - 6, y);
  }

  ctx.fillStyle = theme.axisTitle;
  ctx.font = '11px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText('Outcome percentile (ranked by lifetime withdrawal)', geom.plotX + geom.plotW / 2, geom.height - 2);
  ctx.save();
  ctx.translate(12, geom.plotY + geom.plotH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textBaseline = 'top';
  ctx.fillText('Year', 0, 0);
  ctx.restore();
}

function cellRect(geom, col, year) {
  const hm = state.heatmap;
  const w = geom.plotW / hm.numCols;
  const h = geom.plotH / hm.numYears;
  return { x: geom.plotX + col * w, y: geom.plotY + year * h, w, h };
}

function drawHighlights(ctx, theme, geom) {
  // Selected column: a full-height outline so the drilled-down run stays located.
  if (state.selectedCol != null) {
    const r = cellRect(geom, state.selectedCol, 0);
    ctx.strokeStyle = theme.accent;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(r.x, geom.plotY, Math.max(r.w, 1.5), geom.plotH);
  }
  // Hovered cell outline.
  if (state.hovered) {
    const r = cellRect(geom, state.hovered.col, state.hovered.year);
    ctx.strokeStyle = theme.tooltipTitle;
    ctx.lineWidth = 1;
    ctx.strokeRect(r.x, r.y, Math.max(r.w, 1), Math.max(r.h, 1));
  }
}

function draw() {
  const canvas = document.getElementById('withdrawalHeatmapCanvas');
  if (!canvas || !state.heatmap) return;
  const geom = plotGeometry(canvas);
  if (geom.plotW <= 0 || geom.plotH <= 0) return;

  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(geom.width * dpr);
  canvas.height = Math.round(geom.height * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, geom.width, geom.height);
  state.geom = geom;

  const theme = getChartTheme();
  const off = buildOffscreen();
  // Nearest-neighbor scaling keeps each run's column a crisp vertical stripe
  // instead of smearing adjacent runs together.
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(off, geom.plotX, geom.plotY, geom.plotW, geom.plotH);
  ctx.imageSmoothingEnabled = true;

  drawAxes(ctx, theme, geom);
  drawHighlights(ctx, theme, geom);
}

// Legend: a gradient swatch with endpoint labels for the active encoding.
function renderLegend() {
  const el = document.getElementById('withdrawalHeatmapLegend');
  if (!el || !state.heatmap) return;
  const hm = state.heatmap;
  const mode = isDarkMode() ? 'dark' : 'light';
  const swatch = (gradient) =>
    `<span class="inline-block w-24 h-3 rounded-sm shrink-0" style="background:linear-gradient(to right, ${gradient})"></span>`;
  const item = (html) => `<span class="inline-flex items-center gap-1.5 text-xs text-theme-faint">${html}</span>`;

  const items = [];
  if (state.encoding === 'deviation') {
    const d = DIV_STOPS[mode];
    const max = hm.deltaDomain.max;
    items.push(item(`<span>−${formatK(max)} cut</span>${swatch(`${d.cut}, ${d.mid}, ${d.boost}`)}<span>+${formatK(max)} boost</span>`));
    items.push(item('<span>gray = on plan</span>'));
  } else {
    const s = SEQ_STOPS[mode];
    items.push(item(`<span>${formatK(hm.absDomain.lo)}</span>${swatch(s.join(', '))}<span>${formatK(hm.absDomain.hi)}</span>`));
  }
  items.push(item('<span>(color range clamped at P2–P98)</span>'));
  if (hm.colRunCount[0] > 1) {
    items.push(item(`<span>each column averages ~${hm.colRunCount[0]} adjacent runs</span>`));
  }
  el.innerHTML = items.join('');
}

const TOGGLE_ACTIVE = ['bg-theme-muted', 'text-theme-heading', 'font-semibold'];
const TOGGLE_INACTIVE = ['text-theme-faint'];

function syncToggleUi() {
  const abs = document.getElementById('withdrawalHeatmapModeAbs');
  const delta = document.getElementById('withdrawalHeatmapModeDelta');
  if (!abs || !delta) return;
  for (const [btn, active] of [[abs, state.encoding === 'absolute'], [delta, state.encoding === 'deviation']]) {
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    btn.classList.remove(...TOGGLE_ACTIVE, ...TOGGLE_INACTIVE);
    btn.classList.add(...(active ? TOGGLE_ACTIVE : TOGGLE_INACTIVE));
  }
}

function setEncoding(mode) {
  if (mode !== 'absolute' && mode !== 'deviation') return;
  if (state.encoding === mode) return;
  state.encoding = mode;
  syncToggleUi();
  renderLegend();
  draw();
}

function hitTest(ev) {
  const canvas = document.getElementById('withdrawalHeatmapCanvas');
  if (!canvas || !state.heatmap || !state.geom) return null;
  const rect = canvas.getBoundingClientRect();
  const col = heatmapColumnAtX(ev.clientX - rect.left, state.geom, state.heatmap.numCols);
  const year = heatmapYearAtY(ev.clientY - rect.top, state.geom, state.heatmap.numYears);
  if (col < 0 || year < 0) return null;
  // NaN cells (past every band run's horizon) are not interactive.
  if (Number.isNaN(state.heatmap.values[col * state.heatmap.numYears + year])) return null;
  return { col, year };
}

function showTooltip(ev, cell) {
  const tip = document.getElementById('withdrawalHeatmapTooltip');
  const canvas = document.getElementById('withdrawalHeatmapCanvas');
  if (!tip || !canvas) return;
  if (!cell) {
    tip.style.display = 'none';
    canvas.style.cursor = 'default';
    return;
  }
  const hm = state.heatmap;
  const theme = getChartTheme();
  const { title, rows, footer } = formatHeatmapTooltip({
    year: cell.year + 1,
    pctLabel: percentileLabelForRank(hm.colCenterRank[cell.col], hm.numSimulations),
    simIndex: hm.colSimIndex[cell.col],
    value: hm.values[cell.col * hm.numYears + cell.year],
    plan: hm.planByYear[cell.year],
    runCount: hm.colRunCount[cell.col],
  });
  tip.innerHTML =
    `<div style="font-weight:600;color:${theme.tooltipTitle}">${title}</div>` +
    rows.map((row) => `<div>${row}</div>`).join('') +
    `<div style="color:${theme.floatMutedText}">${footer}</div>`;
  tip.style.background = theme.tooltipBg;
  tip.style.color = theme.tooltipBody;
  tip.style.display = 'block';

  // Park the tip beside the cursor, flipping to the other side near the edges.
  const rect = canvas.getBoundingClientRect();
  const cx = ev.clientX - rect.left;
  const cy = ev.clientY - rect.top;
  const pad = 12;
  let left = cx + pad;
  let top = cy + pad;
  if (left + tip.offsetWidth > state.geom.width - 4) left = cx - tip.offsetWidth - pad;
  if (top + tip.offsetHeight > state.geom.height - 4) top = cy - tip.offsetHeight - pad;
  tip.style.left = `${Math.max(4, left)}px`;
  tip.style.top = `${Math.max(4, top)}px`;
  canvas.style.cursor = 'pointer';
}

const OUTCOME_LABELS = ['Met plan', 'Below plan', 'Ran out'];

// Drill into the column's representative run: same withdrawal-vs-plan line
// chart + linked balance bars as the 3D surface and IRR scatter popups.
function renderPathChart(col) {
  const container = document.getElementById('withdrawalHeatmapDrilldown');
  const titleEl = document.getElementById('withdrawalHeatmapDrilldownTitle');
  const metaEl = document.getElementById('withdrawalHeatmapDrilldownMeta');
  const canvas = document.getElementById('withdrawalHeatmapPathCanvas');
  const balanceCanvas = document.getElementById('withdrawalHeatmapBalanceCanvas');
  if (!container || !canvas || state.params == null || state.seed == null) return;

  const hm = state.heatmap;
  const simIndex = hm.colSimIndex[col];
  const re = regeneratePath(state.params, state.seed, simIndex);
  const outcomeIndex = state.outcome ? state.outcome[simIndex] : 0;
  const pctLabel = percentileLabelForRank(hm.colCenterRank[col], hm.numSimulations);
  const ranOutNote = re.depletionYear !== Infinity ? ` · ran out year ${re.depletionYear}` : '';

  if (titleEl) titleEl.textContent = `Simulation #${simIndex + 1} · ${pctLabel}`;
  if (metaEl) {
    metaEl.textContent = [
      `${OUTCOME_LABELS[outcomeIndex]}${ranOutNote}`,
      `Avg Return ${formatPercent(re.avgReturn)}`,
      `Total Withdrawn ${formatK(re.totalWithdrawn)}`,
      `End Balance ${formatK(re.finalBalance)}`,
    ].join(' · ');
  }
  container.classList.remove('hidden');

  const { withdrawals, unadjustedWithdrawals, balances, returns } = re.path;
  const series = {
    labels: withdrawals.map((_, y) => y + 1),
    actualData: withdrawals,
    unadjustedData: unadjustedWithdrawals,
    balanceData: withdrawals.map((_, y) => Math.max(0, balances[y + 1])),
    returnData: returns,
    depleted: outcomeIndex === 2,
    belowPlan: outcomeIndex === 1,
  };
  const detailsAt = (dataIndex) => ({
    year: dataIndex + 1,
    ret: returns[dataIndex],
    bal: balances[dataIndex + 1],
    wd: withdrawals[dataIndex],
    unadj: unadjustedWithdrawals[dataIndex],
    breakdown: re.path.withdrawalBreakdown?.[dataIndex] ?? null,
  });

  const theme = getChartTheme();
  if (state.pathChart) state.pathChart.destroy();
  state.pathChart = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels: series.labels,
      datasets: withdrawalComparisonDatasets(series, { portfolio: state.params.portfolio }),
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: 'index', intersect: false },
      scales: chartJsCartesianScales(
        theme,
        { beginAtZero: true, ticks: { callback: (v) => formatK(v) } },
        // The balance bar chart below carries the shared Year axis.
        { title: { display: false }, ticks: { display: false }, grid: { display: false } },
      ),
      plugins: {
        legend: {
          display: true,
          labels: { color: theme.legend, boxWidth: 14, boxHeight: 2, font: { size: 10 } },
        },
        tooltip: sampleRunTooltipOptions(withdrawalChartTooltipCallbacks(detailsAt)),
      },
      onHover: (_evt, activeElements) => {
        const index = activeElements.length > 0 ? activeElements[0].index : -1;
        state.balanceBars?.setHighlight(index);
      },
    },
  });

  if (!state.balanceBars && balanceCanvas) {
    state.balanceBars = createLinkedBalanceBars(balanceCanvas, () => state.pathChart);
    canvas.addEventListener('mouseleave', () => state.balanceBars?.reset());
  }
  state.balanceBars?.setSeries(series);
}

function onMouseMove(ev) {
  const cell = hitTest(ev);
  const changed =
    (cell === null) !== (state.hovered === null)
    || (cell && state.hovered && (cell.col !== state.hovered.col || cell.year !== state.hovered.year));
  state.hovered = cell;
  showTooltip(ev, cell);
  if (changed) draw();
}

function onMouseLeave() {
  const tip = document.getElementById('withdrawalHeatmapTooltip');
  if (tip) tip.style.display = 'none';
  if (state.hovered) {
    state.hovered = null;
    draw();
  }
}

function selectColumn(col) {
  state.selectedCol = col;
  draw();
  renderPathChart(col);
}

function onClick(ev) {
  const cell = hitTest(ev);
  if (!cell) return;
  selectColumn(cell.col);
}

function bindEvents(canvas) {
  if (state.eventsBound) return;
  canvas.addEventListener('mousemove', onMouseMove);
  canvas.addEventListener('mouseleave', onMouseLeave);
  canvas.addEventListener('click', onClick);
  document.getElementById('withdrawalHeatmapModeAbs')
    ?.addEventListener('click', () => setEncoding('absolute'));
  document.getElementById('withdrawalHeatmapModeDelta')
    ?.addEventListener('click', () => setEncoding('deviation'));
  state.resizeObserver = new ResizeObserver(() => draw());
  state.resizeObserver.observe(canvas.parentElement);
  state.eventsBound = true;
}

export function drawWithdrawalHeatmap(heatmap, { params, seed, outcome } = {}) {
  const canvas = document.getElementById('withdrawalHeatmapCanvas');
  if (!canvas || !heatmap) return;
  state.heatmap = heatmap;
  state.params = params ?? null;
  state.seed = seed ?? null;
  state.outcome = outcome ?? null;
  state.hovered = null;
  state.selectedCol = null;
  state.offscreen = null;
  state.offscreenKey = null;
  if (state.pathChart) {
    state.pathChart.destroy();
    state.pathChart = null;
  }
  document.getElementById('withdrawalHeatmapDrilldown')?.classList.add('hidden');
  bindEvents(canvas);
  syncToggleUi();
  renderLegend();
  draw();

  if (typeof window !== 'undefined') {
    window.__TEST_HOOKS__ = window.__TEST_HOOKS__ || {};
    window.__TEST_HOOKS__.withdrawalHeatmap = () => ({
      numCols: state.heatmap.numCols,
      numYears: state.heatmap.numYears,
      encoding: state.encoding,
    });
    window.__TEST_HOOKS__.withdrawalHeatmapSetEncoding = (mode) => setEncoding(mode);
    window.__TEST_HOOKS__.withdrawalHeatmapClickColumn = (col) => selectColumn(col);
  }
}

onThemeChange(() => {
  if (!state.heatmap) return;
  renderLegend();
  draw();
  if (state.selectedCol != null && state.pathChart) renderPathChart(state.selectedCol);
});
