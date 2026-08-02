// Build worker payload from SS Timing session state.

import { resolveFeatureMarket } from '../../portfolio/resolve.js';
import { fraFromBirthYear, estimatePiaFromEarnings } from '../../core/socialSecurity.js';

/**
 * Resolve linked Withdraw session or local returns into MC SOR market params.
 * @param {object} state
 * @returns {Promise<object>} worker message
 */
export async function buildSsTimingWorkerPayload(state, { seed } = {}) {
  const personA = resolvePerson(state.personA);
  const personB = state.couple ? resolvePerson(state.personB) : null;
  const runSeed = (seed ?? state.seed ?? (Math.random() * 0xffffffff)) >>> 0;

  const horizonYears = Math.max(
    1,
    Math.max(...(state.endAges || [90]).map((a) => a - (personA.currentAge || 62))),
  );

  const { marketParams, portfolio } = await resolveFeatureMarket(state, {
    horizonYears,
    seed: runSeed,
  });

  return {
    type: 'ssTiming',
    deterministicInput: {
      couple: !!state.couple,
      personA,
      personB,
      endAges: state.endAges,
    },
    marketParams: {
      ...marketParams,
      seed: runSeed,
      allocationOverTimeTiers: portfolio.allocationOverTimeTiers,
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
