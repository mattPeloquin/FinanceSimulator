import { isDarkMode, themeHex, themeRgba } from '../theme.js';

function buildChartTheme(mode) {
  const hex = (path) => themeHex(path, mode);
  const rgba = (path, alpha) => themeRgba(path, mode, alpha);

  return {
    canvasBg: 'transparent',
    gridLine: rgba('chrome.text-faint', mode === 'dark' ? 0.12 : 0.2),
    zeroLine: mode === 'dark' ? rgba('chrome.text-faint', 0.55) : hex('chrome.border-input'),
    axisTitle: hex('chrome.text-muted'),
    axisTick: hex('chrome.text-muted'),
    legend: hex('chrome.text-body'),
    tooltipBg: mode === 'dark' ? rgba('chrome.bg-input', 0.95) : rgba('chrome.bg-surface', 0.95),
    tooltipTitle: hex('chrome.text-heading'),
    tooltipBody: hex('chrome.text-body'),
    sceneBg: hex('chrome.bg-page'),
    axisName: hex('chrome.text-body'),
    axisLabel: hex('chrome.text-muted'),
    axisLine: hex('chrome.border-input'),
    floatPanelBg: mode === 'dark' ? rgba('chrome.bg-surface', 0.94) : rgba('chrome.bg-surface', 0.94),
    floatPanelBorder: hex('chrome.border-input'),
    floatTitleText: hex('chrome.text-body'),
    floatMutedText: hex('chrome.text-muted'),
    planLine: hex('chrome.adorn'),
    planFill: rgba('chrome.adorn', mode === 'dark' ? 0.25 : 0.2),
    accent: hex('chrome.accent'),
    accentFill: rgba('chrome.accent', 0.6),
    accentStroke: rgba('chrome.accent', 1),
    accentFillSoft: rgba('chrome.accent', 0.12),
    accentFillSofter: rgba('chrome.accent', 0.1),
    // Dashed reference line for the minimum-withdrawal guide overlaid on the
    // Base + Spending schedule preview.
    floorLine: hex('status.danger'),
    // Thin dotted line for the gift ceiling above the planned withdrawal.
    // Softer than status.success so it reads as a guide, not a bright highlight.
    giftLine: mode === 'dark' ? '#5d9a6a' : hex('percentile.p40'),
    // Marker dots for major cash events on the base schedule preview.
    eventMarker: mode === 'dark' ? '#d4a853' : '#b8860b',
  };
}

const LIGHT = buildChartTheme('light');
const DARK = buildChartTheme('dark');

export function getChartTheme(isDark = isDarkMode()) {
  return isDark ? DARK : LIGHT;
}

export function chartJsTooltip(theme) {
  return {
    backgroundColor: theme.tooltipBg,
    titleColor: theme.tooltipTitle,
    bodyColor: theme.tooltipBody,
  };
}

// Black translucent tooltip used by 3D sample-run charts (Chart.js default
// look) and by the heatmap / IRR scatter HTML tips so every simulation
// drill-down tooltip reads the same.
export const SAMPLE_RUN_TOOLTIP_STYLE = {
  backgroundColor: 'rgba(0, 0, 0, 0.8)',
  titleColor: '#ffffff',
  bodyColor: '#ffffff',
  mutedColor: 'rgba(255, 255, 255, 0.72)',
  borderColor: 'transparent',
};

/** Apply SAMPLE_RUN_TOOLTIP_STYLE to a positioned HTML tooltip element. */
export function applySampleRunDomTooltipStyle(el) {
  if (!el) return;
  el.style.background = SAMPLE_RUN_TOOLTIP_STYLE.backgroundColor;
  el.style.color = SAMPLE_RUN_TOOLTIP_STYLE.bodyColor;
  el.style.borderColor = SAMPLE_RUN_TOOLTIP_STYLE.borderColor;
  el.style.boxShadow = 'none';
}

/** Pick left vs right tooltip placement from the active point's x position. */
export function sampleRunTooltipXAlign(caretX, chartArea) {
  if (caretX == null || !chartArea) return 'right';
  const midX = (chartArea.left + chartArea.right) / 2;
  return caretX >= midX ? 'left' : 'right';
}

// Sample-run withdrawal charts (3D float, large dialog, IRR drill-down) share
// the compact black-translucent tooltip look. yAlign 'center' with a forced
// side xAlign keeps the tooltip beside the hovered point instead of above it.
export function sampleRunTooltipOptions(callbacks, { large = false } = {}) {
  return {
    displayColors: false,
    backgroundColor: SAMPLE_RUN_TOOLTIP_STYLE.backgroundColor,
    titleColor: SAMPLE_RUN_TOOLTIP_STYLE.titleColor,
    bodyColor: SAMPLE_RUN_TOOLTIP_STYLE.bodyColor,
    footerColor: SAMPLE_RUN_TOOLTIP_STYLE.mutedColor,
    borderColor: SAMPLE_RUN_TOOLTIP_STYLE.borderColor,
    borderWidth: 0,
    // Zoom (large) and compact float tips share one size step above the old 10px.
    titleFont: { size: 11 },
    bodyFont: { size: 11 },
    footerFont: { size: 11 },
    padding: large ? 6 : 4,
    yAlign: 'center',
    xAlign: (ctx) => sampleRunTooltipXAlign(ctx.tooltip.caretX, ctx.chart.chartArea),
    caretPadding: large ? 8 : 6,
    callbacks,
  };
}

export function chartJsCartesianScales(theme, yExtra = {}, xExtra = {}) {
  const base = {
    ticks: { color: theme.axisTick },
    title: { color: theme.axisTitle },
    grid: { color: theme.gridLine },
  };
  return {
    x: { ...base, ...xExtra, ticks: { ...base.ticks, ...xExtra.ticks }, title: { ...base.title, ...xExtra.title }, grid: { ...base.grid, ...xExtra.grid } },
    y: { ...base, ...yExtra, ticks: { ...base.ticks, ...yExtra.ticks }, title: { ...base.title, ...yExtra.title }, grid: { ...base.grid, ...yExtra.grid } },
  };
}

export function percentileColors(isDark = isDarkMode()) {
  const mode = isDark ? 'dark' : 'light';
  const keys = ['p85', 'p65', 'p50', 'p40', 'p30', 'p20', 'p10', 'p5'];
  return Object.fromEntries(keys.map((k) => [k, themeHex(`percentile.${k}`, mode)]));
}
