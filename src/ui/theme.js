const STORAGE_KEY = 'sor:theme';
const THEME_COLORS = { light: '#4f46e5', dark: '#1e293b' };

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
  if (meta) meta.setAttribute('content', THEME_COLORS[mode]);
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

  // Delegated so the toggle keeps working after partial HTML hot reloads in dev.
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
