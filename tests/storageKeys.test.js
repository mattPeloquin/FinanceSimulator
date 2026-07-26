import { describe, it, expect } from 'vitest';
import {
  appStorageKey,
  featureStorageKey,
  APP_PREFS_KEY,
  SOR_PLAN_UI_KEY,
  SOR_PLAN_AUTOSAVE_KEY,
  SOR_PLAN_UNSAVED_STASH_KEY,
  FEATURE_SOR_PLAN,
} from '../src/state/storageKeys.js';

describe('storageKeys', () => {
  it('builds fs:app:* and fs:<feature>:* keys', () => {
    expect(appStorageKey('prefs')).toBe('fs:app:prefs');
    expect(featureStorageKey('sor-plan', 'autosave')).toBe('fs:sor-plan:autosave');
    expect(featureStorageKey('sor-lab', 'ui')).toBe('fs:sor-lab:ui');
  });

  it('exports the canonical Phase 1 keys', () => {
    expect(FEATURE_SOR_PLAN).toBe('sor-plan');
    expect(APP_PREFS_KEY).toBe('fs:app:prefs');
    expect(SOR_PLAN_UI_KEY).toBe('fs:sor-plan:ui');
    expect(SOR_PLAN_AUTOSAVE_KEY).toBe('fs:sor-plan:autosave');
    expect(SOR_PLAN_UNSAVED_STASH_KEY).toBe('fs:sor-plan:unsaved-stash');
  });

  it('rejects empty key segments', () => {
    expect(() => appStorageKey('')).toThrow();
    expect(() => featureStorageKey('', 'ui')).toThrow();
    expect(() => featureStorageKey('sor-plan', '')).toThrow();
  });
});
