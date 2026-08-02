// Public portfolio API — engines and presentation go through here.
// No caller outside src/portfolio/ should name individual market segments.

import { createRng, logNormalMuSigma, applyLogNormalMuSigma } from '../core/rng.js';
import {
  SLEEVES,
  INFLATION,
  listSleeves,
  getSleeveMeta,
  engineKeys,
  logNormalEngineOrder,
  pctKeys,
  historyKeysInOrder,
} from './registry.js';
import {
  correlationCholesky,
  computeStandardizedYears,
  profilesToLogNormal,
  profilesToScenarioFields,
  computeProfiles,
  getSampleYears,
} from './historyMath.js';
import {
  buildAllocationOverTimeSeries,
  allocationPctToEngine,
  renormalizeAllocation,
} from './allocationMath.js';
import {
  normalizePortfolio,
  createPortfolio,
  defaultPortfolio,
  buildSamplesAndProfiles,
  canonicalizeDistMethod,
  isValidYearRange,
  pickReturnsAllocationSlice,
  sliceFromWithdrawScenario,
} from './slice.js';

export {
  listSleeves,
  getSleeveMeta,
  createPortfolio,
  normalizePortfolio,
  defaultPortfolio,
  canonicalizeDistMethod,
  isValidYearRange,
  pickReturnsAllocationSlice,
  sliceFromWithdrawScenario,
  buildSamplesAndProfiles,
  engineKeys,
  pctKeys,
  historyKeysInOrder,
};

function nextBootstrapIndex(rng, currentIndex, poolLen, blockSize) {
  const restartProb = blockSize > 1 ? 1 / blockSize : 1;
  if (currentIndex < 0 || rng.uniform() < restartProb) {
    return Math.floor(rng.uniform() * poolLen);
  }
  return (currentIndex + 1) % poolLen;
}

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

/**
 * Stateful year-by-year real portfolio return sampler (MC SOR).
 * Mutates `state` (bootstrap cursor / AR(1) z) across years on one path.
 *
 * @param {object} marketParams - from buildMarketParams
 * @param {object} rng - RNG with uniform()/normal()
 * @param {object} yearAlloc - engine decimal weights for this year
 * @param {number} yearIndex - year index on the path
 * @param {object} state - mutable { bootIndex, lnPrevZ }
 */
export function sampleYearReturn(marketParams, rng, yearAlloc, yearIndex, state) {
  const {
    distMethod,
    logNormal,
    samples,
    scaledHistoricalShocks,
    scaledHistoricalSmoothing,
    blockSize,
    sequenceStart,
  } = marketParams;

  const sleeveEngines = engineKeys();
  const lnOrder = logNormalEngineOrder();
  const nAssets = sleeveEngines.length;
  const nSeries = lnOrder.length; // sleeves + inflation

  const weights = sleeveEngines.map((key) => yearAlloc?.[key] || 0);

  let portfolioReturn = 0;
  let inflation;

  if (distMethod === 'lognormal') {
    const eps = new Array(nSeries);
    for (let k = 0; k < nSeries; k++) eps[k] = rng.normal();
    const c = logNormal?.chol ? matVec(logNormal.chol, eps) : eps;
    const phi = blockSize > 1 ? 1 - 1 / blockSize : 0;
    let z;
    if (!state.lnPrevZ || phi === 0) {
      z = c;
    } else {
      const a = Math.sqrt(1 - phi * phi);
      z = new Array(nSeries);
      for (let k = 0; k < nSeries; k++) z[k] = phi * state.lnPrevZ[k] + a * c[k];
    }
    state.lnPrevZ = z;
    for (let k = 0; k < nAssets; k++) {
      const key = lnOrder[k];
      const { mu, sigma } = logNormalMuSigma(logNormal[key].mean, logNormal[key].stdDev);
      portfolioReturn += applyLogNormalMuSigma(mu, sigma, z[k]) * weights[k];
    }
    const infKey = INFLATION.engineKey;
    const inf = logNormalMuSigma(logNormal[infKey].mean, logNormal[infKey].stdDev);
    inflation = applyLogNormalMuSigma(inf.mu, inf.sigma, z[nAssets]);
  } else if (distMethod === 'scaledHistorical') {
    const shockPool = scaledHistoricalShocks;
    const shockLen = shockPool ? shockPool.length : 0;
    state.bootIndex = nextBootstrapIndex(rng, state.bootIndex ?? -1, shockLen, blockSize || 1);
    const z = shockPool[state.bootIndex];
    const smoothing = scaledHistoricalSmoothing ?? 0;
    const targets = lnOrder.map((key) => logNormal[key]);
    for (let k = 0; k < nAssets; k++) {
      const { mean: m, stdDev: s } = targets[k];
      const jitter = smoothing > 0 ? rng.normal() * smoothing * s : 0;
      portfolioReturn += (m + z[k] * s + jitter) * weights[k];
    }
    const inf = targets[nAssets];
    const infJitter = smoothing > 0 ? rng.normal() * smoothing * inf.stdDev : 0;
    inflation = inf.mean + z[nAssets] * inf.stdDev + infJitter;
  } else {
    const sampleYears = samples?.years || [];
    const sampleLen = sampleYears.length;
    if (sampleLen === 0) {
      return { realReturn: 0, portfolioReturn: 0, inflation: 0 };
    }
    state.bootIndex =
      distMethod === 'historicalSequence'
        ? ((sequenceStart ?? 0) + yearIndex) % sampleLen
        : nextBootstrapIndex(rng, state.bootIndex ?? -1, sampleLen, blockSize || 1);
    const yearData = sampleYears[state.bootIndex];
    inflation = yearData[INFLATION.historyKey] / 100;
    for (let k = 0; k < nAssets; k++) {
      const histKey = SLEEVES[k].historyKey;
      portfolioReturn += (yearData[histKey] / 100) * weights[k];
    }
  }

  const realReturn = (1 + portfolioReturn) / (1 + inflation) - 1;
  return { realReturn, portfolioReturn, inflation };
}

/** Alias matching prior accumulation export name. */
export const sampleRealPortfolioReturn = sampleYearReturn;

/**
 * Build engine market params from a nested portfolio slice.
 * @param {object} portfolio - nested slice
 * @param {object} [opts]
 * @param {number} [opts.horizonYears] - for allocationSeries length
 * @param {object} [opts.flatProfiles] - optional flat mean/std fields (Withdraw scenario)
 * @param {number} [opts.smoothingIsPercent] - if true, treat slice smoothing as already 0-1
 */
export function buildMarketParams(portfolio, opts = {}) {
  const p = normalizePortfolio(portfolio);
  const { samples, profiles } = buildSamplesAndProfiles(p, {
    forceProfiles: !p.profilesEdited && !opts.flatProfiles,
  });

  // Prefer explicit flat profiles (Withdraw) then nested profiles.
  let profileFields = opts.flatProfiles || profiles;
  if (!profileFields && samples.years?.length) {
    profileFields = profilesToScenarioFields(computeProfiles(samples.years));
  }

  const logNormal = profilesToLogNormal(profileFields || {});
  logNormal.chol = samples.years?.length ? correlationCholesky(samples.years) : null;

  const allocation = allocationPctToEngine(p.allocation);
  const horizonYears = Math.max(1, opts.horizonYears || 1);
  const allocationSeries = buildAllocationOverTimeSeries(
    p.allocationOverTimeTiers,
    horizonYears,
    allocation,
    pctKeys(),
  );

  let smoothing = Number(p.scaledHistoricalSmoothing) || 0;
  if (opts.smoothingIsPercent && smoothing > 1) smoothing /= 100;

  return {
    distMethod: canonicalizeDistMethod(p.distMethod),
    blockSize: p.blockSize || 1,
    samples,
    logNormal,
    allocation,
    allocationSeries,
    scaledHistoricalShocks: samples.years?.length
      ? computeStandardizedYears(samples.years)
      : null,
    scaledHistoricalSmoothing: Math.min(Math.max(smoothing, 0), 1),
    engineKeys: engineKeys(),
  };
}

export function buildAllocationSeries(portfolio, horizonYears) {
  const p = normalizePortfolio(portfolio);
  const allocation = allocationPctToEngine(p.allocation);
  return buildAllocationOverTimeSeries(
    p.allocationOverTimeTiers,
    horizonYears,
    allocation,
    pctKeys(),
  );
}

/** Short labels for closed Investment Planning accordion pills (Withdraw parity). */
const DIST_METHOD_PILL = {
  resampling: 'Historical resampling',
  scaledHistorical: 'Smoothed historical',
  lognormal: 'Log-normal',
  historicalSequence: 'Historical sequence',
};

/**
 * Soft-link / section summary blurb.
 */
export function summarizePortfolio(portfolio) {
  const p = normalizePortfolio(portfolio);
  const sleeves = listSleeves().map((s) => ({
    key: s.pctKey,
    label: s.label,
    pct: Number(p.allocation[s.pctKey]) || 0,
    color: s.color,
    bucket: s.bucket,
  }));
  const tierCount = Array.isArray(p.allocationOverTimeTiers)
    ? p.allocationOverTimeTiers.length
    : 1;
  const mixParts = sleeves
    .filter((s) => s.pct > 0)
    .map((s) => `${s.label} ${Math.round(s.pct)}%`);
  return {
    startYear: p.startYear,
    endYear: p.endYear,
    distMethod: p.distMethod,
    distMethodLabel: DIST_METHOD_PILL[p.distMethod] || p.distMethod,
    blockSize: p.blockSize,
    sleeves,
    tierCount,
    mixLabel: mixParts.join(' · ') || '—',
    yearLabel: `${p.startYear}–${p.endYear}`,
  };
}

/**
 * Two-line closed-state pill for the Investment Planning accordion.
 * Line 1: stock/bond-cash rollup (e.g. "60/40"). Line 2: method · years.
 */
export function formatInvestmentAccordionPill(portfolio) {
  const p = normalizePortfolio(portfolio);
  const alloc = allocationPresentation(p).label;
  const summary = summarizePortfolio(p);
  return `${alloc}\n${summary.distMethodLabel} · ${summary.yearLabel}`;
}

/**
 * Report / donut presentation — pre-resolved labels and colors.
 * Accepts a nested portfolio or anything allocationPresentation can adapt.
 */
export function allocationPresentation(portfolioOrScenario) {
  let allocationPct;
  if (portfolioOrScenario?.allocation && typeof portfolioOrScenario.allocation === 'object') {
    allocationPct = normalizePortfolio(portfolioOrScenario).allocation;
  } else {
    // Flat Withdraw scenario: pct keys at top level
    allocationPct = {};
    for (const s of SLEEVES) {
      allocationPct[s.pctKey] = Number(portfolioOrScenario?.[s.pctKey]) || 0;
    }
  }

  const sleeves = listSleeves().map((s) => ({
    key: s.pctKey,
    label: s.label,
    pct: Number(allocationPct[s.pctKey]) || 0,
    color: s.color,
    bucket: s.bucket,
    chartKey: s.historyKey,
  }));

  let stocksPct = 0;
  let bondCashPct = 0;
  for (const s of sleeves) {
    if (s.bucket === 'stock') stocksPct += s.pct;
    else bondCashPct += s.pct;
  }
  stocksPct = Math.round(stocksPct);
  bondCashPct = Math.round(bondCashPct);

  return {
    stocksPct,
    bondCashPct,
    label: `${stocksPct}/${bondCashPct}`,
    sleeves,
  };
}

/**
 * Generate SOR Lab sweep variable stubs from the registry (no per-class tables).
 * Consumers wire apply/isLive using pctKey / meanKey / stdKey from each entry.
 */
export function labVariablesFromRegistry() {
  const allocationVars = listSleeves().map((s) => ({
    kind: 'allocationPct',
    id: s.pctKey,
    pctKey: s.pctKey,
    label: s.label,
    engineKey: s.engineKey,
  }));
  const meanOffsetVars = listSleeves().map((s) => ({
    kind: 'meanOffset',
    id: `${s.engineKey}ReturnOffset`,
    meanKey: s.meanKey,
    label: `${s.label} return offset`,
  }));
  // Inflation mean offset
  meanOffsetVars.push({
    kind: 'meanOffset',
    id: 'inflationOffset',
    meanKey: INFLATION.meanKey,
    label: 'Inflation offset',
  });
  const volScaleVars = listSleeves().map((s) => ({
    kind: 'volScale',
    id: `${s.engineKey}VolScale`,
    stdKey: s.stdKey,
    label: `${s.label} vol scale`,
  }));
  volScaleVars.push({
    kind: 'volScale',
    id: 'inflationVolScale',
    stdKey: INFLATION.stdKey,
    label: 'Inflation vol scale',
  });
  return { allocationVars, meanOffsetVars, volScaleVars, sleeves: listSleeves() };
}

/** Resolve theme color for a history/chart key from the registry. */
export function themeAssetColor(historyOrEngineKey) {
  const sleeve = getSleeveMeta(historyOrEngineKey);
  if (sleeve) return sleeve.color;
  return null;
}

/** Ensure historical rows contain every registry history key (test helper). */
export function assertHistoryAligned(data) {
  const keys = historyKeysInOrder();
  for (const [year, row] of Object.entries(data)) {
    for (const key of keys) {
      if (!(key in row) || !Number.isFinite(Number(row[key]))) {
        throw new Error(`historicalData[${year}] missing or non-numeric "${key}"`);
      }
    }
  }
  return true;
}

// Re-export createRng for tests that build market paths.
export { createRng, renormalizeAllocation, allocationPctToEngine, getSampleYears };
