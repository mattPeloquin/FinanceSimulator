import { describe, it, expect } from 'vitest';
import {
  migrateScenario,
  migrateLabState,
  migrateAccumulationState,
  migrateSsTimingState,
  migrateFeatureState,
  getFeatureStateVersion,
  LAB_STATE_VERSION,
  LAB_STATE_VERSION_MIN,
  ACCUMULATION_STATE_VERSION,
  SS_TIMING_STATE_VERSION,
} from '../src/state/migrations.js';
import { SCHEMA_VERSION, SCHEMA_VERSION_MIN } from '../src/state/scenario.js';
import {
  FEATURE_SOR_PLAN,
  FEATURE_SOR_LAB,
  FEATURE_ACCUMULATION,
  FEATURE_SS_TIMING,
} from '../src/state/storageKeys.js';

describe('migrateFeatureState registry', () => {
  it('exposes Plan, Lab, Accumulation, and SS Timing current versions', () => {
    expect(getFeatureStateVersion(FEATURE_SOR_PLAN)).toBe(SCHEMA_VERSION);
    expect(getFeatureStateVersion(FEATURE_SOR_LAB)).toBe(LAB_STATE_VERSION);
    expect(getFeatureStateVersion(FEATURE_ACCUMULATION)).toBe(ACCUMULATION_STATE_VERSION);
    expect(getFeatureStateVersion(FEATURE_SS_TIMING)).toBe(SS_TIMING_STATE_VERSION);
  });

  it('delegates Plan migration to migrateScenario', () => {
    const state = { startBalance: 100 };
    const out = migrateFeatureState(FEATURE_SOR_PLAN, state, SCHEMA_VERSION);
    expect(out).toEqual(state);
    expect(out).not.toBe(state);
  });

  it('delegates Lab migration to migrateLabState', () => {
    const state = { version: 1, sweepPoints: 7 };
    const out = migrateFeatureState(FEATURE_SOR_LAB, state, LAB_STATE_VERSION);
    expect(out).toEqual(state);
    expect(out).not.toBe(state);
  });

  it('delegates Accumulation migration to migrateAccumulationState', () => {
    const state = { numYears: 15 };
    const out = migrateFeatureState(FEATURE_ACCUMULATION, state, ACCUMULATION_STATE_VERSION);
    expect(out).toEqual(state);
    expect(migrateAccumulationState(state, ACCUMULATION_STATE_VERSION)).toEqual(state);
  });

  it('delegates SS Timing migration to migrateSsTimingState', () => {
    const state = { couple: true };
    const out = migrateFeatureState(FEATURE_SS_TIMING, state, SS_TIMING_STATE_VERSION);
    expect(out).toEqual(state);
    expect(migrateSsTimingState(state, SS_TIMING_STATE_VERSION)).toEqual(state);
  });

  it('rejects unknown features and missing versions', () => {
    expect(() => getFeatureStateVersion('nope')).toThrow(/no state migrator/i);
    expect(() => migrateFeatureState('nope', {}, 1)).toThrow(/no state migrator/i);
    expect(() => migrateFeatureState(FEATURE_SOR_PLAN, { startBalance: 1 }, undefined))
      .toThrow(/missing or invalid/i);
  });
});

describe('migrateLabState', () => {
  it('returns a shallow copy for the current version', () => {
    const state = { version: LAB_STATE_VERSION, scenarioRef: null };
    const out = migrateLabState(state, LAB_STATE_VERSION);
    expect(out).toEqual(state);
    expect(out).not.toBe(state);
  });

  it('rejects older / newer / invalid versions', () => {
    expect(() => migrateLabState({}, LAB_STATE_VERSION_MIN - 1)).toThrow(/older than this app supports/i);
    expect(() => migrateLabState({}, LAB_STATE_VERSION + 1)).toThrow(/newer than this app supports/i);
    expect(() => migrateLabState({}, '1')).toThrow(/missing or invalid/i);
    expect(() => migrateLabState(null, LAB_STATE_VERSION)).toThrow(/missing or invalid/i);
  });
});

describe('migrateScenario (via migrations module)', () => {
  it('still enforces Plan schema floors', () => {
    expect(() => migrateScenario({ startBalance: 1 }, SCHEMA_VERSION_MIN - 1))
      .toThrow(/older than this app supports/i);
    expect(migrateScenario({ startBalance: 1 }, SCHEMA_VERSION).startBalance).toBe(1);
  });
});
