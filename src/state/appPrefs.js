// App-wide prefs (theme, active feature tab). Stored under fs:app:prefs.
// Feature-specific chrome (report band, accordions, …) lives in uiPrefs.js.

import { APP_PREFS_KEY } from './storageKeys.js';

export { APP_PREFS_KEY };

export const DEFAULT_APP_PREFS = Object.freeze({
  theme: null, // null → follow system; otherwise 'light' | 'dark'
  activeFeature: 'sor-plan',
});

function structuredCloneDefaults() {
  return {
    theme: DEFAULT_APP_PREFS.theme,
    activeFeature: DEFAULT_APP_PREFS.activeFeature,
  };
}

/**
 * Coerce arbitrary input into a full app-prefs object.
 * Any failure / garbage → defaults (never throws).
 */
export function normalizeAppPrefs(raw) {
  try {
    if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
      return structuredCloneDefaults();
    }
    const theme = raw.theme === 'light' || raw.theme === 'dark' ? raw.theme : null;
    const activeFeature =
      typeof raw.activeFeature === 'string' && raw.activeFeature.trim()
        ? raw.activeFeature.trim()
        : DEFAULT_APP_PREFS.activeFeature;
    return { theme, activeFeature };
  } catch {
    return structuredCloneDefaults();
  }
}

function writeAppPrefs(prefs) {
  try {
    localStorage.setItem(APP_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* quota / private mode — non-fatal */
  }
}

/** Load app prefs; missing/invalid → defaults (no legacy `sor:*` migration). */
export function loadAppPrefs() {
  try {
    const raw = localStorage.getItem(APP_PREFS_KEY);
    if (raw) return normalizeAppPrefs(JSON.parse(raw));
  } catch {
    /* fall through */
  }
  return structuredCloneDefaults();
}

/** Merge a partial update into stored app prefs and persist. */
export function saveAppPrefs(partial = {}) {
  const current = loadAppPrefs();
  const next = normalizeAppPrefs({ ...current, ...partial });
  writeAppPrefs(next);
  return next;
}

/** Replace stored app prefs entirely (after normalize). */
export function replaceAppPrefs(prefs) {
  const next = normalizeAppPrefs(prefs);
  writeAppPrefs(next);
  return next;
}
