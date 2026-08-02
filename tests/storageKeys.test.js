import { describe, it, expect } from 'vitest';
import {
  appStorageKey,
  featureStorageKey,
  APP_PREFS_KEY,
  WITHDRAW_UI_KEY,
  WITHDRAW_AUTOSAVE_KEY,
  WITHDRAW_UNSAVED_STASH_KEY,
  SOR_LAB_UI_KEY,
  FEATURE_WITHDRAW,
  FEATURE_ACCUMULATION,
  FEATURE_SOR_LAB,
  FEATURE_SS_TIMING,
  FEATURE_ROTH_CONVERT,
  FEATURE_HOUSE_EQUITY,
  ROTH_CONVERT_UI_KEY,
  HOUSE_EQUITY_UI_KEY,
} from '../src/state/storageKeys.js';

describe('storageKeys', () => {
  it('builds fs:app:* and fs:<feature>:* keys', () => {
    expect(appStorageKey('prefs')).toBe('fs:app:prefs');
    expect(featureStorageKey('withdraw', 'autosave')).toBe('fs:withdraw:autosave');
    expect(featureStorageKey('accumulation', 'ui')).toBe('fs:accumulation:ui');
    expect(featureStorageKey('sor-lab', 'ui')).toBe('fs:sor-lab:ui');
  });

  it('exports the canonical feature keys', () => {
    expect(FEATURE_WITHDRAW).toBe('withdraw');
    expect(FEATURE_ACCUMULATION).toBe('accumulation');
    expect(FEATURE_SOR_LAB).toBe('sor-lab');
    expect(FEATURE_SS_TIMING).toBe('ss-timing');
    expect(FEATURE_ROTH_CONVERT).toBe('roth-convert');
    expect(FEATURE_HOUSE_EQUITY).toBe('house-equity');
    expect(APP_PREFS_KEY).toBe('fs:app:prefs');
    expect(WITHDRAW_UI_KEY).toBe('fs:withdraw:ui');
    expect(WITHDRAW_AUTOSAVE_KEY).toBe('fs:withdraw:autosave');
    expect(WITHDRAW_UNSAVED_STASH_KEY).toBe('fs:withdraw:unsaved-stash');
    expect(SOR_LAB_UI_KEY).toBe('fs:sor-lab:ui');
    expect(ROTH_CONVERT_UI_KEY).toBe('fs:roth-convert:ui');
    expect(HOUSE_EQUITY_UI_KEY).toBe('fs:house-equity:ui');
  });

  it('rejects empty key segments', () => {
    expect(() => appStorageKey('')).toThrow();
    expect(() => featureStorageKey('', 'ui')).toThrow();
    expect(() => featureStorageKey('withdraw', '')).toThrow();
  });
});
