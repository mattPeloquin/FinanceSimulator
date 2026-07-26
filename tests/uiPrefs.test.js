// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  UI_STORAGE_KEY,
  DEFAULT_UI_PREFS,
  normalizeUiPrefs,
  loadUiPrefs,
  saveUiPrefs,
  replaceUiPrefs,
  readUiPrefsSnapshot,
  optionalUiFromEnvelope,
  loadAccordionState,
  setAccordionOpen,
} from '../src/state/uiPrefs.js';
import { APP_PREFS_KEY } from '../src/state/storageKeys.js';
import { saveAppPrefs } from '../src/state/appPrefs.js';

describe('uiPrefs', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('normalizeUiPrefs returns defaults for garbage', () => {
    expect(normalizeUiPrefs(null)).toEqual({
      theme: null,
      reportBand: { low: 5, high: 65 },
      reportThemeMode: null,
      accordions: {},
      balanceLogScale: false,
    });
    expect(normalizeUiPrefs('nope').theme).toBeNull();
    expect(normalizeUiPrefs([{ theme: 'dark' }]).theme).toBeNull();
  });

  it('normalizeUiPrefs clamps report band and keeps valid theme', () => {
    const n = normalizeUiPrefs({
      theme: 'dark',
      reportBand: { low: 12, high: 88 },
      reportThemeMode: 'light',
      accordions: { a: true, b: 'no' },
      balanceLogScale: 1,
    });
    expect(n.theme).toBe('dark');
    expect(n.reportThemeMode).toBe('light');
    expect(n.reportBand).toEqual({ low: 10, high: 90 });
    expect(n.accordions).toEqual({ a: true });
    expect(n.balanceLogScale).toBe(true);
  });

  it('load/save round-trips feature chrome through fs:sor-plan:ui', () => {
    saveUiPrefs({ theme: 'dark', balanceLogScale: true, reportThemeMode: 'light' });
    const raw = JSON.parse(localStorage.getItem(UI_STORAGE_KEY));
    expect(UI_STORAGE_KEY).toBe('fs:sor-plan:ui');
    // Theme is app-wide — stripped from the feature key.
    expect(raw.theme).toBeUndefined();
    expect(raw.balanceLogScale).toBe(true);
    expect(raw.reportThemeMode).toBe('light');
    expect(loadUiPrefs().balanceLogScale).toBe(true);
    expect(loadUiPrefs().theme).toBeNull();
  });

  it('readUiPrefsSnapshot merges app theme for envelopes', () => {
    saveUiPrefs({ balanceLogScale: true });
    saveAppPrefs({ theme: 'dark' });
    expect(readUiPrefsSnapshot()).toMatchObject({
      theme: 'dark',
      balanceLogScale: true,
    });
  });

  it('ignores legacy sor:* keys (clean break)', () => {
    localStorage.setItem('sor:ui', JSON.stringify({ balanceLogScale: true, theme: 'dark' }));
    localStorage.setItem('sor:theme', 'light');
    localStorage.setItem('sor:ui-accordions', JSON.stringify({ 'section-a': true }));
    expect(loadUiPrefs()).toEqual({
      theme: null,
      reportBand: { ...DEFAULT_UI_PREFS.reportBand },
      reportThemeMode: null,
      accordions: {},
      balanceLogScale: false,
    });
    expect(localStorage.getItem(APP_PREFS_KEY)).toBeNull();
  });

  it('optionalUiFromEnvelope omits invalid attach payloads', () => {
    expect(optionalUiFromEnvelope(null)).toBeNull();
    expect(optionalUiFromEnvelope('x')).toBeNull();
    expect(optionalUiFromEnvelope({ theme: 'dark' }).theme).toBe('dark');
  });

  it('accordion helpers write into fs:sor-plan:ui', () => {
    setAccordionOpen('section-investment', true);
    expect(loadAccordionState()['section-investment']).toBe(true);
    const stored = JSON.parse(localStorage.getItem(UI_STORAGE_KEY));
    expect(stored.accordions['section-investment']).toBe(true);
  });

  it('replaceUiPrefs overwrites the whole collection', () => {
    saveUiPrefs({ balanceLogScale: true, reportThemeMode: 'dark' });
    replaceUiPrefs({ ...DEFAULT_UI_PREFS });
    expect(loadUiPrefs().balanceLogScale).toBe(false);
    expect(loadUiPrefs().reportThemeMode).toBeNull();
  });
});
