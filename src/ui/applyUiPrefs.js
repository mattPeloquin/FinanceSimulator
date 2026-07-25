// Apply a normalized UI prefs snapshot to the live DOM + storage.
// Kept separate from state/uiPrefs.js so theme/report modules can import
// storage without a circular dependency through apply.

import { replaceUiPrefs, normalizeUiPrefs } from '../state/uiPrefs.js';
import { setTheme } from './theme.js';
import { applyReportViewPrefs } from './report.js';
import { applyBalanceLogScalePref } from './charts/timeline.js';

/** Persist prefs and push them into the current page controls. */
export function applyUiPrefs(raw) {
  const prefs = replaceUiPrefs(normalizeUiPrefs(raw));

  // Theme: persist already written; setTheme(..., persist:false) only paints.
  if (prefs.theme === 'light' || prefs.theme === 'dark') {
    setTheme(prefs.theme, { persist: false });
  } else {
    // Follow system — clear explicit theme by re-resolving without a stored override.
    // replaceUiPrefs already stored theme:null; resolve via system.
    const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    setTheme(dark ? 'dark' : 'light', { persist: false });
  }

  applyReportViewPrefs({
    reportBand: prefs.reportBand,
    reportThemeMode: prefs.reportThemeMode,
  });

  applyBalanceLogScalePref(prefs.balanceLogScale);

  for (const [id, open] of Object.entries(prefs.accordions)) {
    const el = document.getElementById(id);
    if (el && el.tagName === 'DETAILS') el.open = !!open;
  }

  return prefs;
}
