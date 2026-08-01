// Build worker payload from SS Timing session state.

import {
  buildSamplesAndProfiles,
  pickReturnsAllocationSlice,
  canonicalizeDistMethod,
  ALLOCATION_PCT_KEYS,
} from '../../state/returnsAllocationSlice.js';
import {
  profilesToLogNormal,
  correlationCholesky,
  computeStandardizedYears,
} from '../../core/history.js';
import { allocationFromConfig, ALLOCATION_ENGINE_KEYS } from '../../core/accumulation.js';
import { fraFromBirthYear, estimatePiaFromEarnings } from '../../core/socialSecurity.js';

export function buildSsTimingWorkerPayload(state, { seed } = {}) {
  const personA = resolvePerson(state.personA);
  const personB = state.couple ? resolvePerson(state.personB) : null;

  const slice = pickReturnsAllocationSlice(state);
  const { samples, profiles: derived } = buildSamplesAndProfiles(slice, {
    forceProfiles: !state.profiles,
  });
  const profiles = state.profiles || derived || {};
  const logNormal = profilesToLogNormal(profiles);
  logNormal.chol = samples.years.length >= 2
    ? correlationCholesky(samples.years)
    : null;

  const allocation = allocationFromConfig(state.allocation, ALLOCATION_PCT_KEYS);
  const runSeed = (seed ?? state.seed ?? (Math.random() * 0xffffffff)) >>> 0;

  return {
    type: 'ssTiming',
    deterministicInput: {
      couple: !!state.couple,
      personA,
      personB,
      endAges: state.endAges,
    },
    marketParams: {
      seed: runSeed,
      distMethod: canonicalizeDistMethod(state.distMethod),
      blockSize: state.blockSize,
      allocation,
      allocationKeys: ALLOCATION_PCT_KEYS,
      allocationOverTimeTiers: state.allocationOverTimeTiers,
      samples,
      logNormal,
      scaledHistoricalShocks: samples.years.length
        ? computeStandardizedYears(samples.years)
        : null,
      scaledHistoricalSmoothing: state.scaledHistoricalSmoothing || 0,
      engineKeys: ALLOCATION_ENGINE_KEYS,
    },
    bridge: {
      enabled: state.bridge?.enabled !== false,
      startBalance: state.bridge?.startBalance || 0,
      annualSpend: state.bridge?.annualSpend || 0,
      currentAge: Math.min(
        personA.currentAge,
        personB ? personB.currentAge : personA.currentAge,
      ),
    },
    policy: state.policy,
    numSimulations: state.numSimulations,
    numCores: 1,
    subWorkerPorts: [],
  };
}

function resolvePerson(p) {
  let piaMonthly = Number(p.piaMonthly) || 0;
  if (Array.isArray(p.earningsGrid) && p.earningsGrid.length > 0) {
    const est = estimatePiaFromEarnings(p.earningsGrid);
    if (est.piaMonthly > 0) piaMonthly = est.piaMonthly;
  }
  return {
    label: p.label,
    birthYear: p.birthYear,
    currentAge: p.currentAge,
    piaMonthly,
    fra: p.fra || fraFromBirthYear(p.birthYear),
    claimAge: p.claimAge,
    planningEndAge: p.planningEndAge,
  };
}
