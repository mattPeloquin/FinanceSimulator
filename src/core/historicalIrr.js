// Historical IRR band: what annualized real return a fixed allocation actually
// earned over rolling horizon-length windows of the user's SELECTED historical
// year range. For a buy-and-hold path the IRR equals the annualized return, so
// the band is the "typical historical IRR" for an investing timeline of that
// length. DOM-free and unit-testable.
//
// The band is reduced to its 5th–60th percentiles to match the P5–P60 outcome
// band used everywhere else in the app (percentile cards, 3D surface columns).

import { percentileValue } from './statistics.js';

// App-wide outcome band: P5–P60.
export const HISTORICAL_IRR_PERCENTILES = { low: 0.05, high: 0.6 };

// Allocation-key mapping between the app's camelCase allocation object and the
// snake_case historical dataset columns.
const ALLOCATION_TO_DATA_KEY = {
  usLgGrowth: 'us_lg_growth',
  usLgValue: 'us_lg_value',
  usSmMid: 'us_sm_mid',
  exUs: 'ex_us',
  bond: 'bond',
  cash: 'cash',
};

// One year's inflation-adjusted return (fraction) of a fixed allocation, from a
// historical year record (values in percent). Missing columns/weights count as 0.
export function portfolioRealReturn(record, allocation) {
  let nominal = 0;
  for (const [allocKey, dataKey] of Object.entries(ALLOCATION_TO_DATA_KEY)) {
    nominal += ((record[dataKey] ?? 0) / 100) * (allocation[allocKey] ?? 0);
  }
  return (1 + nominal) / (1 + (record.inflation ?? 0) / 100) - 1;
}

// Annualized real return of the allocation over every rolling
// `horizonYears`-long window of `records` (chronological year records, e.g.
// from getSampleYears). With `wrap`, windows cycle around the selection (one
// per starting year) — matching how Historical Resampling reuses a selection
// shorter than the horizon. Without it, only true in-selection windows count,
// so the result is empty when the horizon exceeds the selection.
export function rollingAnnualizedRealReturns(records, allocation, horizonYears, { wrap = false } = {}) {
  const n = records.length;
  const starts = wrap ? n : n - horizonYears + 1;
  const annualized = [];
  for (let start = 0; start < starts; start++) {
    let growth = 1;
    for (let j = 0; j < horizonYears; j++) {
      growth *= 1 + portfolioRealReturn(records[(start + j) % n], allocation);
    }
    annualized.push(growth ** (1 / horizonYears) - 1);
  }
  return annualized;
}

// P5–P60 band of rolling-window annualized real returns for the selected year
// records. When the selection is shorter than the horizon, windows wrap around
// the selection (flagged via `wrapped`) so short selections still get a band.
// Returns { low, high, windows, wrapped } or null when the inputs can't
// support one (no selection or no allocation).
export function historicalIrrBand(
  records,
  allocation,
  horizonYears,
  percentiles = HISTORICAL_IRR_PERCENTILES,
) {
  if (!records || records.length === 0 || !allocation || !horizonYears || horizonYears < 1) {
    return null;
  }
  const wrapped = records.length < horizonYears;
  const annualized = rollingAnnualizedRealReturns(records, allocation, horizonYears, { wrap: wrapped });
  return {
    low: percentileValue(annualized, percentiles.low),
    high: percentileValue(annualized, percentiles.high),
    windows: annualized.length,
    wrapped,
  };
}
