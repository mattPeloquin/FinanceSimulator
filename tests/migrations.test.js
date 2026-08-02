import { describe, it, expect } from 'vitest';
import {
  migrateScenario,
  migrateLabState,
  migrateAccumulateState,
  migrateSsTimingState,
  migrateRothConvertState,
  migrateHouseEquityState,
  migratePlanState,
  migrateFeatureState,
  getFeatureStateVersion,
  LAB_STATE_VERSION,
  LAB_STATE_VERSION_MIN,
  ACCUMULATE_STATE_VERSION,
  SS_TIMING_STATE_VERSION,
  ROTH_CONVERT_STATE_VERSION,
  HOUSE_EQUITY_STATE_VERSION,
  PLAN_STATE_VERSION,
} from '../src/state/migrations.js';
import { SCHEMA_VERSION, SCHEMA_VERSION_MIN } from '../src/state/scenario.js';
import {
  FEATURE_WITHDRAW,
  FEATURE_SOR_LAB,
  FEATURE_ACCUMULATE,
  FEATURE_SS_TIMING,
  FEATURE_ROTH_CONVERT,
  FEATURE_HOUSE_EQUITY,
  FEATURE_PLAN,
} from '../src/state/storageKeys.js';

describe('migrateFeatureState registry', () => {
  it('exposes Withdraw, Lab, Accumulate, SS Timing, Roth Convert, House Equity, and Lifetime Plan current versions', () => {
    expect(getFeatureStateVersion(FEATURE_WITHDRAW)).toBe(SCHEMA_VERSION);
    expect(getFeatureStateVersion(FEATURE_SOR_LAB)).toBe(LAB_STATE_VERSION);
    expect(getFeatureStateVersion(FEATURE_ACCUMULATE)).toBe(ACCUMULATE_STATE_VERSION);
    expect(getFeatureStateVersion(FEATURE_SS_TIMING)).toBe(SS_TIMING_STATE_VERSION);
    expect(getFeatureStateVersion(FEATURE_ROTH_CONVERT)).toBe(ROTH_CONVERT_STATE_VERSION);
    expect(getFeatureStateVersion(FEATURE_HOUSE_EQUITY)).toBe(HOUSE_EQUITY_STATE_VERSION);
    expect(getFeatureStateVersion(FEATURE_PLAN)).toBe(PLAN_STATE_VERSION);
  });

  it('delegates Plan migration to migrateScenario', () => {
    const state = { startBalance: 100 };
    const out = migrateFeatureState(FEATURE_WITHDRAW, state, SCHEMA_VERSION);
    expect(out).toEqual(state);
    expect(out).not.toBe(state);
  });

  it('delegates Lab migration to migrateLabState', () => {
    const state = { version: 1, sweepPoints: 7 };
    const out = migrateFeatureState(FEATURE_SOR_LAB, state, LAB_STATE_VERSION);
    expect(out).toEqual(state);
    expect(out).not.toBe(state);
  });

  it('delegates Accumulate migration to migrateAccumulateState', () => {
    const state = { numYears: 15 };
    const out = migrateFeatureState(FEATURE_ACCUMULATE, state, ACCUMULATE_STATE_VERSION);
    expect(out).toEqual(state);
    expect(migrateAccumulateState(state, ACCUMULATE_STATE_VERSION)).toEqual(state);
  });

  it('delegates SS Timing migration to migrateSsTimingState', () => {
    const state = { couple: true };
    const out = migrateFeatureState(FEATURE_SS_TIMING, state, SS_TIMING_STATE_VERSION);
    expect(out).toEqual(state);
    expect(migrateSsTimingState(state, SS_TIMING_STATE_VERSION)).toEqual(state);
  });

  it('delegates Roth Convert migration to migrateRothConvertState', () => {
    const state = { tradBalance: 1 };
    const out = migrateFeatureState(FEATURE_ROTH_CONVERT, state, ROTH_CONVERT_STATE_VERSION);
    expect(out).toEqual(state);
    expect(migrateRothConvertState(state, ROTH_CONVERT_STATE_VERSION)).toEqual(state);
  });

  it('delegates House Equity migration to migrateHouseEquityState', () => {
    const state = { homeValue: 800 };
    const out = migrateFeatureState(FEATURE_HOUSE_EQUITY, state, HOUSE_EQUITY_STATE_VERSION);
    expect(out).toEqual(state);
    expect(migrateHouseEquityState(state, HOUSE_EQUITY_STATE_VERSION)).toEqual(state);
  });

  it('delegates Lifetime Plan migration to migratePlanState', () => {
    const state = { planStartYear: 2026, view: 'netWorth', sources: [] };
    const out = migrateFeatureState(FEATURE_PLAN, state, PLAN_STATE_VERSION);
    expect(out).toEqual(state);
    expect(migratePlanState(state, PLAN_STATE_VERSION)).toEqual(state);
  });

  it('migrates Lifetime Plan v1 → v2 with view and handoff defaults', () => {
    const state = {
      planStartYear: 2026,
      sources: [{ id: 's1', feature: 'accumulate', sessionName: 'A' }],
    };
    const out = migratePlanState(state, 1);
    expect(out.view).toBe('netWorth');
    expect(out.sources[0].startsAfter).toBe('');
    expect(out.sources[0].gapYears).toBe(0);
    expect(out.sources[0].handoffPercentile).toBe('p50');
  });

  it('migrates Lifetime Plan v2 → v3 by dropping Roth Convert sources', () => {
    const state = {
      planStartYear: 2026,
      view: 'netWorth',
      sources: [
        { id: 'a1', feature: 'accumulate', sessionName: 'A' },
        { id: 'r1', feature: 'roth-convert', sessionName: 'R' },
        { id: 's1', feature: 'ss-timing', sessionName: 'S' },
      ],
    };
    const out = migratePlanState(state, 2);
    expect(out.sources.map((s) => s.feature)).toEqual(['accumulate', 'ss-timing']);
  });

  it('rejects unknown features and missing versions', () => {
    expect(() => getFeatureStateVersion('nope')).toThrow(/no state migrator/i);
    expect(() => migrateFeatureState('nope', {}, 1)).toThrow(/no state migrator/i);
    expect(() => migrateFeatureState(FEATURE_WITHDRAW, { startBalance: 1 }, undefined))
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
