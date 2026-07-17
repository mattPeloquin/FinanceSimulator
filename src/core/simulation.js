// Core Monte Carlo engine. Pure and DOM-free so it can run in a web worker
// and be unit-tested directly.

import { createRng, deriveSeed, logNormalMuSigma, applyLogNormalMuSigma } from './rng.js';
import { median, irrFromPath } from './statistics.js';
import {
  resolveAdjustment,
  limitBoostForDrawdown,
  balanceScaleMultiplier,
  buildBaseWithdrawalSchedule,
  buildGlideRequiredBalances,
  glideSpendAmount,
  scaledGiftAmount,
} from './withdrawal.js';
import { fitSpecificWithdrawalsToHorizon } from '../state/scenario.js';

const DEPLETION_EPSILON = 1e-6;
const MAX_HORIZON_YEARS = 100;

// Estimate dollars that leave the portfolio for one year with a given market
// boost, stopping before glide surplus. Used only to size the max-boost
// drawdown cap; the real year loop still applies spending once with the
// limited boost. Recovery counters only matter for future years, so this
// probe reads whether a forced-plan year is already active and ignores the
// consecutive-min bookkeeping that would only change later years.
// Dollars still needed after this year's planned withdrawal to fund the rest
// of the plan (undiscounted, no ending-balance cushion). Used by %-mode gifting.
function remainingPlanNeedAfterWithdrawal(planFundedNeed, planAmount, yearIndex) {
  if (!planFundedNeed) return 0;
  const fundedNeed = planFundedNeed[yearIndex] ?? 0;
  return Math.max(0, fundedNeed - Math.max(0, planAmount));
}

function estimateSpendingExGlide({
  postGrowthBalance,
  boost,
  baseVal,
  unadjustedTarget,
  dynConfigEnabled,
  portfolio,
  yearFloor,
  minRecoveryEnabled,
  forcedPlanYearsRemaining,
  eventAmount,
  strategy,
  gift,
  glideRequired,
  glideFraction,
  yearIndex,
  planFundedNeed,
}) {
  let balance = postGrowthBalance;
  let targetWithdrawal = unadjustedTarget + boost;
  const plan = unadjustedTarget;

  if (dynConfigEnabled && targetWithdrawal > 0) {
    targetWithdrawal *= balanceScaleMultiplier(balance, portfolio);
  }
  if (baseVal >= 0 && targetWithdrawal < 0) targetWithdrawal = 0;

  let actualWithdrawal;
  if (targetWithdrawal < 0) {
    actualWithdrawal = targetWithdrawal;
    balance -= actualWithdrawal;
  } else {
    // Forced "stay on plan" years raise this year's floor to the plan amount.
    if (minRecoveryEnabled && forcedPlanYearsRemaining > 0) {
      targetWithdrawal = Math.max(targetWithdrawal, plan);
    } else if (yearFloor > 0) {
      targetWithdrawal = Math.max(targetWithdrawal, yearFloor);
    }
    if (strategy !== 'specific' && eventAmount < 0) {
      targetWithdrawal += -eventAmount;
    }
    actualWithdrawal = Math.min(balance, targetWithdrawal);
    balance -= actualWithdrawal;
  }

  let prospectiveGlideExtra = 0;
  if (glideRequired && targetWithdrawal >= 0) {
    prospectiveGlideExtra = glideSpendAmount(
      postGrowthBalance - glideRequired[yearIndex],
      balance,
      glideFraction,
      portfolio.glideTarget,
    );
  }
  const metPlan =
    targetWithdrawal < 0
    || actualWithdrawal + prospectiveGlideExtra >= unadjustedTarget;
  if (gift && gift.amount > 0 && metPlan) {
    // Gifts leave the portfolio too; only the balance reduction matters here.
    const remainingNeed = remainingPlanNeedAfterWithdrawal(
      planFundedNeed,
      unadjustedTarget,
      yearIndex,
    );
    balance -= Math.min(balance, scaledGiftAmount(gift, balance, remainingNeed));
  }

  return { spendingExGlide: postGrowthBalance - balance };
}

// Draw this run's horizon when a +/- range is enabled. The first RNG draw inside
// simulatePath is reserved for this so regeneratePath stays deterministic.
// Positive z extends the endpoint (sigma = plus/2); negative z shortens it
// (sigma = minus/2). Result is rounded, hard-clamped to the typed bounds, and
// never below 1 year.
function sampleHorizonYears(rng, endpoint, horizonRange) {
  if (!horizonRange) return endpoint;

  const { plus, minus } = horizonRange;
  if (plus === 0 && minus === 0) return endpoint;

  const z = rng.normal();
  let delta = 0;
  if (z >= 0 && plus > 0) {
    const sigma = plus / 2;
    delta = Math.min(plus, Math.max(0, Math.round(z * sigma)));
  } else if (z < 0 && minus > 0) {
    const sigma = minus / 2;
    delta = -Math.min(minus, Math.max(0, Math.round(Math.abs(z) * sigma)));
  }

  let years = endpoint + delta;
  years = Math.max(endpoint - minus, Math.min(endpoint + plus, years));
  years = Math.max(1, Math.min(MAX_HORIZON_YEARS, years));
  return years;
}

// `logNormalMuSigma` only depends on an asset's fixed mean/stdDev, never on the
// random draw, so it's wasteful to recompute it every year of every simulation
// (Goal Seek alone can run hundreds of thousands of years across its candidate
// searches). Cache the derived {mu, sigma} per `logNormal` config object — that
// object is reused by reference across an entire Monte Carlo run (and across
// every Goal Seek candidate, since only portfolio/lever fields change between
// candidates), so this cache effectively computes each asset's parameters once.
const logNormalMuSigmaCache = new WeakMap();

// Canonical order of the 7 log-normal assets (6 asset classes + inflation),
// matching the correlated draw order (`params.logNormal.chol`).
const LOGNORMAL_ASSET_ORDER = ['usLgGrowth', 'usLgValue', 'usSmMid', 'exUs', 'bond', 'cash', 'inflation'];

function getLogNormalMuSigmas(logNormal, assetKeysInOrder) {
  let cached = logNormalMuSigmaCache.get(logNormal);
  if (!cached) {
    cached = assetKeysInOrder.map((key) => logNormalMuSigma(logNormal[key].mean, logNormal[key].stdDev));
    logNormalMuSigmaCache.set(logNormal, cached);
  }
  return cached;
}

// Stationary (circular) block bootstrap: continue consecutive years or jump to a
// new random start with probability 1/blockSize (average run length = blockSize).
function nextBootstrapIndex(rng, currentIndex, poolLen, blockSize) {
  const restartProb = blockSize > 1 ? 1 / blockSize : 1;
  if (currentIndex < 0 || rng.uniform() < restartProb) {
    return Math.floor(rng.uniform() * poolLen);
  }
  return (currentIndex + 1) % poolLen;
}

// Lower-triangular matrix · vector (L is N×N, v length N).
function matVec(L, v) {
  const N = v.length;
  const out = new Array(N);
  for (let i = 0; i < N; i++) {
    let sum = 0;
    for (let k = 0; k <= i; k++) sum += L[i][k] * v[k];
    out[i] = sum;
  }
  return out;
}

// The unadjusted per-year withdrawal plan the glide path must keep funding —
// mirrors the year loop's own `unadjustedTarget` derivation (schedule or
// specific-list amount, clamped at 0 for non-deposit years). The minimum
// withdrawal floor is applied later in the year loop, not here.
function buildGlidePlan(portfolio, baseSchedule, fittedWithdrawals, horizonYears) {
  const isSpecific = portfolio.strategy === 'specific';
  const plan = new Array(horizonYears);
  for (let j = 0; j < horizonYears; j++) {
    const baseVal = isSpecific ? fittedWithdrawals[j] : portfolio.base;
    let target = isSpecific ? fittedWithdrawals[j] : baseSchedule[j];
    if (baseVal >= 0 && target < 0) target = 0;
    plan[j] = target;
  }
  return plan;
}

// Run a single simulation deterministically from `rng`.
// When `collectPath` is true the full per-year arrays are returned (used only
// for the handful of paths we actually chart); otherwise only summary stats.
export function simulatePath(params, rng, collectPath = false, outRealReturns = null, outOffset = 0, outWithdrawals = null) {
  const {
    numYears: endpointYears,
    maxYears: maxYearsParam,
    horizonRange,
    distMethod,
    allocation,
    allocationSeries,
    blockSize,
    portfolio,
    dynConfig,
    logNormal,
    samples,
    scaledHistoricalShocks,
    scaledHistoricalSmoothing,
    earlyYearsWindow,
    sequenceStart,
  } = params;

  const maxYears = maxYearsParam ?? endpointYears ?? params.numYears;
  const horizonYears = sampleHorizonYears(rng, endpointYears ?? params.numYears, horizonRange);

  const smoothing = scaledHistoricalSmoothing ?? 0;
  // Goal Seek's early-years objective (see core/goalSeek.js): how much was
  // withdrawn during just the first `earlyYearsWindow` years, so a search can
  // maximize early-retirement spending instead of the lifetime total.
  const earlyWindow = earlyYearsWindow || 0;

  let totalRealGrowthFactor = 1.0;
  let currentYearIndex = -1;

  let balance = portfolio.start;
  let totalWithdrawn = 0;
  let earlyWithdrawn = 0;
  let depletionYear = Infinity;

  const balances = collectPath ? [balance] : null;
  const withdrawals = collectPath ? [] : null;
  const returns = collectPath ? [] : null;
  const unadjustedWithdrawals = collectPath ? [] : null;
  // Per-year dollar attribution of actual withdrawal vs plan (chart tooltips only).
  const withdrawalBreakdown = collectPath ? [] : null;
  // Per-year actual withdrawals — used to score each run by median yearly spending.
  const yearlyWithdrawals = new Array(horizonYears);

  // Parallel IRR-only track: same market returns, but major-event inflows never
  // land on the balance and event outflows are stripped from cash flows so IRR
  // measures market timing, not house sales or known large payments.
  let irrBalance = portfolio.start;
  const irrYearlyWithdrawals = new Array(horizonYears);

  const sampleYears = samples ? samples.years : null;
  const sampleLen = sampleYears ? sampleYears.length : 0;

  const fittedWithdrawals =
    portfolio.strategy === 'specific'
      ? fitSpecificWithdrawalsToHorizon(portfolio.specificWithdrawals || [], horizonYears)
      : null;

  const baseSchedule =
    portfolio.strategy !== 'specific'
      ? buildBaseWithdrawalSchedule(portfolio.base, portfolio.spendingOverTimeSeries, horizonYears)
      : null;

  // Unadjusted withdrawal plan for this run's horizon — shared by glide-path
  // required balances and by %-mode gifting (funded need of remaining plan).
  const glidePlan = buildGlidePlan(portfolio, baseSchedule, fittedWithdrawals, horizonYears);

  // Gifting % bands compare post-withdrawal balance to the undiscounted
  // funded need of remaining planned withdrawals (ending target 0, rate 0).
  const planFundedNeed = buildGlideRequiredBalances(glidePlan, 0, 0);

  // Glide-path spend-down (optional; glideTarget null/blank = off, engine
  // behaves exactly as before). Precompute the per-year balance required to
  // fund the remaining plan and still land on the glide target at this run's
  // horizon; the year loop recycles a fraction of any surplus above it. Part
  // of Dynamic Adjustments & Guardrails, so the section's enable toggle gates
  // it just like the market adjustments and the balance-scale ramp.
  const glideFraction = portfolio.glideFraction ?? 0;
  const glideRequired =
    dynConfig.enabled
    && portfolio.glideTarget != null
    && Number.isFinite(portfolio.glideTarget)
    && glideFraction > 0
      ? buildGlideRequiredBalances(
          glidePlan,
          portfolio.glideTarget,
          portfolio.glideRate ?? 0,
        )
      : null;

  // Consecutive-min → force-plan recovery: after X years at the minimum
  // backstop, spend at least the plan for the next Y years (still balance-capped).
  const maxConsecutiveMin = portfolio.maxConsecutiveMinWithdrawals ?? 0;
  const planRecoveryYears = portfolio.minWithdrawalPlanRecoveryYears ?? 0;
  const minRecoveryEnabled = maxConsecutiveMin > 0 && planRecoveryYears > 0;
  let consecutiveMinYears = 0;
  let forcedPlanYearsRemaining = 0;

  // Log-normal setup (only used when distMethod === 'lognormal').
  // Assets/inflation ordered to match the correlation Cholesky factor.
  // Allocation weights are NOT cached here: Adjust allocation over time can
  // glide the mix each year, so weights are read inside the year loop.
  let lnMuSigma = null;
  let lnChol = null;
  let lnPhi = 0;
  let lnPrevZ = null;
  if (distMethod === 'lognormal') {
    lnMuSigma = getLogNormalMuSigmas(logNormal, LOGNORMAL_ASSET_ORDER);
    lnChol = logNormal.chol || null;
    // Block size drives year-to-year smoothing via an AR(1) on the standard
    // normals: φ = 1 − 1/blockSize (blockSize 1 ⇒ φ=0 ⇒ independent years).
    lnPhi = blockSize > 1 ? 1 - 1 / blockSize : 0;
  }

  // Smoothed Historical setup: target mean/stdDev per asset (same fields as log-normal).
  let shTargets = null;
  if (distMethod === 'scaledHistorical') {
    shTargets = [
      logNormal.usLgGrowth,
      logNormal.usLgValue,
      logNormal.usSmMid,
      logNormal.exUs,
      logNormal.bond,
      logNormal.cash,
      logNormal.inflation,
    ];
  }

  for (let j = 0; j < horizonYears; j++) {
    let portfolioReturn;
    let inflation;

    // This year's portfolio mix: either the fixed Asset Allocation, or the
    // interpolated weight from Adjust allocation over time (same series the
    // preview chart uses).
    const yearAlloc = allocationSeries?.[j] ?? allocation;
    const yearAllocWeights = [
      yearAlloc.usLgGrowth,
      yearAlloc.usLgValue,
      yearAlloc.usSmMid,
      yearAlloc.exUs,
      yearAlloc.bond,
      yearAlloc.cash,
    ];

    if (distMethod === 'lognormal') {
      // Fresh independent standard normals, then correlate across assets.
      const eps = new Array(7);
      for (let k = 0; k < 7; k++) eps[k] = rng.normal();
      const c = lnChol ? matVec(lnChol, eps) : eps;

      // Serial smoothing: blend this year's correlated shock with last year's,
      // preserving the marginal unit variance and the cross-asset correlation.
      let z;
      if (lnPrevZ === null || lnPhi === 0) {
        z = c;
      } else {
        const a = Math.sqrt(1 - lnPhi * lnPhi);
        z = new Array(7);
        for (let k = 0; k < 7; k++) z[k] = lnPhi * lnPrevZ[k] + a * c[k];
      }
      lnPrevZ = z;

      portfolioReturn = 0;
      for (let k = 0; k < 6; k++) {
        portfolioReturn += applyLogNormalMuSigma(lnMuSigma[k].mu, lnMuSigma[k].sigma, z[k]) * yearAllocWeights[k];
      }
      inflation = applyLogNormalMuSigma(lnMuSigma[6].mu, lnMuSigma[6].sigma, z[6]);
    } else if (distMethod === 'scaledHistorical') {
      // Resample real historical year-to-year sequences, then rescale each asset
      // from its historical z-score onto the user's target mean/stdDev.
      const shockPool = scaledHistoricalShocks;
      const shockLen = shockPool ? shockPool.length : 0;
      currentYearIndex = nextBootstrapIndex(rng, currentYearIndex, shockLen, blockSize);

      const z = shockPool[currentYearIndex];
      portfolioReturn = 0;
      for (let k = 0; k < 6; k++) {
        const { mean, stdDev } = shTargets[k];
        const jitter = smoothing > 0 ? rng.normal() * smoothing * stdDev : 0;
        portfolioReturn += (mean + z[k] * stdDev + jitter) * yearAllocWeights[k];
      }
      const inf = shTargets[6];
      const infJitter = smoothing > 0 ? rng.normal() * smoothing * inf.stdDev : 0;
      inflation = inf.mean + z[6] * inf.stdDev + infJitter;
    } else {
      // Historical years: a stationary (circular) block bootstrap for Monte
      // Carlo resampling, or — for 'historicalSequence' (the plan-backtest
      // band) — a deterministic contiguous walk from `sequenceStart`, wrapping
      // when the selection is shorter than the horizon.
      currentYearIndex =
        distMethod === 'historicalSequence'
          ? ((sequenceStart ?? 0) + j) % sampleLen
          : nextBootstrapIndex(rng, currentYearIndex, sampleLen, blockSize);

      const yearData = sampleYears[currentYearIndex];
      const usLgGrowthReturn = yearData.us_lg_growth / 100;
      const usLgValueReturn = yearData.us_lg_value / 100;
      const usSmMidReturn = yearData.us_sm_mid / 100;
      const exUsReturn = yearData.ex_us / 100;
      const bondReturn = yearData.bond / 100;
      const cashReturn = yearData.cash / 100;
      inflation = yearData.inflation / 100;

      portfolioReturn =
        usLgGrowthReturn * yearAlloc.usLgGrowth +
        usLgValueReturn * yearAlloc.usLgValue +
        usSmMidReturn * yearAlloc.usSmMid +
        exUsReturn * yearAlloc.exUs +
        bondReturn * yearAlloc.bond +
        cashReturn * yearAlloc.cash;
    }

    const startOfYearBalance = balance;

    const realReturn = (1 + portfolioReturn) / (1 + inflation) - 1;
    // Path charts / Market Return tooltips use the same real return the
    // portfolio grew by (and that drives the market-adjustment curve).
    if (returns) returns.push(realReturn);
    if (outRealReturns) outRealReturns[outOffset + j] = realReturn;
    totalRealGrowthFactor *= 1 + realReturn;

    balance = balance * (1 + realReturn);
    irrBalance *= 1 + realReturn;

    // Major events: inflows land on the portfolio after growth, before the
    // year's withdrawal is computed. Outflows are applied later (after the
    // minimum floor) so known payments sit on top of the spending plan.
    const eventAmount = portfolio.majorEventsSeries?.[j] ?? 0;
    if (portfolio.strategy !== 'specific' && eventAmount > 0) {
      balance += eventAmount;
    }

    const postGrowthBalance = balance;

    // Market/balance guardrail add-on before the balance-scale ramp. Curve is
    // keyed off real return (%). Positive boosts may be trimmed below by the
    // max-boost drawdown floor vs start-of-year.
    let dynamicAdj = dynConfig.enabled
      ? resolveAdjustment(balance, realReturn * 100, dynConfig)
      : 0;

    let unadjustedTarget;
    let baseVal;
    if (portfolio.strategy === 'specific') {
      baseVal = fittedWithdrawals[j];
      unadjustedTarget = baseVal;
    } else {
      baseVal = portfolio.base;
      unadjustedTarget = baseSchedule[j];
    }
    if (baseVal >= 0 && unadjustedTarget < 0) {
      unadjustedTarget = 0;
    }

    const yearFloor = portfolio.withdrawalFloorSeries?.[j] ?? 0;
    const gift = portfolio.giftingSeries?.[j];

    // When a positive curve boost would spend past the drawdown floor, shrink
    // it using spending-without-boost as the baseline. Scale can amplify the
    // boost, so scale the allowed headroom by the full-boost extra.
    if (
      dynConfig.enabled
      && dynamicAdj > 0
      && dynConfig.maxBoostDrawdownPct != null
      && Number.isFinite(dynConfig.maxBoostDrawdownPct)
    ) {
      const probeArgs = {
        postGrowthBalance,
        baseVal,
        unadjustedTarget,
        dynConfigEnabled: dynConfig.enabled,
        portfolio,
        yearFloor,
        minRecoveryEnabled,
        forcedPlanYearsRemaining,
        eventAmount,
        strategy: portfolio.strategy,
        gift,
        glideRequired,
        glideFraction,
        yearIndex: j,
        planFundedNeed,
      };
      const withoutBoost = estimateSpendingExGlide({ ...probeArgs, boost: 0 }).spendingExGlide;
      const withFullBoost = estimateSpendingExGlide({
        ...probeArgs,
        boost: dynamicAdj,
      }).spendingExGlide;
      // Additive headroom (boost dollars ≈ spending dollars when scale is 1).
      const additiveCap = limitBoostForDrawdown(
        dynamicAdj,
        startOfYearBalance,
        postGrowthBalance,
        dynConfig.maxBoostDrawdownPct,
        withoutBoost,
      );
      // When balance-scale amplifies the boost, shrink further so the extra
      // dollars of total spending (not just the boost line item) fit.
      const maxExtraWd = Math.max(
        0,
        postGrowthBalance
          - startOfYearBalance * (1 - dynConfig.maxBoostDrawdownPct)
          - withoutBoost,
      );
      const extraFromFull = withFullBoost - withoutBoost;
      if (extraFromFull <= 0) {
        dynamicAdj = 0;
      } else if (extraFromFull > maxExtraWd) {
        dynamicAdj = Math.min(additiveCap, dynamicAdj * (maxExtraWd / extraFromFull));
      } else {
        dynamicAdj = additiveCap;
      }
    }

    let targetWithdrawal = unadjustedTarget + dynamicAdj;

    // Balance-based spending scale: smoothly cut the whole withdrawal as the
    // balance slides below the floor, or boost it as wealth grows past the
    // ceiling. Deposits (negative targets) are never scaled, and the minimum
    // withdrawal below still acts as the backstop after scaling.
    let scaleDelta = 0;
    if (dynConfig.enabled && targetWithdrawal > 0) {
      const scaledTarget = targetWithdrawal * balanceScaleMultiplier(balance, portfolio);
      scaleDelta = scaledTarget - targetWithdrawal;
      targetWithdrawal = scaledTarget;
    }

    if (baseVal >= 0 && targetWithdrawal < 0) {
      // Negative target clamped to zero — fold into scaleDelta so attribution sums.
      scaleDelta += -targetWithdrawal;
      targetWithdrawal = 0;
    }

    const plan = unadjustedTarget;
    // Glide surplus is measured from the pre-withdrawal balance (after growth
    // and inflows) so it stays comparable to glideRequired[j].
    const balanceBeforeYearWithdrawals = balance;

    let actualWithdrawal;
    let floorLift = 0;
    let majorEventOutflow = 0;
    let balanceShortfall = 0;
    let giftPaid = 0;
    let glideExtra = 0;
    if (targetWithdrawal < 0) {
      // Negative target = deposit (adds to balance); floor and min-recovery do not apply.
      actualWithdrawal = targetWithdrawal;
      balance -= actualWithdrawal;
    } else {
      if (minRecoveryEnabled && forcedPlanYearsRemaining > 0) {
        // Recovery window: spend at least the plan even if adjustments cut lower.
        const lifted = Math.max(targetWithdrawal, plan);
        floorLift = lifted - targetWithdrawal;
        targetWithdrawal = lifted;
        forcedPlanYearsRemaining--;
        consecutiveMinYears = 0;
      } else {
        const preFloorTarget = targetWithdrawal;
        if (yearFloor > 0) {
          const lifted = Math.max(targetWithdrawal, yearFloor);
          floorLift = lifted - targetWithdrawal;
          targetWithdrawal = lifted;
        }
        if (minRecoveryEnabled && yearFloor > 0 && plan > yearFloor) {
          if (preFloorTarget < yearFloor) {
            consecutiveMinYears++;
            if (consecutiveMinYears >= maxConsecutiveMin) {
              forcedPlanYearsRemaining = planRecoveryYears;
              consecutiveMinYears = 0;
            }
          } else {
            consecutiveMinYears = 0;
          }
        } else if (minRecoveryEnabled) {
          consecutiveMinYears = 0;
        }
      }
      // Known large payments from major events (negative amounts) are mandatory
      // on top of the plan and floor — still capped by balance below.
      if (portfolio.strategy !== 'specific' && eventAmount < 0) {
        majorEventOutflow = -eventAmount;
        targetWithdrawal += majorEventOutflow;
      }
      actualWithdrawal = Math.min(balance, targetWithdrawal);
      balanceShortfall = targetWithdrawal - actualWithdrawal;
      balance -= actualWithdrawal;
    }

    // Tiered gifting: give only when this year's non-gift spending fully meets
    // the plan. Legacy tiers also require Balance >; %-mode tiers scale the
    // Gift against surplus over the remaining-plan funded need instead.
    // "Meets the plan" counts the upcoming glide surplus (computed before any
    // gift) so a market-adj cut that glide would more than replace does not
    // block gifting — same eligibility as when glide ran first. Deposit years
    // always meet the plan, so only the gift-amount rules apply.
    let prospectiveGlideExtra = 0;
    if (glideRequired && targetWithdrawal >= 0) {
      prospectiveGlideExtra = glideSpendAmount(
        balanceBeforeYearWithdrawals - glideRequired[j],
        balance,
        glideFraction,
        portfolio.glideTarget,
      );
    }
    const metPlan =
      targetWithdrawal < 0
      || actualWithdrawal + prospectiveGlideExtra >= unadjustedTarget;
    if (gift && gift.amount > 0 && metPlan) {
      const remainingNeed = remainingPlanNeedAfterWithdrawal(
        planFundedNeed,
        unadjustedTarget,
        j,
      );
      giftPaid = Math.min(balance, scaledGiftAmount(gift, balance, remainingNeed));
      balance -= giftPaid;
      actualWithdrawal += giftPaid;
    }

    // Glide-path spend-down: after gifting, recycle a fraction of any surplus
    // still above this year's required glide balance. Surplus is measured from
    // the pre-withdrawal balance; gifts already paid reduce what glide may take.
    // Skipped on deposit years so surplus recycling never fights a deposit.
    // glideSpendAmount also stops the recycle at the glide target itself, so
    // glide spending can never be the reason a run ends below the target.
    if (glideRequired && targetWithdrawal >= 0) {
      const glideSurplus = balanceBeforeYearWithdrawals - glideRequired[j] - giftPaid;
      glideExtra = glideSpendAmount(glideSurplus, balance, glideFraction, portfolio.glideTarget);
      if (glideExtra > 0) {
        balance -= glideExtra;
        actualWithdrawal += glideExtra;
      }
    }

    if (withdrawalBreakdown) {
      withdrawalBreakdown.push({
        plan,
        dynamicAdj,
        scaleDelta,
        glideExtra,
        floorLift,
        majorEventOutflow,
        balanceShortfall,
        gift: giftPaid,
        actual: actualWithdrawal,
      });
    }

    totalWithdrawn += actualWithdrawal;
    yearlyWithdrawals[j] = actualWithdrawal;
    // Every run's per-year actual spending (after all adjustments, gifts and
    // glide extras) feeds the Withdrawal Heatmap — unlike the sampled chart
    // paths, this captures all simulations. Depleted years record their true
    // ~$0 withdrawal; only years past the run's horizon get NaN (below).
    if (outWithdrawals) outWithdrawals[outOffset + j] = actualWithdrawal;

    // Shadow IRR cash flows: strip major-event outflows; inflows never entered
    // actualWithdrawal and are not added to irrBalance above.
    let irrWithdrawal = actualWithdrawal;
    if (portfolio.strategy !== 'specific' && eventAmount < 0) {
      irrWithdrawal = Math.max(0, actualWithdrawal + eventAmount);
    }
    if (irrWithdrawal < 0) {
      irrBalance -= irrWithdrawal;
    } else {
      irrWithdrawal = Math.min(irrBalance, irrWithdrawal);
      irrBalance -= irrWithdrawal;
    }
    irrYearlyWithdrawals[j] = irrWithdrawal;

    if (earlyWindow > 0 && j < earlyWindow) {
      earlyWithdrawn += actualWithdrawal;
    }

    if (depletionYear === Infinity && balance <= DEPLETION_EPSILON) {
      depletionYear = j + 1;
    }

    if (balances) balances.push(balance);
    if (withdrawals) withdrawals.push(actualWithdrawal);
    if (unadjustedWithdrawals) unadjustedWithdrawals.push(unadjustedTarget);
  }

  // Pad unused tail years with NaN for histograms when horizons vary.
  if (outRealReturns && maxYears > horizonYears) {
    for (let j = horizonYears; j < maxYears; j++) {
      outRealReturns[outOffset + j] = NaN;
    }
  }
  // Same sentinel for withdrawals: NaN = "this run's horizon ended", which the
  // heatmap must distinguish from a depleted-but-active $0 withdrawal year.
  if (outWithdrawals && maxYears > horizonYears) {
    for (let j = horizonYears; j < maxYears; j++) {
      outWithdrawals[outOffset + j] = NaN;
    }
  }

  const avgReturn = horizonYears > 0 ? totalRealGrowthFactor ** (1 / horizonYears) - 1 : 0;
  const irr = irrFromPath(portfolio.start, irrYearlyWithdrawals, irrBalance, avgReturn);

  const summary = {
    avgReturn,
    irr,
    finalBalance: balance,
    totalWithdrawn,
    medianYearlyWithdrawal: median(yearlyWithdrawals),
    earlyWithdrawn,
    depletionYear,
    horizonYears,
  };

  if (collectPath) {
    summary.path = { balances, withdrawals, returns, unadjustedWithdrawals, withdrawalBreakdown };
  }

  return summary;
}

// Sum the per-year attribution fields; should equal `actual` for withdrawal years.
export function sumWithdrawalBreakdown(b) {
  return (
    b.plan
    + b.dynamicAdj
    + b.scaleDelta
    + b.glideExtra
    + b.floorLift
    + b.majorEventOutflow
    - b.balanceShortfall
    + b.gift
  );
}

// Run the full Monte Carlo. Returns summary stats packed into typed arrays
// (memory-light) plus the baseSeed needed to regenerate any individual path.
// `onProgress(fraction)` is called periodically (0..1).
// `startIndex` offsets the per-simulation seed so parallel chunks stay deterministic.
export function runMonteCarlo(params, { onProgress, startIndex = 0 } = {}) {
  const { numSimulations } = params;
  const maxYears = params.maxYears ?? params.numYears;
  const baseSeed = params.seed >>> 0;

  const avgReturn = new Float64Array(numSimulations);
  const irr = new Float64Array(numSimulations);
  const finalBalance = new Float64Array(numSimulations);
  const totalWithdrawn = new Float64Array(numSimulations);
  const medianYearlyWithdrawal = new Float64Array(numSimulations);
  const earlyWithdrawn = new Float64Array(numSimulations);
  const depletionYear = new Float64Array(numSimulations);
  const horizonYears = new Int32Array(numSimulations);
  const allYearsReturns = new Float64Array(numSimulations * maxYears);
  allYearsReturns.fill(NaN);
  // Per-year actual withdrawal for every run (Withdrawal Heatmap source).
  // Same layout as allYearsReturns: run i's years live at [i*maxYears, (i+1)*maxYears).
  const allYearsWithdrawals = new Float64Array(numSimulations * maxYears);
  allYearsWithdrawals.fill(NaN);

  const progressEvery = Math.max(1, Math.floor(numSimulations / 100));

  for (let i = 0; i < numSimulations; i++) {
    const globalIndex = startIndex + i;
    const rng = createRng(deriveSeed(baseSeed, globalIndex));
    const s = simulatePath(params, rng, false, allYearsReturns, i * maxYears, allYearsWithdrawals);
    avgReturn[i] = s.avgReturn;
    irr[i] = s.irr;
    finalBalance[i] = s.finalBalance;
    totalWithdrawn[i] = s.totalWithdrawn;
    medianYearlyWithdrawal[i] = s.medianYearlyWithdrawal;
    earlyWithdrawn[i] = s.earlyWithdrawn;
    horizonYears[i] = s.horizonYears;
    depletionYear[i] = s.depletionYear === Infinity ? s.horizonYears + 1 : s.depletionYear;

    if (onProgress && i % progressEvery === 0) {
      onProgress(i / numSimulations);
    }
  }

  if (onProgress) onProgress(1);

  return {
    baseSeed,
    numSimulations,
    avgReturn,
    irr,
    finalBalance,
    totalWithdrawn,
    medianYearlyWithdrawal,
    earlyWithdrawn,
    depletionYear,
    horizonYears,
    allYearsReturns,
    allYearsWithdrawals,
  };
}

// Regenerate the full path for a specific simulation index (exact, thanks to
// deterministic per-simulation seeding).
export function regeneratePath(params, baseSeed, index) {
  const rng = createRng(deriveSeed(baseSeed >>> 0, index));
  return simulatePath(params, rng, true);
}
