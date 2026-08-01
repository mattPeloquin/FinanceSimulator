// Build worker params from Accumulation session state + history samples.

import { ALLOCATION_KEYS } from './session.js';
import {
  allocationFromConfig,
  ALLOCATION_ENGINE_KEYS,
} from '../../core/accumulation.js';
import {
  getSampleYears,
  computeProfiles,
  profilesToScenarioFields,
  correlationCholesky,
  computeStandardizedYears,
} from '../../core/history.js';

// Keys match profilesToScenarioFields / Plan scenario log-normal fields.
const PROFILE_MEAN_KEYS = {
  usLgGrowth: 'usLgGrowthMean',
  usLgValue: 'usLgValueMean',
  usSmMid: 'usSmMidMean',
  exUs: 'exUsMean',
  bond: 'bondReturnMean',
  cash: 'cashReturnMean',
  inflation: 'inflationMean',
};

const PROFILE_STD_KEYS = {
  usLgGrowth: 'usLgGrowthStdDev',
  usLgValue: 'usLgValueStdDev',
  usSmMid: 'usSmMidStdDev',
  exUs: 'exUsStdDev',
  bond: 'bondReturnStdDev',
  cash: 'cashReturnStdDev',
  inflation: 'inflationStdDev',
};

/** Convert scenario % profile fields into logNormal decimals for the engine. */
export function profilesToLogNormal(profiles) {
  const logNormal = {};
  for (const key of Object.keys(PROFILE_MEAN_KEYS)) {
    const meanPct = Number(profiles?.[PROFILE_MEAN_KEYS[key]]);
    const stdPct = Number(profiles?.[PROFILE_STD_KEYS[key]]);
    logNormal[key] = {
      mean: (Number.isFinite(meanPct) ? meanPct : 0) / 100,
      stdDev: (Number.isFinite(stdPct) ? stdPct : 0) / 100,
    };
  }
  return logNormal;
}

/** Ensure profiles exist; derive from the selected year range when missing. */
export function ensureProfiles(state) {
  if (state.profiles && typeof state.profiles === 'object') return state.profiles;
  const years = getSampleYears(state.startYear, state.endYear);
  if (!years.length) return null;
  return profilesToScenarioFields(computeProfiles(years));
}

/**
 * Build the pure params object posted to the accumulation worker.
 */
export function buildAccumulationParams(state, { seed } = {}) {
  const samples = {
    startYear: state.startYear,
    endYear: state.endYear,
    years: getSampleYears(state.startYear, state.endYear),
  };
  const profiles = ensureProfiles(state) || {};
  const logNormal = profilesToLogNormal(profiles);
  logNormal.chol = samples.years.length >= 2
    ? correlationCholesky(samples.years)
    : null;

  const allocation = allocationFromConfig(state.allocation, ALLOCATION_KEYS);

  return {
    numYears: state.numYears,
    numSimulations: state.numSimulations,
    seed: seed >>> 0,
    distMethod: state.distMethod,
    blockSize: state.blockSize,
    allocation,
    allocationKeys: ALLOCATION_KEYS,
    allocationOverTimeTiers: state.allocationOverTimeTiers,
    sleeves: state.sleeves,
    events: state.events,
    afterTaxDragRate: state.afterTaxDragRate,
    balancesInThousands: true,
    samples,
    logNormal,
    scaledHistoricalShocks: samples.years.length
      ? computeStandardizedYears(samples.years)
      : null,
    scaledHistoricalSmoothing: 0,
    engineKeys: ALLOCATION_ENGINE_KEYS,
  };
}
