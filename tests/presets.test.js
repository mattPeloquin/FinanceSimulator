import { describe, it, expect } from 'vitest';
import {
  PRESETS,
  DEFAULT_PRESET_LEVEL,
  PRESET_SCENARIO_KEYS,
  PRESET_DERIVED_SCALAR_KEYS,
  presetForLevel,
  computeDerivedPresetValues,
  presetScenarioPatch,
} from '../src/state/presets/index.js';
import {
  defaultScenario,
  validateScenario,
  migrateScenario,
  SCENARIO_DEFAULTS,
  FIELD_BY_KEY,
} from '../src/state/scenario.js';
import { BASE_DEFAULTS } from '../src/state/defaults.js';

const range = { minYear: 1900, maxYear: 2025 };
const balanced = PRESETS[DEFAULT_PRESET_LEVEL];

// The only validation error raw preset scenarios may produce: return profiles
// are null until init fills them from history (Smoothed Historical needs them).
const PROFILES_ERROR =
  'Return assumptions are incomplete. Adjust the year range or edit the Mean / Std Dev fields.';

describe('preset files', () => {
  it('has five levels ordered conservative → aggressive by success target', () => {
    expect(PRESETS).toHaveLength(5);
    for (let i = 1; i < PRESETS.length; i++) {
      expect(PRESETS[i].scenario.goalSeekDesiredSuccessPct)
        .toBeLessThanOrEqual(PRESETS[i - 1].scenario.goalSeekDesiredSuccessPct);
    }
    expect(PRESETS[4].scenario.goalSeekDesiredSuccessPct)
      .toBeLessThan(PRESETS[0].scenario.goalSeekDesiredSuccessPct);
  });

  it('steps base withdrawal pct up from conservative to aggressive in 0.5% steps', () => {
    const rates = PRESETS.map((p) => p.derived.baseWithdrawalPctOfStart);
    expect(rates).toEqual([4.0, 4.5, 5.0, 5.5, 6.0]);
  });

  it('steps minimum-withdrawal lifetime floors down from conservative to aggressive', () => {
    const lifetimes = PRESETS.map((p) => p.derived.minWithdrawalLifetimePctOfStart);
    for (let i = 1; i < lifetimes.length; i++) {
      expect(lifetimes[i], PRESETS[i].name).toBeLessThan(lifetimes[i - 1]);
    }
  });

  it('steps Specific List minimum % down from conservative to aggressive', () => {
    const floors = PRESETS.map((p) => p.derived.specificMinPctOfPlan);
    expect(floors).toEqual([90, 80, 70, 60, 50]);
  });

  it('steps max consecutive minimums up from conservative to aggressive', () => {
    const streaks = PRESETS.map((p) => p.scenario.maxConsecutiveMinWithdrawals);
    expect(streaks).toEqual([2, 2, 2, 3, 3]);
    const recovery = PRESETS.map((p) => p.scenario.minWithdrawalPlanRecoveryYears);
    expect(recovery).toEqual([3, 2, 2, 2, 1]);
  });

  it('only uses allowed scenario keys, and they are real scenario fields', () => {
    for (const preset of PRESETS) {
      for (const key of Object.keys(preset.scenario)) {
        expect(PRESET_SCENARIO_KEYS, `${preset.name}: ${key}`).toContain(key);
        expect(FIELD_BY_KEY.has(key) || key === 'distMethod', `${preset.name}: ${key}`).toBe(true);
      }
    }
  });

  it('does not store goalSeekMode in preset scenario (lives in BASE_DEFAULTS)', () => {
    for (const preset of PRESETS) {
      expect(preset.scenario.goalSeekMode, preset.name).toBeUndefined();
    }
    expect(BASE_DEFAULTS.goalSeekMode).toBe(true);
  });

  it('keeps every Goal Seek lever and gifting on at every level', () => {
    for (const preset of PRESETS) {
      expect(preset.scenario.goalSeekIncludeBaseWithdrawal, preset.name).toBe(true);
      expect(preset.scenario.goalSeekIncludeSpendingOverTime, preset.name).toBe(true);
      expect(preset.scenario.goalSeekIncludeMarketAdjustments, preset.name).toBe(true);
      expect(preset.scenario.goalSeekIncludeBalanceOverrides, preset.name).toBe(true);
      expect(preset.scenario.goalSeekIncludeGlidePath, preset.name).toBe(true);
      expect(preset.derived.gifting.amountPctOfStart, preset.name).toBeGreaterThan(0);
    }
  });

  it('sets max-boost drawdown Easy Mode ladder from Conservative to Aggressive', () => {
    expect(PRESETS.map((p) => p.derived.maxBoostDrawdownPct)).toEqual([-1, 0, 1, 2, null]);
  });

  it('sums allocations to 100 and keeps market triggers strictly increasing', () => {
    for (const preset of PRESETS) {
      const s = preset.scenario;
      const total = s.usLgGrowthAllocation + s.usLgValueAllocation + s.usSmMidAllocation
        + s.exUsAllocation + s.bondAllocation + s.cashAllocation;
      expect(total, preset.name).toBe(100);
      expect(s.dynLowRet, preset.name).toBeLessThan(s.dynMedRet);
      expect(s.dynMedRet, preset.name).toBeLessThan(s.dynHighRet);
    }
  });

  it('keeps Goal Seek targets inside the validated ranges', () => {
    for (const preset of PRESETS) {
      const s = preset.scenario;
      expect(s.goalSeekDesiredSuccessPct, preset.name).toBeGreaterThanOrEqual(65);
      expect(s.goalSeekDesiredSuccessPct, preset.name).toBeLessThanOrEqual(99);
      expect(s.goalSeekRiskTolerancePct, preset.name).toBeGreaterThanOrEqual(0);
      expect(s.goalSeekRiskTolerancePct, preset.name).toBeLessThanOrEqual(35);
    }
  });

  it('steps glide spend timing later for conservative and sooner for aggressive', () => {
    expect(PRESETS[0].scenario.glideRate).toBe(-2);
    expect(PRESETS[1].scenario.glideRate).toBe(-1);
    expect(PRESETS[2].scenario.glideRate).toBe(-1);
    expect(PRESETS[3].scenario.glideRate).toBe(-1);
    expect(PRESETS[4].scenario.glideRate).toBe(0);
  });

  it('clamps out-of-range levels to the nearest valid preset', () => {
    expect(presetForLevel(-1)).toBe(PRESETS[0]);
    expect(presetForLevel(99)).toBe(PRESETS[4]);
    expect(presetForLevel('junk')).toBe(PRESETS[DEFAULT_PRESET_LEVEL]);
  });
});

describe('computeDerivedPresetValues', () => {
  it('creates a minimum-withdrawal tier from an empty list', () => {
    const out = computeDerivedPresetValues(balanced, {
      startThousands: 3000,
      numYears: 35,
      withdrawalFloors: [],
      spendingOverTimeTiers: [
        { changePct: 0, extra: 50, years: 1 },
        { changePct: 0, extra: 99 },
      ],
    });
    expect(out.withdrawalFloors).toEqual([{ amount: 60 }]);
  });

  it('reproduces the classic defaults at a 3,000 start and 35-year horizon (Balanced)', () => {
    const out = computeDerivedPresetValues(balanced, {
      startThousands: 3000,
      numYears: 35,
      spendingOverTimeTiers: [
        { changePct: 0, extra: 50, years: 1 },
        { changePct: 0, extra: 99 },
      ],
    });
    expect(out.withdrawalFloors).toEqual([{ amount: 60 }]);
    expect(out.dynNoCutBal).toBe(3000);
    expect(out.dynMaxBoostDrawdownPct).toBe(1);
    expect(out.goalSeekTargetEndingBalance).toBe(
      Math.round(3000 * (balanced.derived.targetEndingBalancePctOfStart / 100)),
    );
    expect(out.glideTarget).toBe(out.goalSeekTargetEndingBalance);
    expect(out.spendingOverTimeTiers).toEqual([
      { changePct: -2, extra: 50, years: 15 },
      { changePct: -2, extra: 0 },
    ]);
    expect(out.giftingTiers).toEqual([{ amount: 30, balance: 2700 }]);
  });

  it('fills the full spending plan when includePlanFields is true (Balanced @ 2,000)', () => {
    const out = computeDerivedPresetValues(balanced, {
      startThousands: 2000,
      numYears: 25,
      spendingOverTimeTiers: [
        { changePct: 0, extra: 0, years: 1 },
        { changePct: 0, extra: 0 },
      ],
      includePlanFields: true,
    });
    expect(out.baseWithdrawal).toBe(100);
    expect(out.floorBalance).toBe(1600);
    expect(out.ceilingBalance).toBe(2400);
    expect(out.floorPenalty).toBe(50);
    expect(out.ceilingBonus).toBe(50);
    expect(out.dynLowAdj).toBe(-33);
    expect(out.dynMedAdj).toBe(0);
    expect(out.dynHighAdj).toBe(33);
    expect(out.glideFraction).toBe(30);
    expect(out.spendingOverTimeTiers[0].extra).toBe(33);
  });

  it('omits plan fields when includePlanFields is false but still sets Floor/Ceiling', () => {
    const out = computeDerivedPresetValues(balanced, {
      startThousands: 2000,
      numYears: 25,
      includePlanFields: false,
    });
    expect(out.baseWithdrawal).toBeUndefined();
    expect(out.floorPenalty).toBeUndefined();
    expect(out.ceilingBonus).toBeUndefined();
    expect(out.glideFraction).toBeUndefined();
    // Thresholds stay Easy Mode–owned even with Find Best Plan on.
    expect(out.floorBalance).toBe(1600);
    expect(out.ceilingBalance).toBe(2400);
  });

  it('scales the derived amounts with the starting balance and horizon', () => {
    const life = balanced.derived.minWithdrawalLifetimePctOfStart;
    const at3000 = computeDerivedPresetValues(balanced, { startThousands: 3000, numYears: 35 });
    const at6000 = computeDerivedPresetValues(balanced, { startThousands: 6000, numYears: 35 });
    expect(at3000.withdrawalFloors[0].amount).toBe(Math.round(3000 * (life / 100) / 35));
    expect(at6000.withdrawalFloors[0].amount).toBe(Math.round(6000 * (life / 100) / 35));
    expect(at6000.goalSeekTargetEndingBalance).toBe(2 * at3000.goalSeekTargetEndingBalance);
    expect(at6000.glideTarget).toBe(at6000.goalSeekTargetEndingBalance);
    expect(at6000.giftingTiers[0].amount).toBe(2 * at3000.giftingTiers[0].amount);

    const at70y = computeDerivedPresetValues(balanced, { startThousands: 3000, numYears: 70 });
    expect(at70y.withdrawalFloors[0].amount).toBe(Math.round(3000 * (life / 100) / 70));
  });

  it('skips the minimum-withdrawal write when the horizon is missing', () => {
    for (const years of [0, -5, NaN, undefined]) {
      const out = computeDerivedPresetValues(balanced, { startThousands: 3000, numYears: years });
      expect(out.withdrawalFloors).toBeUndefined();
    }
  });

  it('skips balance-derived writes when the start is missing or non-positive', () => {
    for (const start of [0, -5, NaN, undefined]) {
      const out = computeDerivedPresetValues(balanced, {
        startThousands: start,
        numYears: 35,
        includePlanFields: true,
      });
      expect(out.withdrawalFloors).toBeUndefined();
      expect(out.giftingTiers).toBeUndefined();
      expect(out.dynNoCutBal).toBeUndefined();
      expect(out.goalSeekTargetEndingBalance).toBeUndefined();
      expect(out.glideTarget).toBeUndefined();
      expect(out.baseWithdrawal).toBeUndefined();
    }
  });

  it('patches only the slider-managed tier fields, preserving user-added tiers', () => {
    const out = computeDerivedPresetValues(balanced, {
      startThousands: 3000,
      numYears: 35,
      withdrawalFloors: [
        { amount: 55, years: 5 },
        { amount: 44 },
      ],
      giftingTiers: [
        { amount: 9, balance: 900, years: 3 },
        { amount: 5, balance: 500 },
      ],
      spendingOverTimeTiers: [
        { changePct: 1, extra: 77, years: 4 },
        { changePct: 1, extra: 66, years: 6 },
        { changePct: 1, extra: 55 },
      ],
    });
    expect(out.withdrawalFloors).toEqual([{ amount: 60, years: 5 }, { amount: 44 }]);
    expect(out.giftingTiers).toEqual([
      { amount: 30, balance: 2700, years: 3 },
      { amount: 5, balance: 500 },
    ]);
    expect(out.spendingOverTimeTiers).toEqual([
      { changePct: -2, extra: 77, years: 15 },
      { changePct: -2, extra: 0, years: 6 },
      { changePct: 1, extra: 55 },
    ]);
  });

  it('sets tier-0 extra from plan when includePlanFields is true', () => {
    const out = computeDerivedPresetValues(balanced, {
      startThousands: 2000,
      numYears: 25,
      spendingOverTimeTiers: [
        { changePct: 0, extra: 99, years: 1 },
        { changePct: 0, extra: 0 },
      ],
      includePlanFields: true,
    });
    expect(out.spendingOverTimeTiers[0].extra).toBe(33);
  });

  it('only sets changePct when the spending list has a single tier', () => {
    const out = computeDerivedPresetValues(balanced, {
      startThousands: 3000,
      numYears: 35,
      spendingOverTimeTiers: [{ changePct: 1, extra: 20 }],
    });
    expect(out.spendingOverTimeTiers).toEqual([{ changePct: -2, extra: 20 }]);
  });

  it('writes percentage minimum floors for Specific List, not dollar floors', () => {
    const out = computeDerivedPresetValues(balanced, {
      startThousands: 3000,
      numYears: 25,
      withdrawalStrategy: 'specific',
      specificWithdrawalFloors: [],
    });
    expect(out.withdrawalFloors).toBeUndefined();
    expect(out.specificWithdrawalFloors).toEqual([{ pct: 70 }]);
  });

  it('patches only tier 0 of Specific List minimum floors', () => {
    const out = computeDerivedPresetValues(balanced, {
      startThousands: 3000,
      numYears: 25,
      withdrawalStrategy: 'specific',
      specificWithdrawalFloors: [{ pct: 90, years: 5 }, { pct: 40 }],
    });
    expect(out.specificWithdrawalFloors).toEqual([{ pct: 70, years: 5 }, { pct: 40 }]);
  });

  it('Specific List minimum % does not change with horizon', () => {
    const at25 = computeDerivedPresetValues(balanced, {
      startThousands: 3000,
      numYears: 25,
      withdrawalStrategy: 'specific',
      specificWithdrawalFloors: [],
    });
    const at50 = computeDerivedPresetValues(balanced, {
      startThousands: 3000,
      numYears: 50,
      withdrawalStrategy: 'specific',
      specificWithdrawalFloors: [],
    });
    expect(at25.specificWithdrawalFloors).toEqual([{ pct: 70 }]);
    expect(at50.specificWithdrawalFloors).toEqual([{ pct: 70 }]);
  });

  it('fills shared plan fields for Specific List without base withdrawal or spending extras', () => {
    const out = computeDerivedPresetValues(balanced, {
      startThousands: 2000,
      numYears: 25,
      withdrawalStrategy: 'specific',
      spendingOverTimeTiers: [
        { changePct: 0, extra: 99, years: 1 },
        { changePct: 0, extra: 0 },
      ],
      includePlanFields: true,
    });
    expect(out.baseWithdrawal).toBeUndefined();
    expect(out.floorBalance).toBe(1600);
    expect(out.ceilingBalance).toBe(2400);
    expect(out.dynLowAdj).toBe(-33);
    expect(out.dynHighAdj).toBe(33);
    expect(out.glideFraction).toBe(30);
    expect(out.spendingOverTimeTiers).toBeUndefined();
  });

  it('does not patch spending-over-time tiers under Specific List', () => {
    const out = computeDerivedPresetValues(balanced, {
      startThousands: 3000,
      numYears: 35,
      withdrawalStrategy: 'specific',
      spendingOverTimeTiers: [
        { changePct: 1, extra: 50, years: 4 },
        { changePct: 1, extra: 0 },
      ],
    });
    expect(out.spendingOverTimeTiers).toBeUndefined();
  });
});

describe('defaults composition', () => {
  it('keeps preset-owned keys out of BASE_DEFAULTS', () => {
    for (const key of [...PRESET_SCENARIO_KEYS, ...PRESET_DERIVED_SCALAR_KEYS]) {
      expect(Object.hasOwn(BASE_DEFAULTS, key), key).toBe(false);
    }
    // Plan scalars may appear as zero/blank seeds for detached mode; presets own
    // the live values while Easy Mode is on (Goal Seek off).
    expect(BASE_DEFAULTS.baseWithdrawal).toBe(0);
    expect(BASE_DEFAULTS.floorPenalty).toBe(50);
    expect(Object.hasOwn(BASE_DEFAULTS, 'floorBalance')).toBe(false);
    expect(Object.hasOwn(BASE_DEFAULTS, 'ceilingBalance')).toBe(false);
    expect(Object.hasOwn(BASE_DEFAULTS, 'withdrawalFloors')).toBe(false);
    expect(Object.hasOwn(BASE_DEFAULTS, 'giftingTiers')).toBe(false);
    expect(BASE_DEFAULTS.startBalance).toBe('');
    expect(BASE_DEFAULTS.goalSeekMode).toBe(true);
  });

  it('bakes the Balanced preset into SCENARIO_DEFAULTS without a starting portfolio', () => {
    for (const [key, value] of Object.entries(balanced.scenario)) {
      expect(SCENARIO_DEFAULTS[key], key).toEqual(value);
    }
    expect(SCENARIO_DEFAULTS.presetLevel).toBe(DEFAULT_PRESET_LEVEL);
    expect(SCENARIO_DEFAULTS.presetActive).toBe(true);
    expect(SCENARIO_DEFAULTS.startBalance).toBe('');
    expect(SCENARIO_DEFAULTS.withdrawalFloors).toBeUndefined();
    expect(SCENARIO_DEFAULTS.goalSeekTargetEndingBalance).toBeUndefined();
    expect(SCENARIO_DEFAULTS.glideTarget).toBeUndefined();
    expect(SCENARIO_DEFAULTS.floorBalance).toBeUndefined();
    expect(SCENARIO_DEFAULTS.ceilingBalance).toBeUndefined();
    expect(SCENARIO_DEFAULTS.glideRate).toBe(-1);
    expect(SCENARIO_DEFAULTS.spendingOverTimeTiers).toEqual([
      { changePct: -2, extra: 0, years: 13 },
      { changePct: -2, extra: 0 },
    ]);
  });

  it('every preset applied over defaults validates at several balances', () => {
    for (const level of [0, 1, 2, 3, 4]) {
      for (const start of [500, 3000, 20000]) {
        const s = { ...defaultScenario(), startBalance: start };
        Object.assign(s, presetScenarioPatch(level, {
          startThousands: start,
          numYears: s.numYears,
          withdrawalFloors: s.withdrawalFloors,
          giftingTiers: s.giftingTiers,
          spendingOverTimeTiers: s.spendingOverTimeTiers,
          includePlanFields: true,
        }));
        expect(validateScenario(s, range), `level ${level} @ ${start}`)
          .toEqual([PROFILES_ERROR]);
      }
    }
  });
});

describe('preset migration', () => {
  it('marks pre-v5 saves detached at the default level', () => {
    const migrated = migrateScenario({ startBalance: 4000 }, 4);
    expect(migrated.presetActive).toBe(false);
    expect(migrated.presetLevel).toBe(DEFAULT_PRESET_LEVEL);
  });

  it('leaves v5 preset state alone', () => {
    const migrated = migrateScenario({ presetActive: true, presetLevel: 3 }, 5);
    expect(migrated.presetActive).toBe(true);
    expect(migrated.presetLevel).toBe(3);
  });

  it('detaches current-schema saves that omit Easy Mode so defaults cannot re-attach', () => {
    const migrated = migrateScenario({ startBalance: 4200, withdrawalFloors: [{ amount: 88 }] }, 6);
    expect(migrated.presetActive).toBe(false);
    expect(migrated.presetLevel).toBe(DEFAULT_PRESET_LEVEL);
  });
});
