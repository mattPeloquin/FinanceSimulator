// Shared returns + allocation state slice for Plan, Accumulate, and SS Timing.
// Pure (no DOM). Features embed this slice or project flat Plan scenario fields
// into / out of it.

import { minAvailableYear, maxAvailableYear } from '../data/historicalData.js';
import {
  getSampleYears,
  computeProfiles,
  profilesToScenarioFields,
} from '../core/history.js';

/** Scenario % field names for the six investable classes. */
export const ALLOCATION_PCT_KEYS = [
  'usLgGrowthAllocation',
  'usLgValueAllocation',
  'usSmMidAllocation',
  'exUsAllocation',
  'bondAllocation',
  'cashAllocation',
];

export const YEAR_RANGE = { minYear: minAvailableYear, maxYear: maxAvailableYear };

/** Canonical engine distMethod values. */
export const DIST_METHODS = [
  'resampling',
  'lognormal',
  'scaledHistorical',
  'historicalSequence',
];

/**
 * Map legacy / UI aliases onto the canonical distMethod.
 * Accumulate historically used `historical` for bootstrap resampling.
 */
export function canonicalizeDistMethod(raw, fallback = 'lognormal') {
  if (raw === 'historical') return 'resampling';
  if (DIST_METHODS.includes(raw)) return raw;
  return fallback;
}

export function defaultAllocationPct() {
  return {
    usLgGrowthAllocation: 25,
    usLgValueAllocation: 25,
    usSmMidAllocation: 10,
    exUsAllocation: 15,
    bondAllocation: 20,
    cashAllocation: 5,
  };
}

/**
 * Default slice used when a feature has no saved returns/allocation state.
 * @param {Partial<object>} [overrides]
 */
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

export function normalizeAllocationPct(raw) {
  const out = {};
  for (const key of ALLOCATION_PCT_KEYS) {
    const n = Number(raw?.[key]);
    out[key] = Number.isFinite(n) ? n : 0;
  }
  return out;
}

/**
 * Normalize a returns/allocation slice from persisted or form state.
 * @param {object|null|undefined} raw
 * @param {object} [defaults]
 */
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

/** True when the inclusive year range is within the historical dataset. */
export function isValidYearRange(startYear, endYear) {
  return (
    Number.isFinite(startYear)
    && Number.isFinite(endYear)
    && startYear <= endYear
    && startYear >= YEAR_RANGE.minYear
    && endYear <= YEAR_RANGE.maxYear
  );
}

/**
 * Build sample years + optional log-normal profile fields for a slice.
 * @returns {{ samples: { startYear, endYear, years }, profiles: object|null }}
 */
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

/**
 * Pick the returns/allocation fields out of a larger feature state object.
 */
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

/**
 * Project a flat Plan-style scenario onto the shared slice shape.
 */
export function sliceFromWithdrawScenario(scenario) {
  const allocation = normalizeAllocationPct(scenario);
  return normalizeReturnsAllocationSlice({
    startYear: scenario?.startYear,
    endYear: scenario?.endYear,
    distMethod: scenario?.distMethod,
    blockSize: scenario?.blockSize,
    scaledHistoricalSmoothing: scenario?.scaledHistoricalSmoothing,
    allocation,
    allocationOverTimeTiers: scenario?.allocationOverTimeTiers,
    profiles: null,
    profilesEdited: false,
  });
}
