// Nested portfolio / returns-allocation slice. Pure (no DOM).

import { minAvailableYear, maxAvailableYear } from './historicalData.js';
import { getSampleYears, computeProfiles, profilesToScenarioFields } from './historyMath.js';
import { defaultAllocationPct, pctKeys } from './registry.js';

export const ALLOCATION_PCT_KEYS = pctKeys();

export const YEAR_RANGE = { minYear: minAvailableYear, maxYear: maxAvailableYear };

export const DIST_METHODS = [
  'resampling',
  'lognormal',
  'scaledHistorical',
  'historicalSequence',
];

export function canonicalizeDistMethod(raw, fallback = 'lognormal') {
  if (raw === 'historical') return 'resampling';
  if (DIST_METHODS.includes(raw)) return raw;
  return fallback;
}

export { defaultAllocationPct };

export function defaultReturnsAllocationSlice(overrides = {}) {
  const allocation = defaultAllocationPct();
  return {
    startYear: Math.max(minAvailableYear, 1970),
    endYear: maxAvailableYear,
    distMethod: 'lognormal',
    blockSize: 1,
    scaledHistoricalSmoothing: 0,
    allocation: { ...allocation },
    allocationOverTimeTiers: [{ ...allocation }],
    profiles: null,
    profilesEdited: false,
    ...overrides,
  };
}

/** Alias used by the public portfolio API. */
export const defaultPortfolio = defaultReturnsAllocationSlice;

export function normalizeAllocationPct(raw) {
  const out = {};
  for (const key of pctKeys()) {
    const n = Number(raw?.[key]);
    out[key] = Number.isFinite(n) ? n : 0;
  }
  return out;
}

export function normalizeReturnsAllocationSlice(raw, defaults = defaultReturnsAllocationSlice()) {
  const base = { ...defaults, allocation: { ...defaults.allocation } };
  if (!raw || typeof raw !== 'object') return base;

  const allocation = normalizeAllocationPct(raw.allocation || base.allocation);
  let allocationOverTimeTiers = Array.isArray(raw.allocationOverTimeTiers)
    ? raw.allocationOverTimeTiers.map((t, i, arr) => {
      const mix = normalizeAllocationPct(t);
      if (i === arr.length - 1) return mix;
      return { ...mix, years: Math.max(1, parseInt(t?.years, 10) || 1) };
    })
    : [{ ...allocation }];
  if (allocationOverTimeTiers.length === 0) {
    allocationOverTimeTiers = [{ ...allocation }];
  }

  const startYear = parseInt(raw.startYear, 10);
  const endYear = parseInt(raw.endYear, 10);

  return {
    startYear: Number.isFinite(startYear) ? startYear : base.startYear,
    endYear: Number.isFinite(endYear) ? endYear : base.endYear,
    distMethod: canonicalizeDistMethod(raw.distMethod, base.distMethod),
    blockSize: Math.max(1, Math.min(6, parseInt(raw.blockSize, 10) || base.blockSize)),
    scaledHistoricalSmoothing: Math.max(
      0,
      Math.min(1, Number(raw.scaledHistoricalSmoothing) || 0),
    ),
    allocation,
    allocationOverTimeTiers,
    profiles: raw.profiles && typeof raw.profiles === 'object' ? { ...raw.profiles } : null,
    profilesEdited: !!raw.profilesEdited,
  };
}

export const normalizePortfolio = normalizeReturnsAllocationSlice;
export const createPortfolio = (raw) => normalizeReturnsAllocationSlice(raw);

export function isValidYearRange(startYear, endYear) {
  return (
    Number.isFinite(startYear)
    && Number.isFinite(endYear)
    && startYear <= endYear
    && startYear >= YEAR_RANGE.minYear
    && endYear <= YEAR_RANGE.maxYear
  );
}

export function buildSamplesAndProfiles(slice, { forceProfiles = false } = {}) {
  const startYear = slice.startYear;
  const endYear = slice.endYear;
  if (!isValidYearRange(startYear, endYear)) {
    return { samples: { startYear, endYear, years: [] }, profiles: slice.profiles || null };
  }
  const years = getSampleYears(startYear, endYear);
  const samples = { startYear, endYear, years };
  let profiles = slice.profiles && typeof slice.profiles === 'object' ? slice.profiles : null;
  if ((!profiles || forceProfiles) && years.length) {
    profiles = profilesToScenarioFields(computeProfiles(years));
  }
  return { samples, profiles };
}

export function pickReturnsAllocationSlice(state) {
  return normalizeReturnsAllocationSlice({
    startYear: state?.startYear,
    endYear: state?.endYear,
    distMethod: state?.distMethod,
    blockSize: state?.blockSize,
    scaledHistoricalSmoothing: state?.scaledHistoricalSmoothing,
    allocation: state?.allocation,
    allocationOverTimeTiers: state?.allocationOverTimeTiers,
    profiles: state?.profiles,
    profilesEdited: state?.profilesEdited,
  });
}

export function sliceFromWithdrawScenario(scenario) {
  const allocation = normalizeAllocationPct(scenario);
  // Withdraw UI stores smoothing as 0–100%; nested slice uses 0–1.
  let smoothing = Number(scenario?.scaledHistoricalSmoothing);
  if (Number.isFinite(smoothing) && smoothing > 1) smoothing /= 100;
  return normalizeReturnsAllocationSlice({
    startYear: scenario?.startYear,
    endYear: scenario?.endYear,
    distMethod: scenario?.distMethod,
    blockSize: scenario?.blockSize,
    scaledHistoricalSmoothing: Number.isFinite(smoothing) ? smoothing : 0,
    allocation,
    allocationOverTimeTiers: scenario?.allocationOverTimeTiers,
    profiles: null,
    profilesEdited: false,
  });
}
