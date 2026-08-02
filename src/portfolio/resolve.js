// Resolve a feature's portfolio source: soft-linked Withdraw session or local slice.

import * as sessions from '../state/sessions.js';
import { FEATURE_WITHDRAW } from '../state/storageKeys.js';
import { fromWithdrawScenario } from './adapters.js';
import { buildMarketParams } from './api.js';
import {
  normalizePortfolio,
  defaultPortfolio,
  pickReturnsAllocationSlice,
} from './slice.js';

/**
 * @param {object} state - feature state with optional scenarioRef and/or portfolio
 *   (Accumulate / SS Timing may store returns fields flat on state).
 * @param {{ horizonYears?: number, seed?: number }} [opts]
 * @returns {Promise<{ portfolio: object, marketParams: object, source: 'link'|'local', sessionName: string|null }>}
 */
export async function resolveFeatureMarket(state, opts = {}) {
  const horizonYears = Math.max(1, opts.horizonYears || state.numYears || 1);
  const seed = (opts.seed ?? state.seed ?? (Math.random() * 0xffffffff)) >>> 0;

  let portfolio;
  let source;
  let sessionName = null;

  if (state.scenarioRef?.name) {
    const loaded = await sessions.load(
      state.scenarioRef.feature || FEATURE_WITHDRAW,
      state.scenarioRef.name,
    );
    if (!loaded?.payload) {
      throw new Error(
        `Could not load Withdraw session "${state.scenarioRef.name}". Save a scenario in Withdraw first, or switch to a local portfolio.`,
      );
    }
    portfolio = fromWithdrawScenario(loaded.payload);
    source = 'link';
    sessionName = state.scenarioRef.name;
  } else if (state.portfolio) {
    portfolio = normalizePortfolio(state.portfolio);
    source = 'local';
  } else if (state.allocation != null || state.startYear != null) {
    // Flat nested-compatible fields (Accumulate / SS Timing session shape).
    portfolio = pickReturnsAllocationSlice(state);
    source = 'local';
  } else {
    throw new Error(
      'Choose a linked Withdraw / Plan session or define a local portfolio for market returns.',
    );
  }

  const market = buildMarketParams(portfolio, { horizonYears });
  return {
    portfolio,
    source,
    sessionName,
    marketParams: {
      ...market,
      seed,
      allocationKeys: market.engineKeys,
    },
  };
}

export function ensureLocalPortfolio(state) {
  if (state?.portfolio) return normalizePortfolio(state.portfolio);
  return defaultPortfolio();
}

export { normalizePortfolio };
