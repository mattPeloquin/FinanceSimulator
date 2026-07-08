// Pure helpers for turning the historical dataset into (a) a resampling pool and
// (b) log-normal profile estimates. DOM-free and unit-testable.

import { roundPct1 } from './precision.js';
import { historicalData } from '../data/historicalData.js';

const PROFILE_KEYS = ['us_lg_growth', 'us_lg_value', 'us_sm_mid', 'ex_us', 'bond', 'cash', 'inflation'];

// Canonical ordering for the log-normal vector (6 asset classes + inflation).
// The simulation engine indexes its correlated draws in exactly this order.
export const LOGNORMAL_ORDER = PROFILE_KEYS;

// Round each asset return to one decimal (0.1%) — matches UI precision.
export function normalizeHistoricalYear(record) {
  const out = { ...record };
  for (const key of PROFILE_KEYS) {
    if (key in out) out[key] = roundPct1(out[key]);
  }
  return out;
}

// Year-data records (inclusive range), in chronological order.
export function getSampleYears(startYear, endYear, data = historicalData) {
  const years = [];
  for (let year = startYear; year <= endYear; year++) {
    if (data[year]) years.push(normalizeHistoricalYear(data[year]));
  }
  return years;
}

// Population mean and standard deviation for one key (matches the original).
function calculateProfile(records, key) {
  const values = records.map((d) => d[key]);
  const n = values.length;
  const m = values.reduce((a, b) => a + b, 0) / n;
  const variance = values.map((x) => (x - m) ** 2).reduce((a, b) => a + b, 0) / n;
  return { mean: m, stdDev: Math.sqrt(variance) };
}

// Log-normal profiles (in percent) for each asset class plus inflation.
export function computeProfiles(records) {
  const out = {};
  for (const key of PROFILE_KEYS) out[key] = calculateProfile(records, key);
  return out;
}

// Per-year standardized shocks (z-scores) for Smoothed Historical simulation.
// Each year becomes a 7-length array: how many stdDevs above/below that asset's
// historical mean for the selected range. Values are in percent (same units as
// historicalData); zero-variance keys yield z=0.
export function computeStandardizedYears(records, keys = LOGNORMAL_ORDER) {
  if (!records || records.length === 0) return [];

  const profiles = {};
  for (const key of keys) profiles[key] = calculateProfile(records, key);

  return records.map((record) =>
    keys.map((key) => {
      const { mean, stdDev } = profiles[key];
      return stdDev > 0 ? (record[key] - mean) / stdDev : 0;
    })
  );
}

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

// Annualized real return of a fixed allocation over every rolling
// `horizonYears`-long window of the historical dataset, reduced to its
// 10th–90th percentile band. For a buy-and-hold path the IRR equals the
// annualized return, so this is the "typical historical IRR" for an investing
// timeline of that length. Returns null when the horizon exceeds the data.
export function rollingRealReturnBand(allocation, horizonYears, data = historicalData) {
  if (!allocation || !horizonYears || horizonYears < 1) return null;
  const years = Object.keys(data)
    .map(Number)
    .sort((a, b) => a - b);
  if (years.length < horizonYears) return null;

  const annualized = [];
  for (let s = 0; s + horizonYears <= years.length; s++) {
    let growth = 1;
    for (let j = 0; j < horizonYears; j++) {
      const yearData = data[years[s + j]];
      let portfolioReturn = 0;
      for (const [allocKey, dataKey] of Object.entries(ALLOCATION_TO_DATA_KEY)) {
        portfolioReturn += ((yearData[dataKey] ?? 0) / 100) * (allocation[allocKey] ?? 0);
      }
      growth *= (1 + portfolioReturn) / (1 + yearData.inflation / 100);
    }
    annualized.push(growth ** (1 / horizonYears) - 1);
  }

  annualized.sort((a, b) => a - b);
  const at = (p) => annualized[Math.min(annualized.length - 1, Math.floor(annualized.length * p))];
  return { low: at(0.1), high: at(0.9), windows: annualized.length };
}

// Pearson correlation matrix (N×N) across `keys`, estimated from records. A key
// with zero variance yields zero correlation with everything (diagonal stays 1).
export function computeCorrelationMatrix(records, keys = LOGNORMAL_ORDER) {
  const n = records.length;
  const N = keys.length;
  const means = keys.map((k) => records.reduce((a, r) => a + r[k], 0) / n);
  const stds = keys.map((k, j) =>
    Math.sqrt(records.reduce((a, r) => a + (r[k] - means[j]) ** 2, 0) / n)
  );

  const corr = Array.from({ length: N }, () => new Array(N).fill(0));
  for (let a = 0; a < N; a++) {
    corr[a][a] = 1;
    for (let b = a + 1; b < N; b++) {
      let cov = 0;
      for (let r = 0; r < n; r++) cov += (records[r][keys[a]] - means[a]) * (records[r][keys[b]] - means[b]);
      cov /= n;
      const denom = stds[a] * stds[b];
      const c = denom > 0 ? cov / denom : 0;
      corr[a][b] = c;
      corr[b][a] = c;
    }
  }
  return corr;
}

// Cholesky factor L (lower-triangular, L·Lᵀ = M). Sample correlation matrices are
// positive-semidefinite; near-singular pivots are clamped so the factor stays
// usable (producing a valid, possibly reduced-rank, correlation structure).
export function choleskyDecompose(M) {
  const N = M.length;
  const L = Array.from({ length: N }, () => new Array(N).fill(0));
  for (let i = 0; i < N; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = M[i][j];
      for (let k = 0; k < j; k++) sum -= L[i][k] * L[j][k];
      if (i === j) {
        L[i][j] = sum > 1e-12 ? Math.sqrt(sum) : 0;
      } else {
        L[i][j] = L[j][j] > 1e-12 ? sum / L[j][j] : 0;
      }
    }
  }
  return L;
}

// Convenience: Cholesky factor of the historical correlation matrix, or null when
// there isn't enough data to estimate one (caller falls back to uncorrelated draws).
export function correlationCholesky(records, keys = LOGNORMAL_ORDER) {
  if (!records || records.length < 2) return null;
  return choleskyDecompose(computeCorrelationMatrix(records, keys));
}

// Map computed profiles onto the scenario log-normal fields (one decimal).
export function profilesToScenarioFields(profiles) {
  const r = roundPct1;
  return {
    usLgGrowthMean: r(profiles.us_lg_growth.mean),
    usLgGrowthStdDev: r(profiles.us_lg_growth.stdDev),
    usLgValueMean: r(profiles.us_lg_value.mean),
    usLgValueStdDev: r(profiles.us_lg_value.stdDev),
    usSmMidMean: r(profiles.us_sm_mid.mean),
    usSmMidStdDev: r(profiles.us_sm_mid.stdDev),
    exUsMean: r(profiles.ex_us.mean),
    exUsStdDev: r(profiles.ex_us.stdDev),
    bondReturnMean: r(profiles.bond.mean),
    bondReturnStdDev: r(profiles.bond.stdDev),
    cashReturnMean: r(profiles.cash.mean),
    cashReturnStdDev: r(profiles.cash.stdDev),
    inflationMean: r(profiles.inflation.mean),
    inflationStdDev: r(profiles.inflation.stdDev),
  };
}

// Per-year series for the allocation mini-charts.
export function getMiniChartSeries(startYear, endYear, data = historicalData) {
  const years = Object.keys(data)
    .map(Number)
    .filter((y) => y >= startYear && y <= endYear)
    .sort((a, b) => a - b);

  return {
    years,
    inflation: years.map((y) => roundPct1(data[y].inflation)),
    us_lg_growth: years.map((y) => roundPct1(data[y].us_lg_growth)),
    us_lg_value: years.map((y) => roundPct1(data[y].us_lg_value)),
    us_sm_mid: years.map((y) => roundPct1(data[y].us_sm_mid)),
    ex_us: years.map((y) => roundPct1(data[y].ex_us)),
    bond: years.map((y) => roundPct1(data[y].bond)),
    cash: years.map((y) => roundPct1(data[y].cash)),
  };
}
