// localStorage key scheme for the multi-feature shell.
//
//   fs:app:<key>              — genuinely cross-feature prefs (theme, active tab)
//   fs:<feature-id>:<key>     — feature-owned state (autosave, view prefs, …)
//
// Clean break from the old `sor:*` keys — no migration. See
// `.cursor/rules/multi-feature-architecture.mdc`.

/** App-wide prefs namespace: `fs:app:<key>`. */
export function appStorageKey(key) {
  if (!key || typeof key !== 'string') {
    throw new Error('appStorageKey requires a non-empty key string');
  }
  return `fs:app:${key}`;
}

/** Feature namespace: `fs:<feature-id>:<key>`. */
export function featureStorageKey(featureId, key) {
  if (!featureId || typeof featureId !== 'string') {
    throw new Error('featureStorageKey requires a non-empty feature id');
  }
  if (!key || typeof key !== 'string') {
    throw new Error('featureStorageKey requires a non-empty key string');
  }
  return `fs:${featureId}:${key}`;
}

/** Canonical feature ids used by storage helpers below. */
export const FEATURE_WITHDRAW = 'withdraw';
export const FEATURE_ACCUMULATE = 'accumulate';
export const FEATURE_SOR_LAB = 'sor-lab';
export const FEATURE_SS_TIMING = 'ss-timing';
export const FEATURE_ROTH_CONVERT = 'roth-convert';
export const FEATURE_HOUSE_EQUITY = 'house-equity';

export const APP_PREFS_KEY = appStorageKey('prefs');
export const WITHDRAW_UI_KEY = featureStorageKey(FEATURE_WITHDRAW, 'ui');
export const WITHDRAW_AUTOSAVE_KEY = featureStorageKey(FEATURE_WITHDRAW, 'autosave');
export const WITHDRAW_UNSAVED_STASH_KEY = featureStorageKey(FEATURE_WITHDRAW, 'unsaved-stash');
export const SOR_LAB_UI_KEY = featureStorageKey(FEATURE_SOR_LAB, 'ui');
export const ACCUMULATE_UI_KEY = featureStorageKey(FEATURE_ACCUMULATE, 'ui');
export const SS_TIMING_UI_KEY = featureStorageKey(FEATURE_SS_TIMING, 'ui');
export const ROTH_CONVERT_UI_KEY = featureStorageKey(FEATURE_ROTH_CONVERT, 'ui');
export const HOUSE_EQUITY_UI_KEY = featureStorageKey(FEATURE_HOUSE_EQUITY, 'ui');
