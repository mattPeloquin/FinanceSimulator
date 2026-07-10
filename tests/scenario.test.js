import { describe, it, expect } from 'vitest';
import {
  defaultScenario,
  buildSimParams,
  buildGoalSeekConfig,
  validateScenario,
  resolveWithdrawalMetric,
  isHorizonVariable,
  computeMaxYears,
  parseCurrency,
  formatCurrency,
  optionalBalanceThreshold,
  readDynConfigFromScenario,
  parseSpecificWithdrawals,
  fitSpecificWithdrawalsToHorizon,
  normalizeGiftingTiers,
  migrateScenario,
  MONEY_SCALE,
  SCENARIO_DEFAULTS,
} from '../src/state/scenario.js';
import { getSampleYears, computeProfiles, computeStandardizedYears } from '../src/core/history.js';

describe('currency helpers', () => {
  it('parses comma-separated strings as $000s', () => {
    expect(parseCurrency('4,000')).toBe(4000);
    expect(parseCurrency('80')).toBe(80);
    expect(parseCurrency('')).toBe(0);
  });
  it('preserves negative values', () => {
    expect(parseCurrency('-100')).toBe(-100);
    expect(parseCurrency('-22')).toBe(-22);
    expect(parseCurrency('0')).toBe(0);
  });
  it('strips dollar signs when pasted', () => {
    expect(parseCurrency('$-100')).toBe(-100);
    expect(parseCurrency('$1,234')).toBe(1234);
  });
  it('formats numbers with separators', () => {
    expect(formatCurrency(4000)).toBe('4,000');
  });
  it('treats blank or zero balance overrides as disabled', () => {
    expect(optionalBalanceThreshold('')).toBeNull();
    expect(optionalBalanceThreshold(0)).toBeNull();
    expect(optionalBalanceThreshold('3,000')).toBe(3_000_000);
  });
});

describe('migrateScenario', () => {
  it('converts v1 dollar fields to $000s', () => {
    const v1 = { startBalance: 4000000, baseWithdrawal: 80000, numYears: 40 };
    const v2 = migrateScenario(v1, 1);
    expect(v2.startBalance).toBe(4000);
    expect(v2.baseWithdrawal).toBe(80);
    expect(v2.numYears).toBe(40);
  });
  it('converts v2 withdrawalFloor to withdrawalFloors', () => {
    const v2 = { startBalance: 4000, withdrawalFloor: 100 };
    const v3 = migrateScenario(v2, 2);
    expect(v3.withdrawalFloors).toEqual([{ amount: 100 }]);
    expect(v3.withdrawalFloor).toBeUndefined();
  });
  it('converts v3 front-loading fields to spendingOverTimeTiers', () => {
    const v3 = {
      startBalance: 4000,
      withdrawalFloors: [{ amount: 80 }],
      spendChangePct: -2,
      goGoBonus: 50,
      goGoYears: 15,
    };
    const v4 = migrateScenario(v3, 3);
    expect(v4.spendingOverTimeTiers).toEqual([
      { changePct: -2, extra: 50, years: 15 },
      { changePct: -2, extra: 0 },
    ]);
    expect(v4.spendChangePct).toBeUndefined();
    expect(v4.goGoBonus).toBeUndefined();
    expect(v4.goGoYears).toBeUndefined();
  });
  it('leaves v4 scenarios unchanged apart from marking the preset detached', () => {
    const s = {
      startBalance: 4000,
      withdrawalFloors: [{ amount: 80 }],
      spendingOverTimeTiers: [{ changePct: 0, extra: 0 }],
    };
    // Pre-v5 saves predate the Risk Level slider: they load detached so the
    // slider never overwrites their hand-built values.
    expect(migrateScenario(s, 4)).toEqual({
      ...s,
      presetActive: false,
      presetLevel: SCENARIO_DEFAULTS.presetLevel,
    });
  });
  it('leaves v5 scenarios untouched', () => {
    const s = {
      startBalance: 4000,
      presetActive: true,
      presetLevel: 4,
    };
    expect(migrateScenario(s, 5)).toEqual(s);
  });
});

describe('defaultScenario', () => {
  it('matches SCENARIO_DEFAULTS', () => {
    expect(defaultScenario()).toEqual({ ...SCENARIO_DEFAULTS });
  });
});

describe('buildSimParams', () => {
  it('converts percentages to decimals and shapes engine params', () => {
    const s = defaultScenario();
    s.randomSeed = '7';
    const p = buildSimParams(s, { years: [] });
    expect(p.seed).toBe(7);
    expect(p.allocation.usLgGrowth).toBeCloseTo(0.25, 6);
    expect(p.portfolio.start).toBe(s.startBalance * MONEY_SCALE);
    expect(p.portfolio.floorPenalty).toBeCloseTo(0.5, 6);
    expect(p.dynConfig.high.adj).toBe(s.dynHighAdj * MONEY_SCALE);
  });

  it('maps a blank glide target to null (lever off) and a typed value to dollars', () => {
    // Easy Mode defaults pin the glide target to the Balanced ending-balance target.
    const defaults = buildSimParams(defaultScenario(), { years: [] });
    expect(defaults.portfolio.glideTarget).toBe(1_500_000);

    const blank = defaultScenario();
    blank.glideTarget = '';
    expect(buildSimParams(blank, { years: [] }).portfolio.glideTarget).toBeNull();

    const s = defaultScenario();
    s.glideTarget = 500;
    s.glideFraction = 75;
    s.glideRate = -2;
    const p = buildSimParams(s, { years: [] });
    expect(p.portfolio.glideTarget).toBe(500_000);
    expect(p.portfolio.glideFraction).toBeCloseTo(0.75, 9);
    expect(p.portfolio.glideRate).toBeCloseTo(-0.02, 9);

    // A typed 0 is a real "land on zero" target, distinct from blank.
    const zero = defaultScenario();
    zero.glideTarget = 0;
    expect(buildSimParams(zero, { years: [] }).portfolio.glideTarget).toBe(0);
  });

  it('readDynConfigFromScenario matches buildSimParams dynConfig', () => {
    const s = defaultScenario();
    s.dynLowRet = -10;
    s.dynLowAdj = -100;
    s.dynMedRet = 5;
    s.dynMedAdj = -22;
    s.dynHighRet = 30;
    s.dynHighAdj = 0;
    const fromReader = readDynConfigFromScenario(s);
    const fromParams = buildSimParams(s, { years: [] }).dynConfig;
    expect(fromReader).toEqual(fromParams);
    expect(fromReader.low.adj).toBe(-100_000);
    expect(fromReader.med.adj).toBe(-22_000);
    expect(fromReader.high.adj).toBe(0);
  });

  it('uses a random seed when none is provided', () => {
    const s = defaultScenario();
    s.randomSeed = '';
    const p = buildSimParams(s, { years: [] });
    expect(Number.isInteger(p.seed)).toBe(true);
    expect(p.seed).toBeGreaterThanOrEqual(0);
  });

  it('fits specific withdrawals to the simulation horizon', () => {
    const s = defaultScenario();
    s.withdrawalStrategy = 'specific';
    s.specificWithdrawals = '80\n85\n90';
    const p = buildSimParams(s, { years: [] });
    expect(p.portfolio.specificWithdrawals).toHaveLength(s.numYears);
    expect(p.portfolio.specificWithdrawals.slice(0, 3)).toEqual([80000, 85000, 90000]);
    expect(p.portfolio.specificWithdrawals.slice(3)).toEqual(Array(s.numYears - 3).fill(90000));
  });

  it('builds a per-year minimum withdrawal series from tiers', () => {
    const s = defaultScenario();
    s.numYears = 5;
    s.withdrawalFloors = [{ amount: 120, years: 2 }, { amount: 80 }];
    const p = buildSimParams(s, { years: [] });
    expect(p.portfolio.withdrawalFloorSeries).toEqual([120_000, 120_000, 80_000, 80_000, 80_000]);
  });

  it('disables balance overrides when threshold is blank or zero', () => {
    const s = defaultScenario();
    s.dynLowBal = 0;
    s.dynMedBal = '';
    s.dynHighBal = 0;
    const p = buildSimParams(s, { years: [] });
    expect(p.dynConfig.low.bal).toBeNull();
    expect(p.dynConfig.med.bal).toBeNull();
    expect(p.dynConfig.high.bal).toBeNull();
  });

  it('applies no minimum withdrawal when all tiers are removed', () => {
    const s = defaultScenario();
    s.withdrawalFloors = [];
    const p = buildSimParams(s, { years: [] });
    expect(p.portfolio.withdrawalFloorSeries.every((v) => v === 0)).toBe(true);
  });

  it('ignores base minimum-withdrawal tiers for a Specific List strategy', () => {
    const s = defaultScenario();
    s.numYears = 5;
    s.withdrawalStrategy = 'specific';
    s.specificWithdrawals = '80\n85\n90';
    s.withdrawalFloors = [{ amount: 120, years: 2 }, { amount: 80 }];
    s.specificWithdrawalFloors = [];
    const p = buildSimParams(s, { years: [] });
    expect(p.portfolio.withdrawalFloorSeries.every((v) => v === 0)).toBe(true);
  });

  it('builds percentage minimum floors for a Specific List strategy', () => {
    const s = defaultScenario();
    s.numYears = 3;
    s.withdrawalStrategy = 'specific';
    s.specificWithdrawals = '100\n90\n80';
    s.specificWithdrawalFloors = [{ pct: 80, years: 1 }, { pct: 60 }];
    const p = buildSimParams(s, { years: [] });
    expect(p.portfolio.withdrawalFloorSeries).toEqual([80_000, 54_000, 48_000]);
  });

  it('builds a per-year gifting series from tiers', () => {
    const s = defaultScenario();
    s.numYears = 4;
    s.giftingTiers = [{ amount: 25, balance: 2000, years: 2 }, { amount: 10, balance: 1500 }];
    const p = buildSimParams(s, { years: [] });
    expect(p.portfolio.giftingSeries).toEqual([
      { amount: 25_000, balanceThreshold: 2_000_000 },
      { amount: 25_000, balanceThreshold: 2_000_000 },
      { amount: 10_000, balanceThreshold: 1_500_000 },
      { amount: 10_000, balanceThreshold: 1_500_000 },
    ]);
  });

  it('applies no gifting when all tiers are removed', () => {
    const s = defaultScenario();
    s.giftingTiers = [];
    const p = buildSimParams(s, { years: [] });
    expect(p.portfolio.giftingSeries.every((entry) => entry.amount === 0 && entry.balanceThreshold === 0)).toBe(true);
  });

  it('assigns zero floor to deposit years in a Specific List strategy', () => {
    const s = defaultScenario();
    s.numYears = 2;
    s.withdrawalStrategy = 'specific';
    s.specificWithdrawals = '-50\n100';
    s.specificWithdrawalFloors = [{ pct: 80 }];
    const p = buildSimParams(s, { years: [] });
    expect(p.portfolio.withdrawalFloorSeries).toEqual([0, 80_000]);
  });

  it('includes scaledHistoricalShocks when sample years are provided', () => {
    const s = defaultScenario();
    const years = getSampleYears(2000, 2009);
    const p = buildSimParams(s, { years });
    expect(p.scaledHistoricalShocks).toHaveLength(years.length);
    expect(p.scaledHistoricalShocks[0]).toHaveLength(7);
  });

  it('converts scaledHistoricalSmoothing from percent to a 0-1 fraction', () => {
    const s = defaultScenario();
    s.scaledHistoricalSmoothing = 35;
    const p = buildSimParams(s, { years: [] });
    expect(p.scaledHistoricalSmoothing).toBeCloseTo(0.35, 6);
  });

  it('converts plan risk tolerance from percent to a shortfall fraction', () => {
    const s = defaultScenario();
    expect(buildSimParams(s, { years: [] }).shortfallTolerance).toBeCloseTo(0.05, 6);
    s.planRiskTolerancePct = 20;
    expect(buildSimParams(s, { years: [] }).shortfallTolerance).toBeCloseTo(0.2, 6);
    s.planRiskTolerancePct = 150;
    expect(buildSimParams(s, { years: [] }).shortfallTolerance).toBeCloseTo(0.35, 6);
  });
});

describe('buildGoalSeekConfig', () => {
  it('converts $000s and percentages into engine-ready dollars/fractions', () => {
    const s = defaultScenario();
    s.goalSeekTargetEndingBalance = 500;
    s.goalSeekDesiredSuccessPct = 85;
    s.goalSeekRiskTolerancePct = 20;
    s.goalSeekIncludeSpendingOverTime = true;
    // Defaults (Balanced preset) turn every lever on; pin the rest off so the
    // pass-through mapping below is unambiguous.
    s.goalSeekIncludeMarketAdjustments = false;
    s.goalSeekIncludeBalanceOverrides = false;
    s.goalSeekIncludeGlidePath = false;
    const config = buildGoalSeekConfig(s);
    expect(config.targetEndingBalance).toBe(500 * MONEY_SCALE);
    expect(config.desiredSuccessRate).toBeCloseTo(0.85, 6);
    expect(config.shortfallTolerance).toBeCloseTo(0.2, 6);
    expect(config.includeSpendingOverTime).toBe(true);
    expect(config.includeMarketAdjustments).toBe(false);
    expect(config.includeBalanceOverrides).toBe(false);
    expect(config.includeGlidePath).toBe(false);
  });

  it('passes the glide-path lever through for both strategies', () => {
    const s = defaultScenario();
    s.goalSeekIncludeGlidePath = true;
    expect(buildGoalSeekConfig(s).includeGlidePath).toBe(true);
    s.withdrawalStrategy = 'specific';
    expect(buildGoalSeekConfig(s).includeGlidePath).toBe(true);
  });

  it('clamps desired success rate to 0-1', () => {
    const s = defaultScenario();
    s.goalSeekDesiredSuccessPct = 150;
    expect(buildGoalSeekConfig(s).desiredSuccessRate).toBe(1);
    s.goalSeekDesiredSuccessPct = -10;
    expect(buildGoalSeekConfig(s).desiredSuccessRate).toBe(0);
  });

  it('clamps risk tolerance to 0-0.35', () => {
    const s = defaultScenario();
    s.goalSeekRiskTolerancePct = 150;
    expect(buildGoalSeekConfig(s).shortfallTolerance).toBe(0.35);
    s.goalSeekRiskTolerancePct = -10;
    expect(buildGoalSeekConfig(s).shortfallTolerance).toBe(0);
  });

  it('maps include base withdrawal to pinBaseWithdrawal (inverted)', () => {
    const s = defaultScenario();
    expect(buildGoalSeekConfig(s).pinBaseWithdrawal).toBe(false);
    s.goalSeekIncludeBaseWithdrawal = false;
    expect(buildGoalSeekConfig(s).pinBaseWithdrawal).toBe(true);
  });

  it('forces pinBaseWithdrawal and disables spending-over-time for a specific-list strategy', () => {
    const s = defaultScenario();
    s.withdrawalStrategy = 'specific';
    s.goalSeekIncludeBaseWithdrawal = true;
    s.goalSeekIncludeSpendingOverTime = true;
    s.goalSeekIncludeMarketAdjustments = true;
    const config = buildGoalSeekConfig(s);
    expect(config.pinBaseWithdrawal).toBe(true);
    expect(config.includeSpendingOverTime).toBe(false);
    expect(config.includeMarketAdjustments).toBe(true);
  });
});

describe('parseSpecificWithdrawals', () => {
  it('splits on common spreadsheet delimiters', () => {
    expect(parseSpecificWithdrawals('80\n85\n90')).toEqual([80000, 85000, 90000]);
    expect(parseSpecificWithdrawals('80\t85\t90')).toEqual([80000, 85000, 90000]);
    expect(parseSpecificWithdrawals('80;85;90')).toEqual([80000, 85000, 90000]);
    expect(parseSpecificWithdrawals('80|85|90')).toEqual([80000, 85000, 90000]);
    expect(parseSpecificWithdrawals('80, 85, 90')).toEqual([80000, 85000, 90000]);
    expect(parseSpecificWithdrawals('80,85,90')).toEqual([80000, 85000, 90000]);
  });

  it('preserves thousand separators inside a single value', () => {
    expect(parseSpecificWithdrawals('1,234')).toEqual([1234000]);
  });

  it('parses negative values as deposits', () => {
    expect(parseSpecificWithdrawals('-50\n80')).toEqual([-50000, 80000]);
  });
});

describe('fitSpecificWithdrawalsToHorizon', () => {
  it('truncates when the list is longer than the horizon', () => {
    const amounts = [10, 20, 30, 40, 50];
    expect(fitSpecificWithdrawalsToHorizon(amounts, 3)).toEqual([10, 20, 30]);
  });

  it('extends with the last value when the list is shorter than the horizon', () => {
    expect(fitSpecificWithdrawalsToHorizon([80000, 85000], 4)).toEqual([80000, 85000, 85000, 85000]);
  });

  it('fills with zero when the list is empty', () => {
    expect(fitSpecificWithdrawalsToHorizon([], 3)).toEqual([0, 0, 0]);
  });
});

describe('validateScenario', () => {
  const range = { minYear: 1900, maxYear: 2025 };

  // Defaults now ship with Goal Seek on and Smoothed Historical selected (the
  // Balanced risk preset). Raw defaults have null return profiles (filled from
  // history at runtime), so validation tests that want a clean plain-run
  // baseline switch to resampling with Goal Seek off.
  function plainScenario() {
    const s = defaultScenario();
    s.distMethod = 'resampling';
    s.goalSeekMode = false;
    return s;
  }

  it('passes for a plain-run scenario (resampling, Goal Seek off)', () => {
    expect(validateScenario(plainScenario(), range)).toEqual([]);
  });

  it('reports only the missing-profiles error for the raw defaults', () => {
    // The out-of-the-box scenario (Balanced preset) is valid except that its
    // Smoothed Historical profiles are null until init fills them from history.
    const errors = validateScenario(defaultScenario(), range);
    expect(errors).toEqual([
      'Return assumptions are incomplete. Adjust the year range or edit the Mean / Std Dev fields.',
    ]);
  });

  it('flags allocations that do not sum to 100', () => {
    const s = defaultScenario();
    s.cashAllocation = 20; // total becomes 110
    const errors = validateScenario(s, range);
    expect(errors.some((e) => e.includes('100%'))).toBe(true);
  });

  it('flags incomplete log-normal profiles', () => {
    const s = defaultScenario();
    s.distMethod = 'lognormal';
    const errors = validateScenario(s, range);
    expect(errors.some((e) => e.includes('Return assumptions'))).toBe(true);
  });

  it('flags incomplete scaled historical profiles', () => {
    const s = defaultScenario();
    s.distMethod = 'scaledHistorical';
    const errors = validateScenario(s, range);
    expect(errors.some((e) => e.includes('Return assumptions'))).toBe(true);
  });

  it('flags a horizon or simulation count above the caps', () => {
    const s = defaultScenario();
    s.numYears = 101;
    s.numSimulations = 100001;
    const errors = validateScenario(s, range);
    expect(errors.some((e) => e.includes('horizon'))).toBe(true);
    expect(errors.some((e) => e.includes('simulations'))).toBe(true);
  });

  it('flags dynamic adjustment triggers that are not strictly increasing', () => {
    const s = defaultScenario();
    s.dynLowRet = 5;
    s.dynMedRet = 5; // equal to low -> invalid
    const errors = validateScenario(s, range);
    expect(errors.some((e) => e.includes('Dynamic adjustment'))).toBe(true);
  });

  it('flags a floor balance at or above the ceiling balance', () => {
    const s = defaultScenario();
    s.floorBalance = 5000;
    s.ceilingBalance = 5000;
    const errors = validateScenario(s, range);
    expect(errors.some((e) => e.includes('Floor Balance'))).toBe(true);
  });

  it('allows a floor with no ceiling (ceiling = 0)', () => {
    const s = plainScenario();
    s.floorBalance = 5000;
    s.ceilingBalance = 0;
    expect(validateScenario(s, range)).toEqual([]);
  });

  it('ignores trigger ordering when dynamic adjustments are disabled', () => {
    const s = plainScenario();
    s.enableDynamicAdjustments = false;
    s.dynLowRet = 5;
    s.dynMedRet = 5;
    expect(validateScenario(s, range)).toEqual([]);
  });

  it('allows minimum-withdrawal tiers that exceed the simulation horizon', () => {
    const s = defaultScenario();
    s.numYears = 10;
    s.withdrawalFloors = [{ amount: 100, years: 10 }, { amount: 80 }];
    const errors = validateScenario(s, range);
    expect(errors.some((e) => e.includes('final tier'))).toBe(false);
  });

  it('does not validate base minimum-withdrawal tiers for a Specific List strategy', () => {
    const s = defaultScenario();
    s.numYears = 10;
    s.withdrawalStrategy = 'specific';
    s.specificWithdrawals = '80\n85\n90';
    s.withdrawalFloors = [{ amount: 100, years: 10 }, { amount: 80 }];
    const errors = validateScenario(s, range);
    expect(errors.some((e) => e.includes('final tier'))).toBe(false);
  });

  it('allows Specific List minimum tiers that exceed the simulation horizon', () => {
    const s = defaultScenario();
    s.numYears = 10;
    s.withdrawalStrategy = 'specific';
    s.specificWithdrawals = '80\n85\n90';
    s.specificWithdrawalFloors = [{ pct: 80, years: 10 }, { pct: 60 }];
    const errors = validateScenario(s, range);
    expect(errors.some((e) => e.includes('Specific List minimum tiers'))).toBe(false);
  });

  it('allows gifting tiers that exceed the simulation horizon', () => {
    const s = defaultScenario();
    s.numYears = 10;
    s.giftingTiers = [{ amount: 25, balance: 2000, years: 10 }, { amount: 10, balance: 1500 }];
    const errors = validateScenario(s, range);
    expect(errors.some((e) => e.includes('Gifting tiers'))).toBe(false);
  });

  it('allows zero-gift placeholder tiers but requires balance when gift is positive', () => {
    const s = plainScenario();
    s.giftingTiers = [{ amount: 0, balance: 0, years: 5 }, { amount: 25, balance: 2000 }];
    expect(validateScenario(s, range)).toEqual([]);
    s.giftingTiers = [{ amount: 25, balance: 0 }];
    expect(validateScenario(s, range).some((e) => e.includes('positive balance threshold'))).toBe(true);
  });

  it('normalizes gifting tiers with default year spans', () => {
    expect(normalizeGiftingTiers([{ amount: 25, balance: 2000, years: 3 }, { amount: 10, balance: 1500 }])).toEqual([
      { amount: 25, balance: 2000, years: 3 },
      { amount: 10, balance: 1500 },
    ]);
  });

  it('flags an out-of-range plan risk tolerance', () => {
    const s = defaultScenario();
    s.planRiskTolerancePct = 36;
    expect(validateScenario(s, range).some((e) => e.includes('Plan risk tolerance'))).toBe(true);
    s.planRiskTolerancePct = 0;
    expect(validateScenario(s, range).some((e) => e.includes('Plan risk tolerance'))).toBe(false);
    s.planRiskTolerancePct = 35;
    expect(validateScenario(s, range).some((e) => e.includes('Plan risk tolerance'))).toBe(false);
  });

  it('ignores Goal Seek fields when the mode is off', () => {
    const s = plainScenario();
    s.goalSeekTargetEndingBalance = -50;
    s.goalSeekDesiredSuccessPct = 500;
    expect(validateScenario(s, range)).toEqual([]);
  });

  it('flags a negative target ending balance when Goal Seek is on', () => {
    const s = defaultScenario();
    s.goalSeekMode = true;
    s.goalSeekTargetEndingBalance = -50;
    const errors = validateScenario(s, range);
    expect(errors.some((e) => e.includes('target ending balance'))).toBe(true);
  });

  it('flags an out-of-range desired success percentage when Goal Seek is on', () => {
    const s = defaultScenario();
    s.goalSeekMode = true;
    s.goalSeekDesiredSuccessPct = 150;
    const errors = validateScenario(s, range);
    expect(errors.some((e) => e.includes('desired success'))).toBe(true);
  });

  it('flags a desired success percentage outside the 65-99 range when Goal Seek is on', () => {
    const s = defaultScenario();
    s.goalSeekMode = true;
    s.goalSeekDesiredSuccessPct = 64;
    expect(validateScenario(s, range).some((e) => e.includes('desired success'))).toBe(true);
    s.goalSeekDesiredSuccessPct = 100;
    expect(validateScenario(s, range).some((e) => e.includes('desired success'))).toBe(true);
    s.goalSeekDesiredSuccessPct = 65;
    expect(validateScenario(s, range).some((e) => e.includes('desired success'))).toBe(false);
    s.goalSeekDesiredSuccessPct = 99;
    expect(validateScenario(s, range).some((e) => e.includes('desired success'))).toBe(false);
  });

  it('flags an out-of-range risk tolerance when Goal Seek is on', () => {
    const s = defaultScenario();
    s.goalSeekMode = true;
    s.goalSeekRiskTolerancePct = 150;
    const errors = validateScenario(s, range);
    expect(errors.some((e) => e.includes('risk tolerance'))).toBe(true);
  });

  it('flags a risk tolerance outside the 0-35 range when Goal Seek is on', () => {
    const s = defaultScenario();
    s.goalSeekMode = true;
    s.goalSeekRiskTolerancePct = 36;
    expect(validateScenario(s, range).some((e) => e.includes('risk tolerance'))).toBe(true);
    s.goalSeekRiskTolerancePct = 0;
    expect(validateScenario(s, range).some((e) => e.includes('risk tolerance'))).toBe(false);
    s.goalSeekRiskTolerancePct = 35;
    expect(validateScenario(s, range).some((e) => e.includes('risk tolerance'))).toBe(false);
  });

  it('requires at least one other lever when base is not included in the search', () => {
    const s = defaultScenario();
    s.goalSeekMode = true;
    s.goalSeekIncludeBaseWithdrawal = false;
    // Defaults (Balanced preset) turn every lever on; this test needs them all off.
    s.goalSeekIncludeSpendingOverTime = false;
    s.goalSeekIncludeMarketAdjustments = false;
    s.goalSeekIncludeBalanceOverrides = false;
    s.goalSeekIncludeGlidePath = false;
    s.baseWithdrawal = 150;
    const errors = validateScenario(s, range);
    expect(errors.some((e) => e.includes('at least one other lever'))).toBe(true);
  });

  it('requires a positive base when base is not included in the search', () => {
    const s = defaultScenario();
    s.goalSeekMode = true;
    s.goalSeekIncludeBaseWithdrawal = false;
    s.goalSeekIncludeBalanceOverrides = true;
    s.baseWithdrawal = 0;
    const errors = validateScenario(s, range);
    expect(errors.some((e) => e.includes('positive amount'))).toBe(true);
  });

  it('flags a specific-list strategy under Goal Seek when no lever is included', () => {
    const s = defaultScenario();
    s.goalSeekMode = true;
    s.withdrawalStrategy = 'specific';
    // Defaults (Balanced preset) turn every lever on; this test needs the
    // specific-list-compatible ones off.
    s.goalSeekIncludeMarketAdjustments = false;
    s.goalSeekIncludeBalanceOverrides = false;
    s.goalSeekIncludeGlidePath = false;
    const errors = validateScenario(s, range);
    expect(errors.some((e) => e.includes('Specific List'))).toBe(true);
  });

  it('allows a specific-list strategy under Goal Seek once a lever is included', () => {
    const s = defaultScenario();
    s.goalSeekMode = true;
    s.withdrawalStrategy = 'specific';
    s.goalSeekIncludeMarketAdjustments = true;
    const errors = validateScenario(s, range);
    expect(errors.some((e) => e.includes('Specific List'))).toBe(false);
  });
});

describe('history helpers', () => {
  it('returns the right number of sample years', () => {
    const years = getSampleYears(2000, 2009);
    expect(years.length).toBe(10);
  });

  it('computes profiles with finite mean and stddev', () => {
    const records = getSampleYears(1928, 2025);
    const profiles = computeProfiles(records);
    expect(Number.isFinite(profiles.us_lg_growth.mean)).toBe(true);
    expect(profiles.us_lg_growth.stdDev).toBeGreaterThan(0);
    expect(Number.isFinite(profiles.inflation.mean)).toBe(true);
  });

  it('standardizes each year to z-scores with mean ~0 and stdDev ~1', () => {
    const records = getSampleYears(1928, 2025);
    const shocks = computeStandardizedYears(records);
    expect(shocks).toHaveLength(records.length);
    expect(shocks[0]).toHaveLength(7);

    for (let k = 0; k < 7; k++) {
      const series = shocks.map((row) => row[k]);
      const mean = series.reduce((a, b) => a + b, 0) / series.length;
      const variance =
        series.reduce((a, z) => a + (z - mean) ** 2, 0) / series.length;
      expect(mean).toBeCloseTo(0, 1);
      expect(Math.sqrt(variance)).toBeCloseTo(1, 1);
    }
  });

  it('returns zero z-scores for zero-variance keys', () => {
    const records = [
      { us_lg_growth: 5, us_lg_value: 5, us_sm_mid: 5, ex_us: 5, bond: 5, cash: 5, inflation: 2 },
      { us_lg_growth: 5, us_lg_value: 5, us_sm_mid: 5, ex_us: 5, bond: 5, cash: 5, inflation: 2 },
    ];
    const shocks = computeStandardizedYears(records);
    expect(shocks.every((row) => row.every((z) => z === 0))).toBe(true);
  });
});

describe('variable horizon and withdrawal metric', () => {
  it('detects when a +/- range is enabled', () => {
    expect(isHorizonVariable({ horizonPlusYears: 0, horizonMinusYears: 0 })).toBe(false);
    expect(isHorizonVariable({ horizonPlusYears: 3, horizonMinusYears: 0 })).toBe(true);
  });

  it('resolves auto metric from horizon mode', () => {
    expect(resolveWithdrawalMetric({ withdrawalMetric: 'auto', horizonPlusYears: 0, horizonMinusYears: 0 })).toBe('total');
    expect(resolveWithdrawalMetric({ withdrawalMetric: 'auto', horizonPlusYears: 5, horizonMinusYears: 0 })).toBe('meanYearly');
    expect(resolveWithdrawalMetric({ withdrawalMetric: 'total', horizonPlusYears: 5, horizonMinusYears: 0 })).toBe('total');
  });

  it('passes explicit metrics through regardless of horizon mode', () => {
    expect(resolveWithdrawalMetric({ withdrawalMetric: 'meanYearly', horizonPlusYears: 0, horizonMinusYears: 0 })).toBe('meanYearly');
    expect(resolveWithdrawalMetric({ withdrawalMetric: 'medianYearly', horizonPlusYears: 0, horizonMinusYears: 0 })).toBe('medianYearly');
    expect(resolveWithdrawalMetric({ withdrawalMetric: 'medianYearly', horizonPlusYears: 5, horizonMinusYears: 0 })).toBe('medianYearly');
  });

  it('buildSimParams uses maxYears for specific-withdrawal fitting', () => {
    const s = defaultScenario();
    s.numYears = 30;
    s.horizonPlusYears = 5;
    s.specificWithdrawals = '80, 85, 90';
    const samples = { years: getSampleYears(1960, 2025) };
    const p = buildSimParams(s, samples);
    expect(p.maxYears).toBe(35);
    expect(p.portfolio.specificWithdrawals).toHaveLength(35);
    expect(p.withdrawalMetric).toBe('meanYearly');
  });

  it('validates horizon range bounds', () => {
    const s = defaultScenario();
    s.numYears = 5;
    s.horizonMinusYears = 5;
    const errors = validateScenario(s, { minYear: 1900, maxYear: 2025 });
    expect(errors.some((e) => e.includes('Horizon −'))).toBe(true);

    s.horizonMinusYears = 0;
    s.horizonPlusYears = 96;
    const errors2 = validateScenario(s, { minYear: 1900, maxYear: 2025 });
    expect(errors2.some((e) => e.includes('Endpoint + horizon'))).toBe(true);
  });

  it('computeMaxYears adds only the plus side', () => {
    expect(computeMaxYears({ numYears: 30, horizonPlusYears: 4, horizonMinusYears: 3 })).toBe(34);
  });
});
