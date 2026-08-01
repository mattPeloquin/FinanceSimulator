// Build worker payload from House Equity session state.

import * as sessions from '../../state/sessions.js';
import { FEATURE_SOR_PLAN } from '../../state/storageKeys.js';
import {
  buildSamplesAndProfiles,
  sliceFromPlanScenario,
  canonicalizeDistMethod,
  ALLOCATION_PCT_KEYS,
} from '../../state/returnsAllocationSlice.js';
import {
  profilesToLogNormal,
  correlationCholesky,
  computeStandardizedYears,
} from '../../core/history.js';
import { allocationFromConfig, ALLOCATION_ENGINE_KEYS } from '../../core/accumulation.js';
import { toDollars } from '../../state/scenario.js';

/** Session percents → engine decimals (4 → 0.04). */
function toRate(pct) {
  return (Number(pct) || 0) / 100;
}

/**
 * Resolve Plan soft-link (if any) into market params, or constant-return mode.
 * Money fields arrive as $000s; rate fields as percents.
 * @param {object} state
 */
export async function buildHouseEquityWorkerPayload(state, { seed } = {}) {
  const runSeed = (seed ?? state.seed ?? (Math.random() * 0xffffffff)) >>> 0;
  const linked = !!(state.scenarioRef?.name);

  let returnMode = 'constant';
  let marketParams = null;
  let allocation = null;
  let allocationOverTimeTiers = [];

  if (linked) {
    const loaded = await sessions.load(
      state.scenarioRef.feature || FEATURE_SOR_PLAN,
      state.scenarioRef.name,
    );
    if (!loaded?.payload) {
      throw new Error(
        `Could not load Plan session "${state.scenarioRef.name}". Save a scenario in SOR Plan first, or clear the link to use a constant return.`,
      );
    }
    const slice = sliceFromPlanScenario(loaded.payload);
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
    type: 'houseEquity',
    input: {
      seed: runSeed,
      numSimulations: state.numSimulations,
      numYears: state.numYears,
      accessYear: state.accessYear,
      currentAge: state.currentAge,
      homeValue: toDollars(state.homeValue),
      costBasis: toDollars(state.costBasis),
      cgExclusion: toDollars(state.cgExclusion),
      longTermCgRate: toRate(state.longTermCgRate),
      saleCommissionPct: toRate(state.saleCommissionPct),
      saleOtherClosingPct: toRate(state.saleOtherClosingPct),
      existingMortgageBalance: toDollars(state.existingMortgageBalance),
      existingMortgageRate: toRate(state.existingMortgageRate),
      existingMortgageTermYears: state.existingMortgageTermYears,
      expectedRealAppreciation: toRate(state.expectedRealAppreciation),
      expectedInflation: toRate(state.expectedInflation),
      annualSpendTarget: toDollars(state.annualSpendTarget),
      annualRent: toDollars(state.annualRent),
      realRentGrowth: toRate(state.realRentGrowth),
      simplifiedRmMode: state.simplifiedRmMode,
      simplifiedRmFeePct: toRate(state.simplifiedRmFeePct),
      simplifiedRmRate: toRate(state.simplifiedRmRate),
      simplifiedRmLineGrowth: toRate(state.simplifiedRmLineGrowth),
      privateRmMode: state.privateRmMode,
      privateRmProceedsPct: toRate(state.privateRmProceedsPct),
      privateRmFeePct: toRate(state.privateRmFeePct),
      privateRmRate: toRate(state.privateRmRate),
      privateRmLineGrowth: toRate(state.privateRmLineGrowth),
      helocLtv: toRate(state.helocLtv),
      helocRate: toRate(state.helocRate),
      cashOutLtv: toRate(state.cashOutLtv),
      cashOutRate: toRate(state.cashOutRate),
      cashOutTermYears: state.cashOutTermYears,
      cashOutClosingPct: toRate(state.cashOutClosingPct),
      returnMode,
      constantRealReturn: toRate(state.constantRealReturn),
      marketParams,
      allocation,
      allocationOverTimeTiers,
      allocationKeys: ALLOCATION_PCT_KEYS,
      numCores: 1,
      subWorkerPorts: [],
    },
    numCores: 1,
    subWorkerPorts: [],
  };
}
