// Cross-feature cashflow series contract.
//
// Yearly signed real-dollar amounts plus metadata. Feature producers attach a
// series on export/share (envelope field). Consumers (Plan preview / household
// orchestrator) are reserved for a future plan — not wired into SOR Plan here.

export const CASHFLOW_SERIES_VERSION = 1;

/**
 * @typedef {object} StrategyCashflow
 * @property {number[]} annual - signed real $; + = cash to household, − = outflow
 */

/**
 * @typedef {object} CashflowSeries
 * @property {number} version
 * @property {string} sourceFeature
 * @property {string|null} sessionName
 * @property {'real-dollars'} units
 * @property {number} startAge
 * @property {number[]} years - year indices 0..N-1 (0 = current year)
 * @property {Record<string, StrategyCashflow>} seriesByStrategy
 */

/**
 * @param {Partial<CashflowSeries>} [overrides]
 * @returns {CashflowSeries}
 */
export function createEmptyCashflowSeries(overrides = {}) {
  return {
    version: CASHFLOW_SERIES_VERSION,
    sourceFeature: typeof overrides.sourceFeature === 'string' ? overrides.sourceFeature : '',
    sessionName: overrides.sessionName == null ? null : String(overrides.sessionName),
    units: 'real-dollars',
    startAge: Number.isFinite(Number(overrides.startAge)) ? Number(overrides.startAge) : 0,
    years: Array.isArray(overrides.years) ? overrides.years.map((y) => y | 0) : [],
    seriesByStrategy:
      overrides.seriesByStrategy && typeof overrides.seriesByStrategy === 'object'
        ? overrides.seriesByStrategy
        : {},
  };
}

/**
 * Normalize / validate a series blob. Drops unknown fields; coerces annual arrays.
 * @param {unknown} raw
 * @returns {CashflowSeries}
 */
export function normalizeCashflowSeries(raw) {
  const base = createEmptyCashflowSeries();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base;

  const version = Number(raw.version);
  const startAge = Number(raw.startAge);
  const years = Array.isArray(raw.years)
    ? raw.years.map((y) => Math.max(0, y | 0))
    : [];

  /** @type {Record<string, StrategyCashflow>} */
  const seriesByStrategy = {};
  const src = raw.seriesByStrategy && typeof raw.seriesByStrategy === 'object'
    ? raw.seriesByStrategy
    : {};
  for (const [id, entry] of Object.entries(src)) {
    if (!entry || typeof entry !== 'object') continue;
    const annual = Array.isArray(entry.annual)
      ? entry.annual.map((v) => (Number.isFinite(Number(v)) ? Number(v) : 0))
      : [];
    seriesByStrategy[String(id)] = { annual };
  }

  return {
    version: Number.isFinite(version) ? version : CASHFLOW_SERIES_VERSION,
    sourceFeature: typeof raw.sourceFeature === 'string' ? raw.sourceFeature : '',
    sessionName: raw.sessionName == null || raw.sessionName === ''
      ? null
      : String(raw.sessionName),
    units: 'real-dollars',
    startAge: Number.isFinite(startAge) ? startAge : 0,
    years,
    seriesByStrategy,
  };
}

/**
 * Build a normalized series from a map of strategy id → annual real-$ arrays.
 * @param {object} opts
 * @param {string} opts.sourceFeature
 * @param {number} [opts.startAge=0]
 * @param {string|null} [opts.sessionName=null]
 * @param {number} opts.numYears
 * @param {Record<string, number[]>} opts.annualByStrategy
 * @returns {CashflowSeries}
 */
export function buildCashflowSeries({
  sourceFeature,
  startAge = 0,
  sessionName = null,
  numYears = 0,
  annualByStrategy = {},
} = {}) {
  const n = Math.max(0, numYears | 0);
  const years = Array.from({ length: n }, (_, i) => i);
  /** @type {Record<string, { annual: number[] }>} */
  const seriesByStrategy = {};
  for (const [id, annual] of Object.entries(annualByStrategy || {})) {
    const arr = Array.isArray(annual) ? annual : [];
    const padded = new Array(n);
    for (let i = 0; i < n; i++) {
      padded[i] = Number.isFinite(Number(arr[i])) ? Number(arr[i]) : 0;
    }
    seriesByStrategy[String(id)] = { annual: padded };
  }
  return normalizeCashflowSeries(createEmptyCashflowSeries({
    sourceFeature: sourceFeature || '',
    startAge,
    sessionName,
    years,
    seriesByStrategy,
  }));
}

/**
 * Remap an age-indexed benefit stream onto year indices from startAge.
 * @param {{ years?: number[], annual?: number[] }} cashflow
 * @param {number} startAge
 * @param {number} numYears
 * @returns {number[]}
 */
export function remapAgeCashflowToYears(cashflow, startAge, numYears) {
  const n = Math.max(0, numYears | 0);
  const annual = new Array(n).fill(0);
  const ages = Array.isArray(cashflow?.years) ? cashflow.years : [];
  const amounts = Array.isArray(cashflow?.annual) ? cashflow.annual : [];
  const base = Number(startAge) || 0;
  for (let i = 0; i < ages.length; i++) {
    const y = (Number(ages[i]) || 0) - base;
    if (y >= 0 && y < n) annual[y] += Number(amounts[i]) || 0;
  }
  return annual;
}

/**
 * Convert a nominal annual series to real dollars using per-year inflation rates.
 * Year 0 cash is already today's $ (deflator 1). After year y's inflation,
 * the deflator for cash booked at end of year y uses cumulative product through y.
 *
 * @param {number[]} nominalAnnual - length N, dollars of that year
 * @param {number[]} inflationByYear - length N, decimal inflation for each year
 * @returns {number[]} real annual series (same length)
 */
export function deflateNominalSeries(nominalAnnual, inflationByYear) {
  const n = Array.isArray(nominalAnnual) ? nominalAnnual.length : 0;
  const real = new Array(n);
  // Cash during year 0 is already in today's dollars.
  let deflator = 1;
  for (let y = 0; y < n; y++) {
    const nominal = Number(nominalAnnual[y]) || 0;
    real[y] = nominal / deflator;
    const inflation = Number(inflationByYear?.[y]);
    const inf = Number.isFinite(inflation) ? Math.max(-0.5, Math.min(1, inflation)) : 0;
    deflator *= 1 + inf;
  }
  return real;
}
