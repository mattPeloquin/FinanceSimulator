// Sequence-of-returns scatter: each simulation's money-weighted return (IRR, y)
// against its time-weighted average return (x). Points on the diagonal had
// neutral sequencing; below it, early bad years hurt; above it, early good
// years helped. A horizontal line marks the plan's break-even IRR, so paths
// with good average returns that still failed stand out in the lower-right.
//
// Rendered straight to a canvas (fillRect per point) — the population can be
// tens of thousands of paths, which is far past what Chart.js scatters handle.
import { Chart } from './chartSetup.js';
import { withdrawalComparisonDatasets, withdrawalChartTooltipCallbacks } from './surface3d.js';
import { getChartTheme, chartJsTooltip, chartJsCartesianScales } from './chartTheme.js';
import { onThemeChange, isDarkMode } from '../theme.js';
import { formatPercent, formatK } from '../format.js';
import { regeneratePath } from '../../core/simulation.js';
import { median, percentileValue } from '../../core/statistics.js';
import { historicalIrrBand } from '../../core/historicalIrr.js';
import { createLinkedBalanceBars } from './balanceBars.js';

// Outcome status colors, one triplet per mode, in outcome-code order
// (0 = met plan, 1 = below plan, 2 = ran out). Both triplets validated with
// the palette checker (lightness band, chroma, CVD separation, contrast)
// against the app's light/dark surfaces. Below-plan matches the 3D surface's
// below-plan blue; ran-out matches status.danger.
const OUTCOME_COLORS = {
  light: ['#16a34a', '#0284c7', '#dc2626'],
  dark: ['#16a34a', '#0284c7', '#ef4444'],
};
const OUTCOME_LABELS = ['Met plan', 'Below plan', 'Ran out'];

const MARGIN = { top: 10, right: 14, bottom: 34, left: 52 };
const HIT_RADIUS_PX = 10;
// Both axes run from a fixed -4% up to at most +8%; the rare more-extreme
// paths fall off the plot rather than compressing the region where the
// sequence story lives.
const AXIS_MIN = -0.04;
const AXIS_CAP = 0.08;

const state = {
  scatter: null,
  params: null,
  seed: null,
  band: null, // P5–P60 of the plan's IRR backtested over contiguous historical windows
  selected: null, // sim index of the clicked path
  pathChart: null,
  balanceBars: null, // linked balance bar chart under the drill-down's line chart
  resizeObserver: null,
};

function outcomeColors() {
  return OUTCOME_COLORS[isDarkMode() ? 'dark' : 'light'];
}

// Round a raw interval up to a friendly 1/2/5 step.
function niceStep(rawStep) {
  const mag = 10 ** Math.floor(Math.log10(rawStep));
  const norm = rawStep / mag;
  if (norm <= 1) return mag;
  if (norm <= 2) return 2 * mag;
  if (norm <= 5) return 5 * mag;
  return 10 * mag;
}

function computeExtents(scatter) {
  const { avgReturn, irr, requiredIrr } = scatter;
  let xMin = Infinity;
  let xMax = -Infinity;
  let yMin = Infinity;
  let yMax = -Infinity;
  for (let i = 0; i < avgReturn.length; i++) {
    if (Number.isNaN(irr[i])) continue;
    if (avgReturn[i] < xMin) xMin = avgReturn[i];
    if (avgReturn[i] > xMax) xMax = avgReturn[i];
    if (irr[i] < yMin) yMin = irr[i];
    if (irr[i] > yMax) yMax = irr[i];
  }
  if (xMin === Infinity) return null;
  if (requiredIrr != null) {
    yMin = Math.min(yMin, requiredIrr);
    yMax = Math.max(yMax, requiredIrr);
  }
  if (state.band) {
    yMin = Math.min(yMin, state.band.low);
    yMax = Math.max(yMax, state.band.high);
  }
  const xPad = Math.max((xMax - xMin) * 0.05, 0.002);
  const yPad = Math.max((yMax - yMin) * 0.05, 0.002);
  return {
    xMin: AXIS_MIN,
    xMax: Math.min(xMax + xPad, AXIS_CAP),
    yMin: AXIS_MIN,
    yMax: Math.min(yMax + yPad, AXIS_CAP),
  };
}

// Whether point i sits inside the (possibly capped) axis extents.
function inExtents(scatter, extents, i) {
  const x = scatter.avgReturn[i];
  const y = scatter.irr[i];
  return !Number.isNaN(y) && x >= extents.xMin && x <= extents.xMax && y >= extents.yMin && y <= extents.yMax;
}

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

function makeScales(extents, geom) {
  const sx = (v) => geom.plotX + ((v - extents.xMin) / (extents.xMax - extents.xMin)) * geom.plotW;
  const sy = (v) => geom.plotY + geom.plotH - ((v - extents.yMin) / (extents.yMax - extents.yMin)) * geom.plotH;
  return { sx, sy };
}

function drawAxes(ctx, theme, extents, geom, scales) {
  const { sx, sy } = scales;
  ctx.strokeStyle = theme.gridLine;
  ctx.fillStyle = theme.axisTick;
  ctx.lineWidth = 1;
  ctx.font = '10px sans-serif';

  const xStep = niceStep((extents.xMax - extents.xMin) / 8);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (let v = Math.ceil(extents.xMin / xStep) * xStep; v <= extents.xMax; v += xStep) {
    const x = sx(v);
    ctx.beginPath();
    ctx.moveTo(x, geom.plotY);
    ctx.lineTo(x, geom.plotY + geom.plotH);
    ctx.stroke();
    ctx.fillText(`${(v * 100).toFixed(Math.abs(xStep) < 0.01 ? 1 : 0)}%`, x, geom.plotY + geom.plotH + 5);
  }

  const yStep = niceStep((extents.yMax - extents.yMin) / 6);
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let v = Math.ceil(extents.yMin / yStep) * yStep; v <= extents.yMax; v += yStep) {
    const y = sy(v);
    ctx.beginPath();
    ctx.moveTo(geom.plotX, y);
    ctx.lineTo(geom.plotX + geom.plotW, y);
    ctx.stroke();
    ctx.fillText(`${(v * 100).toFixed(Math.abs(yStep) < 0.01 ? 1 : 0)}%`, geom.plotX - 6, y);
  }

  ctx.fillStyle = theme.axisTitle;
  ctx.font = '11px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText('Avg Annual Real Return (time-weighted)', geom.plotX + geom.plotW / 2, geom.height - 2);
  ctx.save();
  ctx.translate(12, geom.plotY + geom.plotH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textBaseline = 'top';
  ctx.fillText('IRR (money-weighted)', 0, 0);
  ctx.restore();
}

// Soft horizontal band: the P5–P60 range of the plan's money-weighted IRR when
// run over every contiguous horizon-length window of the user's selected
// historical years — the same quantity as the y-axis, sequence risk included.
function drawHistoricalBand(ctx, theme, geom, scales) {
  if (!state.band) return;
  const plotTop = geom.plotY;
  const plotBottom = geom.plotY + geom.plotH;
  const yTop = Math.max(plotTop, Math.min(plotBottom, scales.sy(state.band.high)));
  const yBottom = Math.max(plotTop, Math.min(plotBottom, scales.sy(state.band.low)));
  ctx.fillStyle = theme.planFill;
  ctx.fillRect(geom.plotX, yTop, geom.plotW, yBottom - yTop);
  // Solid edge lines: the P5–P60 band can be a narrow strip, and the soft fill
  // alone disappears under the grid lines.
  ctx.strokeStyle = theme.planLine;
  ctx.lineWidth = 1;
  for (const y of [yTop, yBottom]) {
    ctx.beginPath();
    ctx.moveTo(geom.plotX, y);
    ctx.lineTo(geom.plotX + geom.plotW, y);
    ctx.stroke();
  }
}

function drawReferenceLines(ctx, theme, scatter, extents, geom, scales) {
  const { sx, sy } = scales;
  ctx.save();
  ctx.setLineDash([5, 4]);
  ctx.lineWidth = 1;

  // Diagonal IRR = avg return: neutral sequencing.
  ctx.strokeStyle = theme.zeroLine;
  const dLo = Math.max(extents.xMin, extents.yMin);
  const dHi = Math.min(extents.xMax, extents.yMax);
  if (dHi > dLo) {
    ctx.beginPath();
    ctx.moveTo(sx(dLo), sy(dLo));
    ctx.lineTo(sx(dHi), sy(dHi));
    ctx.stroke();
    ctx.fillStyle = theme.axisTick;
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.fillText('IRR = Avg', sx(dHi) - 2, sy(dHi) - 2);
  }

  // Break-even IRR required to fund the full plan.
  if (scatter.requiredIrr != null) {
    const y = sy(scatter.requiredIrr);
    ctx.strokeStyle = outcomeColors()[2];
    ctx.beginPath();
    ctx.moveTo(geom.plotX, y);
    ctx.lineTo(geom.plotX + geom.plotW, y);
    ctx.stroke();
    ctx.fillStyle = theme.axisTick;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillText(`Required IRR ${formatPercent(scatter.requiredIrr)}`, geom.plotX + 4, y - 2);
  }
  ctx.restore();
}

function drawPoints(ctx, scatter, extents, scales, colors) {
  const { avgReturn, irr, outcome } = scatter;
  const n = avgReturn.length;
  const size = n > 2000 ? 3.5 : 4.5;
  const half = size / 2;
  // Met-plan first, failures on top, so the sparse-but-important points survive
  // overplotting in dense regions.
  for (const pass of [0, 1, 2]) {
    ctx.fillStyle = colors[pass];
    ctx.globalAlpha = 0.25;
    for (let i = 0; i < n; i++) {
      if (outcome[i] !== pass || !inExtents(scatter, extents, i)) continue;
      ctx.fillRect(scales.sx(avgReturn[i]) - half, scales.sy(irr[i]) - half, size, size);
    }
  }
  ctx.globalAlpha = 1;
}

function drawSelection(ctx, theme, scatter, scales) {
  if (state.selected == null) return;
  const i = state.selected;
  if (!inExtents(scatter, state.extents, i)) return;
  ctx.strokeStyle = theme.tooltipTitle;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(scales.sx(scatter.avgReturn[i]), scales.sy(scatter.irr[i]), 5.5, 0, Math.PI * 2);
  ctx.stroke();
}

function draw() {
  const canvas = document.getElementById('irrScatterCanvas');
  if (!canvas || !state.scatter) return;
  const geom = plotGeometry(canvas);
  if (geom.plotW <= 0 || geom.plotH <= 0) return;

  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(geom.width * dpr);
  canvas.height = Math.round(geom.height * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, geom.width, geom.height);

  const extents = computeExtents(state.scatter);
  if (!extents) return;
  state.extents = extents;
  state.geom = geom;

  const theme = getChartTheme();
  const scales = makeScales(extents, geom);
  drawHistoricalBand(ctx, theme, geom, scales);
  drawAxes(ctx, theme, extents, geom, scales);
  drawReferenceLines(ctx, theme, state.scatter, extents, geom, scales);
  drawPoints(ctx, state.scatter, extents, scales, outcomeColors());
  drawSelection(ctx, theme, state.scatter, scales);
}

function renderLegend() {
  const el = document.getElementById('irrScatterLegend');
  if (!el || !state.scatter) return;
  const colors = outcomeColors();
  const theme = getChartTheme();
  const items = OUTCOME_LABELS.map(
    (label, i) =>
      `<span class="inline-flex items-center gap-1.5 text-xs text-theme-faint">` +
      `<span class="inline-block w-3 h-3 rounded-sm shrink-0" style="background:${colors[i]}"></span>${label}</span>`,
  );
  items.push(
    `<span class="inline-flex items-center gap-1.5 text-xs text-theme-faint">` +
      `<span class="inline-block w-4 border-t border-dashed shrink-0" style="border-color:${theme.zeroLine}"></span>IRR = Avg (neutral sequence)</span>`,
  );
  if (state.scatter.requiredIrr != null) {
    items.push(
      `<span class="inline-flex items-center gap-1.5 text-xs text-theme-faint" title="Money-weighted return at which the planned withdrawals exactly exhaust the starting balance">` +
        `<span class="inline-block w-4 border-t border-dashed shrink-0" style="border-color:${colors[2]}"></span>Required IRR to fund plan</span>`,
    );
  }
  if (state.band) {
    const { startYear, endYear } = state.params?.samples ?? {};
    const rangeNote =
      startYear != null && endYear != null ? `your selected years (${startYear}–${endYear})` : 'your selected years';
    const wrapNote = state.band.wrapped
      ? '; the selection is shorter than the horizon, so windows wrap around it'
      : '';
    items.push(
      `<span class="inline-flex items-center gap-1.5 text-xs text-theme-faint" title="P5–P60 of your plan's money-weighted IRR when run over all ${state.band.windows} contiguous ${state.params?.numYears}-year sequences from ${rangeNote}${wrapNote}">` +
        `<span class="inline-block w-4 h-3 rounded-sm shrink-0" style="background:${theme.planFill};border:1px solid ${theme.planLine}"></span>Historical IRR range (${state.params?.numYears}-yr windows)</span>`,
    );
  }
  let excluded = 0;
  for (let i = 0; i < state.scatter.irr.length; i++) {
    if (Number.isNaN(state.scatter.irr[i])) excluded++;
  }
  if (excluded > 0) {
    items.push(`<span class="text-xs text-theme-faint">(${excluded} paths without a defined IRR excluded)</span>`);
  }
  el.innerHTML = items.join('');
}

// Headline IRR numbers (shown above the IRR distribution histogram): median
// IRR, the plan's break-even IRR, and the P10–P90 spread of the per-path
// sequence effect (IRR − avg return: how far sequencing alone can move an
// outcome, holding average returns fixed).
function renderSummaryCards() {
  const setCard = (id, text) => {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  };
  const { avgReturn, irr, requiredIrr } = state.scatter;

  const finiteIrr = [];
  const drag = [];
  for (let i = 0; i < avgReturn.length; i++) {
    if (Number.isNaN(irr[i])) continue;
    finiteIrr.push(irr[i]);
    drag.push(irr[i] - avgReturn[i]);
  }

  setCard('seqMedianIrr', finiteIrr.length ? formatPercent(median(finiteIrr)) : '—');
  setCard('seqRequiredIrr', requiredIrr != null ? formatPercent(requiredIrr) : '—');
  if (drag.length) {
    const lo = percentileValue(drag, 0.1);
    const hi = percentileValue(drag, 0.9);
    setCard('seqDrag', `${formatPercent(lo)} to ${hi > 0 ? '+' : ''}${formatPercent(hi)}`);
  } else {
    setCard('seqDrag', '—');
  }
}

// Nearest point within the hit radius of a mouse event, or -1.
function hitTest(ev) {
  const canvas = document.getElementById('irrScatterCanvas');
  if (!canvas || !state.scatter || !state.extents) return -1;
  const rect = canvas.getBoundingClientRect();
  const mx = ev.clientX - rect.left;
  const my = ev.clientY - rect.top;
  const scales = makeScales(state.extents, state.geom);
  const { avgReturn, irr } = state.scatter;
  let best = -1;
  let bestDist = HIT_RADIUS_PX * HIT_RADIUS_PX;
  for (let i = 0; i < avgReturn.length; i++) {
    if (!inExtents(state.scatter, state.extents, i)) continue;
    const dx = scales.sx(avgReturn[i]) - mx;
    const dy = scales.sy(irr[i]) - my;
    const d = dx * dx + dy * dy;
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

function showTooltip(ev, i) {
  const tip = document.getElementById('irrScatterTooltip');
  const canvas = document.getElementById('irrScatterCanvas');
  if (!tip || !canvas) return;
  if (i < 0) {
    tip.style.display = 'none';
    canvas.style.cursor = 'default';
    return;
  }
  const { avgReturn, irr, outcome } = state.scatter;
  const theme = getChartTheme();
  tip.innerHTML =
    `<div style="font-weight:600;color:${theme.tooltipTitle}">Simulation #${i + 1} · ${OUTCOME_LABELS[outcome[i]]}</div>` +
    `<div>Avg Return: ${formatPercent(avgReturn[i])}</div>` +
    `<div>IRR: ${formatPercent(irr[i])}</div>` +
    `<div style="color:${theme.floatMutedText}">Click to see this path</div>`;
  tip.style.background = theme.tooltipBg;
  tip.style.color = theme.tooltipBody;
  const rect = canvas.getBoundingClientRect();
  const x = ev.clientX - rect.left;
  const y = ev.clientY - rect.top;
  tip.style.display = 'block';
  tip.style.left = `${Math.min(x + 12, rect.width - tip.offsetWidth - 4)}px`;
  tip.style.top = `${Math.max(y - tip.offsetHeight - 8, 4)}px`;
  canvas.style.cursor = 'pointer';
}

function renderPathChart(i) {
  const container = document.getElementById('irrScatterDrilldown');
  const titleEl = document.getElementById('irrScatterDrilldownTitle');
  const canvas = document.getElementById('irrScatterPathCanvas');
  const balanceCanvas = document.getElementById('irrScatterBalanceCanvas');
  if (!container || !canvas || state.params == null || state.seed == null) return;

  const re = regeneratePath(state.params, state.seed, i);
  const { outcome } = state.scatter;
  const ranOutNote = re.depletionYear !== Infinity ? ` · ran out year ${re.depletionYear}` : '';
  if (titleEl) {
    titleEl.textContent =
      `Simulation #${i + 1} · ${OUTCOME_LABELS[outcome[i]]}${ranOutNote}` +
      ` · Avg Return ${formatPercent(re.avgReturn)} · IRR ${formatPercent(re.irr) || '—'}` +
      ` · Total Withdrawn ${formatK(re.totalWithdrawn)}`;
  }
  container.classList.remove('hidden');

  // Same withdrawal-vs-plan chart as the 3D chart's popup: actual withdrawals
  // against the original plan, with minimum-floor and gift-ceiling overlays,
  // colored by the path's outcome, plus the linked balance bar chart below.
  const { withdrawals, unadjustedWithdrawals, balances, returns } = re.path;
  const series = {
    labels: withdrawals.map((_, y) => y + 1),
    actualData: withdrawals,
    unadjustedData: unadjustedWithdrawals,
    balanceData: withdrawals.map((_, y) => Math.max(0, balances[y + 1])),
    returnData: returns,
    depleted: outcome[i] === 2,
    belowPlan: outcome[i] === 1,
  };
  const detailsAt = (dataIndex) => ({
    year: dataIndex + 1,
    ret: returns[dataIndex],
    bal: balances[dataIndex + 1],
    wd: withdrawals[dataIndex],
    unadj: unadjustedWithdrawals[dataIndex],
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
        tooltip: {
          ...chartJsTooltip(theme),
          displayColors: false,
          callbacks: withdrawalChartTooltipCallbacks(detailsAt),
        },
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
  showTooltip(ev, hitTest(ev));
}

function onMouseLeave() {
  const tip = document.getElementById('irrScatterTooltip');
  if (tip) tip.style.display = 'none';
}

function onClick(ev) {
  const i = hitTest(ev);
  if (i < 0) return;
  state.selected = i;
  draw();
  renderPathChart(i);
}

function bindEvents(canvas) {
  if (state.eventsBound) return;
  canvas.addEventListener('mousemove', onMouseMove);
  canvas.addEventListener('mouseleave', onMouseLeave);
  canvas.addEventListener('click', onClick);
  // The canvas sits inside a <details>; it has zero size until opened, so
  // observe the container and (re)draw whenever it gains real dimensions.
  state.resizeObserver = new ResizeObserver(() => draw());
  state.resizeObserver.observe(canvas.parentElement);
  state.eventsBound = true;
}

export function drawIrrScatter(scatter, { params, seed } = {}) {
  const canvas = document.getElementById('irrScatterCanvas');
  if (!canvas || !scatter) return;
  state.scatter = scatter;
  state.params = params ?? null;
  state.seed = seed ?? null;
  state.band = historicalIrrBand(params);
  state.selected = null;
  if (state.pathChart) {
    state.pathChart.destroy();
    state.pathChart = null;
  }
  document.getElementById('irrScatterDrilldown')?.classList.add('hidden');
  bindEvents(canvas);
  renderSummaryCards();
  renderLegend();
  draw();
}

onThemeChange(() => {
  if (!state.scatter) return;
  renderLegend();
  draw();
  if (state.selected != null && state.pathChart) renderPathChart(state.selected);
});
