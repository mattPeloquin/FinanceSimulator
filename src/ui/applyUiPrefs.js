// Apply a normalized UI prefs snapshot to the live DOM + storage.
// Kept separate from state/uiPrefs.js so theme/report modules can import
// storage without a circular dependency through apply.
//
// Theme is app-wide (fs:app:prefs); report/accordion/chart prefs are
// feature chrome (fs:withdraw:ui).

import { replaceUiPrefs, normalizeUiPrefs } from '../state/uiPrefs.js';
import { saveAppPrefs } from '../state/appPrefs.js';
import { setTheme } from './theme.js';
import { applyReportViewPrefs } from '../features/withdraw/ui/report.js';
import { applyBalanceLogScalePref } from '../features/withdraw/ui/charts/timeline.js';

/** Persist prefs and push them into the current page controls. */
export function applyUiPrefs(raw) {
  const prefs = normalizeUiPrefs(raw);
  replaceUiPrefs(prefs);

  // Theme belongs in app prefs; envelopes may still carry it for share UX.
  if (prefs.theme === 'light' || prefs.theme === 'dark') {
    saveAppPrefs({ theme: prefs.theme });
    setTheme(prefs.theme, { persist: false });
  } else {
    saveAppPrefs({ theme: null });
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
