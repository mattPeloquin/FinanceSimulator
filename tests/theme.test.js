// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { initTheme, setTheme, isDarkMode } from '../src/ui/theme.js';

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
});
