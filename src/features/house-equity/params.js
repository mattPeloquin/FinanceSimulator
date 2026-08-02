// Build worker payload from House Equity session state.

import { resolveFeatureMarket } from '../../portfolio/resolve.js';
import { pctKeys } from '../../portfolio/registry.js';
import { toDollars } from '../../state/scenario.js';

/** Session percents → engine decimals (4 → 0.04). */
function toRate(pct) {
  return (Number(pct) || 0) / 100;
}

/**
 * Resolve linked Withdraw session or local portfolio into MC SOR market params.
 * Money fields arrive as $000s; rate fields as percents.
 * @param {object} state
 */
export async function buildHouseEquityWorkerPayload(state, { seed } = {}) {
  const runSeed = (seed ?? state.seed ?? (Math.random() * 0xffffffff)) >>> 0;
  const { marketParams, portfolio, source } = await resolveFeatureMarket(state, {
    horizonYears: state.numYears,
    seed: runSeed,
  });

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
      returnMode: 'market',
      marketParams,
      allocation: marketParams.allocation,
      allocationOverTimeTiers: portfolio.allocationOverTimeTiers,
      allocationKeys: pctKeys(),
      portfolioSource: source,
      numCores: 1,
      subWorkerPorts: [],
    },
    numCores: 1,
    subWorkerPorts: [],
  };
}
