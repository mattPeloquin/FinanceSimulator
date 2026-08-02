// Build worker params from Accumulate session state + history samples.

import { ALLOCATION_KEYS } from './session.js';
import {
  allocationFromConfig,
  ALLOCATION_ENGINE_KEYS,
} from '../../core/accumulation.js';
import {
  correlationCholesky,
  computeStandardizedYears,
  profilesToLogNormal,
} from '../../core/history.js';
import {
  buildSamplesAndProfiles,
  pickReturnsAllocationSlice,
  canonicalizeDistMethod,
} from '../../state/returnsAllocationSlice.js';

export { profilesToLogNormal };

/** Ensure profiles exist; derive from the selected year range when missing. */
export function ensureProfiles(state) {
  if (state.profiles && typeof state.profiles === 'object') return state.profiles;
  const { profiles } = buildSamplesAndProfiles(pickReturnsAllocationSlice(state), {
    forceProfiles: true,
  });
  return profiles;
}

/**
 * Build the pure params object posted to the accumulate worker.
 */
export function buildAccumulateParams(state, { seed } = {}) {
  const slice = pickReturnsAllocationSlice(state);
  const { samples, profiles: derived } = buildSamplesAndProfiles(slice);
  const profiles = ensureProfiles({ ...state, profiles: state.profiles || derived }) || {};
  const logNormal = profilesToLogNormal(profiles);
  logNormal.chol = samples.years.length >= 2
    ? correlationCholesky(samples.years)
    : null;

  const allocation = allocationFromConfig(state.allocation, ALLOCATION_KEYS);

  return {
    numYears: state.numYears,
    numSimulations: state.numSimulations,
    seed: seed >>> 0,
    distMethod: canonicalizeDistMethod(state.distMethod),
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
