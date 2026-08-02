// Canonical market-segment registry — the ONLY place that enumerates investable
// sleeves + inflation. Sleeve count is whatever this array contains; no other
// module may assume a fixed N.
//
// To add / rename / remove a sleeve:
//   1. Edit SLEEVES (and INFLATION if needed) here — keys, labels, color, bucket, defaults
//   2. Update every year row in ./historicalData.js to match historyKey columns
//   3. Update risk / feature preset JSON mixes to use the new pctKey names
// UI, charts, report, Lab, and engines all derive from this registry.

/**
 * @typedef {object} SleeveDef
 * @property {string} id - Stable id (usually same as engineKey)
 * @property {string} historyKey - Column in historicalData year rows (snake_case)
 * @property {string} engineKey - Decimal weight / logNormal key (camelCase)
 * @property {string} pctKey - UI / scenario % field (…Allocation)
 * @property {string} meanKey - Flat scenario / profile mean field (%)
 * @property {string} stdKey - Flat scenario / profile stdDev field (%)
 * @property {string} label - Short UI label
 * @property {string} color - Chart hex color
 * @property {'stock'|'bondCash'} bucket - Report rollup bucket
 * @property {number} defaultPct - Default allocation weight (%)
 * @property {string} domId - CamelCase stem for DOM ids (e.g. usLgGrowth)
 */

/** @type {SleeveDef[]} */
export const SLEEVES = [
  {
    id: 'usLgGrowth',
    historyKey: 'us_lg_growth',
    engineKey: 'usLgGrowth',
    pctKey: 'usLgGrowthAllocation',
    meanKey: 'usLgGrowthMean',
    stdKey: 'usLgGrowthStdDev',
    label: 'US Lg Growth',
    color: '#2a6f9c',
    bucket: 'stock',
    defaultPct: 25,
    domId: 'usLgGrowth',
  },
  {
    id: 'usLgValue',
    historyKey: 'us_lg_value',
    engineKey: 'usLgValue',
    pctKey: 'usLgValueAllocation',
    meanKey: 'usLgValueMean',
    stdKey: 'usLgValueStdDev',
    label: 'US Lg Value',
    color: '#2a8490',
    bucket: 'stock',
    defaultPct: 25,
    domId: 'usLgValue',
  },
  {
    id: 'usSmMid',
    historyKey: 'us_sm_mid',
    engineKey: 'usSmMid',
    pctKey: 'usSmMidAllocation',
    meanKey: 'usSmMidMean',
    stdKey: 'usSmMidStdDev',
    label: 'US Sm/Mid',
    color: '#268a72',
    bucket: 'stock',
    defaultPct: 10,
    domId: 'usSmMid',
  },
  {
    id: 'exUs',
    historyKey: 'ex_us',
    engineKey: 'exUs',
    pctKey: 'exUsAllocation',
    meanKey: 'exUsMean',
    stdKey: 'exUsStdDev',
    label: 'ex-US',
    color: '#3a78a8',
    bucket: 'stock',
    defaultPct: 15,
    domId: 'exUs',
  },
  {
    id: 'bond',
    historyKey: 'bond',
    engineKey: 'bond',
    pctKey: 'bondAllocation',
    // Legacy Withdraw field names (not bondMean) — kept only in this mapping.
    meanKey: 'bondReturnMean',
    stdKey: 'bondReturnStdDev',
    label: 'Bonds',
    color: '#4f9438',
    bucket: 'bondCash',
    defaultPct: 20,
    domId: 'bond',
  },
  {
    id: 'cash',
    historyKey: 'cash',
    engineKey: 'cash',
    pctKey: 'cashAllocation',
    meanKey: 'cashReturnMean',
    stdKey: 'cashReturnStdDev',
    label: 'Cash',
    color: '#3d5f78',
    bucket: 'bondCash',
    defaultPct: 5,
    domId: 'cash',
  },
];

/** Inflation is a history/logNormal series, never an allocation weight. */
export const INFLATION = {
  id: 'inflation',
  historyKey: 'inflation',
  engineKey: 'inflation',
  meanKey: 'inflationMean',
  stdKey: 'inflationStdDev',
  label: 'Inflation',
  domId: 'inflation',
};

/** History keys in log-normal / Cholesky order: all sleeves then inflation. */
export function historyKeysInOrder() {
  return [...SLEEVES.map((s) => s.historyKey), INFLATION.historyKey];
}

/** Engine keys for investable sleeves only (no inflation). */
export function engineKeys() {
  return SLEEVES.map((s) => s.engineKey);
}

/** Engine keys including inflation (correlated draw order). */
export function logNormalEngineOrder() {
  return [...SLEEVES.map((s) => s.engineKey), INFLATION.engineKey];
}

/** Scenario / slice % field names. */
export function pctKeys() {
  return SLEEVES.map((s) => s.pctKey);
}

/** Flat mean/std profile field names including inflation. */
export function profileFieldKeys() {
  const keys = [];
  for (const s of SLEEVES) {
    keys.push(s.meanKey, s.stdKey);
  }
  keys.push(INFLATION.meanKey, INFLATION.stdKey);
  return keys;
}

/** Segment identifier strings used by the encapsulation grep-guard. */
export function segmentIdentifierPatterns() {
  const ids = new Set();
  for (const s of SLEEVES) {
    ids.add(s.historyKey);
    ids.add(s.engineKey);
    ids.add(s.pctKey);
    ids.add(s.meanKey);
    ids.add(s.stdKey);
    ids.add(s.domId);
  }
  ids.add(INFLATION.historyKey);
  ids.add(INFLATION.engineKey);
  ids.add(INFLATION.meanKey);
  ids.add(INFLATION.stdKey);
  ids.add(INFLATION.domId);
  return [...ids];
}

/**
 * Ordered presentation metadata for UI / Lab / report consumers.
 * @returns {Array<SleeveDef & { color: string }>}
 */
export function listSleeves() {
  return SLEEVES.map((s) => ({ ...s }));
}

/** @param {string} key - engineKey, pctKey, historyKey, or id */
export function getSleeveMeta(key) {
  return (
    SLEEVES.find(
      (s) =>
        s.id === key
        || s.engineKey === key
        || s.pctKey === key
        || s.historyKey === key
        || s.domId === key,
    ) || null
  );
}

export function defaultAllocationPct() {
  const out = {};
  for (const s of SLEEVES) out[s.pctKey] = s.defaultPct;
  return out;
}

/** pctKey → engineKey */
export function allocationKeyToEngine(pctKey) {
  const sleeve = SLEEVES.find((s) => s.pctKey === pctKey);
  return sleeve ? sleeve.engineKey : String(pctKey).replace(/Allocation$/, '');
}

/** Build chartAssets-style map from registry colors. */
export function sleeveColorMap() {
  const out = {};
  for (const s of SLEEVES) out[s.historyKey] = s.color;
  return out;
}
