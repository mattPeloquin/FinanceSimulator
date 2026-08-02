// Build worker payload from Roth Convert session state.

import * as sessions from '../../state/sessions.js';
import { FEATURE_WITHDRAW } from '../../state/storageKeys.js';
import {
  buildSamplesAndProfiles,
  sliceFromWithdrawScenario,
  canonicalizeDistMethod,
  ALLOCATION_PCT_KEYS,
} from '../../state/returnsAllocationSlice.js';
import {
  profilesToLogNormal,
  correlationCholesky,
  computeStandardizedYears,
} from '../../core/history.js';
import { allocationFromConfig, ALLOCATION_ENGINE_KEYS } from '../../core/accumulation.js';
import { normalizeTaxLadder } from '../../data/taxLadderIllustrative.js';
import { toDollars } from '../../state/scenario.js';

/**
 * Resolve Plan soft-link (if any) into market params, or constant-return mode.
 * @param {object} state
 * @returns {Promise<object>} worker `input` object
 */
export async function buildRothWorkerPayload(state, { seed } = {}) {
  const runSeed = (seed ?? state.seed ?? (Math.random() * 0xffffffff)) >>> 0;
  const linked = !!(state.scenarioRef?.name);

  let returnMode = 'constant';
  let marketParams = null;
  let allocation = null;
  let allocationOverTimeTiers = [];

  if (linked) {
    const loaded = await sessions.load(
      state.scenarioRef.feature || FEATURE_WITHDRAW,
      state.scenarioRef.name,
    );
    if (!loaded?.payload) {
      throw new Error(
        `Could not load Withdraw session "${state.scenarioRef.name}". Save a scenario in Withdraw first, or clear the link to use a constant return.`,
      );
    }
    const slice = sliceFromWithdrawScenario(loaded.payload);
    const { samples, profiles: derived } = buildSamplesAndProfiles(slice, {
      forceProfiles: true,
    });
    const profiles = derived || {};
    const logNormal = profilesToLogNormal(profiles);
    logNormal.chol = samples.years.length >= 2
      ? correlationCholesky(samples.years)
      : null;
    allocation = allocationFromConfig(slice.allocation, ALLOCATION_PCT_KEYS);
    allocationOverTimeTiers = slice.allocationOverTimeTiers || [];
    returnMode = 'market';
    marketParams = {
      seed: runSeed,
      distMethod: canonicalizeDistMethod(slice.distMethod),
      blockSize: slice.blockSize,
      allocation,
      allocationKeys: ALLOCATION_PCT_KEYS,
      allocationOverTimeTiers,
      samples,
      logNormal,
      scaledHistoricalShocks: samples.years.length
        ? computeStandardizedYears(samples.years)
        : null,
      scaledHistoricalSmoothing: slice.scaledHistoricalSmoothing || 0,
      engineKeys: ALLOCATION_ENGINE_KEYS,
    };
  }

  return {
    type: 'rothConvert',
    input: {
      seed: runSeed,
      numSimulations: state.numSimulations,
      numYears: state.numYears,
      couple: !!state.couple,
      ageA: state.ageA,
      ageB: state.ageB,
      // Session money fields are $000s → dollars for the engine.
      tradBalance: toDollars(state.tradBalance),
      rothBalance: toDollars(state.rothBalance),
      taxableBalance: toDollars(state.taxableBalance),
      taxableBasis: toDollars(state.taxableBasis),
      taxableGainRate: state.taxableGainRate,
      otherTaxableIncome: toDollars(state.otherTaxableIncome),
      ladder: normalizeTaxLadder(state.ladder),
      fillTierRate: state.fillTierRate,
      annualConversionCap: toDollars(state.annualConversionCap),
      taxPayment: state.taxPayment,
      ratePremium: state.ratePremium,
      taxNoiseStd: state.taxNoiseStd,
      rmdEnabled: state.rmdEnabled,
      qcdEnabled: state.qcdEnabled,
      qcdAnnual: toDollars(state.qcdAnnual),
      spouseSoleBeneficiary: state.spouseSoleBeneficiary,
      returnMode,
      constantRealReturn: state.constantRealReturn,
      marketParams,
      allocation,
      allocationOverTimeTiers,
      numCores: 1,
      subWorkerPorts: [],
    },
    numCores: 1,
    subWorkerPorts: [],
  };
}
