// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  APP_PREFS_KEY,
  DEFAULT_APP_PREFS,
  normalizeAppPrefs,
  loadAppPrefs,
  saveAppPrefs,
  replaceAppPrefs,
} from '../src/state/appPrefs.js';

describe('appPrefs', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('normalizeAppPrefs returns defaults for garbage', () => {
    expect(normalizeAppPrefs(null)).toEqual({
      theme: null,
      activeFeature: 'sor-plan',
    });
    expect(normalizeAppPrefs('nope').theme).toBeNull();
  });

  it('load/save round-trips through fs:app:prefs', () => {
    saveAppPrefs({ theme: 'dark', activeFeature: 'sor-lab' });
    const raw = JSON.parse(localStorage.getItem(APP_PREFS_KEY));
    expect(raw).toEqual({ theme: 'dark', activeFeature: 'sor-lab' });
    expect(loadAppPrefs().theme).toBe('dark');
    expect(loadAppPrefs().activeFeature).toBe('sor-lab');
  });

  it('ignores legacy sor:* keys (clean break)', () => {
    localStorage.setItem('sor:ui', JSON.stringify({ theme: 'dark' }));
    localStorage.setItem('sor:theme', 'light');
    expect(loadAppPrefs()).toEqual({ ...DEFAULT_APP_PREFS });
  });

  it('replaceAppPrefs overwrites the whole collection', () => {
    saveAppPrefs({ theme: 'dark', activeFeature: 'sor-lab' });
    replaceAppPrefs({ theme: 'light', activeFeature: 'sor-plan' });
    expect(loadAppPrefs()).toEqual({ theme: 'light', activeFeature: 'sor-plan' });
  });
});
