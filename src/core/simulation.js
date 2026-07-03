// Core Monte Carlo engine. Pure and DOM-free so it can run in a web worker
// and be unit-tested directly.

import { createRng, deriveSeed } from './rng.js';
import { resolveAdjustment, balanceScaleMultiplier } from './withdrawal.js';
import { fitSpecificWithdrawalsToHorizon } from '../state/scenario.js';

const DEPLETION_EPSILON = 1e-6;

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

// Run a single simulation deterministically from `rng`.
// When `collectPath` is true the full per-year arrays are returned (used only
// for the handful of paths we actually chart); otherwise only summary stats.
export function simulatePath(params, rng, collectPath = false, outRealReturns = null, outOffset = 0) {
  const { numYears, distMethod, allocation, blockSize, portfolio, dynConfig, logNormal, samples } = params;

  let totalRealGrowthFactor = 1.0;
  let currentYearIndex = -1;

  let balance = portfolio.start;
  let totalWithdrawn = 0;
  let depletionYear = Infinity;

  const balances = collectPath ? [balance] : null;
  const withdrawals = collectPath ? [] : null;
  const returns = collectPath ? [] : null;
  const unadjustedWithdrawals = collectPath ? [] : null;

  const sampleYears = samples ? samples.years : null;
  const sampleLen = sampleYears ? sampleYears.length : 0;

  const fittedWithdrawals =
    portfolio.strategy === 'specific'
      ? fitSpecificWithdrawalsToHorizon(portfolio.specificWithdrawals || [], numYears)
      : null;

  // Log-normal setup (only used when distMethod === 'lognormal').
  // Assets/inflation ordered to match the correlation Cholesky factor.
  let lnAssets = null;
  let lnChol = null;
  let lnAlloc = null;
  let lnPhi = 0;
  let lnPrevZ = null;
  if (distMethod === 'lognormal') {
    lnAssets = [
      logNormal.usLgGrowth,
      logNormal.usLgValue,
      logNormal.usSmMid,
      logNormal.exUs,
      logNormal.bond,
      logNormal.cash,
      logNormal.inflation,
    ];
    lnAlloc = [
      allocation.usLgGrowth,
      allocation.usLgValue,
      allocation.usSmMid,
      allocation.exUs,
      allocation.bond,
      allocation.cash,
    ];
    lnChol = logNormal.chol || null;
    // Block size drives year-to-year smoothing via an AR(1) on the standard
    // normals: φ = 1 − 1/blockSize (blockSize 1 ⇒ φ=0 ⇒ independent years).
    lnPhi = blockSize > 1 ? 1 - 1 / blockSize : 0;
  }

  for (let j = 0; j < numYears; j++) {
    let portfolioReturn;
    let inflation;

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
        portfolioReturn += rng.logNormalFromZ(lnAssets[k].mean, lnAssets[k].stdDev, z[k]) * lnAlloc[k];
      }
      inflation = rng.logNormalFromZ(lnAssets[6].mean, lnAssets[6].stdDev, z[6]);
    } else {
      // Historical resampling via a stationary (circular) block bootstrap.
      // Each year we either continue the current run of consecutive years or,
      // with probability 1/blockSize, jump to a new random start year. This makes
      // the run lengths random (geometric) with an *average* of blockSize years,
      // so there are no rigid block boundaries. Wrapping past the final year back
      // to the first keeps every year equally likely (removes end-of-range bias).
      const restartProb = blockSize > 1 ? 1 / blockSize : 1;
      if (currentYearIndex < 0 || rng.uniform() < restartProb) {
        currentYearIndex = Math.floor(rng.uniform() * sampleLen);
      } else {
        currentYearIndex = (currentYearIndex + 1) % sampleLen;
      }

      const yearData = sampleYears[currentYearIndex];
      const usLgGrowthReturn = yearData.us_lg_growth / 100;
      const usLgValueReturn = yearData.us_lg_value / 100;
      const usSmMidReturn = yearData.us_sm_mid / 100;
      const exUsReturn = yearData.ex_us / 100;
      const bondReturn = yearData.bond / 100;
      const cashReturn = yearData.cash / 100;
      inflation = yearData.inflation / 100;

      portfolioReturn =
        usLgGrowthReturn * allocation.usLgGrowth +
        usLgValueReturn * allocation.usLgValue +
        usSmMidReturn * allocation.usSmMid +
        exUsReturn * allocation.exUs +
        bondReturn * allocation.bond +
        cashReturn * allocation.cash;
    }

    if (returns) returns.push(portfolioReturn);

    const realReturn = (1 + portfolioReturn) / (1 + inflation) - 1;
    if (outRealReturns) outRealReturns[outOffset + j] = realReturn;
    totalRealGrowthFactor *= 1 + realReturn;

    balance = balance * (1 + realReturn);

    const adjAmount = dynConfig.enabled 
      ? resolveAdjustment(balance, portfolioReturn * 100, dynConfig) 
      : 0;

    let targetWithdrawal;
    let unadjustedTarget;
    let baseVal;
    if (portfolio.strategy === 'specific') {
      baseVal = fittedWithdrawals[j];
      targetWithdrawal = baseVal + adjAmount;
      unadjustedTarget = baseVal;
    } else {
      baseVal = portfolio.base;
      // Front-loading: scale the whole target by an annual real-change factor (j=0 in
      // year one, so the first year is unscaled), then add a flat early-years bonus.
      const ageFactor = (1 + (portfolio.spendChangeRate || 0)) ** j;
      targetWithdrawal = (portfolio.base + adjAmount) * ageFactor;
      unadjustedTarget = portfolio.base * ageFactor;
      if (j < portfolio.goGoYears) {
        targetWithdrawal += portfolio.goGoBonus;
        unadjustedTarget += portfolio.goGoBonus;
      }
    }

    // Balance-based spending scale: smoothly cut the whole withdrawal as the
    // balance slides below the floor, or boost it as wealth grows past the
    // ceiling. Deposits (negative targets) are never scaled, and the minimum
    // withdrawal below still acts as the backstop after scaling.
    if (dynConfig.enabled && targetWithdrawal > 0) {
      targetWithdrawal *= balanceScaleMultiplier(balance, portfolio);
    }

    if (baseVal >= 0 && targetWithdrawal < 0) {
      targetWithdrawal = 0;
    }
    if (baseVal >= 0 && unadjustedTarget < 0) {
      unadjustedTarget = 0;
    }

    const yearFloor = portfolio.withdrawalFloorSeries?.[j] ?? 0;
    if (unadjustedTarget >= 0 && yearFloor > 0) {
      unadjustedTarget = Math.max(unadjustedTarget, yearFloor);
    }

    let actualWithdrawal;
    if (targetWithdrawal < 0) {
      // Negative target = deposit (adds to balance); floor does not apply.
      actualWithdrawal = targetWithdrawal;
      balance -= actualWithdrawal;
    } else {
      if (yearFloor > 0) {
        targetWithdrawal = Math.max(targetWithdrawal, yearFloor);
      }
      actualWithdrawal = Math.min(balance, targetWithdrawal);
      balance -= actualWithdrawal;
    }

    totalWithdrawn += actualWithdrawal;

    if (depletionYear === Infinity && balance <= DEPLETION_EPSILON) {
      depletionYear = j + 1;
    }

    if (balances) balances.push(balance);
    if (withdrawals) withdrawals.push(actualWithdrawal);
    if (unadjustedWithdrawals) unadjustedWithdrawals.push(unadjustedTarget);
  }

  const avgReturn = totalRealGrowthFactor ** (1 / numYears) - 1;

  const summary = {
    avgReturn,
    finalBalance: balance,
    totalWithdrawn,
    depletionYear,
  };

  if (collectPath) {
    summary.path = { balances, withdrawals, returns, unadjustedWithdrawals };
  }

  return summary;
}

// Run the full Monte Carlo. Returns summary stats packed into typed arrays
// (memory-light) plus the baseSeed needed to regenerate any individual path.
// `onProgress(fraction)` is called periodically (0..1).
export function runMonteCarlo(params, { onProgress } = {}) {
  const { numSimulations, numYears } = params;
  const baseSeed = params.seed >>> 0;

  const avgReturn = new Float64Array(numSimulations);
  const finalBalance = new Float64Array(numSimulations);
  const totalWithdrawn = new Float64Array(numSimulations);
  const depletionYear = new Float64Array(numSimulations);
  const allYearsReturns = new Float64Array(numSimulations * numYears);

  const progressEvery = Math.max(1, Math.floor(numSimulations / 100));

  for (let i = 0; i < numSimulations; i++) {
    const rng = createRng(deriveSeed(baseSeed, i));
    const s = simulatePath(params, rng, false, allYearsReturns, i * numYears);
    avgReturn[i] = s.avgReturn;
    finalBalance[i] = s.finalBalance;
    totalWithdrawn[i] = s.totalWithdrawn;
    depletionYear[i] = s.depletionYear === Infinity ? params.numYears + 1 : s.depletionYear;

    if (onProgress && i % progressEvery === 0) {
      onProgress(i / numSimulations);
    }
  }

  if (onProgress) onProgress(1);

  return { baseSeed, numSimulations, avgReturn, finalBalance, totalWithdrawn, depletionYear, allYearsReturns };
}

// Regenerate the full path for a specific simulation index (exact, thanks to
// deterministic per-simulation seeding).
export function regeneratePath(params, baseSeed, index) {
  const rng = createRng(deriveSeed(baseSeed >>> 0, index));
  return simulatePath(params, rng, true);
}
