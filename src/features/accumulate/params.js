// Build worker params from Accumulate session state + resolved portfolio market.

import { ALLOCATION_KEYS } from './session.js';
import { allocationFromConfig } from '../../core/accumulation.js';
import { resolveFeatureMarket } from '../../portfolio/resolve.js';
import {
  buildSamplesAndProfiles,
  pickReturnsAllocationSlice,
} from '../../state/returnsAllocationSlice.js';

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
 * Resolves linked Withdraw portfolio or local returns fields via the portfolio API.
 */
export async function buildAccumulateParams(state, { seed } = {}) {
  const runSeed = (seed ?? state.seed ?? (Math.random() * 0xffffffff)) >>> 0;
  const { marketParams, portfolio } = await resolveFeatureMarket(state, {
    horizonYears: state.numYears,
    seed: runSeed,
  });

  // Engine allocation weights come from the resolved portfolio; sleeve balances stay local.
  const allocation = marketParams.allocation
    || allocationFromConfig(portfolio.allocation || state.allocation, ALLOCATION_KEYS);

  return {
    numYears: state.numYears,
    numSimulations: state.numSimulations,
    seed: runSeed,
    distMethod: marketParams.distMethod,
    blockSize: marketParams.blockSize,
    allocation,
    allocationKeys: marketParams.allocationKeys || marketParams.engineKeys || ALLOCATION_KEYS,
    allocationOverTimeTiers: portfolio.allocationOverTimeTiers,
    sleeves: state.sleeves,
    events: state.events,
    afterTaxDragRate: state.afterTaxDragRate,
    balancesInThousands: true,
    samples: marketParams.samples,
    logNormal: marketParams.logNormal,
    scaledHistoricalShocks: marketParams.scaledHistoricalShocks,
    scaledHistoricalSmoothing: marketParams.scaledHistoricalSmoothing || 0,
    engineKeys: marketParams.engineKeys,
  };
}
