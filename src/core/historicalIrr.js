// Historical plan-backtest IRR band: run the user's actual withdrawal plan
// over every contiguous horizon-length window of the SELECTED historical years
// and take the money-weighted IRR of each run. Because the plan's cash flows
// weight early years the most, this captures sequence risk the way the
// simulation's IRR scatter does — unlike a buy-and-hold annualized return —
// so the band and the scatter's y-axis measure the same quantity.
//
// The band is reduced to its 5th–65th percentiles to match the P5–P65 chart
// outcome band (3D surface columns, timeline, IRR scatter).
// DOM-free and unit-testable.

import { percentileValue } from './statistics.js';
import { simulatePath } from './simulation.js';
import { createRng } from './rng.js';

// Chart outcome band: P5–P65.
export const HISTORICAL_IRR_PERCENTILES = { low: 0.05, high: 0.65 };

// Money-weighted IRR of the plan run over each contiguous horizon-length
// window of the selected years (one window per starting year). When the
// selection is shorter than the horizon, windows wrap around the selection
// (flagged via `wrapped`) — matching how Historical Resampling reuses a short
// selection. Returns { irrs, wrapped } or null when the inputs can't support
// a backtest (no selection or no horizon). Windows whose IRR is undefined
// (irrFromPath returns NaN) are dropped.
export function historicalPlanIrrs(params) {
  const records = params?.samples?.years;
  const horizonYears = params?.numYears;
  if (!records || records.length === 0 || !horizonYears || horizonYears < 1) return null;

  const wrapped = records.length < horizonYears;
  const starts = wrapped ? records.length : records.length - horizonYears + 1;

  // Reuse the Monte Carlo engine's full withdrawal/guardrail/IRR logic in its
  // deterministic 'historicalSequence' mode. That mode never draws from the
  // rng (and horizonRange: null skips the horizon draw), so the seed is inert.
  const base = { ...params, distMethod: 'historicalSequence', horizonRange: null };
  const irrs = [];
  for (let start = 0; start < starts; start++) {
    const { irr } = simulatePath({ ...base, sequenceStart: start }, createRng(0));
    if (!Number.isNaN(irr)) irrs.push(irr);
  }
  return { irrs, wrapped };
}

// P5–P65 band of the plan's backtested IRRs over the selected year records.
// Returns { low, high, windows, wrapped } or null when no window has a
// defined IRR.
export function historicalIrrBand(params, percentiles = HISTORICAL_IRR_PERCENTILES) {
  const backtest = historicalPlanIrrs(params);
  if (!backtest || backtest.irrs.length === 0) return null;
  return {
    low: percentileValue(backtest.irrs, percentiles.low),
    high: percentileValue(backtest.irrs, percentiles.high),
    windows: backtest.irrs.length,
    wrapped: backtest.wrapped,
  };
}
