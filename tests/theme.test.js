// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { initTheme, setTheme, isDarkMode, themeCssVars, themeHex, themeRgba, themeTokens } from '../src/ui/theme.js';

describe('theme', () => {
  beforeEach(() => {
    delete window.__SOR_THEME_WIRED__;
    window.matchMedia = vi.fn().mockImplementation(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    }));
    document.documentElement.classList.remove('dark');
    localStorage.clear();
    document.body.innerHTML =
      '<button id="themeToggle" type="button" aria-pressed="false" aria-label="Switch to dark mode"></button>' +
      '<meta name="theme-color" content="#4f46e5">';
  });

  afterEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove('dark');
  });

  it('setTheme toggles html class and persists preference', () => {
    setTheme('dark');
    expect(isDarkMode()).toBe(true);
    expect(localStorage.getItem('sor:theme')).toBe('dark');
    expect(document.querySelector('meta[name="theme-color"]').getAttribute('content')).toBe('#1e293b');

    setTheme('light');
    expect(isDarkMode()).toBe(false);
    expect(localStorage.getItem('sor:theme')).toBe('light');
    expect(document.querySelector('meta[name="theme-color"]').getAttribute('content')).toBe('#4f46e5');
  });

  it('initTheme wires the toggle button', () => {
    localStorage.setItem('sor:theme', 'light');
    initTheme();
    const btn = document.getElementById('themeToggle');
    expect(btn.getAttribute('aria-pressed')).toBe('false');

    btn.click();
    expect(isDarkMode()).toBe(true);
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    expect(localStorage.getItem('sor:theme')).toBe('dark');
  });

  it('themeCssVars emits chrome, status, and percentile CSS variables', () => {
    const light = themeCssVars('light');
    expect(light['--theme-bg-page']).toBe('241 245 249');
    expect(light['--theme-accent']).toBe('79 70 229');
    expect(light['--theme-success']).toBe('22 163 74');
    expect(light['--theme-p10']).toBe('220 38 38');

    const dark = themeCssVars('dark');
    expect(dark['--theme-bg-page']).toBe('15 23 42');
    expect(dark['--theme-p50']).toBe('74 222 128');
  });

  it('themeHex resolves token paths to hex colors', () => {
    expect(themeHex('meta', 'light')).toBe('#4f46e5');
    expect(themeHex('meta', 'dark')).toBe('#1e293b');
    expect(themeHex('chrome.accent', 'light')).toBe('#4f46e5');
    expect(themeHex('percentile.p10', 'dark')).toBe('#f87171');
    expect(themeHex('chartAssets.bond', 'light')).toBe('#16a34a');
  });

  it('themeRgba resolves token paths to rgba strings', () => {
    expect(themeRgba('chrome.accent', 'light', 0.5)).toBe('rgba(79, 70, 229, 0.5)');
    expect(themeRgba('status.danger', 'dark', 0.5)).toBe('rgba(248, 113, 113, 0.5)');
  });

  it('themeTokens meta colors match updateMetaThemeColor', () => {
    expect(themeTokens.meta.light).toBe('#4f46e5');
    expect(themeTokens.meta.dark).toBe('#1e293b');
  });
});
