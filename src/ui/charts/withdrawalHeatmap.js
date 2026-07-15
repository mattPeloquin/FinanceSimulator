// Withdrawal Heatmap: how the distribution of simulation outcomes shapes
// spending over time. Each COLUMN is one simulation (or a narrow band of
// adjacent ones) placed by its lifetime-withdrawal rank from P5 to P65 — the
// same run-coherent ordering as the 3D surface — so a lean year inside an
// otherwise-good run stays visible as an off-color cell in its column. Each
// ROW is a year, year 1 at the BOTTOM (time reads upward, like the balance
// axis on the other charts); an "Early years" slider stretches the first rows
// taller for emphasis. Cell color is a diverging orange↔teal spectrum
// around a per-year anchor — the planned schedule (default), that year's
// median, or absolute withdrawal dollars over the from/to window — switched
// by a segmented toggle. Exact $0 withdrawals (plan depletion within the
// run's horizon) override that spectrum with bright red so ran-out years
// stay unmistakable against ordinary cuts. Values are smoothed and
// interpolated along years so each column reads as a continuous vertical
// gradient.
//
// Rendered straight to a canvas: cells are painted into an offscreen canvas
// (one pixel column per data column, VSS sub-pixels per year), then blitted
// with nearest-neighbor so columns stay crisp horizontally. Data arrives
// pre-aggregated from resultPackaging — the renderer rebands the per-run
// source to fill the plot width for the active Show from/to window.
import { bandWithdrawalHeatmap } from '../../core/resultPackaging.js';
import { Chart } from './chartSetup.js';
import { withdrawalComparisonDatasets, withdrawalChartTooltipCallbacks } from './surface3d.js';
import { getChartTheme, chartJsCartesianScales, sampleRunTooltipOptions } from './chartTheme.js';
import { onThemeChange, isDarkMode } from '../theme.js';
import { formatK, formatPercent } from '../format.js';
import { regeneratePath } from '../../core/simulation.js';
import { percentileLabelForRank } from '../../core/surfaceDrilldown.js';
import { createLinkedBalanceBars } from './balanceBars.js';
import { heatmapRowLayout, EMPHASIS_DEFAULT } from './yearEmphasis.js';

export { heatmapRowLayout, EMPHASIS_DEFAULT, EMPHASIS_MAX_RATIO } from './yearEmphasis.js';

const MARGIN = { top: 10, right: 14, bottom: 40, left: 52 };

// Vertical supersampling: sub-pixels painted per year row, interpolated
// between year values so columns read as continuous gradients.
const VSS = 8;

// Random-replay cadence: speed slider has 10 settings mapping to a tick
// interval of ~800ms (contemplative) down to 40ms (shimmering ensemble). The
// quadratic curve biases the scale toward the faster side — the midpoint is
// already well under half the slowest interval.
export const SPEED_STEPS = 10;
export function tickMsForSpeed(speed) {
  const s = Math.max(1, Math.min(SPEED_STEPS, speed));
  const t = (SPEED_STEPS - s) / (SPEED_STEPS - 1);
  return Math.round(40 + 760 * t * t);
}

// Bright red override for a true $0 withdrawal year — the heatmap's signal
// that the plan ran out (distinct from NaN past-horizon cells, which stay
// transparent, and from ordinary below-anchor cuts, which stay burnt orange).
export const DEPLETION_RGB = [220, 38, 38]; // #dc2626 — bright but a shade off pure red

// One diverging spectrum for every encoding, anchored per cell: burnt orange
// = below the anchor (bad), an indigo-tinted gray midpoint on the anchor, teal
// = above it (good). Teal competes with orange better than purple; the mid is
// cool/indigo enough to bridge the poles without leaning into either. Dark
// mode uses the same poles with a darker indigo-gray mid — a light midpoint
// would make "on anchor" the brightest thing on a dark surface, inverting
// salience — with each arm blending straight to its pole.
const ARM_STOPS = {
  light: {
    below: ['#9894b0', '#fdb863', '#e66101'], // indigo-gray → light orange → burnt orange
    above: ['#9894b0', '#5ecfc4', '#0d9488'], // indigo-gray → light teal → teal
  },
  dark: {
    below: ['#4a4862', '#e66101'], // indigo-gray anchor → burnt orange
    above: ['#4a4862', '#0d9488'], // indigo-gray anchor → teal
  },
};

// Per-arm gamma easing applied to |t| before stop interpolation. Values > 1
// widen the neutral band (slow color onset near the midpoint, saturation
// near the poles). Below (orange/cuts) uses a higher gamma so modest cuts
// stay closer to neutral; above (teal/boosts) is also slightly > 1 so the
// mid stays a bit wider while surplus still maps fairly evenly.
const GAMMA = { below: 1.4, above: 1.2 };

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

const ARM_RGB = {
  light: { below: ARM_STOPS.light.below.map(hexToRgb), above: ARM_STOPS.light.above.map(hexToRgb) },
  dark: { below: ARM_STOPS.dark.below.map(hexToRgb), above: ARM_STOPS.dark.above.map(hexToRgb) },
};

function lerpRgb(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

// Below-arm length for color transfer: at least as long as the above arm.
// Cuts are often a smaller dollar range than boosts; if we normalized orange
// against the shallow cut end alone, a modest −$33k would hit peak burnt
// orange while +$33k on a +$169k indigo arm still looked pale. Flooring the
// below end at `hi` keeps those colors matched — peak orange only appears
// once the cut side itself exceeds the top range (lo > hi).
export function belowArmEnd(domain) {
  return Math.max(domain.lo, domain.hi);
}

// Anchored diverging cell color. `delta` = actual − anchor; negative runs
// down the orange arm, positive up the teal arm, zero sits exactly on the
// mode's neutral midpoint. The domain is ASYMMETRIC — `{lo, hi}` with lo
// stored positive — because cuts are bounded while boosts are not. The above
// arm normalizes against `hi`; the below arm against max(lo, hi) so a shallow
// cut range never saturates orange early. Gamma easing (> 1) widens the
// neutral band near the anchor. Deltas beyond each arm's end clamp to the poles.
export function divergingRgb(delta, domain, isDark = isDarkMode()) {
  const arms = ARM_RGB[isDark ? 'dark' : 'light'];
  const below = delta < 0;
  const end = below ? belowArmEnd(domain) : domain.hi;
  const t = Math.min(1, end > 0 ? Math.abs(delta) / end : 0);
  const eased = t ** (below ? GAMMA.below : GAMMA.above);
  const stops = below ? arms.below : arms.above;
  const pos = eased * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(pos));
  return lerpRgb(stops[i], stops[i + 1], pos - i);
}

export function divergingColor(delta, domain, isDark = isDarkMode()) {
  const [r, g, b] = divergingRgb(delta, domain, isDark);
  return `rgb(${r}, ${g}, ${b})`;
}

// Final cell RGB for one sample. Absolute withdrawal of exactly $0 means the
// portfolio had nothing left to spend that year — paint bright red instead of
// the diverging cut color so depletion does not blend in with ordinary cuts.
// NaN (past horizon) is handled by the painter before calling this.
export function cellRgb(absoluteWithdrawal, delta, domain, isDark = isDarkMode()) {
  if (absoluteWithdrawal === 0) return DEPLETION_RGB;
  return divergingRgb(delta, domain, isDark);
}

// Pixel → column index within the plot rect, or -1 outside it.
export function heatmapColumnAtX(x, geom, numCols) {
  if (x < geom.plotX || x >= geom.plotX + geom.plotW) return -1;
  return Math.min(numCols - 1, Math.floor(((x - geom.plotX) / geom.plotW) * numCols));
}

// Pixel → year index (0-based, year 1 at the BOTTOM — time reads upward),
// or -1 outside the plot. `layout` is a heatmapRowLayout bounds array; omit
// it for a uniform grid.
export function heatmapYearAtY(y, geom, numYears, layout = null) {
  if (y < geom.plotY || y >= geom.plotY + geom.plotH) return -1;
  if (!layout) {
    const rowFromTop = Math.min(numYears - 1, Math.floor(((y - geom.plotY) / geom.plotH) * numYears));
    return numYears - 1 - rowFromTop;
  }
  const fracFromTop = (y - geom.plotY) / geom.plotH;
  for (let j = numYears - 1; j >= 0; j--) {
    // Year j's band, measured from the top, spans [1 - layout[j+1], 1 - layout[j]).
    if (fracFromTop >= 1 - layout[j + 1] && fracFromTop < 1 - layout[j]) return j;
  }
  return fracFromTop < 1 - layout[numYears] ? numYears - 1 : 0;
}

// Smooth a per-year series and upsample it to `vss` sub-samples per year:
// a NaN-aware 1-2-1 kernel along years, then linear interpolation between
// year centers. NaN years (past a run's horizon) stay NaN — sub-samples take
// their NEAREST year's finiteness, so the horizon edge stays hard and values
// never bleed across it. Exported pure for unit tests.
export function smoothColumnSeries(values, vss) {
  const n = values.length;
  const smoothed = new Float64Array(n);
  for (let j = 0; j < n; j++) {
    const v = values[j];
    if (Number.isNaN(v)) {
      smoothed[j] = NaN;
      continue;
    }
    let sum = 2 * v;
    let w = 2;
    const prev = j > 0 ? values[j - 1] : NaN;
    const next = j < n - 1 ? values[j + 1] : NaN;
    if (!Number.isNaN(prev)) {
      sum += prev;
      w += 1;
    }
    if (!Number.isNaN(next)) {
      sum += next;
      w += 1;
    }
    smoothed[j] = sum / w;
  }

  const out = new Float64Array(n * vss);
  for (let k = 0; k < n * vss; k++) {
    // Sub-sample position in year-center coordinates (year j's center at j).
    const pos = (k + 0.5) / vss - 0.5;
    let j0 = Math.floor(pos);
    let frac = pos - j0;
    if (j0 < 0) {
      j0 = 0;
      frac = 0;
    }
    if (j0 >= n - 1) {
      j0 = n - 1;
      frac = 0;
    }
    const nearest = smoothed[frac < 0.5 ? j0 : Math.min(n - 1, j0 + 1)];
    if (Number.isNaN(nearest)) {
      out[k] = NaN;
      continue;
    }
    const a = smoothed[j0];
    const b = frac > 0 ? smoothed[Math.min(n - 1, j0 + 1)] : a;
    if (Number.isNaN(a) || Number.isNaN(b)) {
      // One side of the interpolation window is past a horizon: clamp to the
      // nearest finite year instead of interpolating across the boundary.
      out[k] = nearest;
      continue;
    }
    out[k] = a + (b - a) * frac;
  }
  return out;
}

// Tooltip content as plain data so it is unit-testable without a DOM.
export function formatHeatmapTooltip({ year, pctLabel, simIndex, value, plan, median, runCount }) {
  const signed = (delta) => `${delta >= 0 ? '+' : '−'}${formatK(Math.abs(delta))}`;
  const rows = [
    `Withdrawal ${formatK(value)}`,
    `${signed(value - plan)} vs plan (${formatK(plan)})`,
    `${signed(value - median)} vs year median (${formatK(median)})`,
  ];
  if (runCount > 1) rows.push(`avg of ${runCount} runs`);
  const title = runCount > 1
    ? `Year ${year} · ${pctLabel}`
    : `Year ${year} · ${pctLabel} · Simulation #${simIndex + 1}`;
  return { title, rows, footer: 'Click to see this path' };
}

const state = {
  source: null, // per-run P5..P90 source from resultPackaging (immutable per run)
  heatmap: null, // width-aware band for the active from/to window
  bandKey: null, // cache key: loRank:hiRank:maxCols
  params: null,
  seed: null,
  outcome: null, // per-sim outcome tags from returnScatter (0 met / 1 below / 2 ran out)
  encoding: 'plan', // 'plan' | 'median' (per-year delta) | 'abs' (absolute $ over from/to)
  frame: 0, // scrubber: 0 = averaged view, k ≥ 1 = pre-sliced composite k
  speed: 0, // 0 = off; > 0 = random replay at tickMsForSpeed(speed)
  randomAssign: null, // Int32Array(numCols): per-column random frame while replaying
  tick: 0, // replay tick counter (busts the offscreen cache per tick)
  animTimer: null,
  emphasis: EMPHASIS_DEFAULT, // early-year row-height emphasis slider (0..100); default biases early years
  lowerPct: 5, // "show from" lower axis percentile (5..30); view pref, survives runs
  upperPct: 65, // "show to" upper axis percentile (65..90); view pref, survives runs
  windowAnchors: null, // cached windowAnchorSeries for the visible range
  windowAnchorsKey: null,
  windowDomain: null, // cached windowDeltaDomain for encoding + visible range
  windowDomainKey: null,
  rowLayout: null, // heatmapRowLayout bounds for the current draw
  hovered: null, // { col, year } under the cursor
  selectedCol: null,
  selectedSimIndex: null, // run shown in the drill-down (snapshot at click time)
  geom: null,
  offscreen: null,
  offscreenKey: null, // encoding+mode+display the offscreen was painted for
  pathChart: null,
  balanceBars: null,
  resizeObserver: null,
  eventsBound: false,
};

function isPlaying() {
  return state.speed > 0 && (state.heatmap?.numFrames ?? 1) > 1 && state.randomAssign != null;
}

// Per-year mean and median across a window of columns, weighted by band size
// so the mean is exact (band mean × band count reconstructs the band total).
// The median is the unweighted median of the band means — bands are narrow
// contiguous rank groups of near-equal size, so this tracks the run median
// closely. Exported pure for unit tests.
export function windowAnchorSeries(values, colRunCount, numYears, start, end) {
  const mean = new Float64Array(numYears);
  const medianArr = new Float64Array(numYears);
  const cells = [];
  for (let j = 0; j < numYears; j++) {
    let sum = 0;
    let weight = 0;
    cells.length = 0;
    for (let c = start; c < end; c++) {
      const v = values[c * numYears + j];
      if (!Number.isNaN(v)) {
        sum += v * colRunCount[c];
        weight += colRunCount[c];
        cells.push(v);
      }
    }
    if (weight === 0) {
      mean[j] = NaN;
      medianArr[j] = NaN;
      continue;
    }
    mean[j] = sum / weight;
    cells.sort((a, b) => a - b);
    const mid = cells.length >> 1;
    medianArr[j] = cells.length % 2 ? cells[mid] : (cells[mid - 1] + cells[mid]) / 2;
  }
  return { mean, median: medianArr };
}

// Color clamps from the visible window's cell deltas. Mean/median anchors are
// already recomputed for the from/to crop, so the delta cloud is roughly
// centered on zero — both arms therefore use mirrored tails (|P2| and P98)
// instead of the outcome-axis "show to" percentile. (Coupling hi to that
// slider used to clip indigo at ~P68 whenever the axis sat at P65, so the
// spectrum only looked centered at the full P5–P90 window.) Each side guards
// against a degenerate spread so the renderer never divides by zero.
// Exported pure for unit tests.
export function windowDeltaDomain(values, anchor, numYears, start, end) {
  const deltas = [];
  for (let c = start; c < end; c++) {
    for (let j = 0; j < numYears; j++) {
      const v = values[c * numYears + j];
      if (!Number.isNaN(v) && !Number.isNaN(anchor[j])) deltas.push(v - anchor[j]);
    }
  }
  deltas.sort((a, b) => a - b);
  const q = (p) => (deltas.length ? deltas[Math.min(deltas.length - 1, Math.floor((deltas.length * p) / 100))] : 0);
  return {
    lo: Math.max(1, -q(2)),
    hi: Math.max(1, q(98)),
  };
}

// Absolute withdrawal scale for Amount mode: P2/P98 of finite cell values in
// the visible from/to columns (all years), split by the actual MEDIAN of
// those values (not the arithmetic mean of lo/hi). Anchoring on the mean
// would make armLo === armHi by construction — always exactly symmetric —
// so a skewed distribution (say, low sitting 3x closer to zero than high is
// far above it) would still saturate both color arms equally, hiding that
// asymmetry. The median instead reflects where the data actually centers, so
// the shorter arm reaches its pole sooner and reads visibly paler. Guard
// hi > lo so color transfer never divides by zero.
// Exported pure for unit tests.
export function windowAbsoluteDomain(values, numYears, start, end) {
  const samples = [];
  for (let c = start; c < end; c++) {
    for (let j = 0; j < numYears; j++) {
      const v = values[c * numYears + j];
      if (!Number.isNaN(v)) samples.push(v);
    }
  }
  samples.sort((a, b) => a - b);
  const q = (p) => (samples.length
    ? samples[Math.min(samples.length - 1, Math.floor((samples.length * p) / 100))]
    : 0);
  let lo = q(2);
  let hi = q(98);
  if (hi <= lo) {
    const spread = Math.max(1, Math.abs(lo) * 0.01 || 1);
    hi = lo + spread;
  }
  const mid = q(50);
  return { lo, hi, mid: Math.min(hi, Math.max(lo, mid)) };
}

// The rank a given outcome percentile maps to, clamped to the built source window.
function rankAtPct(pct) {
  const src = state.source;
  if (!src) return 0;
  return Math.max(src.p5Rank, Math.min(src.hiRank, Math.floor((src.numSimulations * pct) / 100)));
}

// Reband the source to fill the plot for the current from/to window. Skips
// work when loRank, hiRank, and maxCols are unchanged (slider drags / resize).
function ensureBanded(canvas) {
  if (!state.source || !canvas) return false;
  const geom = plotGeometry(canvas);
  const maxCols = Math.max(1, Math.floor(geom.plotW));
  const loRank = rankAtPct(state.lowerPct);
  const hiRank = rankAtPct(state.upperPct);
  const key = `${loRank}:${hiRank}:${maxCols}`;
  if (state.bandKey === key && state.heatmap) return false;

  const prevCols = state.heatmap?.numCols ?? 0;
  state.heatmap = bandWithdrawalHeatmap(state.source, loRank, hiRank, maxCols);
  state.bandKey = key;
  state.windowAnchors = null;
  state.windowAnchorsKey = null;
  state.windowDomain = null;
  state.windowDomainKey = null;
  state.offscreen = null;
  state.offscreenKey = null;

  if (state.heatmap.numCols !== prevCols) {
    state.randomAssign = null;
    state.frame = 0;
    if (state.selectedCol != null && state.selectedCol >= state.heatmap.numCols) {
      state.selectedCol = null;
      state.selectedSimIndex = null;
    }
  }
  return true;
}

// All banded columns are painted — no cropping of a pre-built grid.
function visibleRange() {
  const hm = state.heatmap;
  if (!hm) return { start: 0, end: 0, count: 0 };
  return { start: 0, end: hm.numCols, count: hm.numCols };
}

// Window-local anchors, cached per visible range: the mean/median the colors
// diverge around is computed from the cells ON SCREEN, so the neutral
// midpoint stays anchored to the middle of whatever range is shown.
function windowAnchors() {
  const { start, end } = visibleRange();
  const key = `${start}:${end}`;
  if (!state.windowAnchors || state.windowAnchorsKey !== key) {
    const hm = state.heatmap;
    state.windowAnchors = windowAnchorSeries(hm.values, hm.colRunCount, hm.numYears, start, end);
    state.windowAnchorsKey = key;
  }
  return state.windowAnchors;
}

// Active anchor / color domain for the current encoding, derived from the
// visible from/to window.
function anchorInfo() {
  const hm = state.heatmap;
  const { start, end } = visibleRange();
  const key = `${state.encoding}:${start}:${end}`;

  if (state.encoding === 'abs') {
    if (!state.windowDomain || state.windowDomainKey !== key) {
      state.windowDomain = windowAbsoluteDomain(hm.values, hm.numYears, start, end);
      state.windowDomainKey = key;
    }
    const abs = state.windowDomain;
    const armLo = abs.mid - abs.lo;
    const armHi = abs.hi - abs.mid;
    return {
      mode: 'abs',
      abs,
      anchor: null,
      domain: { lo: armLo, hi: armHi },
      mid: abs.mid,
    };
  }

  const anchors = windowAnchors();
  const anchor = state.encoding === 'plan' ? hm.planByYear : anchors.median;
  if (!state.windowDomain || state.windowDomainKey !== key) {
    state.windowDomain = windowDeltaDomain(hm.values, anchor, hm.numYears, start, end);
    state.windowDomainKey = key;
  }
  return { mode: 'delta', abs: null, anchor, domain: state.windowDomain, mid: null };
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

// Which pre-sliced frame a column currently displays, or -1 for the averaged
// view: a per-column random pick while replaying, the scrubbed composite
// otherwise.
function currentFrameIndex(col) {
  if (isPlaying()) return state.randomAssign[col];
  if (state.frame > 0) return state.frame - 1;
  return -1;
}

// The value a cell currently displays. All painting, hit testing, and
// tooltips read through here so every surface agrees on what is on screen.
function cellValue(col, year) {
  const hm = state.heatmap;
  const f = currentFrameIndex(col);
  if (f >= 0 && hm.frameValues) {
    return hm.frameValues[(f * hm.numCols + col) * hm.numYears + year];
  }
  return hm.values[col * hm.numYears + year];
}

// Paint the cells into an offscreen canvas: one pixel column per data column,
// VSS sub-pixels per year, each column smoothed and interpolated along years
// so the vertical gradient is continuous. NaN cells (no run active that year)
// stay transparent so the past-horizon region recedes to the page background.
// Delta modes smooth in delta space (anchor varies by year); Amount mode
// smooths raw withdrawal dollars then maps through the absolute scale.
function buildOffscreen() {
  const hm = state.heatmap;
  const isDark = isDarkMode();
  const { count } = visibleRange();
  const displayKey = isPlaying() ? `t${state.tick}` : state.frame > 0 ? `f${state.frame}` : 'avg';
  const key = `${state.encoding}:${isDark ? 'dark' : 'light'}:${displayKey}:w${state.lowerPct}-${state.upperPct}:${count}`;
  if (state.offscreen && state.offscreenKey === key) return state.offscreen;

  const info = anchorInfo();
  const rows = hm.numYears * VSS;
  const off = document.createElement('canvas');
  off.width = count;
  off.height = rows;
  const ctx = off.getContext('2d');
  const img = ctx.createImageData(count, rows);
  const data = img.data;
  const series = new Float64Array(hm.numYears);

  // Absolute withdrawal per year (pre-smoothing) so $0 depletion years can
  // override the diverging spectrum even when delta-mode smoothing would
  // otherwise turn a zero into a large negative cut.
  const absSeries = new Float64Array(hm.numYears);

  for (let c = 0; c < hm.numCols; c++) {
    for (let j = 0; j < hm.numYears; j++) {
      const v = cellValue(c, j);
      absSeries[j] = v;
      if (info.mode === 'abs') {
        series[j] = v;
      } else {
        series[j] = Number.isNaN(v) ? NaN : v - info.anchor[j];
      }
    }
    const sub = smoothColumnSeries(series, VSS);
    for (let s = 0; s < rows; s++) {
      // Sub-sample s counts up from year 1 at the bottom; ImageData rows count
      // down from the top. Year ownership is by VSS strip so a $0 year paints
      // solid bright red even where vertical smoothing blended its neighbors.
      const p = ((rows - 1 - s) * count + c) * 4;
      const sample = sub[s];
      if (Number.isNaN(sample)) {
        data[p + 3] = 0;
        continue;
      }
      const year = Math.min(hm.numYears - 1, Math.floor(s / VSS));
      const d = info.mode === 'abs' ? sample - info.mid : sample;
      const rgb = cellRgb(absSeries[year], d, info.domain, isDark);
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

// Rounded pixel edge of year j's bottom boundary under the current layout.
function rowEdges(geom, layout, numYears) {
  const edges = new Float64Array(numYears + 1);
  for (let j = 0; j <= numYears; j++) {
    edges[j] = Math.round(geom.plotY + geom.plotH * (1 - layout[j]));
  }
  return edges;
}

function drawAxes(ctx, theme, geom, layout) {
  const hm = state.heatmap;
  ctx.fillStyle = theme.axisTick;
  ctx.font = '10px sans-serif';

  // X axis: percentile labels. Ranks map linearly onto the plot because the
  // columns partition the rank window evenly; the visible span runs between
  // the "show from" and "show to" sliders' percentiles.
  const startRank = rankAtPct(state.lowerPct);
  const visSpan = Math.max(1, rankAtPct(state.upperPct) - startRank + 1);
  const xForRank = (rank) => geom.plotX + ((rank - startRank + 0.5) / visSpan) * geom.plotW;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.strokeStyle = theme.gridLine;
  ctx.lineWidth = 1;
  const ticks = [state.lowerPct];
  for (let pct = state.lowerPct + 10; pct < state.upperPct; pct += 10) ticks.push(pct);
  ticks.push(state.upperPct);
  for (const pct of ticks) {
    const rank = rankAtPct(pct);
    const x = xForRank(rank);
    ctx.beginPath();
    ctx.moveTo(x, geom.plotY + geom.plotH);
    ctx.lineTo(x, geom.plotY + geom.plotH + 4);
    ctx.stroke();
    ctx.fillText(`P${pct}`, x, geom.plotY + geom.plotH + 6);
  }

  // Y axis: years, year 1 at the bottom (time reads upward); label positions
  // follow the emphasis-distorted layout.
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  const yearStep = hm.numYears > 15 ? 5 : 1;
  for (let year = 1; year <= hm.numYears; year += yearStep) {
    const mid = (layout[year - 1] + layout[year]) / 2;
    const y = geom.plotY + geom.plotH * (1 - mid);
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
  const layout = state.rowLayout ?? heatmapRowLayout(hm.numYears, state.emphasis);
  const { count } = visibleRange();
  const w = geom.plotW / count;
  const top = geom.plotY + geom.plotH * (1 - layout[year + 1]);
  const bottom = geom.plotY + geom.plotH * (1 - layout[year]);
  return { x: geom.plotX + col * w, y: top, w, h: bottom - top };
}

function drawHighlights(ctx, theme, geom) {
  // Selected column: a full-height outline so the drilled-down run stays located.
  if (state.selectedCol != null && state.selectedCol < state.heatmap.numCols) {
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
  if (!canvas || !state.source) return;
  ensureBanded(canvas);
  if (!state.heatmap) return;
  const geom = plotGeometry(canvas);
  if (geom.plotW <= 0 || geom.plotH <= 0) return;

  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(geom.width * dpr);
  canvas.height = Math.round(geom.height * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, geom.width, geom.height);
  state.geom = geom;

  const hm = state.heatmap;
  const layout = heatmapRowLayout(hm.numYears, state.emphasis);
  state.rowLayout = layout;

  const theme = getChartTheme();
  const off = buildOffscreen();
  // Nearest-neighbor scaling keeps each run's column a crisp vertical stripe
  // instead of smearing adjacent runs together (the vertical direction is
  // already smooth in the offscreen source). Blit one strip per year so the
  // emphasis layout can stretch row heights without touching the cache.
  ctx.imageSmoothingEnabled = false;
  const edges = rowEdges(geom, layout, hm.numYears);
  const { count } = visibleRange();
  for (let j = 0; j < hm.numYears; j++) {
    const destTop = edges[j + 1];
    const destH = edges[j] - edges[j + 1];
    if (destH <= 0) continue;
    // Year j's sub-rows sit at offscreen rows [(numYears-1-j)*VSS, +VSS).
    ctx.drawImage(off, 0, (hm.numYears - 1 - j) * VSS, count, VSS, geom.plotX, destTop, geom.plotW, destH);
  }
  ctx.imageSmoothingEnabled = true;

  drawAxes(ctx, theme, geom, layout);
  drawHighlights(ctx, theme, geom);
}

// CSS gradient that mirrors the actual (asymmetric, gamma-eased) color
// transfer by sampling it left-to-right across [−lo, +hi]. When lo < hi the
// left side only reaches a fraction of the orange pole — matching cells that
// normalize below against max(lo, hi).
function legendGradient(domain) {
  const stops = [];
  const K = 12;
  for (let i = 0; i <= K; i++) {
    const frac = i / K;
    const delta = -domain.lo + frac * (domain.lo + domain.hi);
    stops.push(`${divergingColor(delta, domain)} ${Math.round(frac * 100)}%`);
  }
  return stops.join(', ');
}

// Legend: a sampled gradient swatch with the active anchor's endpoint labels
// and what the neutral midpoint means; the column-mode note renders into its
// own row below the legend line.
function renderLegend() {
  const el = document.getElementById('withdrawalHeatmapLegend');
  if (!el || !state.heatmap) return;
  const hm = state.heatmap;
  const info = anchorInfo();
  const swatch =
    `<span class="inline-block w-28 h-4 rounded-sm shrink-0 border border-theme-border" style="background:linear-gradient(to right, ${legendGradient(info.domain)})"></span>`;
  const item = (html) => `<span class="inline-flex items-center gap-1.5 text-sm text-theme-faint">${html}</span>`;
  const midWord = 'gray';

  const depletionSwatch =
    `<span class="inline-block w-3 h-3 rounded-sm shrink-0 border border-theme-border" style="background:rgb(${DEPLETION_RGB.join(',')})"></span>`;
  const items = [];
  if (info.mode === 'abs') {
    items.push(item(`<span>${formatK(info.abs.lo)} low</span>${swatch}<span>${formatK(info.abs.hi)} high</span>`));
    items.push(item(`<span>${midWord} = median of shown range</span>`));
  } else {
    const anchorWord = state.encoding === 'plan'
      ? 'on plan'
      : 'that year’s median withdrawal';
    const loLabel = state.encoding === 'plan' ? 'cut' : 'below';
    const hiLabel = state.encoding === 'plan' ? 'boost' : 'above';
    items.push(item(`<span>−${formatK(info.domain.lo)} ${loLabel}</span>${swatch}<span>+${formatK(info.domain.hi)} ${hiLabel}</span>`));
    items.push(item(`<span>${midWord} = ${anchorWord}</span>`));
  }
  items.push(item(`${depletionSwatch}<span>$0 = depleted</span>`));
  el.innerHTML = items.join('');

  const noteEl = document.getElementById('withdrawalHeatmapColumnNote');
  if (!noteEl) return;
  let note = '';
  if (isPlaying()) {
    note = 'replaying: each column shows a random run from its band';
  } else if (state.frame > 0) {
    note = `showing run set ${state.frame} of ${hm.numFrames}`;
  } else {
    // Bands can be uneven (e.g. 851 runs over 480 columns → sizes 1–2), so
    // report the widest one rather than trusting column 0.
    const { start, end } = visibleRange();
    let maxRuns = 1;
    for (let c = start; c < end; c++) {
      if (hm.colRunCount[c] > maxRuns) maxRuns = hm.colRunCount[c];
    }
    if (maxRuns > 1) note = `each column averages up to ${maxRuns} adjacent runs`;
  }
  noteEl.textContent = note;
  noteEl.classList.toggle('hidden', note === '');
}

const TOGGLE_ACTIVE = ['bg-theme-muted', 'text-theme-heading', 'font-semibold'];
const TOGGLE_INACTIVE = ['text-theme-faint'];

function syncToggleUi() {
  const buttons = [
    [document.getElementById('withdrawalHeatmapModeDelta'), 'plan'],
    [document.getElementById('withdrawalHeatmapModeMedian'), 'median'],
    [document.getElementById('withdrawalHeatmapModeAbs'), 'abs'],
  ];
  for (const [btn, mode] of buttons) {
    if (!btn) continue;
    const active = state.encoding === mode;
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    btn.classList.remove(...TOGGLE_ACTIVE, ...TOGGLE_INACTIVE);
    btn.classList.add(...(active ? TOGGLE_ACTIVE : TOGGLE_INACTIVE));
  }
}

function setEncoding(mode) {
  if (mode !== 'abs' && mode !== 'median' && mode !== 'plan') return;
  if (state.encoding === mode) return;
  state.encoding = mode;
  state.windowDomain = null;
  state.windowDomainKey = null;
  state.offscreen = null;
  state.offscreenKey = null;
  syncToggleUi();
  renderLegend();
  draw();
}

// Keep the sliders and their value labels in step with state; hide the
// run/speed pair when every column is a single run (nothing to scrub/replay).
function syncControlUi() {
  const hm = state.heatmap;
  const available = (hm?.numFrames ?? 1) > 1;
  const frameWrap = document.getElementById('withdrawalHeatmapFrameWrap');
  const speedWrap = document.getElementById('withdrawalHeatmapSpeedWrap');
  frameWrap?.classList.toggle('hidden', !available);
  speedWrap?.classList.toggle('hidden', !available);

  const frameEl = document.getElementById('withdrawalHeatmapFrame');
  if (frameEl) {
    frameEl.max = String(hm?.numFrames ?? 0);
    frameEl.value = String(state.frame);
    // The random replay owns the display while running; scrubbing is moot.
    frameEl.disabled = state.speed > 0;
  }
  const frameLabel = document.getElementById('withdrawalHeatmapFrameLabel');
  if (frameLabel) frameLabel.textContent = state.frame === 0 ? 'Avg' : `${state.frame}/${hm?.numFrames ?? 0}`;

  const speedEl = document.getElementById('withdrawalHeatmapSpeed');
  if (speedEl) speedEl.value = String(state.speed);
  const speedLabel = document.getElementById('withdrawalHeatmapSpeedLabel');
  if (speedLabel) speedLabel.textContent = state.speed === 0 ? 'off' : String(state.speed);

  const emphasisEl = document.getElementById('withdrawalHeatmapEmphasis');
  if (emphasisEl) emphasisEl.value = String(state.emphasis);

  const lowerEl = document.getElementById('withdrawalHeatmapLower');
  if (lowerEl) lowerEl.value = String(state.lowerPct);
  const lowerLabel = document.getElementById('withdrawalHeatmapLowerLabel');
  if (lowerLabel) lowerLabel.textContent = `P${state.lowerPct}`;

  const upperEl = document.getElementById('withdrawalHeatmapUpper');
  if (upperEl) upperEl.value = String(state.upperPct);
  const upperLabel = document.getElementById('withdrawalHeatmapUpperLabel');
  if (upperLabel) upperLabel.textContent = `P${state.upperPct}`;
}

// Scrubber: step through the averaged view (0) and the deterministic
// pre-sliced composites (1..numFrames). Ignored on screen while replaying.
function setFrame(k) {
  const hm = state.heatmap;
  if (!hm) return;
  const next = Math.max(0, Math.min(hm.numFrames, Math.round(k) || 0));
  if (state.frame === next) return;
  state.frame = next;
  syncControlUi();
  renderLegend();
  draw();
}

function onReplayTick() {
  const hm = state.heatmap;
  for (let c = 0; c < hm.numCols; c++) {
    state.randomAssign[c] = Math.floor(Math.random() * hm.numFrames);
  }
  state.tick++;
  draw();
}

// Speed: 0 = off; > 0 starts the fully random replay — every tick each
// column independently samples one of its band's runs, so each instant is an
// unbiased mixed draw from the ensemble and no composite ever repeats.
function setSpeed(v) {
  const hm = state.heatmap;
  if (!hm) return;
  const next = Math.max(0, Math.min(SPEED_STEPS, Math.round(v) || 0));
  if (state.speed === next) return;
  state.speed = next;
  if (state.animTimer != null) {
    clearInterval(state.animTimer);
    state.animTimer = null;
  }
  if (next > 0 && hm.numFrames > 1) {
    if (!state.randomAssign) state.randomAssign = new Int32Array(hm.numCols);
    state.animTimer = setInterval(onReplayTick, tickMsForSpeed(next));
    onReplayTick();
  } else {
    state.randomAssign = null;
    draw();
  }
  syncControlUi();
  renderLegend();
}

function setEmphasis(v) {
  const next = Math.max(0, Math.min(100, Math.round(v) || 0));
  if (state.emphasis === next) return;
  state.emphasis = next;
  // Only the blit layout changes — the offscreen cache stays valid, so slider
  // drags stay fluid.
  draw();
}

// "Show from"/"show to": reband the source to fill the plot for the new
// percentile window — no worker round-trip.
function afterWindowChange() {
  const canvas = document.getElementById('withdrawalHeatmapCanvas');
  ensureBanded(canvas);
  syncControlUi();
  renderLegend();
  draw();
}

function setLowerPct(v) {
  if (!state.source) return;
  const next = Math.max(5, Math.min(30, Math.round(v) || 5));
  if (state.lowerPct === next) return;
  state.lowerPct = next;
  afterWindowChange();
}

function setUpperPct(v) {
  const cap = state.source?.hiPercentile ?? 90;
  const next = Math.max(65, Math.min(cap, Math.round(v) || 65));
  if (state.upperPct === next) return;
  state.upperPct = next;
  afterWindowChange();
}

function hitTest(ev) {
  const canvas = document.getElementById('withdrawalHeatmapCanvas');
  if (!canvas || !state.heatmap || !state.geom) return null;
  const rect = canvas.getBoundingClientRect();
  const { count } = visibleRange();
  const col = heatmapColumnAtX(ev.clientX - rect.left, state.geom, count);
  const year = heatmapYearAtY(ev.clientY - rect.top, state.geom, state.heatmap.numYears, state.rowLayout);
  if (col < 0 || year < 0) return null;
  // NaN cells (past the displayed run's/band's horizon) are not interactive.
  if (Number.isNaN(cellValue(col, year))) return null;
  return { col, year };
}

// The run a column currently stands for: the displayed run while scrubbing
// or replaying, the band's center run in the averaged view.
function displayedSimIndex(col) {
  const hm = state.heatmap;
  const f = currentFrameIndex(col);
  if (f >= 0 && hm.frameSimIndex) return hm.frameSimIndex[f * hm.numCols + col];
  return hm.colSimIndex[col];
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
  const showingRuns = isPlaying() || state.frame > 0;
  const anchors = windowAnchors();
  const { title, rows, footer } = formatHeatmapTooltip({
    year: cell.year + 1,
    pctLabel: percentileLabelForRank(hm.colCenterRank[cell.col], hm.numSimulations),
    simIndex: displayedSimIndex(cell.col),
    value: cellValue(cell.col, cell.year),
    plan: hm.planByYear[cell.year],
    median: anchors.median[cell.year],
    // While showing individual runs each cell is exactly one real run, so the
    // tooltip names it instead of reporting the band average.
    runCount: showingRuns ? 1 : hm.colRunCount[cell.col],
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
function renderPathChart(col, simIndex) {
  const container = document.getElementById('withdrawalHeatmapDrilldown');
  const titleEl = document.getElementById('withdrawalHeatmapDrilldownTitle');
  const metaEl = document.getElementById('withdrawalHeatmapDrilldownMeta');
  const canvas = document.getElementById('withdrawalHeatmapPathCanvas');
  const balanceCanvas = document.getElementById('withdrawalHeatmapBalanceCanvas');
  if (!container || !canvas || state.params == null || state.seed == null) return;

  const hm = state.heatmap;
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
  const hm = state.heatmap;
  if (!hm || col < 0 || col >= hm.numCols) return;
  state.selectedCol = col;
  // Pin the run that was on screen at click time — during replay the column
  // keeps changing, but the drill-down is a snapshot of that run.
  state.selectedSimIndex = displayedSimIndex(col);
  draw();
  renderPathChart(col, state.selectedSimIndex);
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
    ?.addEventListener('click', () => setEncoding('abs'));
  document.getElementById('withdrawalHeatmapModeMedian')
    ?.addEventListener('click', () => setEncoding('median'));
  document.getElementById('withdrawalHeatmapModeDelta')
    ?.addEventListener('click', () => setEncoding('plan'));
  document.getElementById('withdrawalHeatmapFrame')
    ?.addEventListener('input', (ev) => setFrame(Number(ev.target.value)));
  document.getElementById('withdrawalHeatmapSpeed')
    ?.addEventListener('input', (ev) => setSpeed(Number(ev.target.value)));
  document.getElementById('withdrawalHeatmapEmphasis')
    ?.addEventListener('input', (ev) => setEmphasis(Number(ev.target.value)));
  document.getElementById('withdrawalHeatmapLower')
    ?.addEventListener('input', (ev) => setLowerPct(Number(ev.target.value)));
  document.getElementById('withdrawalHeatmapUpper')
    ?.addEventListener('input', (ev) => setUpperPct(Number(ev.target.value)));
  state.resizeObserver = new ResizeObserver(() => {
    const rebanded = ensureBanded(canvas);
    if (rebanded) {
      syncControlUi();
      renderLegend();
    }
    draw();
  });
  state.resizeObserver.observe(canvas.parentElement);
  state.eventsBound = true;
}

export function drawWithdrawalHeatmap(source, { params, seed, outcome } = {}) {
  const canvas = document.getElementById('withdrawalHeatmapCanvas');
  if (!canvas || !source) return;
  state.source = source;
  state.heatmap = null;
  state.bandKey = null;
  state.params = params ?? null;
  state.seed = seed ?? null;
  state.outcome = outcome ?? null;
  state.hovered = null;
  state.selectedCol = null;
  state.selectedSimIndex = null;
  state.offscreen = null;
  state.offscreenKey = null;
  // New data invalidates the window-local anchor/domain caches.
  state.windowAnchors = null;
  state.windowAnchorsKey = null;
  state.windowDomain = null;
  state.windowDomainKey = null;
  // Fresh results: stop any replay and reset the scrubber for the new grid
  // (the emphasis and window sliders are view preferences and survive re-runs).
  state.frame = 0;
  state.speed = 0;
  state.randomAssign = null;
  state.tick = 0;
  if (state.animTimer != null) {
    clearInterval(state.animTimer);
    state.animTimer = null;
  }
  if (state.pathChart) {
    state.pathChart.destroy();
    state.pathChart = null;
  }
  document.getElementById('withdrawalHeatmapDrilldown')?.classList.add('hidden');
  bindEvents(canvas);
  ensureBanded(canvas);
  syncToggleUi();
  syncControlUi();
  renderLegend();
  draw();

  if (typeof window !== 'undefined') {
    window.__TEST_HOOKS__ = window.__TEST_HOOKS__ || {};
    window.__TEST_HOOKS__.withdrawalHeatmap = () => {
      const canvas = document.getElementById('withdrawalHeatmapCanvas');
      const geom = canvas ? plotGeometry(canvas) : { plotW: 0 };
      const { start, end, count } = visibleRange();
      const info = anchorInfo();
      const loRank = rankAtPct(state.lowerPct);
      const hiRank = rankAtPct(state.upperPct);
      const rankSpan = Math.max(1, hiRank - loRank + 1);
      const hm = state.heatmap;
      const out = {
        sourceSpan: state.source?.sourceSpan ?? 0,
        rankSpan,
        plotW: Math.floor(geom.plotW),
        numCols: hm?.numCols ?? 0,
        visibleCols: count,
        numYears: hm?.numYears ?? 0,
        encoding: state.encoding,
        numFrames: hm?.numFrames ?? 1,
        frame: state.frame,
        speed: state.speed,
        playing: isPlaying(),
        emphasis: state.emphasis,
        lowerPct: state.lowerPct,
        upperPct: state.upperPct,
        domainLo: info.domain.lo,
        domainHi: info.domain.hi,
      };
      if (info.mode === 'abs') {
        out.absLo = info.abs.lo;
        out.absHi = info.abs.hi;
        out.absMid = info.abs.mid;
      } else {
        // Weighted mean of (cell − year-median) over the banded columns.
        const anchors = windowAnchors();
        let signed = 0;
        let weight = 0;
        for (let c = start; c < end; c++) {
          const w = hm.colRunCount[c];
          for (let j = 0; j < hm.numYears; j++) {
            const v = hm.values[c * hm.numYears + j];
            const a = anchors.median[j];
            if (!Number.isNaN(v) && !Number.isNaN(a)) {
              signed += (v - a) * w;
              weight += w;
            }
          }
        }
        out.medianDeltaBias = weight > 0 ? signed / weight : 0;
        out.year0Median = anchors.median[0];
      }
      return out;
    };
    window.__TEST_HOOKS__.withdrawalHeatmapSetEncoding = (mode) => setEncoding(mode);
    window.__TEST_HOOKS__.withdrawalHeatmapClickColumn = (col) => selectColumn(col);
    window.__TEST_HOOKS__.withdrawalHeatmapSetFrame = (k) => setFrame(k);
    window.__TEST_HOOKS__.withdrawalHeatmapSetSpeed = (v) => setSpeed(v);
    window.__TEST_HOOKS__.withdrawalHeatmapSetEmphasis = (v) => setEmphasis(v);
    window.__TEST_HOOKS__.withdrawalHeatmapSetLower = (v) => setLowerPct(v);
    window.__TEST_HOOKS__.withdrawalHeatmapSetUpper = (v) => setUpperPct(v);
  }
}

onThemeChange(() => {
  if (!state.source) return;
  renderLegend();
  draw();
  if (state.selectedCol != null && state.pathChart) {
    renderPathChart(state.selectedCol, state.selectedSimIndex ?? state.heatmap.colSimIndex[state.selectedCol]);
  }
});
