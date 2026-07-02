import { isDarkMode } from '../theme.js';

const LIGHT = {
  canvasBg: 'transparent',
  gridLine: 'rgba(148,163,184,0.2)',
  zeroLine: 'rgba(203, 213, 225, 1)',
  axisTitle: '#64748b',
  axisTick: '#64748b',
  legend: '#475569',
  tooltipBg: 'rgba(255, 255, 255, 0.95)',
  tooltipTitle: '#0f172a',
  tooltipBody: '#475569',
  sceneBg: '#f1f5f9',
  axisName: '#475569',
  axisLabel: '#64748b',
  axisLine: '#cbd5e1',
  floatPanelBg: 'rgba(255,255,255,0.94)',
  floatPanelBorder: '#e2e8f0',
  floatTitleText: '#334155',
  floatMutedText: '#64748b',
  planLine: '#94a3b8',
  planFill: 'rgba(148, 163, 184, 0.2)',
};

const DARK = {
  canvasBg: 'transparent',
  gridLine: 'rgba(148,163,184,0.12)',
  zeroLine: 'rgba(100, 116, 139, 0.55)',
  axisTitle: '#94a3b8',
  axisTick: '#94a3b8',
  legend: '#cbd5e1',
  tooltipBg: 'rgba(51, 65, 85, 0.95)',
  tooltipTitle: '#f1f5f9',
  tooltipBody: '#e2e8f0',
  sceneBg: '#0f172a',
  axisName: '#94a3b8',
  axisLabel: '#94a3b8',
  axisLine: '#475569',
  floatPanelBg: 'rgba(30, 41, 59, 0.94)',
  floatPanelBorder: '#475569',
  floatTitleText: '#e2e8f0',
  floatMutedText: '#94a3b8',
  planLine: '#64748b',
  planFill: 'rgba(100, 116, 139, 0.25)',
};

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
