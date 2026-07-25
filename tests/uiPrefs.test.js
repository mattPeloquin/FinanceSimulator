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
      reportBand: { low: 10, high: 90 },
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

  it('load/save round-trips through sor:ui', () => {
    saveUiPrefs({ theme: 'dark', balanceLogScale: true });
    const raw = JSON.parse(localStorage.getItem(UI_STORAGE_KEY));
    expect(raw.theme).toBe('dark');
    expect(raw.balanceLogScale).toBe(true);
    expect(loadUiPrefs().theme).toBe('dark');
    expect(readUiPrefsSnapshot().balanceLogScale).toBe(true);
  });

  it('migrates legacy keys once into sor:ui', () => {
    localStorage.setItem('sor:theme', 'light');
    localStorage.setItem('sor:report-band', JSON.stringify({ low: 25, high: 75 }));
    localStorage.setItem('sor:report-theme-mode', 'dark');
    localStorage.setItem('sor:ui-accordions', JSON.stringify({ 'section-a': true }));
    localStorage.setItem('sor:ui-balance-log-scale', '1');

    const prefs = loadUiPrefs();
    expect(prefs.theme).toBe('light');
    expect(prefs.reportBand).toEqual({ low: 25, high: 75 });
    expect(prefs.reportThemeMode).toBe('dark');
    expect(prefs.accordions).toEqual({ 'section-a': true });
    expect(prefs.balanceLogScale).toBe(true);

    expect(localStorage.getItem(UI_STORAGE_KEY)).toBeTruthy();
    expect(localStorage.getItem('sor:theme')).toBeNull();
    expect(localStorage.getItem('sor:report-band')).toBeNull();
    expect(localStorage.getItem('sor:ui-accordions')).toBeNull();
  });

  it('optionalUiFromEnvelope omits invalid attach payloads', () => {
    expect(optionalUiFromEnvelope(null)).toBeNull();
    expect(optionalUiFromEnvelope('x')).toBeNull();
    expect(optionalUiFromEnvelope({ theme: 'dark' }).theme).toBe('dark');
  });

  it('accordion helpers write into sor:ui', () => {
    setAccordionOpen('section-investment', true);
    expect(loadAccordionState()['section-investment']).toBe(true);
    const stored = JSON.parse(localStorage.getItem(UI_STORAGE_KEY));
    expect(stored.accordions['section-investment']).toBe(true);
  });

  it('replaceUiPrefs overwrites the whole collection', () => {
    saveUiPrefs({ theme: 'dark', balanceLogScale: true });
    replaceUiPrefs({ ...DEFAULT_UI_PREFS, theme: 'light' });
    expect(loadUiPrefs().theme).toBe('light');
    expect(loadUiPrefs().balanceLogScale).toBe(false);
  });
});
