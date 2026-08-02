// Pure helpers for turning the historical dataset into (a) a resampling pool and
// (b) log-normal profile estimates. Key order comes from the portfolio registry.

import { roundPct1 } from '../core/precision.js';
import { historicalData } from './historicalData.js';
import {
  SLEEVES,
  INFLATION,
  historyKeysInOrder,
  logNormalEngineOrder,
} from './registry.js';

/** @deprecated Prefer historyKeysInOrder() — kept for compat re-exports. */
export const LOGNORMAL_ORDER = historyKeysInOrder();

export function normalizeHistoricalYear(record) {
  const out = { ...record };
  for (const key of historyKeysInOrder()) {
    if (key in out) out[key] = roundPct1(out[key]);
  }
  return out;
}

export function getSampleYears(startYear, endYear, data = historicalData) {
  const years = [];
  for (let year = startYear; year <= endYear; year++) {
    if (data[year]) years.push(normalizeHistoricalYear(data[year]));
  }
  return years;
}

function calculateProfile(records, key) {
  const values = records.map((d) => d[key]);
  const n = values.length;
  const m = values.reduce((a, b) => a + b, 0) / n;
  const variance = values.map((x) => (x - m) ** 2).reduce((a, b) => a + b, 0) / n;
  return { mean: m, stdDev: Math.sqrt(variance) };
}

export function computeProfiles(records) {
  const out = {};
  for (const key of historyKeysInOrder()) out[key] = calculateProfile(records, key);
  return out;
}

export function computeStandardizedYears(records, keys = historyKeysInOrder()) {
  if (!records || records.length === 0) return [];

  const profiles = {};
  for (const key of keys) profiles[key] = calculateProfile(records, key);

  return records.map((record) =>
    keys.map((key) => {
      const { mean, stdDev } = profiles[key];
      return stdDev > 0 ? (record[key] - mean) / stdDev : 0;
    }),
  );
}

export function computeCorrelationMatrix(records, keys = historyKeysInOrder()) {
  const n = records.length;
  const N = keys.length;
  const means = keys.map((k) => records.reduce((a, r) => a + r[k], 0) / n);
  const stds = keys.map((k, j) =>
    Math.sqrt(records.reduce((a, r) => a + (r[k] - means[j]) ** 2, 0) / n),
  );

  const corr = Array.from({ length: N }, () => new Array(N).fill(0));
  for (let a = 0; a < N; a++) {
    corr[a][a] = 1;
    for (let b = a + 1; b < N; b++) {
      let cov = 0;
      for (let r = 0; r < n; r++) {
        cov += (records[r][keys[a]] - means[a]) * (records[r][keys[b]] - means[b]);
      }
      cov /= n;
      const denom = stds[a] * stds[b];
      const c = denom > 0 ? cov / denom : 0;
      corr[a][b] = c;
      corr[b][a] = c;
    }
  }
  return corr;
}

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

export function correlationCholesky(records, keys = historyKeysInOrder()) {
  if (!records || records.length < 2) return null;
  return choleskyDecompose(computeCorrelationMatrix(records, keys));
}

/** Map computed history profiles onto flat scenario/profile % fields. */
export function profilesToScenarioFields(profiles) {
  const r = roundPct1;
  const out = {};
  for (const s of SLEEVES) {
    out[s.meanKey] = r(profiles[s.historyKey].mean);
    out[s.stdKey] = r(profiles[s.historyKey].stdDev);
  }
  out[INFLATION.meanKey] = r(profiles[INFLATION.historyKey].mean);
  out[INFLATION.stdKey] = r(profiles[INFLATION.historyKey].stdDev);
  return out;
}

/** Convert flat % profile fields into logNormal decimals for engines. */
export function profilesToLogNormal(profiles) {
  const logNormal = {};
  for (const s of SLEEVES) {
    const meanPct = Number(profiles?.[s.meanKey]);
    const stdPct = Number(profiles?.[s.stdKey]);
    logNormal[s.engineKey] = {
      mean: (Number.isFinite(meanPct) ? meanPct : 0) / 100,
      stdDev: (Number.isFinite(stdPct) ? stdPct : 0) / 100,
    };
  }
  const infMean = Number(profiles?.[INFLATION.meanKey]);
  const infStd = Number(profiles?.[INFLATION.stdKey]);
  logNormal[INFLATION.engineKey] = {
    mean: (Number.isFinite(infMean) ? infMean : 0) / 100,
    stdDev: (Number.isFinite(infStd) ? infStd : 0) / 100,
  };
  return logNormal;
}

export function toRealReturnPct(nominalPct, inflationPct) {
  return ((1 + nominalPct / 100) / (1 + inflationPct / 100) - 1) * 100;
}

export function averageRealReturn(nominalSeries, inflationSeries) {
  if (!nominalSeries?.length || !inflationSeries?.length) return null;
  if (nominalSeries.length !== inflationSeries.length) return null;
  let sum = 0;
  for (let i = 0; i < nominalSeries.length; i++) {
    sum += toRealReturnPct(nominalSeries[i], inflationSeries[i]);
  }
  return sum / nominalSeries.length;
}

export function sparklineRange(assetSeries, inflationSeries) {
  if (!assetSeries?.length) return null;
  let min = 0;
  let max = 0;
  for (let i = 0; i < assetSeries.length; i++) {
    const assetReturn = assetSeries[i];
    const inflation = inflationSeries?.[i] ?? 0;
    if (assetReturn < min) min = assetReturn;
    if (assetReturn > max) max = assetReturn;
    if (inflation < min) min = inflation;
    if (inflation > max) max = inflation;
  }
  return { min, max };
}

export function sparklineZeroTopPct(range) {
  if (!range) return 50;
  const { min, max } = range;
  if (max === min) return 50;
  return ((max - 0) / (max - min)) * 100;
}

/** Per-year series for allocation mini-charts — keys from registry. */
export function getMiniChartSeries(startYear, endYear, data = historicalData) {
  const years = Object.keys(data)
    .map(Number)
    .filter((y) => y >= startYear && y <= endYear)
    .sort((a, b) => a - b);

  const out = {
    years,
    [INFLATION.historyKey]: years.map((y) => roundPct1(data[y][INFLATION.historyKey])),
  };
  for (const s of SLEEVES) {
    out[s.historyKey] = years.map((y) => roundPct1(data[y][s.historyKey]));
  }
  return out;
}

export { logNormalEngineOrder };
