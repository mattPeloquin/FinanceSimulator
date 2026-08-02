// Flat Withdraw scenario ↔ nested portfolio slice adapters.
// This is the only place outside registry that may mention flat field names
// derived from the registry (via SLEEVES metadata).

import { SLEEVES, INFLATION, pctKeys, profileFieldKeys } from './registry.js';
import {
  normalizePortfolio,
  normalizeAllocationPct,
  sliceFromWithdrawScenario,
  defaultPortfolio,
} from './slice.js';
import { buildMarketParams, allocationPresentation, summarizePortfolio } from './api.js';
import {
  profilesToScenarioFields,
  computeProfiles,
  correlationCholesky,
  computeStandardizedYears,
  profilesToLogNormal,
} from './historyMath.js';
import { buildAllocationOverTimeSeries, allocationPctToEngine } from './allocationMath.js';

export { sliceFromWithdrawScenario };

/** Nested portfolio from a flat Withdraw-style scenario. */
export function fromWithdrawScenario(scenario) {
  const slice = sliceFromWithdrawScenario(scenario);
  // Carry flat profile fields into nested profiles when present.
  const hasProfiles = SLEEVES.some(
    (s) => scenario?.[s.meanKey] != null && scenario[s.meanKey] !== '',
  );
  if (hasProfiles) {
    const profiles = {};
    for (const key of profileFieldKeys()) {
      const n = Number(scenario[key]);
      profiles[key] = Number.isFinite(n) ? n : null;
    }
    slice.profiles = profiles;
    slice.profilesEdited = true;
  }
  return slice;
}

/**
 * Patch object to merge a nested portfolio back onto a flat Withdraw scenario.
 * Does not mutate the scenario; caller assigns fields.
 */
export function toWithdrawPatch(portfolio) {
  const p = normalizePortfolio(portfolio);
  const patch = {
    startYear: p.startYear,
    endYear: p.endYear,
    distMethod: p.distMethod,
    blockSize: p.blockSize,
    // Withdraw UI stores 0–100
    scaledHistoricalSmoothing: Math.round((p.scaledHistoricalSmoothing || 0) * 100),
    allocationOverTimeTiers: p.allocationOverTimeTiers,
  };
  for (const key of pctKeys()) {
    patch[key] = p.allocation[key];
  }
  if (p.profiles) {
    for (const key of profileFieldKeys()) {
      if (p.profiles[key] != null) patch[key] = p.profiles[key];
    }
  }
  return patch;
}

/** Apply portfolio onto a scenario object (mutates and returns it). */
export function applyToWithdrawScenario(scenario, portfolio) {
  Object.assign(scenario, toWithdrawPatch(portfolio));
  return scenario;
}

/**
 * Build Withdraw engine sim market fields from a flat scenario + samples.
 * Used by buildSimParams to avoid hard-coding sleeve keys there.
 */
export function buildWithdrawMarketBlock(scenario, samples, maxYears) {
  const portfolio = fromWithdrawScenario(scenario);
  // Prefer live samples from history refresh when provided.
  if (samples?.years?.length) {
    portfolio.startYear = samples.startYear ?? portfolio.startYear;
    portfolio.endYear = samples.endYear ?? portfolio.endYear;
  }

  const flatProfiles = {};
  for (const key of profileFieldKeys()) {
    flatProfiles[key] = scenario[key];
  }

  const allocation = allocationPctToEngine(normalizeAllocationPct(scenario));
  const fallbackMix = normalizeAllocationPct(scenario);
  const tiers = Array.isArray(scenario.allocationOverTimeTiers)
    ? scenario.allocationOverTimeTiers
    : [{ ...fallbackMix }];

  const years = samples?.years || [];
  const logNormal = profilesToLogNormal(flatProfiles);
  logNormal.chol = years.length ? correlationCholesky(years) : null;

  return {
    distMethod: portfolio.distMethod,
    blockSize: scenario.blockSize || 1,
    allocation,
    allocationSeries: buildAllocationOverTimeSeries(tiers, maxYears, allocation, pctKeys()),
    logNormal,
    scaledHistoricalShocks: years.length ? computeStandardizedYears(years) : null,
    // Withdraw stores smoothing as 0–100
    scaledHistoricalSmoothing: Math.min(
      Math.max(Number(scenario.scaledHistoricalSmoothing) / 100, 0),
      1,
    ),
    samples: samples || { startYear: portfolio.startYear, endYear: portfolio.endYear, years: [] },
    engineKeys: Object.keys(allocation),
  };
}

export function allocationPresentationFromWithdraw(scenario) {
  return allocationPresentation(scenario);
}

export function summarizeWithdrawScenario(scenario) {
  return summarizePortfolio(fromWithdrawScenario(scenario));
}

/** Default flat allocation/profile fields for SCENARIO_DEFAULTS construction. */
export function defaultWithdrawPortfolioFields() {
  const p = defaultPortfolio();
  const patch = toWithdrawPatch(p);
  // Profile means/stds start null (auto-filled from history) in Withdraw.
  for (const s of SLEEVES) {
    patch[s.meanKey] = null;
    patch[s.stdKey] = null;
  }
  patch[INFLATION.meanKey] = null;
  patch[INFLATION.stdKey] = null;
  return patch;
}

export {
  buildMarketParams,
  profilesToScenarioFields,
  computeProfiles,
};
