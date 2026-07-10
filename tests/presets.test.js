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
        .toBeLessThan(PRESETS[i - 1].scenario.goalSeekDesiredSuccessPct);
    }
  });

  it('steps minimum-withdrawal lifetime floors down from conservative to aggressive', () => {
    // Conservative locks in more lifetime spending (steadier cash flow);
    // Aggressive accepts a lower floor so Goal Seek can cut spending more.
    const lifetimes = PRESETS.map((p) => p.derived.minWithdrawalLifetimePctOfStart);
    for (let i = 1; i < lifetimes.length; i++) {
      expect(lifetimes[i], PRESETS[i].name).toBeLessThan(lifetimes[i - 1]);
    }
  });

  it('only uses allowed scenario keys, and they are real scenario fields', () => {
    for (const preset of PRESETS) {
      for (const key of Object.keys(preset.scenario)) {
        expect(PRESET_SCENARIO_KEYS, `${preset.name}: ${key}`).toContain(key);
        expect(FIELD_BY_KEY.has(key) || key === 'distMethod', `${preset.name}: ${key}`).toBe(true);
      }
    }
  });

  it('keeps every Goal Seek lever and gifting on at every level', () => {
    for (const preset of PRESETS) {
      expect(preset.scenario.goalSeekMode, preset.name).toBe(true);
      expect(preset.scenario.goalSeekIncludeBaseWithdrawal, preset.name).toBe(true);
      expect(preset.scenario.goalSeekIncludeSpendingOverTime, preset.name).toBe(true);
      expect(preset.scenario.goalSeekIncludeMarketAdjustments, preset.name).toBe(true);
      expect(preset.scenario.goalSeekIncludeBalanceOverrides, preset.name).toBe(true);
      expect(preset.scenario.goalSeekIncludeGlidePath, preset.name).toBe(true);
      expect(preset.derived.gifting.amountPctOfStart, preset.name).toBeGreaterThan(0);
    }
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
    expect(PRESETS[0].scenario.glideRate).toBe(-3);
    expect(PRESETS[1].scenario.glideRate).toBe(-2);
    expect(PRESETS[2].scenario.glideRate).toBe(-2);
    expect(PRESETS[3].scenario.glideRate).toBe(-2);
    expect(PRESETS[4].scenario.glideRate).toBe(-1);
  });

  it('clamps out-of-range levels to the nearest valid preset', () => {
    expect(presetForLevel(-1)).toBe(PRESETS[0]);
    expect(presetForLevel(99)).toBe(PRESETS[4]);
    expect(presetForLevel('junk')).toBe(PRESETS[DEFAULT_PRESET_LEVEL]);
  });
});

describe('computeDerivedPresetValues', () => {
  it('reproduces the classic defaults at a 3,000 start and 35-year horizon (Balanced)', () => {
    const out = computeDerivedPresetValues(balanced, {
      startThousands: 3000,
      numYears: 35,
      spendingOverTimeTiers: [
        { changePct: 0, extra: 50, years: 1 },
        { changePct: 0, extra: 99 },
      ],
    });
    // 40% of start over 35 years → 34/yr minimum at the default balance.
    expect(out.withdrawalFloors).toEqual([{ amount: 34 }]);
    // 0.3333/1/1.6667 × 3,000 → the classic 1,000/3,000/5,000 balance triggers.
    expect(out.dynLowBal).toBe(1000);
    expect(out.dynMedBal).toBe(3000);
    expect(out.dynHighBal).toBe(5000);
    // Target ending % of start; glide Target mirrors it.
    expect(out.goalSeekTargetEndingBalance).toBe(
      Math.round(3000 * (balanced.derived.targetEndingBalancePctOfStart / 100)),
    );
    expect(out.glideTarget).toBe(out.goalSeekTargetEndingBalance);
    // -2%/yr on both tiers; first tier spans 43% of 35 years ≈ 15; second
    // tier's extra pinned to 0; first tier's extra untouched (Goal Seek's).
    expect(out.spendingOverTimeTiers).toEqual([
      { changePct: -2, extra: 50, years: 15 },
      { changePct: -2, extra: 0 },
    ]);
    // Gifting: 1% of start yearly while balance stays above 1.33 × start.
    expect(out.giftingTiers).toEqual([{ amount: 30, balance: 3990 }]);
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

    // Doubling the horizon halves the annual floor (same lifetime total).
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
      const out = computeDerivedPresetValues(balanced, { startThousands: start, numYears: 35 });
      expect(out.withdrawalFloors).toBeUndefined();
      expect(out.giftingTiers).toBeUndefined();
      expect(out.dynLowBal).toBeUndefined();
      expect(out.goalSeekTargetEndingBalance).toBeUndefined();
      expect(out.glideTarget).toBeUndefined();
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
    // Tier 0 amounts replaced, extra tiers (and their year spans) untouched.
    expect(out.withdrawalFloors).toEqual([{ amount: 34, years: 5 }, { amount: 44 }]);
    expect(out.giftingTiers).toEqual([
      { amount: 30, balance: 3990, years: 3 },
      { amount: 5, balance: 500 },
    ]);
    // changePct on the first two tiers, years on tier 0, extra 0 on tier 1;
    // tier 0's extra and the third tier stay exactly as the user left them.
    expect(out.spendingOverTimeTiers).toEqual([
      { changePct: -2, extra: 77, years: 15 },
      { changePct: -2, extra: 0, years: 6 },
      { changePct: 1, extra: 55 },
    ]);
  });

  it('only sets changePct when the spending list has a single tier', () => {
    const out = computeDerivedPresetValues(balanced, {
      startThousands: 3000,
      numYears: 35,
      spendingOverTimeTiers: [{ changePct: 1, extra: 20 }],
    });
    expect(out.spendingOverTimeTiers).toEqual([{ changePct: -2, extra: 20 }]);
  });
});

describe('defaults composition', () => {
  it('keeps preset-owned keys out of BASE_DEFAULTS', () => {
    for (const key of [...PRESET_SCENARIO_KEYS, ...PRESET_DERIVED_SCALAR_KEYS]) {
      expect(Object.hasOwn(BASE_DEFAULTS, key), key).toBe(false);
    }
    // Tier lists: floors/gifting are fully derived; spending keeps only the
    // Goal Seek seed shape (first-tier extra), not preset changePct/years.
    expect(Object.hasOwn(BASE_DEFAULTS, 'withdrawalFloors')).toBe(false);
    expect(Object.hasOwn(BASE_DEFAULTS, 'giftingTiers')).toBe(false);
    expect(BASE_DEFAULTS.spendingOverTimeTiers[0].extra).toBe(50);
  });

  it('bakes the Balanced preset into SCENARIO_DEFAULTS', () => {
    for (const [key, value] of Object.entries(balanced.scenario)) {
      expect(SCENARIO_DEFAULTS[key], key).toEqual(value);
    }
    expect(SCENARIO_DEFAULTS.presetLevel).toBe(DEFAULT_PRESET_LEVEL);
    expect(SCENARIO_DEFAULTS.presetActive).toBe(true);
    expect(SCENARIO_DEFAULTS.withdrawalFloors).toEqual([{
      amount: Math.round(3000 * (balanced.derived.minWithdrawalLifetimePctOfStart / 100) / 35),
    }]);
    expect(SCENARIO_DEFAULTS.goalSeekTargetEndingBalance).toBe(
      Math.round(3000 * (balanced.derived.targetEndingBalancePctOfStart / 100)),
    );
    expect(SCENARIO_DEFAULTS.glideTarget).toBe(SCENARIO_DEFAULTS.goalSeekTargetEndingBalance);
    expect(SCENARIO_DEFAULTS.glideRate).toBe(-2);
    expect(SCENARIO_DEFAULTS.spendingOverTimeTiers).toEqual([
      { changePct: -2, extra: 50, years: 15 },
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
        }));
        // Null return profiles are the only acceptable complaint (init fills
        // them from history before any run).
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
});
