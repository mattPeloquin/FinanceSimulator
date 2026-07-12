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
import { getChartTheme, chartJsCartesianScales, sampleRunTooltipOptions } from './chartTheme.js';
import { onThemeChange, isDarkMode } from '../theme.js';
import { formatPercent, formatK } from '../format.js';
import { regeneratePath } from '../../core/simulation.js';
import { median, percentileValue } from '../../core/statistics.js';
import { historicalIrrBand } from '../../core/historicalIrr.js';
import { percentileLabelForRank } from '../../core/surfaceDrilldown.js';
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
// Default plot window: both axes span −4% to +8%. The zoom control scales this
// window in and out around its center; zoom-out stops at the data envelope.
const AXIS_MIN = -0.04;
const AXIS_CAP = 0.08;
const AXIS_CENTER = (AXIS_MIN + AXIS_CAP) / 2;
const AXIS_HALF = (AXIS_CAP - AXIS_MIN) / 2;
const ZOOM_SLIDER_DEFAULT = 50;
const MIN_AXIS_HALF = 0.002;
const ZOOM_IN_MAX = 4;
const ZOOM_OUT_MIN = 0.25;
const ZOOM_DRAW_DEBOUNCE_MS = 16;

const state = {
  scatter: null,
  params: null,
  seed: null,
  simRank: null, // withdrawal-rank of each simulation (inverse of surfaceMeta.rankW)
  band: null, // P5–P65 of the plan's IRR backtested over contiguous historical windows
  dataProfile: null, // finite-point envelope used to cap zoom-out
  zoomSlider: ZOOM_SLIDER_DEFAULT,
  zoomDrawTimer: null,
  selected: null, // sim index of the clicked path
  tooltipSide: null, // sticky 'ne'|'nw'|'se'|'sw' while hovering the scatter
  pathChart: null,
  balanceBars: null, // linked balance bar chart under the drill-down's line chart
  resizeObserver: null,
};

function outcomeColors() {
  return OUTCOME_COLORS[isDarkMode() ? 'dark' : 'light'];
}

// Map each simulation index to its withdrawal rank (same ordering as percentile cards).
function buildSimRank(rankW) {
  const n = rankW.length;
  const simRank = new Int32Array(n);
  for (let r = 0; r < n; r++) simRank[rankW[r]] = r;
  return simRank;
}

function simPercentileLabel(simIndex) {
  if (!state.simRank) return '';
  return percentileLabelForRank(state.simRank[simIndex], state.simRank.length);
}

function simTitleLabel(simIndex) {
  const pctLabel = simPercentileLabel(simIndex);
  return pctLabel ? `Simulation #${simIndex + 1} · ${pctLabel}` : `Simulation #${simIndex + 1}`;
}

function pathSummaryItems({ outcomeIndex, avgReturn, irr, totalWithdrawn, finalBalance, ranOutNote = '' }) {
  return [
    `${OUTCOME_LABELS[outcomeIndex]}${ranOutNote}`,
    `Avg Return ${formatPercent(avgReturn)}`,
    `IRR ${formatPercent(irr) || '—'}`,
    `Total Withdrawn ${formatK(totalWithdrawn)}`,
    `End Balance ${formatK(finalBalance)}`,
  ];
}

function pathSummaryLine(details) {
  return pathSummaryItems(details).join(' · ');
}

const TOOLTIP_POINT_HALF = 5.5;
// Gap from the selected dot to the tooltip edge — keeps the tip clearly
// offset from the point rather than hugging it.
const TOOLTIP_GAP = 14;
// Clearance around the cursor hotspot so the tip never sits under the pointer.
const TOOLTIP_POINTER_CLEAR = 18;
const TOOLTIP_EDGE_PAD = 4;
// Stable corner order relative to the data point. Do not pick the primary
// corner from the cursor side — that flipped every time the mouse crossed a
// dot's center and flashed the tip left/right while sweeping the cloud.
const TOOLTIP_SIDE_ORDER = ['ne', 'nw', 'se', 'sw'];

function rectOverlapsPoint(left, top, tipW, tipH, x, y, clear) {
  return (
    left < x + clear
    && left + tipW > x - clear
    && top < y + clear
    && top + tipH > y - clear
  );
}

function clampTip(left, top, tipW, tipH, canvasW, canvasH, pad) {
  return {
    left: Math.min(Math.max(left, pad), Math.max(pad, canvasW - tipW - pad)),
    top: Math.min(Math.max(top, pad), Math.max(pad, canvasH - tipH - pad)),
  };
}

function tooltipCorners(pointX, pointY, tipW, tipH, pointClear) {
  const right = pointX + pointClear;
  const leftAligned = pointX - tipW - pointClear;
  const above = pointY - tipH - pointClear;
  const below = pointY + pointClear;
  return {
    ne: { left: right, top: above },
    nw: { left: leftAligned, top: above },
    se: { left: right, top: below },
    sw: { left: leftAligned, top: below },
  };
}

// Pick a canvas-local top-left for the IRR scatter tooltip: offset from the
// selected data point, with sticky corner preference so sweeping across dots
// does not flip the tip side-to-side. Avoids covering the pointer when possible.
export function chooseIrrScatterTooltipPosition({
  tipW,
  tipH,
  canvasW,
  canvasH,
  pointX,
  pointY,
  cursorX = pointX,
  cursorY = pointY,
  stickySide = null,
}) {
  const pad = TOOLTIP_EDGE_PAD;
  const pointClear = TOOLTIP_POINT_HALF + TOOLTIP_GAP;
  const pointerClear = TOOLTIP_POINTER_CLEAR;
  const corners = tooltipCorners(pointX, pointY, tipW, tipH, pointClear);

  const isClear = (left, top) =>
    !rectOverlapsPoint(left, top, tipW, tipH, pointX, pointY, pointClear)
    && !rectOverlapsPoint(left, top, tipW, tipH, cursorX, cursorY, pointerClear);

  const inBounds = (left, top) =>
    left >= pad
    && top >= pad
    && left + tipW <= canvasW - pad
    && top + tipH <= canvasH - pad;

  // Keep the previous corner first when still valid — prevents flicker while
  // the cursor crosses successive dots or a single point's center.
  const order = stickySide && corners[stickySide]
    ? [stickySide, ...TOOLTIP_SIDE_ORDER.filter((side) => side !== stickySide)]
    : TOOLTIP_SIDE_ORDER;

  for (const side of order) {
    const candidate = corners[side];
    if (!isClear(candidate.left, candidate.top)) continue;
    if (!inBounds(candidate.left, candidate.top)) continue;
    return { left: candidate.left, top: candidate.top, side };
  }

  // Prefer a clear corner even if it needs clamping (near edges).
  for (const side of order) {
    const candidate = corners[side];
    if (!isClear(candidate.left, candidate.top)) continue;
    const clamped = clampTip(candidate.left, candidate.top, tipW, tipH, canvasW, canvasH, pad);
    if (isClear(clamped.left, clamped.top)) {
      return { ...clamped, side };
    }
  }

  // Last resort: park beside the cursor with a fixed SE bias (stable).
  let left = cursorX + pointerClear;
  let top = cursorY + pointerClear;
  ({ left, top } = clampTip(left, top, tipW, tipH, canvasW, canvasH, pad));
  if (rectOverlapsPoint(left, top, tipW, tipH, cursorX, cursorY, pointerClear)) {
    const shifts = [
      { left: cursorX + pointerClear, top: cursorY + pointerClear },
      { left: cursorX + pointerClear, top: cursorY - tipH - pointerClear },
      { left: cursorX - tipW - pointerClear, top: cursorY + pointerClear },
      { left: cursorX - tipW - pointerClear, top: cursorY - tipH - pointerClear },
    ];
    const rescued = shifts
      .map((s) => clampTip(s.left, s.top, tipW, tipH, canvasW, canvasH, pad))
      .find((s) => isClear(s.left, s.top));
    if (rescued) ({ left, top } = rescued);
  }
  return { left, top, side: stickySide || 'se' };
}

function positionIrrScatterTooltip(tip, geom, pointX, pointY, cursorX, cursorY) {
  const { left, top, side } = chooseIrrScatterTooltipPosition({
    tipW: tip.offsetWidth,
    tipH: tip.offsetHeight,
    canvasW: geom.width,
    canvasH: geom.height,
    pointX,
    pointY,
    cursorX,
    cursorY,
    stickySide: state.tooltipSide,
  });
  state.tooltipSide = side;
  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
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

// Flipped slider: left = zoom in, right = zoom out, center = default −4%/+8%.
// Zoom-in uses a square-root curve so the left end is less twitchy at high magnification.
export function irrScatterZoomScale(slider, defaultSlider = ZOOM_SLIDER_DEFAULT) {
  if (slider === defaultSlider) return 1;
  if (slider < defaultSlider) {
    const t = (defaultSlider - slider) / defaultSlider;
    return 1 + (ZOOM_IN_MAX - 1) * Math.sqrt(t);
  }
  const u = (slider - defaultSlider) / (100 - defaultSlider);
  return 1 / (1 + (1 / ZOOM_OUT_MIN - 1) * u);
}

// How many finite paths fall inside a candidate axis window.
export function irrScatterVisibleCount(scatter, extents) {
  let visible = 0;
  for (let i = 0; i < scatter.avgReturn.length; i++) {
    if (inExtents(scatter, extents, i)) visible++;
  }
  return visible;
}

// Data envelope for zoom-out plus the share of paths the default −4%/+8% window captures.
export function buildIrrScatterDataProfile(scatter, band = null) {
  const { avgReturn, irr, requiredIrr } = scatter;
  let xMin = Infinity;
  let xMax = -Infinity;
  let yMin = Infinity;
  let yMax = -Infinity;
  let visibleAtDefault = 0;
  let finite = 0;
  for (let i = 0; i < avgReturn.length; i++) {
    if (Number.isNaN(irr[i])) continue;
    finite++;
    const x = avgReturn[i];
    const y = irr[i];
    if (x < xMin) xMin = x;
    if (x > xMax) xMax = x;
    if (y < yMin) yMin = y;
    if (y > yMax) yMax = y;
    if (x >= AXIS_MIN && x <= AXIS_CAP && y >= AXIS_MIN && y <= AXIS_CAP) visibleAtDefault++;
  }
  if (finite === 0) return null;
  if (requiredIrr != null) {
    yMin = Math.min(yMin, requiredIrr);
    yMax = Math.max(yMax, requiredIrr);
  }
  if (band) {
    yMin = Math.min(yMin, band.low);
    yMax = Math.max(yMax, band.high);
  }
  const xPad = Math.max((xMax - xMin) * 0.05, 0.002);
  const yPad = Math.max((yMax - yMin) * 0.05, 0.002);
  return {
    xMin: xMin - xPad,
    xMax: xMax + xPad,
    yMin: yMin - yPad,
    yMax: yMax + yPad,
    finite,
    defaultVisiblePct: (visibleAtDefault / finite) * 100,
  };
}

export function computeIrrScatterExtents(scatter, { zoomSlider, dataProfile }) {
  if (!dataProfile) return null;
  const half = Math.max(AXIS_HALF / irrScatterZoomScale(zoomSlider), MIN_AXIS_HALF);
  let xMin = AXIS_CENTER - half;
  let xMax = AXIS_CENTER + half;
  let yMin = AXIS_CENTER - half;
  let yMax = AXIS_CENTER + half;
  // Only cap zoom-out at the data envelope — never shrink the default window.
  if (xMin < AXIS_MIN) xMin = Math.max(xMin, dataProfile.xMin);
  if (xMax > AXIS_CAP) xMax = Math.min(xMax, dataProfile.xMax);
  if (yMin < AXIS_MIN) yMin = Math.max(yMin, dataProfile.yMin);
  if (yMax > AXIS_CAP) yMax = Math.min(yMax, dataProfile.yMax);
  return { xMin, xMax, yMin, yMax };
}

function renderZoomLabel() {
  const label = document.getElementById('irrScatterZoomLabel');
  if (!label || !state.scatter || !state.extents || !state.dataProfile) return;
  const visible = irrScatterVisibleCount(state.scatter, state.extents);
  const pct = Math.round((visible / state.dataProfile.finite) * 100);
  label.textContent = `~${pct}% of paths`;
}

function scheduleZoomDraw() {
  if (state.zoomDrawTimer != null) clearTimeout(state.zoomDrawTimer);
  state.zoomDrawTimer = setTimeout(() => {
    state.zoomDrawTimer = null;
    draw();
  }, ZOOM_DRAW_DEBOUNCE_MS);
}

function syncZoomPreview() {
  if (!state.scatter) return;
  const extents = computeExtents(state.scatter);
  if (!extents) return;
  state.extents = extents;
  renderZoomLabel();
}

function computeExtents(scatter) {
  return computeIrrScatterExtents(scatter, {
    zoomSlider: state.zoomSlider,
    dataProfile: state.dataProfile,
  });
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

// Soft horizontal band: the P5–P65 range of the plan's money-weighted IRR when
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
  // Solid edge lines: the P5–P65 band can be a narrow strip, and the soft fill
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
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('IRR = Avg', sx(dLo) + 2, sy(dLo) + 2);
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
  renderZoomLabel();
  renderLegend();
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
      `<span class="inline-flex items-center gap-1.5 text-xs text-theme-faint" title="P5–P65 of your plan's money-weighted IRR when run over all ${state.band.windows} contiguous ${state.params?.numYears}-year sequences from ${rangeNote}${wrapNote}">` +
        `<span class="inline-block w-4 h-3 rounded-sm shrink-0" style="background:${theme.planFill};border:1px solid ${theme.planLine}"></span>Historical IRR range (${state.params?.numYears}-yr windows)</span>`,
    );
  }
  let excluded = 0;
  let offChart = 0;
  for (let i = 0; i < state.scatter.irr.length; i++) {
    if (Number.isNaN(state.scatter.irr[i])) excluded++;
    else if (state.extents && !inExtents(state.scatter, state.extents, i)) offChart++;
  }
  if (excluded > 0) {
    items.push(`<span class="text-xs text-theme-faint">(${excluded} paths without a defined IRR excluded)</span>`);
  }
  if (offChart > 0) {
    items.push(`<span class="text-xs text-theme-faint">(${offChart} paths outside current view)</span>`);
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
    state.tooltipSide = null;
    return;
  }
  const { avgReturn, irr, outcome, totalWithdrawn, finalBalance } = state.scatter;
  const theme = getChartTheme();
  const summaryRows = pathSummaryItems({
    outcomeIndex: outcome[i],
    avgReturn: avgReturn[i],
    irr: irr[i],
    totalWithdrawn: totalWithdrawn[i],
    finalBalance: finalBalance[i],
  });
  tip.innerHTML =
    `<div style="font-weight:600;color:${theme.tooltipTitle}">${simTitleLabel(i)}</div>` +
    summaryRows.map((row) => `<div>${row}</div>`).join('') +
    `<div style="color:${theme.floatMutedText}">Click to see this path</div>`;
  tip.style.background = theme.tooltipBg;
  tip.style.color = theme.tooltipBody;
  tip.style.display = 'block';
  if (!state.extents || !state.geom) return;

  const scales = makeScales(state.extents, state.geom);
  const pointX = scales.sx(avgReturn[i]);
  const pointY = scales.sy(irr[i]);
  const rect = canvas.getBoundingClientRect();
  const cursorX = ev.clientX - rect.left;
  const cursorY = ev.clientY - rect.top;
  positionIrrScatterTooltip(tip, state.geom, pointX, pointY, cursorX, cursorY);
  canvas.style.cursor = 'pointer';
}

function renderPathChart(i) {
  const container = document.getElementById('irrScatterDrilldown');
  const titleEl = document.getElementById('irrScatterDrilldownTitle');
  const metaEl = document.getElementById('irrScatterDrilldownMeta');
  const canvas = document.getElementById('irrScatterPathCanvas');
  const balanceCanvas = document.getElementById('irrScatterBalanceCanvas');
  if (!container || !canvas || state.params == null || state.seed == null) return;

  const re = regeneratePath(state.params, state.seed, i);
  const { outcome } = state.scatter;
  const ranOutNote = re.depletionYear !== Infinity ? ` · ran out year ${re.depletionYear}` : '';
  if (titleEl) titleEl.textContent = simTitleLabel(i);
  if (metaEl) {
    metaEl.textContent = pathSummaryLine({
      outcomeIndex: outcome[i],
      avgReturn: re.avgReturn,
      irr: re.irr,
      totalWithdrawn: re.totalWithdrawn,
      finalBalance: re.finalBalance,
      ranOutNote,
    });
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

  if (typeof window !== 'undefined') {
    window.__TEST_HOOKS__ = window.__TEST_HOOKS__ || {};
    window.__TEST_HOOKS__.irrScatterPathChart = () => state.pathChart;
    window.__TEST_HOOKS__.irrScatterBreakdownSample = () => {
      const bd = re.path.withdrawalBreakdown?.[0] ?? null;
      if (!bd) return null;
      return {
        actual: bd.actual,
        plan: bd.plan,
        dynamicAdj: bd.dynamicAdj,
        scaleDelta: bd.scaleDelta,
      };
    };
  }
}

function onMouseMove(ev) {
  showTooltip(ev, hitTest(ev));
}

function onMouseLeave() {
  const tip = document.getElementById('irrScatterTooltip');
  if (tip) tip.style.display = 'none';
  state.tooltipSide = null;
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
  const zoom = document.getElementById('irrScatterZoom');
  if (zoom) {
    zoom.addEventListener('input', () => {
      state.zoomSlider = Number(zoom.value);
      syncZoomPreview();
      scheduleZoomDraw();
    });
  }
  // The canvas sits inside a <details>; it has zero size until opened, so
  // observe the container and (re)draw whenever it gains real dimensions.
  state.resizeObserver = new ResizeObserver(() => draw());
  state.resizeObserver.observe(canvas.parentElement);
  state.eventsBound = true;
}

export function drawIrrScatter(scatter, { params, seed, meta } = {}) {
  const canvas = document.getElementById('irrScatterCanvas');
  if (!canvas || !scatter) return;
  state.scatter = scatter;
  state.params = params ?? null;
  state.seed = seed ?? null;
  state.simRank = meta?.rankW ? buildSimRank(meta.rankW) : null;
  state.band = historicalIrrBand(params);
  state.dataProfile = buildIrrScatterDataProfile(scatter, state.band);
  state.zoomSlider = ZOOM_SLIDER_DEFAULT;
  if (state.zoomDrawTimer != null) {
    clearTimeout(state.zoomDrawTimer);
    state.zoomDrawTimer = null;
  }
  state.selected = null;
  const zoom = document.getElementById('irrScatterZoom');
  if (zoom) zoom.value = String(ZOOM_SLIDER_DEFAULT);
  if (state.pathChart) {
    state.pathChart.destroy();
    state.pathChart = null;
  }
  document.getElementById('irrScatterDrilldown')?.classList.add('hidden');
  bindEvents(canvas);
  renderSummaryCards();
  draw();
}

onThemeChange(() => {
  if (!state.scatter) return;
  draw();
  if (state.selected != null && state.pathChart) renderPathChart(state.selected);
});
