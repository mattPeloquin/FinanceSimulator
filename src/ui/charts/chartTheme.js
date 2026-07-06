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
  const keys = ['p60', 'p50', 'p40', 'p30', 'p20', 'p10', 'p5'];
  return Object.fromEntries(keys.map((k) => [k, themeHex(`percentile.${k}`, mode)]));
}
