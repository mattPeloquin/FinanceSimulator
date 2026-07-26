// Browser UI chrome prefs (not scenario inputs).
// Stored as one localStorage object so DevTools / share / sessions can treat
// view settings as a single collection.

export const UI_STORAGE_KEY = 'sor:ui';

const LEGACY_KEYS = {
  theme: 'sor:theme',
  reportBand: 'sor:report-band',
  reportThemeMode: 'sor:report-theme-mode',
  accordions: 'sor:ui-accordions',
  balanceLogScale: 'sor:ui-balance-log-scale',
};

export const DEFAULT_UI_PREFS = Object.freeze({
  theme: null,
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

function readLegacyBundle() {
  const bundle = {};
  let found = false;

  try {
    const theme = localStorage.getItem(LEGACY_KEYS.theme);
    if (theme === 'light' || theme === 'dark') {
      bundle.theme = theme;
      found = true;
    }
  } catch { /* ignore */ }

  try {
    const raw = localStorage.getItem(LEGACY_KEYS.reportBand);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        bundle.reportBand = parsed;
        found = true;
      }
    }
  } catch { /* ignore */ }

  try {
    const mode = localStorage.getItem(LEGACY_KEYS.reportThemeMode);
    if (mode === 'light' || mode === 'dark') {
      bundle.reportThemeMode = mode;
      found = true;
    }
  } catch { /* ignore */ }

  try {
    const raw = localStorage.getItem(LEGACY_KEYS.accordions);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        bundle.accordions = parsed;
        found = true;
      }
    }
  } catch { /* ignore */ }

  try {
    const raw = localStorage.getItem(LEGACY_KEYS.balanceLogScale);
    if (raw === '1' || raw === '0') {
      bundle.balanceLogScale = raw === '1';
      found = true;
    }
  } catch { /* ignore */ }

  return found ? bundle : null;
}

function clearLegacyKeys() {
  for (const key of Object.values(LEGACY_KEYS)) {
    try {
      localStorage.removeItem(key);
    } catch { /* ignore */ }
  }
}

function writeUiPrefs(prefs) {
  try {
    localStorage.setItem(UI_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    /* quota / private mode — non-fatal */
  }
}

/** Load prefs; migrate legacy keys once if `sor:ui` is absent. */
export function loadUiPrefs() {
  try {
    const raw = localStorage.getItem(UI_STORAGE_KEY);
    if (raw) {
      return normalizeUiPrefs(JSON.parse(raw));
    }
    const legacy = readLegacyBundle();
    if (legacy) {
      const migrated = normalizeUiPrefs(legacy);
      writeUiPrefs(migrated);
      clearLegacyKeys();
      return migrated;
    }
  } catch {
    /* fall through */
  }
  return structuredCloneDefaults();
}

/** Merge a partial update into stored prefs and persist. */
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

/** Replace stored prefs entirely (after normalize). */
export function replaceUiPrefs(prefs) {
  const next = normalizeUiPrefs(prefs);
  writeUiPrefs(next);
  return next;
}

/** Snapshot of current view settings for attach to session/export/share. */
export function readUiPrefsSnapshot() {
  return loadUiPrefs();
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
