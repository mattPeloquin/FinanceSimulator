// Classic "4% rule" benchmark: withdraw 4% of the starting portfolio in year 1,
// then keep that same real (today's-dollar) amount every year with no market
// adjustments, floors, gifts, events, or glide. Because this simulator already
// works in real dollars, a flat base equals the textbook "inflate the dollar
// amount with CPI" rule without a second inflation step.
//
// Used after every plan run to compare the user's policy against that rigid
// strawman on identical market paths (same seed + samples).

import { plannedYearlySchedule } from './goalSeek.js';
import { isMedianYearlyMetric, isMeanYearlyMetric } from './statistics.js';

/** Classic Bengen / Trinity first-year withdrawal rate. */
export const CLASSIC_FOUR_PERCENT_RATE = 0.04;

/** Relative tolerance when checking whether a plan is already flat 4%. */
const EQUIVALENT_RATE_TOLERANCE = 0.0005; // 0.05 percentage points of start

function maxHorizonYears(params) {
  return params.maxYears ?? params.numYears ?? 0;
}

function zeroGiftSeries(numYears) {
  return Array.from({ length: numYears }, () => ({ amount: 0, balanceThreshold: 0 }));
}

function flatSpendingSeries(numYears) {
  return Array.from({ length: numYears }, () => ({ changeRate: 0, extra: 0 }));
}

function seriesIsFlatZeroExtra(series) {
  if (!series || series.length === 0) return true;
  return series.every((entry) => (entry?.changeRate ?? 0) === 0 && (entry?.extra ?? 0) === 0);
}

function seriesIsAllZeros(series) {
  if (!series || series.length === 0) return true;
  return series.every((value) => (value ?? 0) === 0);
}

function giftSeriesIsOff(series) {
  if (!series || series.length === 0) return true;
  return series.every((entry) => (entry?.amount ?? 0) === 0);
}

/**
 * Clone engine params into a Trinity-style fixed real 4% withdrawal policy.
 * Market / horizon / seed / samples stay identical so path-by-path comparison
 * is fair; only the withdrawal side is forced.
 */
export function buildClassicFourPercentParams(params) {
  const numYears = maxHorizonYears(params);
  const startBalance = params.portfolio?.start ?? 0;

  return {
    ...params,
    // Keep seed + samples by reference so both Monte Carlos draw the same
    // return / inflation sequences for each simulation index.
    seed: params.seed,
    samples: params.samples,
    portfolio: {
      ...params.portfolio,
      strategy: 'base',
      // Year-1 withdrawal = 4% of start; flat real schedule thereafter.
      base: startBalance * CLASSIC_FOUR_PERCENT_RATE,
      // Specific-list amounts are unused under strategy 'base', but clear them
      // so a clone never accidentally inherits a typed list if strategy changes.
      specificWithdrawals: new Array(numYears).fill(0),
      floorBalance: 0,
      floorPenalty: 0,
      ceilingBalance: Infinity,
      ceilingBonus: 0,
      glideTarget: null,
      glideFraction: 0,
      withdrawalFloorSeries: new Array(numYears).fill(0),
      spendingOverTimeSeries: flatSpendingSeries(numYears),
      giftingSeries: zeroGiftSeries(numYears),
      majorEventsSeries: new Array(numYears).fill(0),
      maxConsecutiveMinWithdrawals: 0,
      minWithdrawalPlanRecoveryYears: 0,
    },
    dynConfig: {
      ...(params.dynConfig || {}),
      enabled: false,
    },
  };
}

/**
 * True when the user's engine params already match a flat real 4% rule
 * (same spending shape the classic clone would produce).
 */
export function isClassicFourPercentEquivalent(params) {
  const portfolio = params?.portfolio;
  if (!portfolio) return false;
  if (portfolio.strategy !== 'base') return false;
  if (params.dynConfig?.enabled) return false;

  const startBalance = portfolio.start ?? 0;
  if (!(startBalance > 0)) return false;

  const classicBase = startBalance * CLASSIC_FOUR_PERCENT_RATE;
  const baseGap = Math.abs((portfolio.base ?? 0) - classicBase) / startBalance;
  if (baseGap > EQUIVALENT_RATE_TOLERANCE) return false;

  if ((portfolio.floorBalance ?? 0) > 0) return false;
  if ((portfolio.floorPenalty ?? 0) > 0) return false;
  if (Number.isFinite(portfolio.ceilingBalance) && (portfolio.ceilingBonus ?? 0) > 0) {
    return false;
  }
  if (portfolio.glideTarget != null) return false;
  if (!seriesIsFlatZeroExtra(portfolio.spendingOverTimeSeries)) return false;
  if (!seriesIsAllZeros(portfolio.withdrawalFloorSeries)) return false;
  if (!giftSeriesIsOff(portfolio.giftingSeries)) return false;
  if (!seriesIsAllZeros(portfolio.majorEventsSeries)) return false;
  if ((portfolio.maxConsecutiveMinWithdrawals ?? 0) > 0) return false;

  return true;
}

function primaryWithdrawn(result, metric) {
  if (isMedianYearlyMetric(metric)) return result.medianYearlyWithdrawn;
  if (isMeanYearlyMetric(metric)) return result.meanYearlyWithdrawn;
  return result.medianWithdrawn;
}

/**
 * Pure comparison metrics for the results verdict strip.
 * Headline leftover = classic median end balance (money the rule never spent).
 */
export function buildFourPercentComparison(userResult, classicResult, params) {
  const startBalance = params.portfolio?.start ?? 0;
  const horizonYears = params.numYears ?? 0;
  const userSchedule = plannedYearlySchedule(params.portfolio, horizonYears);
  const userPlanYear1 = userSchedule[0] ?? 0;
  const userYear1Rate = startBalance > 0 ? userPlanYear1 / startBalance : 0;

  const metric = userResult.withdrawalMetric ?? params.withdrawalMetric ?? 'total';
  const userPrimaryWithdrawn = primaryWithdrawn(userResult, metric);
  const classicPrimaryWithdrawn = primaryWithdrawn(classicResult, metric);

  return {
    equivalent: isClassicFourPercentEquivalent(params),
    classicRate: CLASSIC_FOUR_PERCENT_RATE,
    userYear1Rate,
    // Money left unspent under the classic rule (median ending balance).
    classicLeftover: classicResult.medianBalance ?? 0,
    userLeftover: userResult.medianBalance ?? 0,
    // Positive => classic left more behind than the user's plan.
    leftoverDelta: (classicResult.medianBalance ?? 0) - (userResult.medianBalance ?? 0),
    userMedianWithdrawn: userResult.medianWithdrawn ?? 0,
    classicMedianWithdrawn: classicResult.medianWithdrawn ?? 0,
    userMeanYearlyWithdrawn: userResult.meanYearlyWithdrawn ?? 0,
    classicMeanYearlyWithdrawn: classicResult.meanYearlyWithdrawn ?? 0,
    userPrimaryWithdrawn,
    classicPrimaryWithdrawn,
    // Positive => user's plan withdrew more than the classic rule.
    withdrawnDelta: userPrimaryWithdrawn - classicPrimaryWithdrawn,
    // Positive => user's plan withdrew more lifetime total than classic.
    totalWithdrawnDelta:
      (userResult.medianWithdrawn ?? 0) - (classicResult.medianWithdrawn ?? 0),
    // Positive => user's plan had higher mean yearly spending than classic.
    meanYearlyDelta:
      (userResult.meanYearlyWithdrawn ?? 0) - (classicResult.meanYearlyWithdrawn ?? 0),
    userSuccessRate: userResult.successRate ?? 0,
    classicSuccessRate: classicResult.successRate ?? 0,
    withdrawalMetric: metric,
  };
}
