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
export const FEATURE_SOR_PLAN = 'sor-plan';
export const FEATURE_SOR_LAB = 'sor-lab';

export const APP_PREFS_KEY = appStorageKey('prefs');
export const SOR_PLAN_UI_KEY = featureStorageKey(FEATURE_SOR_PLAN, 'ui');
export const SOR_PLAN_AUTOSAVE_KEY = featureStorageKey(FEATURE_SOR_PLAN, 'autosave');
export const SOR_PLAN_UNSAVED_STASH_KEY = featureStorageKey(FEATURE_SOR_PLAN, 'unsaved-stash');
