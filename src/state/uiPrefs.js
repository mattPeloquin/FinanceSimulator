// Feature chrome prefs for Withdraw (report band, accordions, chart view).
// Stored under fs:withdraw:ui. App-wide theme / active tab live in appPrefs.js.
//
// Snapshots attached to sessions/export/share still include `theme` so a shared
// link can paint the same look; applyUiPrefs routes theme into app prefs.

import { loadAppPrefs } from './appPrefs.js';
import { WITHDRAW_UI_KEY } from './storageKeys.js';

export const UI_STORAGE_KEY = WITHDRAW_UI_KEY;

export const DEFAULT_UI_PREFS = Object.freeze({
  theme: null, // carried in snapshots / envelopes only; not stored here
  reportBand: Object.freeze({ low: 5, high: 65 }),
  reportThemeMode: null,
  accordions: Object.freeze({}),
  balanceLogScale: false,
});

function clampBand(low, high) {
  return {
    low: Math.min(45, Math.max(0, Math.round(low / 5) * 5)),
    high: Math.min(100, Math.max(55, Math.round(high / 5) * 5)),
  };
}

function normalizeAccordions(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  for (const [id, open] of Object.entries(raw)) {
    if (typeof open === 'boolean') out[id] = open;
  }
  return out;
}

/**
 * Coerce arbitrary input into a full prefs object.
 * Any failure / garbage → defaults (never throws).
 * `theme` is accepted for envelope compatibility but not persisted in this key.
 */
export function normalizeUiPrefs(raw) {
  try {
    if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
      return structuredCloneDefaults();
    }
    const theme = raw.theme === 'light' || raw.theme === 'dark' ? raw.theme : null;
    const reportThemeMode =
      raw.reportThemeMode === 'light' || raw.reportThemeMode === 'dark'
        ? raw.reportThemeMode
        : null;

    let reportBand = { ...DEFAULT_UI_PREFS.reportBand };
    if (raw.reportBand && typeof raw.reportBand === 'object') {
      const low = Number(raw.reportBand.low);
      const high = Number(raw.reportBand.high);
      if (Number.isFinite(low) && Number.isFinite(high)) {
        reportBand = clampBand(low, high);
      }
    }

    return {
      theme,
      reportBand,
      reportThemeMode,
      accordions: normalizeAccordions(raw.accordions),
      balanceLogScale: !!raw.balanceLogScale,
    };
  } catch {
    return structuredCloneDefaults();
  }
}

function structuredCloneDefaults() {
  return {
    theme: DEFAULT_UI_PREFS.theme,
    reportBand: { ...DEFAULT_UI_PREFS.reportBand },
    reportThemeMode: DEFAULT_UI_PREFS.reportThemeMode,
    accordions: { ...DEFAULT_UI_PREFS.accordions },
    balanceLogScale: DEFAULT_UI_PREFS.balanceLogScale,
  };
}

/** Persist feature chrome only — theme is stripped (lives in fs:app:prefs). */
function writeUiPrefs(prefs) {
  try {
    const featureChrome = {
      reportBand: prefs.reportBand,
      reportThemeMode: prefs.reportThemeMode,
      accordions: prefs.accordions,
      balanceLogScale: prefs.balanceLogScale,
    };
    localStorage.setItem(UI_STORAGE_KEY, JSON.stringify(featureChrome));
  } catch {
    /* quota / private mode — non-fatal */
  }
}

/** Load feature chrome prefs; missing/invalid → defaults (no `sor:*` migration). */
export function loadUiPrefs() {
  try {
    const raw = localStorage.getItem(UI_STORAGE_KEY);
    if (raw) {
      // Theme is not stored here; leave null so callers that need it use
      // readUiPrefsSnapshot() (merges app theme) or loadAppPrefs().
      return normalizeUiPrefs(JSON.parse(raw));
    }
  } catch {
    /* fall through */
  }
  return structuredCloneDefaults();
}

/** Merge a partial update into stored feature chrome prefs and persist. */
export function saveUiPrefs(partial = {}) {
  const current = loadUiPrefs();
  const next = normalizeUiPrefs({ ...current, ...partial });
  if (partial && Object.prototype.hasOwnProperty.call(partial, 'reportBand')) {
    next.reportBand = normalizeUiPrefs({ reportBand: partial.reportBand }).reportBand;
  }
  if (partial && Object.prototype.hasOwnProperty.call(partial, 'accordions')) {
    next.accordions = normalizeAccordions(partial.accordions);
  }
  writeUiPrefs(next);
  return next;
}

/** Replace stored feature chrome prefs entirely (after normalize). */
export function replaceUiPrefs(prefs) {
  const next = normalizeUiPrefs(prefs);
  writeUiPrefs(next);
  return next;
}

/**
 * Snapshot of view settings for attach to session/export/share.
 * Merges app theme so shared links still carry the look.
 */
export function readUiPrefsSnapshot() {
  const feature = loadUiPrefs();
  const app = loadAppPrefs();
  return {
    ...feature,
    theme: app.theme,
  };
}

/**
 * If `raw` normalizes to usable prefs, return them; otherwise null.
 * Used for optional envelope.ui — invalid attach must not fail the import.
 */
export function optionalUiFromEnvelope(raw) {
  if (raw == null) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) return null;
  try {
    return normalizeUiPrefs(raw);
  } catch {
    return null;
  }
}

// ---- Accordion helpers (formerly in persistence.js) -----------------------

/** @returns {Record<string, boolean>} id → open */
export function loadAccordionState() {
  return { ...loadUiPrefs().accordions };
}

/** @param {Record<string, boolean>} state */
export function saveAccordionState(state) {
  saveUiPrefs({ accordions: normalizeAccordions(state) });
}

/** Merge one accordion's open flag into the persisted map. */
export function setAccordionOpen(id, open) {
  if (!id) return;
  const accordions = loadAccordionState();
  accordions[id] = !!open;
  saveUiPrefs({ accordions });
}
