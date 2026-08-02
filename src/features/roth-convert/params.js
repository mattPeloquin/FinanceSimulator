// Build worker payload from Roth Convert session state.

import { resolveFeatureMarket } from '../../portfolio/resolve.js';
import { normalizeTaxLadder } from '../../data/taxLadderIllustrative.js';
import { toDollars } from '../../state/scenario.js';

/**
 * Resolve linked Withdraw session or local portfolio into MC SOR market params.
 * @param {object} state
 * @returns {Promise<object>} worker message
 */
export async function buildRothWorkerPayload(state, { seed } = {}) {
  const runSeed = (seed ?? state.seed ?? (Math.random() * 0xffffffff)) >>> 0;
  const { marketParams, portfolio, source } = await resolveFeatureMarket(state, {
    horizonYears: state.numYears,
    seed: runSeed,
  });

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
      returnMode: 'market',
      marketParams,
      allocation: marketParams.allocation,
      allocationOverTimeTiers: portfolio.allocationOverTimeTiers,
      portfolioSource: source,
      numCores: 1,
      subWorkerPorts: [],
    },
    numCores: 1,
    subWorkerPorts: [],
  };
}
