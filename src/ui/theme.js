export const themeTokens = {
  meta: { light: '#4f46e5', dark: '#1e293b' },

  chrome: {
    'bg-page': { light: '241 245 249', dark: '0 0 0' },
    'bg-surface': { light: '255 255 255', dark: '0 0 0' },
    'bg-muted': { light: '248 250 252', dark: '15 23 42' },
    'bg-subtle': { light: '238 242 255', dark: '30 27 75' },
    'bg-input': { light: '255 255 255', dark: '51 65 85' },
    'bg-control': { light: '71 85 105', dark: '51 65 85' },
    'bg-control-hover': { light: '51 65 85', dark: '71 85 105' },
    'text-heading': { light: '15 23 42', dark: '241 245 249' },
    'text-body': { light: '51 65 85', dark: '226 232 240' },
    'text-muted': { light: '71 85 105', dark: '148 163 184' },
    'text-faint': { light: '100 116 139', dark: '148 163 184' },
    'border-default': { light: '226 232 240', dark: '51 65 85' },
    'border-input': { light: '203 213 225', dark: '71 85 105' },
    accent: { light: '79 70 229', dark: '129 140 248' },
    'accent-hover': { light: '67 56 202', dark: '99 102 241' },
    'accent-subtle': { light: '238 242 255', dark: '30 27 75' },
    'accent-text': { light: '67 56 202', dark: '165 180 252' },
    'on-accent': { light: '255 255 255', dark: '255 255 255' },
    'ring-accent': { light: '99 102 241', dark: '99 102 241' },
    'ring-offset': { light: '255 255 255', dark: '30 41 59' },
    adorn: { light: '148 163 184', dark: '100 116 139' },
    'spinner-track': { light: '0 0 0', dark: '255 255 255' },
    'spinner-accent': { light: '79 70 229', dark: '129 140 248' },
  },

  status: {
    success: { light: '22 163 74', dark: '34 197 94' },
    danger: { light: '220 38 38', dark: '248 113 113' },
    'danger-bg': { light: '220 38 38', dark: '185 28 28' },
    'danger-hover': { light: '185 28 28', dark: '153 27 27' },
    info: { light: '59 130 246', dark: '96 165 250' },
  },

  percentile: {
    p5: { light: '153 27 27', dark: '239 68 68' },
    p10: { light: '220 38 38', dark: '248 113 113' },
    p20: { light: '249 115 22', dark: '251 146 60' },
    p30: { light: '202 138 4', dark: '250 204 21' },
    p40: { light: '101 163 13', dark: '132 204 22' },
    p50: { light: '22 163 74', dark: '74 222 128' },
    p60: { light: '13 148 136', dark: '45 212 191' },
    p65: { light: '13 148 136', dark: '45 212 191' },
  },

  chartAssets: {
    us_lg_growth: '#4338ca',
    us_lg_value: '#be123c',
    us_sm_mid: '#0f766e',
    ex_us: '#c2410c',
    bond: '#16a34a',
    cash: '#64748b',
  },
};

function rgbTripletToHex(triplet) {
  return (
    '#' +
    triplet
      .split(' ')
      .map((n) => parseInt(n, 10).toString(16).padStart(2, '0'))
      .join('')
  );
}

function hexToRgba(hex, alpha) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function themeCssVars(mode) {
  const vars = {};
  for (const [key, val] of Object.entries(themeTokens.chrome)) {
    vars[`--theme-${key}`] = val[mode];
  }
  for (const [key, val] of Object.entries(themeTokens.status)) {
    vars[`--theme-${key}`] = val[mode];
  }
  for (const [key, val] of Object.entries(themeTokens.percentile)) {
    vars[`--theme-${key}`] = val[mode];
  }
  return vars;
}

/** Resolve a token path (e.g. `chrome.accent`, `percentile.p10`, `meta`) to a hex color. */
export function themeHex(path, mode) {
  const parts = path.split('.');
  let obj = themeTokens;
  for (const p of parts) {
    obj = obj[p];
  }
  if (obj == null) return '#000000';
  if (typeof obj === 'string') return obj;
  if (obj.light != null && (mode === 'light' || mode === 'dark')) {
    const val = obj[mode];
    if (typeof val === 'string' && val.includes(' ')) return rgbTripletToHex(val);
    return val;
  }
  return '#000000';
}

export function themeRgba(path, mode, alpha) {
  return hexToRgba(themeHex(path, mode), alpha);
}

const STORAGE_KEY = 'sor:theme';

const listeners = new Set();
let systemMedia = null;

function getStoredTheme() {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === 'light' || stored === 'dark' ? stored : null;
}

function getSystemDark() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function resolveTheme() {
  const stored = getStoredTheme();
  if (stored) return stored;
  return getSystemDark() ? 'dark' : 'light';
}

export function isDarkMode() {
  return document.documentElement.classList.contains('dark');
}

function updateMetaThemeColor(mode) {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', themeTokens.meta[mode]);
}

function syncToggleUi(mode) {
  const btn = document.getElementById('themeToggle');
  if (!btn) return;
  btn.setAttribute('aria-pressed', mode === 'dark' ? 'true' : 'false');
  btn.setAttribute('aria-label', mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
  btn.dataset.theme = mode;
}

export function setTheme(mode, { persist = true } = {}) {
  const next = mode === 'dark' ? 'dark' : 'light';
  const prev = isDarkMode() ? 'dark' : 'light';
  document.documentElement.classList.toggle('dark', next === 'dark');
  if (persist) localStorage.setItem(STORAGE_KEY, next);
  updateMetaThemeColor(next);
  syncToggleUi(next);
  if (prev !== next) {
    document.dispatchEvent(new CustomEvent('themechange', { detail: { theme: next } }));
    listeners.forEach((fn) => fn(next));
  }
}

export function onThemeChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function handleSystemChange() {
  if (getStoredTheme()) return;
  setTheme(getSystemDark() ? 'dark' : 'light', { persist: false });
}

function handleToggleClick(event) {
  if (!event.target.closest('#themeToggle')) return;
  setTheme(isDarkMode() ? 'light' : 'dark');
}

function wireThemeControls() {
  if (window.__SOR_THEME_WIRED__) return;
  window.__SOR_THEME_WIRED__ = true;

  document.addEventListener('click', handleToggleClick);

  systemMedia = window.matchMedia('(prefers-color-scheme: dark)');
  if (systemMedia.addEventListener) {
    systemMedia.addEventListener('change', handleSystemChange);
  } else if (systemMedia.addListener) {
    systemMedia.addListener(handleSystemChange);
  }
}

export function initTheme() {
  wireThemeControls();
  setTheme(resolveTheme(), { persist: false });
}

if (typeof document !== 'undefined' && import.meta.env.MODE !== 'test') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initTheme);
  } else {
    initTheme();
  }
}
