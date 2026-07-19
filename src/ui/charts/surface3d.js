// 3D topography column chart. ECharts + ECharts-GL are heavy, so they are
// lazy-loaded (dynamic import) the first time this chart is drawn.
import { formatK, formatPercent } from '../format.js';
import { Chart } from './chartSetup.js';
import {
  rankForOverviewColumn,
  buildDrilldownPaths,
  percentileLabelForRank,
  sampleOverviewPaths,
  ranksForPercentileWindow,
} from '../../core/surfaceDrilldown.js';
import {
  meetsWithdrawalTarget,
  median,
  isMedianYearlyMetric,
  isMeanYearlyMetric,
  isEarlyWeightingActive,
  weightedScheduleScore,
} from '../../core/statistics.js';
import { getChartTheme, sampleRunTooltipOptions } from './chartTheme.js';
import { onThemeChange } from '../theme.js';
import { buildGiftOverlaySeries } from '../../core/withdrawal.js';
import { CLASSIC_FOUR_PERCENT_RATE } from '../../core/fourPercentComparison.js';
import { RETURN_MIN, RETURN_MAX, lerpColor, colorForReturn } from './returnColors.js';
import { createLinkedBalanceBars } from './balanceBars.js';
import { heatmapRowLayout, SURFACE_EMPHASIS_MAX_RATIO, yearAtDisplayCoord } from './yearEmphasis.js';
import {
  OUTCOME_LOWER_DEFAULT,
  OUTCOME_UPPER_DEFAULT,
  getOutcomeWindow,
  setOutcomeLowerPct,
  setOutcomeUpperPct,
  onOutcomeWindowChange,
} from './outcomeWindow.js';


let echartsModule = null;
let chartInstance = null;

const BOX_WIDTH = 280;
const BOX_DEPTH = 120;
const BOX_HEIGHT = 60;

// Initial view — orbit angles, zoom, and pan pivot (maps to grid3D.viewControl).
// Adjust in the browser, then copy from __SOR_SURFACE__.getOption().grid3D[0].viewControl.
const CAMERA_ALPHA = 15; // vertical tilt (°); higher = more top-down
const CAMERA_BETA = 220; // horizontal orbit (°); spins the scene left/right
const CAMERA_DISTANCE = 220; // zoom at the reference container size below; lower = closer to the grid
const PAN_CENTER_X = -20; // pan pivot X (scene units)
const PAN_CENTER_Y = -30; // pan pivot Y; negative shifts plot upward on screen
const PAN_CENTER_Z = 0; // pan pivot Z (scene units)

// The perspective camera's FOV is fixed, so a wider container (taller aspect
// ratio) leaves the plot looking small/centered instead of filling the width.
// Scale the camera distance against the container's own aspect ratio so the
// grid keeps roughly the same on-screen footprint at any container size.
const REFERENCE_WIDTH = 900; // container size CAMERA_DISTANCE was tuned at
const REFERENCE_HEIGHT = 420;
const MIN_CAMERA_DISTANCE = 90; // don't let very wide screens zoom in past this
const MAX_CAMERA_DISTANCE = 260; // don't let very narrow screens zoom out past this

function computeCameraDistance(dom) {
  const w = dom?.clientWidth || REFERENCE_WIDTH;
  const h = dom?.clientHeight || REFERENCE_HEIGHT;
  const referenceAspect = REFERENCE_WIDTH / REFERENCE_HEIGHT;
  const aspect = w / h || referenceAspect;
  const distance = CAMERA_DISTANCE * (referenceAspect / aspect);
  return Math.max(MIN_CAMERA_DISTANCE, Math.min(MAX_CAMERA_DISTANCE, distance));
}

// Z axis is capped at this multiple of the starting portfolio value.
const Z_CAP_MULTIPLE = 2;

const DIM_OPACITY = 0.02; // opacity of non-focused columns
const POP_FRACTION = 0; // how far the focused row floats up (fraction of zCap)

const FLOAT_PANEL_WIDTH = 221;
const FLOAT_PANEL_CHART_HEIGHT = 102;
const FLOAT_THEME = {
  ok: { line: '#16a34a', fill: 'rgba(22,163,74,0.14)', point: '#16a34a' },
  depleted: { line: '#ea580c', fill: 'rgba(249,115,22,0.2)', point: '#f97316' },
  belowPlan: { line: '#0284c7', fill: 'rgba(2,132,199,0.2)', point: '#0ea5e9' },
};

const CLICK_WAIT_MS = 400; // window to distinguish single vs double click (ECharts GL bar3D has no reliable dblclick)
const TOOLTIP_POINTER_OFFSET = 28; // gap between cursor and hover card
const TOOLTIP_EDGE_PAD = 8;
const SURFACE_AXIS_TICK_FONT = 10;
const BALANCE_AXIS_NAME_GAP = 28;

// bar3D passes an empty rect and often [0, 0] for point; track the cursor ourselves.
let surfaceTooltipPointer = null;

const OVERVIEW_TITLE = 'Explore specific paths';
const EMPHASIS_DEFAULT = 0;
const HEIGHT_BALANCE = 'balance';
const HEIGHT_WITHDRAWAL = 'withdrawal';

// Interaction + layout state shared with the event handlers (one chart instance).
const surfaceState = {
  columns: [], // columns[x] = array of data points for that simulation
  breakdownCols: [], // parallel to columns: per-year withdrawal attribution arrays
  depletedCols: [], // parallel to columns: true when the path runs out of money
  belowPlanCols: [], // parallel to columns: true when withdrawals fall below plan (not depleted)
  barWidth: 1,
  barDepth: 1,
  yearDepths: null, // per-year barDepth along the year axis (scene units)
  yearLayout: null, // heatmapRowLayout bounds for axis label mapping
  zCap: 0,
  numYears: 0,
  pinnedCol: null,
  largeChartCol: null,
  columnClickHandled: false,
  eventsBound: false,
  controlsBound: false,
  viewMode: 'overview',
  overviewPaths: [],
  simParams: null,
  seed: 0,
  surfaceMeta: null,
  drilldownCenterRank: null,
  drilldownLo: null,
  drilldownHi: null,
  lastContext: null,
  shortfallTolerance: 0.05,
  plannedWithdrawn: 0,
  plannedMedianYearly: 0,
  onPlanBenchmark: 0,
  withdrawalMetric: 'total',
  horizonVariable: false,
  // View prefs (survive re-runs, like the heatmap controls)
  heightMode: HEIGHT_BALANCE, // 'balance' | 'withdrawal'
  emphasis: EMPHASIS_DEFAULT,
  lowerPct: OUTCOME_LOWER_DEFAULT,
  upperPct: OUTCOME_UPPER_DEFAULT,
  outcomeWindowBound: false,
};

async function loadEcharts() {
  if (echartsModule) return echartsModule;
  const echarts = await import('echarts');
  await import('echarts-gl');
  echartsModule = echarts;
  return echarts;
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

// Below-plan paths (funded but under-withdrawn): light blue with the same return span.
function colorForBelowPlanReturn(v) {
  const clamped = Math.max(-DEPLETED_RETURN_SPAN, Math.min(DEPLETED_RETURN_SPAN, v));
  const t = (clamped + DEPLETED_RETURN_SPAN) / (2 * DEPLETED_RETURN_SPAN);
  const lowBright = [2, 132, 199];   // sky-600
  const highBright = [125, 211, 252]; // sky-300
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

function rankingWeightingFromState() {
  const meta = surfaceState.surfaceMeta;
  return {
    strengthPct: meta?.earlyWeightStrengthPct ?? 0,
    earlyEmphasisPct: meta?.earlyWeightEmphasisPct ?? 30,
    lateFloorPct: meta?.earlyWeightLateFloorPct ?? 40,
  };
}

// Funded path that fell short of the risk-adjusted plan benchmark (same rule as
// the "Success Rate (within X% of plan)" metric and Goal Seek scoring).
function pathActualWithdrawal(path, withdrawalMetric) {
  const weighting = rankingWeightingFromState();
  if (isEarlyWeightingActive(weighting)) {
    if (path.earlyWeightedScore != null) return path.earlyWeightedScore;
    const h = path.horizonYears ?? path.withdrawals?.length ?? 0;
    const weightedTotal = weightedScheduleScore(path.withdrawals || [], weighting);
    return isMeanYearlyMetric(withdrawalMetric) && h > 0 ? weightedTotal / h : weightedTotal;
  }
  if (isMedianYearlyMetric(withdrawalMetric)) {
    if (path.medianYearlyWithdrawal != null) return path.medianYearlyWithdrawal;
    return median(path.withdrawals || []);
  }
  if (isMeanYearlyMetric(withdrawalMetric)) {
    const h = path.horizonYears ?? path.withdrawals?.length ?? 0;
    return h > 0 ? (path.totalWithdrawn ?? 0) / h : 0;
  }
  return path.totalWithdrawn ?? 0;
}

function pathBelowPlan(actualWithdrawn, plannedBenchmark, shortfallTolerance) {
  if (plannedBenchmark <= 0) return false;
  return !meetsWithdrawalTarget(actualWithdrawn ?? 0, plannedBenchmark, shortfallTolerance);
}

function floatThemeForSeries(series) {
  if (series.depleted) return FLOAT_THEME.depleted;
  if (series.belowPlan) return FLOAT_THEME.belowPlan;
  return FLOAT_THEME.ok;
}

function pathStatusDisplay(series) {
  if (series.depleted) return { text: 'Depleted', color: '#c2410c' };
  if (series.belowPlan) return { text: 'Below Plan', color: '#0369a1' };
  return { text: 'Funded', color: '#15803d' };
}

// Columns are sampled evenly from lowerPct to upperPct.
function percentileLabel(col, numCols) {
  const fraction = numCols > 1 ? col / (numCols - 1) : 0;
  const span = surfaceState.upperPct - surfaceState.lowerPct;
  return 'P' + Math.round(surfaceState.lowerPct + fraction * span);
}

function overviewAxisTickPercentiles() {
  const ticks = [];
  for (let p = surfaceState.lowerPct; p <= surfaceState.upperPct; p += 10) {
    ticks.push(p);
  }
  if (ticks[ticks.length - 1] !== surfaceState.upperPct) ticks.push(surfaceState.upperPct);
  return ticks;
}

function overviewAxisInterval(numCols) {
  if (numCols <= 1) return 1;
  const span = surfaceState.upperPct - surfaceState.lowerPct;
  if (span <= 0) return numCols - 1;
  return ((numCols - 1) * 10) / span;
}

// Overview x-axis: show decade ticks (and endpoints) across the active window.
function overviewAxisTickLabel(col, numCols) {
  if (numCols <= 1) return col === 0 ? `P${surfaceState.lowerPct}` : '';
  const span = surfaceState.upperPct - surfaceState.lowerPct;
  const pct = Math.round(surfaceState.lowerPct + (col / (numCols - 1)) * span);
  const ticks = overviewAxisTickPercentiles();
  if (!ticks.includes(pct)) return '';
  // Avoid duplicate labels when endpoints aren't on a 10-step grid.
  if (pct !== surfaceState.lowerPct && pct !== surfaceState.upperPct && (pct - surfaceState.lowerPct) % 10 !== 0) {
    return '';
  }
  return 'P' + pct;
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

function sampleRunTitle(col) {
  return `${columnPercentileLabel(col, surfaceState.columns.length)} - Sample run`;
}

function heightMetricPhrase() {
  return surfaceState.heightMode === HEIGHT_WITHDRAWAL ? 'withdrawal amount' : 'portfolio balance';
}

function overviewDescriptionHtml() {
  return (
    `A 3D plot of representative paths from the ${surfaceState.lowerPct}th to ${surfaceState.upperPct}th percentiles. ` +
    `Column height represents <strong>${heightMetricPhrase()}</strong>; color reflects the <strong>annual real market return</strong> for that year (Red = crash, Green = boom). ` +
    '<strong>Single-click</strong> a column to pin that simulation and mouse over each year for values; click the column again or empty space to release. ' +
    '<strong>Double-click</strong> a column to explore ~200 nearby simulations; double-click again to return.'
  );
}

function updateSurfaceChrome({ mode, centerRank, lo, hi, n } = {}) {
  const titleEl = document.getElementById('surfaceChartTitle');
  const descEl = document.getElementById('surfaceChartDescription');
  if (!titleEl || !descEl) return;

  if (mode === 'drilldown' && surfaceState.surfaceMeta) {
    const centerLabel = percentileLabelForRank(centerRank, n);
    const loLabel = percentileLabelForRank(lo, n, DRILLDOWN_PERCENTILE_DECIMALS);
    const hiLabel = percentileLabelForRank(hi, n, DRILLDOWN_PERCENTILE_DECIMALS);
    titleEl.textContent = `Explore paths near ${centerLabel}`;
    const rankLens = isEarlyWeightingActive(rankingWeightingFromState())
      ? 'early-weighted spending ranks'
      : 'total-withdrawn ranks';
    descEl.innerHTML =
      `Showing ~200 simulations with ${rankLens} between ${loLabel} and ${hiLabel} (centered on ${centerLabel}). ` +
      `Column height represents ${heightMetricPhrase()}; color reflects each year's market return. ` +
      `<strong>Single-click</strong> a column to pin it; <strong>double-click</strong> any column to return to the P${surfaceState.lowerPct}–P${surfaceState.upperPct} overview.`;
    return;
  }

  titleEl.textContent = OVERVIEW_TITLE;
  descEl.innerHTML = overviewDescriptionHtml();
}

function buildXAxisConfig(numCols) {
  const isDrilldown = surfaceState.viewMode === 'drilldown';
  const n = surfaceState.surfaceMeta?.numSimulations;
  const centerLabel = isDrilldown && n != null
    ? percentileLabelForRank(surfaceState.drilldownCenterRank, n)
    : null;
  const tickCount = overviewAxisTickPercentiles().length;

  return axisConfig(isDrilldown ? `Percentile (near ${centerLabel})` : 'Percentile', {
    min: 0,
    max: numCols - 1,
    ...(isDrilldown
      ? { splitNumber: 5 }
      : { interval: overviewAxisInterval(numCols), splitNumber: Math.max(1, tickCount - 1) }),
    axisLine: { show: true, lineStyle: { width: 1 } },
    axisLabel: {
      showMinLabel: !isDrilldown,
      showMaxLabel: !isDrilldown,
      formatter: (v) =>
        isDrilldown
          ? columnPercentileLabel(v, numCols)
          : overviewAxisTickLabel(Number(v), numCols),
    },
  });
}

// value layout: [x, displayY, height, ret, balance, withdrawal, total, avg, unadj, medianYr, horizon, planBenchmark, irr, yearIndex]
function makeBarPoint(x, displayY, height, ret, balance, withdrawal, totalWithdrawn, avgReturn, depleted, belowPlan, unadjusted, medianYearlyWithdrawal, horizonYears, planBenchmark, irr, yearIndex) {
  const value = [x, displayY, height, ret, balance, withdrawal, totalWithdrawn, avgReturn, unadjusted, medianYearlyWithdrawal, horizonYears, planBenchmark, irr, yearIndex];
  if (depleted) {
    return { value, itemStyle: { color: colorForDepletedReturn(ret) } };
  }
  if (belowPlan) {
    return { value, itemStyle: { color: colorForBelowPlanReturn(ret) } };
  }
  return value;
}

function pointValue(p) {
  return Array.isArray(p) ? p : p.value;
}

function pointYearIndex(vals) {
  if (vals.length > 13 && Number.isFinite(vals[13])) return Math.round(vals[13]);
  return Math.round(vals[1]);
}

// When bar3D truncates the payload to x/y/z, recover the year by nearest display-Y.
function findYearInColumn(col, displayY) {
  const points = surfaceState.columns[col];
  if (!points?.length) return Math.round(displayY);
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < points.length; i++) {
    const d = Math.abs(pointValue(points[i])[1] - displayY);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

// bar3D hover params.value often carries only x/y/z (+ visualMap dim); look up the
// full per-bar payload we stored when building columns.
function surfaceBarPointValues(params) {
  const partial = pointValue(params?.value);
  if (!partial?.length) return partial ?? [];
  const col = Math.round(partial[0]);
  const year = partial.length > 13 && Number.isFinite(partial[13])
    ? Math.round(partial[13])
    : findYearInColumn(col, partial[1]);
  const stored = surfaceState.columns[col]?.[year];
  return stored ? pointValue(stored) : partial;
}

function zAxisLabel(formatter) {
  const theme = getChartTheme();
  return { show: true, color: theme.axisName, fontSize: SURFACE_AXIS_TICK_FONT, margin: 4, formatter };
}

export function largeWithdrawalLegendOptions(theme) {
  return {
    position: 'top',
    labels: {
      color: theme.legend,
      // Match heatmap / sequence-risk sample-run charts (short line swatches).
      boxWidth: 14,
      boxHeight: 2,
      font: { size: 10 },
      padding: 12,
      // Default Chart.js legend generation walks `_getSortedDatasetMetas()`,
      // which sorts by dataset.order (draw order). Build from the datasets
      // array instead so "4% rule" (appended last) stays last in the legend
      // while still drawn behind other series. Chart.js paints legend text
      // from each item's `fontColor` (not labels.color alone), so set it here.
      generateLabels(chart) {
        const fontColor = chart.legend?.options?.labels?.color ?? theme.legend;
        return chart.data.datasets.map((dataset, datasetIndex) => ({
          text: dataset.label,
          fillStyle: 'transparent',
          fontColor,
          strokeStyle: dataset.borderColor,
          lineWidth: Math.max(dataset.borderWidth ?? 2, 1.5),
          lineDash: dataset.borderDash ?? [],
          hidden: !chart.isDatasetVisible(datasetIndex),
          datasetIndex,
        }));
      },
    },
  };
}

function applySurfaceTheme() {
  if (!chartInstance || !surfaceState.columns.length) return;
  const theme = getChartTheme();
  const numCols = surfaceState.columns.length;
  chartInstance.setOption({
    tooltip: surfaceTooltipOptions(theme),
    xAxis3D: buildXAxisConfig(numCols),
    yAxis3D: buildYAxisConfig(surfaceState.numYears),
    zAxis3D: buildZAxisConfig({ min: 0, max: surfaceState.zCap }),
    grid3D: { environment: theme.sceneBg },
  });
  if (floatPanel) {
    floatPanel.style.background = theme.floatPanelBg;
    floatPanel.style.borderLeftColor = theme.floatPanelBorder;
    floatPanel.style.borderBottomColor = theme.floatPanelBorder;
  }
  if (floatTitle) floatTitle.style.color = theme.floatTitleText;
  if (floatChart && surfaceState.pinnedCol != null) {
    const series = extractWithdrawalSeries(surfaceState.pinnedCol);
    if (series) syncWithdrawalLineChart(floatChart, series);
  } else if (floatChart) {
    Object.assign(floatChart.options, floatChartOptions());
    floatChart.update('none');
  }
  if (largeChart && surfaceState.largeChartCol != null) {
    const series = extractWithdrawalSeries(surfaceState.largeChartCol);
    if (series) syncWithdrawalLineChart(largeChart, series, { large: true });
  } else if (largeChart) {
    Object.assign(largeChart.options.scales.x.ticks, { color: theme.axisTick });
    Object.assign(largeChart.options.scales.y.ticks, { color: theme.axisTick, callback: (v) => formatK(v) });
    Object.assign(largeChart.options.scales.y.title, { color: theme.axisTitle });
    Object.assign(largeChart.options.plugins.legend.labels, { color: theme.legend });
    largeChart.update('none');
  }
  largeBalanceBars?.applyTheme();
  if (surfaceState.pinnedCol != null) showFloatWithdrawal(surfaceState.pinnedCol);
}

function axisConfig(name, extra = {}) {
  const theme = getChartTheme();
  const {
    axisLabel: axisLabelExtra,
    axisLine: axisLineExtra,
    axisTick: axisTickExtra,
    nameTextStyle: nameTextStyleExtra,
    splitLine: splitLineExtra,
    ...rest
  } = extra;

  return {
    type: 'value',
    name,
    nameTextStyle: { color: theme.axisName, fontSize: 11, ...nameTextStyleExtra },
    axisLabel: {
      show: true,
      color: theme.axisName,
      fontSize: SURFACE_AXIS_TICK_FONT,
      margin: 4,
      ...axisLabelExtra,
    },
    axisTick: { show: false, ...axisTickExtra },
    axisLine: {
      ...axisLineExtra,
      lineStyle: {
        color: theme.axisName,
        ...axisLineExtra?.lineStyle,
      },
    },
    splitLine: { show: false, ...splitLineExtra },
    ...rest,
  };
}

function buildZAxisConfig({ min = 0, max = surfaceState.zCap } = {}) {
  const name = surfaceState.heightMode === HEIGHT_WITHDRAWAL ? 'Withdrawal' : 'Balance';
  return {
    min,
    max,
    ...axisConfig(name, { nameGap: BALANCE_AXIS_NAME_GAP }),
    axisLabel: zAxisLabel((v) => formatK(v)),
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
  floatTitle.style.cssText = `font-size:10px;font-weight:600;color:${theme.floatTitleText};margin-bottom:2px;line-height:1.15;`;

  const wrap = document.createElement('div');
  wrap.style.cssText = `height:${FLOAT_PANEL_CHART_HEIGHT}px;`;
  floatCanvas = document.createElement('canvas');
  floatCanvas.id = 'floatWithdrawalCanvas';
  wrap.appendChild(floatCanvas);

  floatPanel.appendChild(floatTitle);
  floatPanel.appendChild(wrap);
  container.appendChild(floatPanel);
}

function withdrawalPointDetails(col, dataIndex) {
  const points = surfaceState.columns[col];
  if (!points) return null;
  const p = points[dataIndex + 1];
  if (!p) return null;
  const vals = pointValue(p);
  return {
    year: pointYearIndex(vals),
    ret: vals[3],
    bal: vals[4],
    wd: vals[5],
    unadj: vals[8],
    breakdown: surfaceState.breakdownCols[col]?.[dataIndex] ?? null,
  };
}

// A negative "withdrawal" is actually a deposit (see simulation.js); report it
// as such rather than as a negative withdrawal amount.
function formatWithdrawnLine(wd, unadj) {
  if (wd < 0) return `Deposit: ${formatK(-wd)}`;
  const delta = wd - unadj;
  const deltaStr = delta === 0 ? '' : ` (Delta: ${delta > 0 ? '+' : ''}${formatK(delta)})`;
  return `Withdrawn: ${formatK(wd)}${deltaStr}`;
}

// One-line attribution of non-zero components vs the original plan.
export function formatWithdrawalBreakdownLine(breakdown) {
  if (!breakdown || breakdown.actual < 0) return null;
  const parts = [`Plan ${formatK(breakdown.plan)}`];
  const components = [
    ['Adj', breakdown.dynamicAdj],
    ['Scale', breakdown.scaleDelta],
    ['Gift', breakdown.gift],
    ['Glide', breakdown.glideExtra],
    ['Floor', breakdown.floorLift],
    ['Event', breakdown.majorEventOutflow],
    ['Tax', breakdown.tax],
  ];
  for (const [label, amount] of components) {
    if (Math.abs(amount) > 1e-6) {
      parts.push(`${label} ${amount > 0 ? '+' : ''}${formatK(amount)}`);
    }
  }
  if (breakdown.balanceShortfall > 1e-6) {
    parts.push(`Cap −${formatK(breakdown.balanceShortfall)}`);
  }
  return parts.length > 1 ? parts.join(' · ') : null;
}

function withdrawalDetailTailLines(details) {
  if (!details) return [];
  return [
    `Balance: ${formatK(details.bal)}`,
    `Market Return: ${(details.ret * 100).toFixed(1)}%`,
  ];
}

// `source` is either a surfaceState column key (this chart's own popups) or a
// `(dataIndex) => details` function so other charts (the sequence-risk
// scatter's drill-down) can reuse the exact same tooltip.
export function withdrawalChartTooltipCallbacks(source) {
  const detailsAt =
    typeof source === 'function'
      ? source
      : (dataIndex) => withdrawalPointDetails(surfaceState[source], dataIndex);
  return {
    title: (items) => (items[0] ? `Year ${items[0].label}` : null),
    afterTitle: (items) => {
      if (!items[0]) return [];
      const details = detailsAt(items[0].dataIndex);
      if (!details) return [];
      const lines = [formatWithdrawnLine(details.wd, details.unadj)];
      const breakdownLine = formatWithdrawalBreakdownLine(details.breakdown);
      if (breakdownLine) lines.push(breakdownLine);
      return lines;
    },
    // "Actual Withdrawal" is omitted here since afterTitle's "Withdrawn" line
    // already shows that same value (plus its delta from plan). The quiet
    // "4% rule" guide stays off the popup so it doesn't clutter the hover.
    filter: (item) =>
      item.dataset.label !== 'Actual Withdrawal' && item.dataset.label !== '4% rule',
    label: (ctx) => {
      const value = formatK(ctx.parsed.y);
      if (ctx.dataset.label === 'Minimum') return `Minimum: ${value}`;
      if (ctx.dataset.label === 'Gift') return `Gift ceiling: ${value}`;
      if (ctx.dataset.label === 'Original Plan') return `Original Plan: ${value}`;
      return null;
    },
    afterBody: (items) => {
      if (!items[0]) return [];
      return withdrawalDetailTailLines(detailsAt(items[0].dataIndex));
    },
  };
}

// Pull the year-by-year withdrawal series out of one pinned column's points.
function extractWithdrawalSeries(col) {
  const points = surfaceState.columns[col];
  if (!points) return null;

  const labels = [];
  const actualData = [];
  const unadjustedData = [];
  const balanceData = [];
  const returnData = [];
  let totalUnadjusted = 0;
  for (const p of points) {
    const vals = pointValue(p);
    const year = pointYearIndex(vals);
    if (year === 0) continue; // skip year 0 (no withdrawal)
    labels.push(year);
    actualData.push(vals[5]);
    unadjustedData.push(vals[8]);
    balanceData.push(vals[4]);
    returnData.push(vals[3]);
    totalUnadjusted += vals[8];
  }

  return {
    depleted: surfaceState.depletedCols[col] ?? false,
    belowPlan: surfaceState.belowPlanCols[col] ?? false,
    labels,
    actualData,
    unadjustedData,
    balanceData,
    returnData,
    totalUnadjusted,
    total: points[0] ? pointValue(points[0])[6] : 0,
    medianYearly: points[0] ? pointValue(points[0])[9] : 0,
    horizonYears: points[0] ? pointValue(points[0])[10] : 0,
    avg: points[0] ? pointValue(points[0])[7] : 0,
    irr: points[0] ? pointValue(points[0])[12] : NaN,
  };
}

// Minimum-withdrawal and gift-ceiling reference lines for a sample-run chart,
// sliced to the path length and styled like the schedule preview sparklines.
function planOverlaySlice(portfolio, length) {
  if (!portfolio || length <= 0) {
    return { floorSeries: null, giftAmounts: null };
  }
  return {
    floorSeries: portfolio.withdrawalFloorSeries?.slice(0, length) ?? null,
    giftAmounts: portfolio.giftingSeries?.map((entry) => entry.amount).slice(0, length) ?? null,
  };
}

function buildWithdrawalOverlayDatasets(series, { large = false, portfolio } = {}) {
  const theme = getChartTheme();
  const resolvedPortfolio = portfolio ?? surfaceState.simParams?.portfolio;
  const { floorSeries, giftAmounts } = planOverlaySlice(
    resolvedPortfolio,
    series.labels.length,
  );
  const datasets = [];

  const displayFloor = Array.isArray(floorSeries)
    ? floorSeries.map((v) => Math.max(0, v ?? 0))
    : null;
  if (displayFloor?.some((v) => v > 0)) {
    datasets.push({
      label: 'Minimum',
      data: displayFloor,
      borderColor: theme.floorLine,
      backgroundColor: 'transparent',
      borderWidth: large ? 1.5 : 1,
      borderDash: [4, 3],
      tension: 0.1,
      pointRadius: 0,
      pointHoverRadius: large ? 4 : 3,
      fill: false,
      order: 0,
    });
  }

  const baseline = series.unadjustedData.map((v) => Math.max(0, v));
  const giftOverlay = Array.isArray(giftAmounts)
    ? buildGiftOverlaySeries(baseline, giftAmounts)
    : null;
  if (giftOverlay?.some((v) => v != null)) {
    datasets.push({
      label: 'Gift',
      data: giftOverlay,
      borderColor: theme.giftLine,
      backgroundColor: 'transparent',
      borderWidth: large ? 1.5 : 1,
      borderDash: [2, 2],
      tension: 0.1,
      pointRadius: 0,
      pointHoverRadius: large ? 4 : 3,
      fill: false,
      order: 2,
      spanGaps: false,
    });
  }

  return datasets;
}

/** Flat start × 4% reference — quiet dash, adorn color; first in legend, drawn on top. */
function buildFourPercentRuleDataset(series, portfolio) {
  const theme = getChartTheme();
  const resolvedPortfolio = portfolio ?? surfaceState.simParams?.portfolio;
  const startBalance = resolvedPortfolio?.start ?? 0;
  if (!(startBalance > 0) || series.labels.length === 0) return null;
  const classicAmount = startBalance * CLASSIC_FOUR_PERCENT_RATE;
  return {
    label: '4% rule',
    data: series.labels.map(() => classicAmount),
    borderColor: theme.planLine,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderDash: [2, 5],
    tension: 0,
    pointRadius: 0,
    pointHoverRadius: 0,
    fill: false,
    // Highest draw order = painted last (on top). First in the datasets array
    // = first in the legend (see largeWithdrawalLegendOptions).
    order: 10,
  };
}

// Chart.js datasets comparing the original withdrawal plan against what was
// actually withdrawn. Shared by the small float panel, the large dialog, and
// the sequence-risk scatter's drill-down; `large` just scales line and point
// sizes up, and `portfolio` overrides this chart's own sim params for reuse
// from other charts.
export function withdrawalComparisonDatasets(series, { large = false, portfolio } = {}) {
  const theme = getChartTheme();
  const floatTheme = floatThemeForSeries(series);
  // Deposit years carry a negative "withdrawal" internally; this chart only
  // depicts withdrawals, so clamp those to 0 rather than dipping below the axis.
  const unadjustedData = series.unadjustedData.map((v) => Math.max(0, v));
  const actualData = series.actualData.map((v) => Math.max(0, v));
  const fourPercentRule = buildFourPercentRuleDataset(series, portfolio);
  // Keep Original Plan immediately before Actual so fill target '-1' still
  // compares actual vs plan. 4% rule is listed first for the legend.
  return [
    ...(fourPercentRule ? [fourPercentRule] : []),
    {
      label: 'Original Plan',
      data: unadjustedData,
      // Color only swapped with 4% rule (muted axis tick); dash/width unchanged.
      borderColor: theme.axisTick,
      borderWidth: large ? 2 : 1.5,
      borderDash: large ? [5, 5] : [4, 4],
      tension: 0.1,
      fill: { target: 'origin' },
      backgroundColor: theme.planFill,
      pointRadius: 0,
      pointHoverRadius: 0,
      order: 1,
    },
    {
      label: 'Actual Withdrawal',
      data: actualData,
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
      order: 3,
    },
    ...buildWithdrawalOverlayDatasets(series, { large, portfolio }),
  ];
}

function syncWithdrawalLineChart(chart, series, { large = false } = {}) {
  if (!chart || !series) return;
  chart.data.labels = series.labels;
  chart.data.datasets = withdrawalComparisonDatasets(series, { large });
  const theme = floatThemeForSeries(series);
  const actualDataset = chart.data.datasets.find((ds) => ds.label === 'Actual Withdrawal');
  if (actualDataset) {
    actualDataset.borderColor = theme.line;
    actualDataset.pointBackgroundColor = theme.point;
  }
  chart.update(large ? undefined : 'none');
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
      tooltip: sampleRunTooltipOptions(withdrawalChartTooltipCallbacks('pinnedCol')),
    },
  };
}

function applyFloatChartTheme(series) {
  if (!floatChart) return;
  const theme = floatThemeForSeries(series);
  const dsActual = floatChart.data.datasets.find((ds) => ds.label === 'Actual Withdrawal');
  if (!dsActual) return;
  dsActual.borderColor = theme.line;
  dsActual.pointBackgroundColor = theme.point;
}

// Lifetime withdrawal summary for 3D sample-run charts: Total + Mean / Year
// only (Median / Year stays on the results cards). Mean leads when that
// metric ranks the runs; otherwise Total leads. Pure + exported for unit tests.
export function withdrawalAmountRows(total, horizonYears, metric) {
  const meanYr = horizonYears > 0 ? total / horizonYears : 0;
  const totalRow = { label: 'Total', value: total };
  const meanRow = { label: 'Mean / Year', value: meanYr };
  return isMeanYearlyMetric(metric) ? [meanRow, totalRow] : [totalRow, meanRow];
}

function withdrawalAmounts(total, horizonYears = 0) {
  return withdrawalAmountRows(total, horizonYears, surfaceState.withdrawalMetric);
}

function formatAmountSummary(rows, { htmlBold = false, sep = ' · ' } = {}) {
  return rows
    .map((row) => (
      htmlBold
        ? `${row.label}: <b>${formatK(row.value)}</b>`
        : `${row.label}: ${formatK(row.value)}`
    ))
    .join(sep);
}

function withdrawalSummaryHtml(total, horizonYears, { includeHorizon = false } = {}) {
  const rows = withdrawalAmounts(total, horizonYears);
  const lines = [formatAmountSummary(rows, { htmlBold: true })];
  if (includeHorizon && surfaceState.horizonVariable && horizonYears > 0) {
    lines.push(`Horizon: <b>${horizonYears} years</b>`);
  }
  return lines.join('<br>');
}

function showFloatWithdrawal(col) {
  ensureFloatPanel();
  const series = extractWithdrawalSeries(col);
  if (!floatPanel || !series) return;

  const status = pathStatusDisplay(series);
  const muted = getChartTheme().floatMutedText;
  const amountSummary = formatAmountSummary(
    withdrawalAmounts(series.total, series.horizonYears),
  );
  const planBit = `Plan: ${formatK(series.totalUnadjusted)}`;
  const horizonPlanLine = surfaceState.horizonVariable && series.horizonYears > 0
    ? `Horizon: ${series.horizonYears} years · ${planBit}`
    : planBit;
  // Tight header: title+status | Avg · IRR; then amounts; then Horizon · Plan.
  floatTitle.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:6px;">
      <div style="font-weight:700;font-size:10px;line-height:1.15;">
        ${sampleRunTitle(col)}
        <span style="font-weight:normal;color:${status.color}"> · ${status.text}</span>
      </div>
      <div style="color:${muted};text-align:right;font-weight:normal;font-size:9px;line-height:1.15;white-space:nowrap;">
        Avg: ${formatPercent(series.avg)} · IRR: ${formatPercent(series.irr) || '—'}
      </div>
    </div>
    <div style="font-weight:normal;color:${muted};font-size:9px;line-height:1.2;margin-top:1px">
      <div>${amountSummary}</div>
      <div>${horizonPlanLine}</div>
    </div>
  `;
  floatTitle.style.color = '';

  if (floatChart) {
    syncWithdrawalLineChart(floatChart, series);
    applyFloatChartTheme(series);
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
let largeBalanceBars = null; // linked balance bar chart under the large dialog's line chart

function resetWithdrawalHover() {
  largeBalanceBars?.reset();
}

function openLargeWithdrawalChart(col) {
  const dialog = document.getElementById('withdrawalChartDialog');
  if (!dialog) return;

  surfaceState.largeChartCol = col;

  const series = extractWithdrawalSeries(col);
  if (!series) return;

  const title = document.getElementById('withdrawalChartDialogTitle');
  if (title) title.textContent = sampleRunTitle(col);
  
  const subtitle = document.getElementById('withdrawalChartDialogSubtitle');
  if (subtitle) {
    subtitle.innerHTML =
      `${formatAmountSummary(withdrawalAmounts(series.total, series.horizonYears))}` +
      `<br>Plan: ${formatK(series.totalUnadjusted)}`;
  }
  
  const avgReturnEl = document.getElementById('withdrawalChartDialogAvgReturn');
  if (avgReturnEl) avgReturnEl.textContent = `Avg Return: ${formatPercent(series.avg)}`;

  const irrEl = document.getElementById('withdrawalChartDialogIrr');
  if (irrEl) irrEl.textContent = `IRR: ${formatPercent(series.irr) || '—'}`;

  const canvas = document.getElementById('largeWithdrawalCanvas');
  const balanceCanvas = document.getElementById('largeBalanceCanvas');
  const theme = floatThemeForSeries(series);

  if (largeChart) {
    syncWithdrawalLineChart(largeChart, series, { large: true });
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
          legend: largeWithdrawalLegendOptions(chartTheme),
          tooltip: sampleRunTooltipOptions(withdrawalChartTooltipCallbacks('largeChartCol'), { large: true }),
        },
        onHover: (_evt, activeElements) => {
          const index = activeElements.length > 0 ? activeElements[0].index : -1;
          largeBalanceBars?.setHighlight(index);
        },
      },
    });
    canvas.addEventListener('mouseleave', resetWithdrawalHover);
    const actualDataset = largeChart.data.datasets.find((ds) => ds.label === 'Actual Withdrawal');
    if (actualDataset) {
      actualDataset.borderColor = theme.line;
      actualDataset.pointBackgroundColor = theme.point;
    }
  }

  if (!largeBalanceBars && balanceCanvas) {
    largeBalanceBars = createLinkedBalanceBars(balanceCanvas, () => largeChart);
  }
  largeBalanceBars?.setSeries(series);

  dialog.showModal();
}

function hideFloatPanel() {
  if (floatPanel) floatPanel.style.display = 'none';
}

function tooltipFormatter(params) {
  const vals = surfaceBarPointValues(params);
  const col = Math.round(vals[0]);
  const y = pointYearIndex(vals);
  const ret = vals[3];
  const bal = vals[4];
  const wd = vals[5];
  const avg = vals[7];
  const irr = vals[12];
  const unadj = vals[8];
  const delta = wd - unadj;
  const deltaStr = delta === 0 ? '' : ` (Delta: ${delta > 0 ? '+' : ''}${formatK(delta)})`;
  const summary = withdrawalSummaryHtml(vals[6], vals[10], { includeHorizon: true });
  return (
    `<b>${sampleRunTitle(col)}</b>` +
    `<br>${summary}` +
    `<br>Avg: <b>${formatPercent(avg)}</b> · IRR: <b>${formatPercent(irr) || '—'}</b>` +
    `<br>Year: ${y}` +
    `<br>Withdrawn: ${formatK(wd)}${deltaStr}` +
    `<br>Original Plan: ${formatK(unadj)}` +
    `<br>Balance: ${formatK(bal)}` +
    `<br>Market Return: ${(ret * 100).toFixed(1)}%`
  );
}

function surfaceTooltipPosition(point, _params, _dom, _rect, size) {
  const [viewW, viewH] = size.viewSize;
  const [tipW, tipH] = size.contentSize;
  const mouse = surfaceTooltipPointer ?? point;
  if (!mouse) return [TOOLTIP_EDGE_PAD, TOOLTIP_EDGE_PAD];

  let x = mouse[0] + TOOLTIP_POINTER_OFFSET;
  let y = mouse[1] + TOOLTIP_POINTER_OFFSET;
  if (x + tipW > viewW - TOOLTIP_EDGE_PAD) {
    x = mouse[0] - tipW - TOOLTIP_POINTER_OFFSET;
  }
  if (y + tipH > viewH - TOOLTIP_EDGE_PAD) {
    y = mouse[1] - tipH - TOOLTIP_POINTER_OFFSET;
  }
  x = Math.max(TOOLTIP_EDGE_PAD, Math.min(x, viewW - tipW - TOOLTIP_EDGE_PAD));
  y = Math.max(TOOLTIP_EDGE_PAD, Math.min(y, viewH - tipH - TOOLTIP_EDGE_PAD));
  return [x, y];
}

function surfaceTooltipOptions(theme) {
  return {
    confine: true,
    appendToBody: false,
    position: surfaceTooltipPosition,
    formatter: tooltipFormatter,
    backgroundColor: theme.floatPanelBg,
    borderColor: theme.floatPanelBorder,
    padding: [5, 7],
    textStyle: { fontSize: 12, color: theme.tooltipBody },
  };
}

// Update the dim/highlight overlay without rebuilding the whole chart.
// Only the pinned row is highlighted; it floats up above the (dimmed) field.
function applyFocus() {
  if (!chartInstance) return;
  const col = surfaceState.pinnedCol;
  const { columns, zCap, barWidth, barDepth } = surfaceState;
  const nPath = pathSeriesCount();

  if (col == null || !columns[col]) {
    // Nothing pinned: the full field is interactive for exploration.
    hideFloatPanel();
    chartInstance.setOption({
      zAxis3D: { max: zCap },
      series: [
        ...Array.from({ length: nPath }, () => ({ itemStyle: { opacity: 1 }, silent: false })),
        { data: [], barSize: [barWidth, barDepth] },
      ],
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
  // so the per-row lifetime Total stays constant as you mouse along it.
  chartInstance.setOption({
    zAxis3D: { max: zCap + lift },
    series: [
      ...Array.from({ length: nPath }, () => ({ itemStyle: { opacity: DIM_OPACITY }, silent: true })),
      {
        data: lifted,
        barSize: [barWidth, barDepth],
        itemStyle: { opacity: 1 },
        silent: false,
      },
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

  chartInstance.getZr().on('mousemove', (e) => {
    surfaceTooltipPointer = [e.offsetX, e.offsetY];
  });
  chartInstance.getZr().on('mouseout', () => {
    surfaceTooltipPointer = null;
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

function yearDisplayLayout(numYears, emphasis) {
  // numYears+1 bands cover year 0 (start) through year numYears.
  // Each bar sits at its band midpoint with depth matching that band — early
  // years get thicker bars (no gaps between years).
  const numRows = numYears + 1;
  const layout = heatmapRowLayout(numRows, emphasis, SURFACE_EMPHASIS_MAX_RATIO);
  const displayY = new Float64Array(numRows);
  const yearDepths = new Float64Array(numRows);
  let minDepth = Infinity;
  for (let y = 0; y < numRows; y++) {
    const lo = layout[y];
    const hi = layout[y + 1];
    displayY[y] = ((lo + hi) / 2) * numYears;
    // Slight shrink so adjacent year bars don't z-fight at the shared edge.
    const depth = BOX_DEPTH * (hi - lo) * 0.96;
    yearDepths[y] = depth;
    if (depth < minDepth) minDepth = depth;
  }
  return { displayY, yearDepths, barDepth: minDepth, layout };
}

function buildYAxisConfig(numYears) {
  const layout = surfaceState.yearLayout;
  return axisConfig('Year', {
    min: 0,
    max: numYears,
    splitNumber: 5,
    inverse: true,
    axisLabel: {
      formatter: (v) => String(yearAtDisplayCoord(Number(v), layout, numYears)),
    },
  });
}

function maxWithdrawalInPaths(surfacePaths) {
  let maxW = 0;
  for (const path of surfacePaths) {
    const wds = path.withdrawals;
    if (!wds) continue;
    for (let i = 0; i < wds.length; i++) {
      if (wds[i] > maxW) maxW = wds[i];
    }
  }
  return maxW;
}

function buildColumnsFromPaths(surfacePaths, numYears, {
  shortfallTolerance,
  withdrawalMetric,
  heightMode,
  emphasis,
} = {}) {
  const numCols = surfacePaths.length;
  const numRows = numYears + 1;
  const startBalance = surfacePaths[0] ? surfacePaths[0].balances[0] : 0;
  const mode = heightMode ?? surfaceState.heightMode ?? HEIGHT_BALANCE;
  const emp = emphasis ?? surfaceState.emphasis ?? EMPHASIS_DEFAULT;
  const { displayY, yearDepths, barDepth, layout } = yearDisplayLayout(numYears, emp);

  let zCap;
  if (mode === HEIGHT_WITHDRAWAL) {
    const peak = maxWithdrawalInPaths(surfacePaths);
    zCap = Math.max(peak * 1.05, 1);
  } else {
    zCap = startBalance * Z_CAP_MULTIPLE;
  }

  const tolerance = shortfallTolerance ?? surfaceState.shortfallTolerance ?? 0.05;
  const metric = withdrawalMetric ?? surfaceState.withdrawalMetric ?? 'total';

  const dataByYear = Array.from({ length: numRows }, () => []);
  const columns = [];
  const breakdownCols = [];
  const depletedCols = [];
  const belowPlanCols = [];
  for (let x = 0; x < numCols; x++) {
    const path = surfacePaths[x];
    const { balances, returns, withdrawals, unadjustedWithdrawals, withdrawalBreakdown, totalWithdrawn, avgReturn, irr, medianYearlyWithdrawal, horizonYears, planBenchmark } = path;
    const pathHorizon = horizonYears ?? numYears;
    const depleted = pathDepleted(balances);
    const belowPlan = !depleted && pathBelowPlan(pathActualWithdrawal(path, metric), planBenchmark ?? 0, tolerance);
    depletedCols.push(depleted);
    belowPlanCols.push(belowPlan);
    const colPoints = [];
    for (let y = 0; y <= pathHorizon; y++) {
      const balance = Math.max(0, balances[y]);
      const withdrawal = y > 0 && withdrawals ? withdrawals[y - 1] : 0;
      const heightRaw = mode === HEIGHT_WITHDRAWAL ? Math.max(0, withdrawal) : balance;
      const height = Math.min(heightRaw, zCap);
      const ret = y > 0 ? returns[y - 1] : returns[0] || 0;
      const unadjusted = y > 0 && unadjustedWithdrawals ? unadjustedWithdrawals[y - 1] : 0;
      const point = makeBarPoint(
        x, displayY[y] ?? y, height, ret, balance, withdrawal, totalWithdrawn || 0, avgReturn || 0, depleted, belowPlan, unadjusted,
        medianYearlyWithdrawal ?? 0, pathHorizon, planBenchmark ?? 0, irr ?? NaN, y,
      );
      dataByYear[y].push(point);
      colPoints.push(point);
    }
    columns.push(colPoints);
    breakdownCols.push(withdrawalBreakdown ?? null);
  }

  const barWidth = BOX_WIDTH / numCols;

  return {
    dataByYear,
    columns,
    breakdownCols,
    depletedCols,
    belowPlanCols,
    zCap,
    barWidth,
    barDepth,
    yearDepths,
    layout,
    numCols,
    numRows,
  };
}

function buildPathYearSeries(dataByYear, barWidth, yearDepths, {
  opacity = 1,
  silent = false,
  includeType = false,
} = {}) {
  return dataByYear.map((data, y) => {
    const series = {
      name: y === 0 ? 'paths' : `paths-y${y}`,
      data,
      barSize: [barWidth, yearDepths[y]],
      itemStyle: { opacity },
      silent,
    };
    if (includeType) {
      series.type = 'bar3D';
      series.shading = 'lambert';
      series.bevelSize = 0;
      series.animation = false;
      series.emphasis = { label: { show: false } };
    }
    return series;
  });
}

function buildFocusSeriesShell(barWidth, barDepth, { includeType = false } = {}) {
  const series = {
    name: 'focus',
    data: [],
    barSize: [barWidth, barDepth],
    itemStyle: { opacity: 1 },
    silent: false,
  };
  if (includeType) {
    series.type = 'bar3D';
    series.shading = 'lambert';
    series.bevelSize = 0;
    series.animation = false;
    series.emphasis = { label: { show: false } };
  }
  return series;
}

function pathSeriesCount() {
  return surfaceState.yearDepths?.length ?? (surfaceState.numYears + 1);
}

function applySurfaceDataset(surfacePaths, numYears) {
  if (!chartInstance) return;

  const {
    dataByYear,
    columns,
    breakdownCols,
    depletedCols,
    belowPlanCols,
    zCap,
    barWidth,
    barDepth,
    yearDepths,
    layout,
    numCols,
  } = buildColumnsFromPaths(surfacePaths, numYears, {
    shortfallTolerance: surfaceState.shortfallTolerance,
    withdrawalMetric: surfaceState.withdrawalMetric,
    heightMode: surfaceState.heightMode,
    emphasis: surfaceState.emphasis,
  });

  surfaceState.columns = columns;
  surfaceState.breakdownCols = breakdownCols;
  surfaceState.depletedCols = depletedCols;
  surfaceState.belowPlanCols = belowPlanCols;
  surfaceState.barWidth = barWidth;
  surfaceState.barDepth = barDepth;
  surfaceState.yearDepths = yearDepths;
  surfaceState.yearLayout = layout;
  surfaceState.zCap = zCap;
  surfaceState.numYears = numYears;
  surfaceState.pinnedCol = null;
  surfaceState.columnClickHandled = false;
  hideFloatPanel();

  chartInstance.setOption({
    xAxis3D: buildXAxisConfig(numCols),
    yAxis3D: buildYAxisConfig(numYears),
    zAxis3D: buildZAxisConfig({ min: 0, max: zCap }),
    series: [
      ...buildPathYearSeries(dataByYear, barWidth, yearDepths, { includeType: true }),
      buildFocusSeriesShell(barWidth, barDepth, { includeType: true }),
    ],
  }, { replaceMerge: ['series'] });
}

function enrichDrilldownPaths(paths) {
  const cache = surfaceState.surfaceMeta?.benchmarkCache ?? {};
  const metric = surfaceState.withdrawalMetric;
  const weighting = rankingWeightingFromState();
  return paths.map((path) => {
    const h = path.horizonYears;
    let planBenchmark = path.planBenchmark;
    if (planBenchmark == null && h != null) {
      planBenchmark = cache[h];
    }
    if (planBenchmark == null && h != null && surfaceState.simParams?.portfolio) {
      if (isEarlyWeightingActive(weighting)) {
        const weightedPlan = weightedScheduleScore(path.unadjustedWithdrawals ?? path.withdrawals ?? [], weighting);
        planBenchmark = isMeanYearlyMetric(metric) && h > 0 ? weightedPlan / h : weightedPlan;
      } else if (isMedianYearlyMetric(metric)) {
        planBenchmark = median(path.withdrawals || []);
      } else {
        const plannedTotal = (path.unadjustedWithdrawals ?? []).reduce((sum, w) => sum + w, 0);
        planBenchmark = isMeanYearlyMetric(metric) && h > 0 ? plannedTotal / h : plannedTotal;
      }
    }
    let earlyWeightedScore = path.earlyWeightedScore;
    if (earlyWeightedScore == null && isEarlyWeightingActive(weighting)) {
      const weightedTotal = weightedScheduleScore(path.withdrawals || [], weighting);
      earlyWeightedScore = isMeanYearlyMetric(metric) && h > 0 ? weightedTotal / h : weightedTotal;
    }
    return { ...path, planBenchmark: planBenchmark ?? 0, earlyWeightedScore };
  });
}

function activeOverviewRanks() {
  const n = surfaceState.surfaceMeta?.numSimulations;
  if (!n) {
    return {
      loRank: surfaceState.surfaceMeta?.p5Rank ?? 0,
      hiRank: surfaceState.surfaceMeta?.p65Rank ?? 0,
    };
  }
  return ranksForPercentileWindow(n, surfaceState.lowerPct, surfaceState.upperPct);
}

function syncSurfaceControlUi() {
  const balBtn = document.getElementById('surfaceHeightBalance');
  const wdBtn = document.getElementById('surfaceHeightWithdrawal');
  const isBal = surfaceState.heightMode === HEIGHT_BALANCE;
  if (balBtn) {
    balBtn.setAttribute('aria-pressed', isBal ? 'true' : 'false');
    balBtn.classList.toggle('bg-theme-muted', isBal);
    balBtn.classList.toggle('text-theme-heading', isBal);
    balBtn.classList.toggle('font-semibold', isBal);
    balBtn.classList.toggle('text-theme-faint', !isBal);
  }
  if (wdBtn) {
    wdBtn.setAttribute('aria-pressed', isBal ? 'false' : 'true');
    wdBtn.classList.toggle('bg-theme-muted', !isBal);
    wdBtn.classList.toggle('text-theme-heading', !isBal);
    wdBtn.classList.toggle('font-semibold', !isBal);
    wdBtn.classList.toggle('text-theme-faint', isBal);
  }

  const emp = document.getElementById('surfaceEmphasis');
  if (emp) emp.value = String(surfaceState.emphasis);

  const lower = document.getElementById('surfaceLower');
  const upper = document.getElementById('surfaceUpper');
  const lowerLabel = document.getElementById('surfaceLowerLabel');
  const upperLabel = document.getElementById('surfaceUpperLabel');
  if (lower) lower.value = String(surfaceState.lowerPct);
  if (upper) upper.value = String(surfaceState.upperPct);
  if (lowerLabel) lowerLabel.textContent = `P${surfaceState.lowerPct}`;
  if (upperLabel) upperLabel.textContent = `P${surfaceState.upperPct}`;
}

function redrawCurrentSurface() {
  if (surfaceState.viewMode === 'drilldown') {
    // Rebuild from current drilldown ranks (paths aren't stored separately).
    const center = surfaceState.drilldownCenterRank;
    if (center == null || !surfaceState.surfaceMeta || !surfaceState.simParams) return;
    const { paths: drillPaths, lo, hi, centerRank } = buildDrilldownPaths(
      center,
      surfaceState.surfaceMeta,
      surfaceState.simParams,
      surfaceState.seed,
    );
    surfaceState.drilldownLo = lo;
    surfaceState.drilldownHi = hi;
    surfaceState.drilldownCenterRank = centerRank;
    applySurfaceDataset(enrichDrilldownPaths(drillPaths), surfaceState.numYears);
    updateSurfaceChrome({
      mode: 'drilldown',
      centerRank,
      lo,
      hi,
      n: surfaceState.surfaceMeta.numSimulations,
    });
    return;
  }
  if (!surfaceState.overviewPaths?.length) return;
  applySurfaceDataset(surfaceState.overviewPaths, surfaceState.numYears);
  updateSurfaceChrome({ mode: 'overview' });
}

function setHeightMode(mode) {
  const next = mode === HEIGHT_WITHDRAWAL ? HEIGHT_WITHDRAWAL : HEIGHT_BALANCE;
  if (surfaceState.heightMode === next) return;
  surfaceState.heightMode = next;
  syncSurfaceControlUi();
  redrawCurrentSurface();
}

function setEmphasis(v) {
  const next = Math.max(0, Math.min(100, Math.round(v) || 0));
  if (surfaceState.emphasis === next) return;
  surfaceState.emphasis = next;
  syncSurfaceControlUi();
  redrawCurrentSurface();
}

function rebuildOverviewFromWindow() {
  if (!surfaceState.surfaceMeta || !surfaceState.simParams) return;
  const { loRank, hiRank } = activeOverviewRanks();
  const paths = sampleOverviewPaths(
    loRank,
    hiRank,
    surfaceState.surfaceMeta,
    surfaceState.simParams,
    surfaceState.seed,
  );
  surfaceState.overviewPaths = enrichDrilldownPaths(paths);
  surfaceState.viewMode = 'overview';
  surfaceState.drilldownCenterRank = null;
  surfaceState.drilldownLo = null;
  surfaceState.drilldownHi = null;
  applySurfaceDataset(surfaceState.overviewPaths, surfaceState.numYears);
  updateSurfaceChrome({ mode: 'overview' });
}

// Apply the shared from/to window (keeps surface in lockstep with the heatmap).
function applyOutcomeWindow({ lowerPct, upperPct }) {
  const changed = surfaceState.lowerPct !== lowerPct || surfaceState.upperPct !== upperPct;
  surfaceState.lowerPct = lowerPct;
  surfaceState.upperPct = upperPct;
  syncSurfaceControlUi();
  if (!changed) return;
  if (surfaceState.surfaceMeta && surfaceState.simParams) {
    rebuildOverviewFromWindow();
  }
}

function setLowerPct(v) {
  if (!setOutcomeLowerPct(v)) syncSurfaceControlUi();
}

function setUpperPct(v) {
  if (!setOutcomeUpperPct(v)) syncSurfaceControlUi();
}

function bindControlEvents() {
  if (surfaceState.controlsBound) return;
  document.getElementById('surfaceHeightBalance')
    ?.addEventListener('click', () => setHeightMode(HEIGHT_BALANCE));
  document.getElementById('surfaceHeightWithdrawal')
    ?.addEventListener('click', () => setHeightMode(HEIGHT_WITHDRAWAL));
  document.getElementById('surfaceEmphasis')
    ?.addEventListener('input', (ev) => setEmphasis(Number(ev.target.value)));
  document.getElementById('surfaceLower')
    ?.addEventListener('input', (ev) => setLowerPct(Number(ev.target.value)));
  document.getElementById('surfaceUpper')
    ?.addEventListener('input', (ev) => setUpperPct(Number(ev.target.value)));
  if (!surfaceState.outcomeWindowBound) {
    onOutcomeWindowChange(applyOutcomeWindow);
    surfaceState.outcomeWindowBound = true;
  }
  surfaceState.controlsBound = true;
}

function enterDrilldown(col) {
  if (!surfaceState.surfaceMeta || !surfaceState.simParams) {
    console.warn('3D drill-down unavailable: simulation metadata missing. Re-run the simulation.');
    return;
  }

  const { loRank, hiRank } = activeOverviewRanks();
  const centerRank = rankForOverviewColumn(col, surfaceState.surfaceMeta, loRank, hiRank);
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

  applySurfaceDataset(enrichDrilldownPaths(paths), surfaceState.numYears);
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

  const {
    params = null,
    seed = 0,
    surfaceMeta = null,
    shortfallTolerance = 0.05,
    plannedWithdrawn = 0,
    plannedMedianYearly = 0,
    onPlanBenchmark = 0,
    withdrawalMetric = 'total',
    horizonVariable = false,
  } = context;

  surfaceState.viewMode = 'overview';
  surfaceState.overviewPaths = surfacePaths;
  surfaceState.simParams = params;
  surfaceState.seed = seed;
  surfaceState.surfaceMeta = surfaceMeta;
  surfaceState.shortfallTolerance = shortfallTolerance;
  surfaceState.plannedWithdrawn = plannedWithdrawn;
  surfaceState.plannedMedianYearly = plannedMedianYearly;
  surfaceState.onPlanBenchmark = onPlanBenchmark;
  surfaceState.withdrawalMetric = withdrawalMetric;
  surfaceState.horizonVariable = horizonVariable;
  surfaceState.drilldownCenterRank = null;
  surfaceState.drilldownLo = null;
  surfaceState.drilldownHi = null;
  surfaceState.numYears = numYears;
  surfaceState.lastContext = { surfacePaths, numYears, context };

  // Keep local state aligned with the shared from/to window (heatmap may have
  // moved the sliders before this chart drew).
  const sharedWindow = getOutcomeWindow();
  surfaceState.lowerPct = sharedWindow.lowerPct;
  surfaceState.upperPct = sharedWindow.upperPct;

  // If the user widened/narrowed the percentile window on a prior run, resample
  // so the chart matches the sliders instead of the packaged P5–P65 default.
  if (
    surfaceMeta &&
    params &&
    (surfaceState.lowerPct !== OUTCOME_LOWER_DEFAULT || surfaceState.upperPct !== OUTCOME_UPPER_DEFAULT)
  ) {
    const { loRank, hiRank } = activeOverviewRanks();
    surfaceState.overviewPaths = enrichDrilldownPaths(
      sampleOverviewPaths(loRank, hiRank, surfaceMeta, params, seed),
    );
  }

  const pathsForDraw = surfaceState.overviewPaths;

  const {
    dataByYear,
    columns,
    breakdownCols,
    depletedCols,
    belowPlanCols,
    zCap,
    barWidth,
    barDepth,
    yearDepths,
    layout,
    numCols,
  } = buildColumnsFromPaths(pathsForDraw, numYears, {
    shortfallTolerance,
    withdrawalMetric,
    heightMode: surfaceState.heightMode,
    emphasis: surfaceState.emphasis,
  });

  surfaceState.columns = columns;
  surfaceState.breakdownCols = breakdownCols;
  surfaceState.depletedCols = depletedCols;
  surfaceState.belowPlanCols = belowPlanCols;
  surfaceState.barWidth = barWidth;
  surfaceState.barDepth = barDepth;
  surfaceState.yearDepths = yearDepths;
  surfaceState.yearLayout = layout;
  surfaceState.zCap = zCap;
  surfaceState.pinnedCol = null;
  surfaceState.columnClickHandled = false;
  hideFloatPanel();
  syncSurfaceControlUi();
  updateSurfaceChrome({ mode: 'overview' });
  const theme = getChartTheme();

  chartInstance.setOption(
    {
      tooltip: surfaceTooltipOptions(theme),
      visualMap: {
        show: false,
        dimension: 3,
        min: RETURN_MIN,
        max: RETURN_MAX,
        inRange: { color: buildReturnColorRamp() },
      },
      xAxis3D: buildXAxisConfig(numCols),
      yAxis3D: buildYAxisConfig(numYears),
      zAxis3D: buildZAxisConfig({ min: 0, max: zCap }),
      grid3D: {
        boxWidth: BOX_WIDTH,
        boxDepth: BOX_DEPTH,
        boxHeight: BOX_HEIGHT,
        viewControl: {
          alpha: CAMERA_ALPHA,
          beta: CAMERA_BETA,
          distance: computeCameraDistance(dom),
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
        ...buildPathYearSeries(dataByYear, barWidth, yearDepths, { includeType: true }),
        buildFocusSeriesShell(barWidth, barDepth, { includeType: true }),
      ],
    },
    true
  );

  bindEvents();
  bindControlEvents();

  window.__TEST_HOOKS__ = window.__TEST_HOOKS__ || {};
  window.__TEST_HOOKS__.surfaceChart = chartInstance;
  window.__TEST_HOOKS__.surfaceViewMode = () => surfaceState.viewMode;
  window.__TEST_HOOKS__.enterSurfaceDrilldown = (col) => enterDrilldown(col);
  window.__TEST_HOOKS__.exitSurfaceDrilldown = () => exitDrilldown();
  window.__TEST_HOOKS__.surfaceXAxisLabel = (col) =>
    columnPercentileLabel(col, surfaceState.columns.length);
  window.__TEST_HOOKS__.surfaceOverviewAxisTickLabel = (col) =>
    overviewAxisTickLabel(col, surfaceState.columns.length);
  window.__TEST_HOOKS__.formatSurfaceTooltip = (params) => tooltipFormatter(params);
  window.__TEST_HOOKS__.pinSurfaceColumn = (col) => {
    surfaceState.pinnedCol = col;
    applyFocus();
  };
  window.__TEST_HOOKS__.surfaceState = () => ({
    heightMode: surfaceState.heightMode,
    emphasis: surfaceState.emphasis,
    lowerPct: surfaceState.lowerPct,
    upperPct: surfaceState.upperPct,
    zCap: surfaceState.zCap,
    viewMode: surfaceState.viewMode,
  });
  window.__TEST_HOOKS__.surfaceSetHeightMode = (mode) => setHeightMode(mode);
  window.__TEST_HOOKS__.surfaceSetEmphasis = (v) => setEmphasis(v);
  window.__TEST_HOOKS__.surfaceSetLower = (v) => setLowerPct(v);
  window.__TEST_HOOKS__.surfaceSetUpper = (v) => setUpperPct(v);
  window.__TEST_HOOKS__.floatWithdrawalChart = () => floatChart;
  window.__TEST_HOOKS__.activateFloatWithdrawalTooltip = (index = 5) => {
    if (!floatChart) return null;
    const datasetIndex = floatChart.data.datasets.findIndex((d) => d.label === 'Actual Withdrawal');
    if (datasetIndex < 0) return null;
    const meta = floatChart.getDatasetMeta(datasetIndex);
    const point = meta.data[index];
    if (!point) return null;
    floatChart.setActiveElements([{ datasetIndex, index }]);
    floatChart.tooltip.setActiveElements([{ datasetIndex, index }], { x: point.x, y: point.y });
    floatChart.draw();
    const { tooltip } = floatChart;
    return {
      caretX: tooltip.caretX,
      tooltipCenterX: tooltip.x + tooltip.width / 2,
      pointerX: point.x,
      xAlign: tooltip.xAlign,
      yAlign: tooltip.yAlign,
      opacity: tooltip.opacity,
    };
  };

  if (!window.__sorSurfaceResizeBound) {
    window.addEventListener('resize', () => {
      resizeSurfaceChart();
    });
    window.__sorSurfaceResizeBound = true;
  }
}

/** Resize the surface after its host accordion opens or the window changes. */
export function resizeSurfaceChart() {
  if (!chartInstance) return;
  const dom = document.getElementById('surfaceChart');
  if (!dom) return;
  // setOption alone doesn't move an already-initialized orbit camera;
  // grid3DChangeCamera is the action that actually updates the live view.
  chartInstance.dispatchAction({
    type: 'grid3DChangeCamera',
    distance: computeCameraDistance(dom),
  });
  chartInstance.resize();
}

/** PNG data URL for accordion thumbnails; null if the chart is not ready. */
export function getSurfaceChartDataURL({ pixelRatio = 1, backgroundColor = 'transparent' } = {}) {
  if (!chartInstance) return null;
  try {
    return chartInstance.getDataURL({
      type: 'png',
      pixelRatio,
      backgroundColor,
    });
  } catch {
    return null;
  }
}

onThemeChange(() => {
  applySurfaceTheme();
});
