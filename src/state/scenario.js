// Single source of truth for all user inputs.
//
// A "scenario" is a flat, JSON-serialisable object. Each field declares the DOM
// element it binds to and how to parse/format it. This removes the scattered
// getElementById calls of the original app and makes persistence, export/import,
// and validation trivial.

import { correlationCholesky } from '../core/history.js';

export const SCHEMA_VERSION = 2;

// All currency fields are stored and edited in thousands ($000s). Simulation uses dollars.
export const MONEY_SCALE = 1000;

// type: how the raw input string is parsed and re-formatted.
//   int      -> integer
//   float    -> float
//   currency -> float in thousands ($000s), displayed with thousands separators
//   string   -> raw string (e.g. optional seed)
const FIELDS = [
  { key: 'numYears', dom: 'numYears', type: 'int', def: 40 },
  { key: 'numSimulations', dom: 'numSimulations', type: 'int', def: 10000 },
  { key: 'randomSeed', dom: 'randomSeed', type: 'string', def: '' },
  // Half-width (in % of all runs) of the band averaged around each percentile to
  // smooth the representative path/cards. 0 = single run (no smoothing).
  { key: 'smoothWindowPct', dom: 'smoothWindowPct', type: 'float', def: 1 },

  { key: 'startYear', dom: 'startYear', type: 'int', def: 1970 },
  { key: 'endYear', dom: 'endYear', type: 'int', def: 2025 },
  { key: 'blockSize', dom: 'blockSize', type: 'int', def: 3 },

  { key: 'usLgGrowthAllocation', dom: 'usLgGrowthAllocation', type: 'float', def: 35 },
  { key: 'usLgValueAllocation', dom: 'usLgValueAllocation', type: 'float', def: 25 },
  { key: 'usSmMidAllocation', dom: 'usSmMidAllocation', type: 'float', def: 15 },
  { key: 'exUsAllocation', dom: 'exUsAllocation', type: 'float', def: 15 },
  { key: 'bondAllocation', dom: 'bondAllocation', type: 'float', def: 0 },
  { key: 'cashAllocation', dom: 'cashAllocation', type: 'float', def: 10 },

  { key: 'startBalance', dom: 'startBalance', type: 'currency', def: 4000 },
  { key: 'baseWithdrawal', dom: 'baseWithdrawal', type: 'currency', def: 80 },
  { key: 'floorBalance', dom: 'floorBalance', type: 'currency', def: 2000 },
  { key: 'floorPenalty', dom: 'floorPenalty', type: 'float', def: 50 },
  { key: 'ceilingBalance', dom: 'ceilingBalance', type: 'currency', def: 5000 },
  { key: 'ceilingBonus', dom: 'ceilingBonus', type: 'float', def: 50 },
  // Minimum withdrawal each year in $000s (after adjustments), regardless of strategy.
  { key: 'withdrawalFloor', dom: 'withdrawalFloor', type: 'currency', def: 0 },

  // Front-loading: annual real change applied to the whole target withdrawal, plus
  // an optional flat bonus for the first goGoYears years. Defaults are neutral.
  { key: 'spendChangePct', dom: 'spendChangePct', type: 'float', def: 0 },
  { key: 'goGoBonus', dom: 'goGoBonus', type: 'currency', def: 0 },
  { key: 'goGoYears', dom: 'goGoYears', type: 'int', def: 10 },
  { key: 'specificWithdrawals', dom: 'specificWithdrawals', type: 'string', def: '' },

  { key: 'enableDynamicAdjustments', dom: 'enableDynamicAdjustments', type: 'boolean', def: true },
  { key: 'dynLowRet', dom: 'dynLowRet', type: 'float', def: -15 },
  { key: 'dynLowBal', dom: 'dynLowBal', type: 'currency', def: 1000 },
  { key: 'dynLowAdj', dom: 'dynLowAdj', type: 'currency', def: 0 },
  { key: 'dynMedRet', dom: 'dynMedRet', type: 'float', def: 5 },
  { key: 'dynMedBal', dom: 'dynMedBal', type: 'currency', def: 5000 },
  { key: 'dynMedAdj', dom: 'dynMedAdj', type: 'currency', def: 100 },
  { key: 'dynHighRet', dom: 'dynHighRet', type: 'float', def: 20 },
  { key: 'dynHighBal', dom: 'dynHighBal', type: 'currency', def: 8000 },
  { key: 'dynHighAdj', dom: 'dynHighAdj', type: 'currency', def: 200 },

  { key: 'usLgGrowthMean', dom: 'usLgGrowthMean', type: 'float', def: null },
  { key: 'usLgGrowthStdDev', dom: 'usLgGrowthStdDev', type: 'float', def: null },
  { key: 'usLgValueMean', dom: 'usLgValueMean', type: 'float', def: null },
  { key: 'usLgValueStdDev', dom: 'usLgValueStdDev', type: 'float', def: null },
  { key: 'usSmMidMean', dom: 'usSmMidMean', type: 'float', def: null },
  { key: 'usSmMidStdDev', dom: 'usSmMidStdDev', type: 'float', def: null },
  { key: 'exUsMean', dom: 'exUsMean', type: 'float', def: null },
  { key: 'exUsStdDev', dom: 'exUsStdDev', type: 'float', def: null },
  { key: 'bondReturnMean', dom: 'bondReturnMean', type: 'float', def: null },
  { key: 'bondReturnStdDev', dom: 'bondReturnStdDev', type: 'float', def: null },
  { key: 'cashReturnMean', dom: 'cashReturnMean', type: 'float', def: null },
  { key: 'cashReturnStdDev', dom: 'cashReturnStdDev', type: 'float', def: null },
  { key: 'inflationMean', dom: 'inflationMean', type: 'float', def: null },
  { key: 'inflationStdDev', dom: 'inflationStdDev', type: 'float', def: null },
];

const FIELD_BY_KEY = new Map(FIELDS.map((f) => [f.key, f]));

export const ALLOCATION_KEYS = [
  'usLgGrowthAllocation',
  'usLgValueAllocation',
  'usSmMidAllocation',
  'exUsAllocation',
  'bondAllocation',
  'cashAllocation',
];

export function parseCurrency(val) {
  if (typeof val === 'number') return val;
  if (val == null || val === '') return 0;
  return parseFloat(String(val).replace(/,/g, '')) || 0;
}

/** Convert a $000s scenario value to dollars for the simulation engine. */
export function toDollars(thousands) {
  return parseCurrency(thousands) * MONEY_SCALE;
}

export function formatCurrency(val) {
  const n = parseCurrency(val);
  if (Number.isNaN(n)) return '';
  return n.toLocaleString('en-US');
}

/** Upgrade v1 scenarios that stored currency fields in full dollars. */
export function migrateScenario(scenario, schemaVersion = SCHEMA_VERSION) {
  if (!scenario || schemaVersion >= 2) return scenario;
  const migrated = { ...scenario };
  for (const f of FIELDS) {
    if (f.type === 'currency' && migrated[f.key] != null && migrated[f.key] !== '') {
      migrated[f.key] = migrated[f.key] / MONEY_SCALE;
    }
  }
  return migrated;
}

export function defaultScenario() {
  const scenario = { distMethod: 'resampling', withdrawalStrategy: 'base' };
  for (const f of FIELDS) scenario[f.key] = f.def;
  return scenario;
}

// Read the current DOM input values into a scenario object.
export function readScenarioFromDom(doc = document) {
  const scenario = {};
  for (const f of FIELDS) {
    const el = doc.getElementById(f.dom);
    if (!el) {
      scenario[f.key] = f.def;
      continue;
    }
    if (f.type === 'boolean') {
      scenario[f.key] = el.checked;
    } else {
      scenario[f.key] = parseField(el.value, f.type);
    }
  }
  const checked = doc.querySelector('input[name="distribution-method"]:checked');
  scenario.distMethod = checked ? checked.value : 'resampling';
  
  const strat = doc.querySelector('input[name="withdrawal-strategy"]:checked');
  scenario.withdrawalStrategy = strat ? strat.value : 'base';
  
  return scenario;
}

// Write a scenario object back into the DOM inputs.
export function writeScenarioToDom(scenario, doc = document) {
  for (const f of FIELDS) {
    const el = doc.getElementById(f.dom);
    if (!el) continue;
    if (f.type === 'boolean') {
      el.checked = !!scenario[f.key];
    } else {
      const value = scenario[f.key];
      el.value = formatField(value, f.type);
    }
  }

  const method = scenario.distMethod || 'resampling';
  const radio = doc.querySelector(`input[name="distribution-method"][value="${method}"]`);
  if (radio) radio.checked = true;

  const strat = scenario.withdrawalStrategy || 'base';
  const stratRadio = doc.querySelector(`input[name="withdrawal-strategy"][value="${strat}"]`);
  if (stratRadio) stratRadio.checked = true;

  // Keep the block-size slider in sync with its number input.
  const slider = doc.getElementById('blockSizeSlider');
  if (slider && scenario.blockSize != null) slider.value = scenario.blockSize;
}

function parseField(raw, type) {
  switch (type) {
    case 'int': {
      const n = parseInt(raw, 10);
      return Number.isNaN(n) ? null : n;
    }
    case 'float': {
      const n = parseFloat(raw);
      return Number.isNaN(n) ? null : n;
    }
    case 'currency':
      return parseCurrency(raw);
    case 'string':
    default:
      return raw == null ? '' : String(raw);
  }
}

function formatField(value, type) {
  if (value == null || value === '') return '';
  if (type === 'currency') return formatCurrency(value);
  return String(value);
}

const WITHDRAWAL_THOUSAND_COMMA = '\uFFFF';

/** Parse pasted withdrawal amounts (in thousands) from mixed spreadsheet delimiters. */
export function parseSpecificWithdrawals(raw) {
  if (!raw || typeof raw !== 'string') return [];
  // Protect commas in 1,234-style grouping before splitting on list delimiters.
  const protectedRaw = raw.replace(/(\d),(?=\d{3}(?:\d|,|\b))/g, `$1${WITHDRAWAL_THOUSAND_COMMA}`);
  // Remaining commas separate values (e.g. "80, 85" or "80,85,90").
  const withCommasSplit = protectedRaw.replace(/,(?=\s*-?\d)/g, '\n');
  const tokens = withCommasSplit
    .split(/[\r\n\t;,|]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return tokens.map((t) => {
    const cleaned = t.replace(new RegExp(WITHDRAWAL_THOUSAND_COMMA, 'g'), ',').replace(/^\$/, '').trim();
    return toDollars(parseCurrency(cleaned));
  });
}

/** Truncate or extend a parsed list to match the simulation horizon (raw input unchanged). */
export function fitSpecificWithdrawalsToHorizon(amounts, numYears) {
  if (numYears <= 0) return [];
  const trimmed = amounts.slice(0, numYears);
  if (trimmed.length === 0) return Array(numYears).fill(0);
  const last = trimmed[trimmed.length - 1];
  while (trimmed.length < numYears) trimmed.push(last);
  return trimmed;
}

// Convert a scenario plus the resolved historical samples into the flat params
// object consumed by the simulation engine.
export function buildSimParams(scenario, samples) {
  const seedRaw = String(scenario.randomSeed ?? '').trim();
  const seed = seedRaw === '' ? (Math.random() * 0xffffffff) >>> 0 : parseInt(seedRaw, 10) >>> 0;

  return {
    numYears: scenario.numYears,
    numSimulations: scenario.numSimulations,
    seed,
    distMethod: scenario.distMethod,
    blockSize: scenario.blockSize || 1,
    // Fraction of runs on each side of a percentile rank to average together
    // (clamped to a sane range). Consumed by the worker's path smoothing.
    smoothFraction: Math.min(Math.max(num(scenario.smoothWindowPct) / 100, 0), 0.1),
    allocation: {
      usLgGrowth: (scenario.usLgGrowthAllocation || 0) / 100,
      usLgValue: (scenario.usLgValueAllocation || 0) / 100,
      usSmMid: (scenario.usSmMidAllocation || 0) / 100,
      exUs: (scenario.exUsAllocation || 0) / 100,
      bond: (scenario.bondAllocation || 0) / 100,
      cash: (scenario.cashAllocation || 0) / 100,
    },
    portfolio: {
      strategy: scenario.withdrawalStrategy || 'base',
      specificWithdrawals: fitSpecificWithdrawalsToHorizon(
        parseSpecificWithdrawals(scenario.specificWithdrawals),
        scenario.numYears,
      ),
      start: toDollars(scenario.startBalance),
      base: toDollars(scenario.baseWithdrawal),
      floorBalance: toDollars(scenario.floorBalance),
      floorPenalty: (scenario.floorPenalty || 0) / 100,
      ceilingBalance: toDollars(scenario.ceilingBalance) || Infinity,
      ceilingBonus: (scenario.ceilingBonus || 0) / 100,
      withdrawalFloor: toDollars(scenario.withdrawalFloor),
      // Front-loading controls. Same name as the scenario's spendChangePct field,
      // but converted from a percentage to a decimal rate.
      spendChangeRate: (scenario.spendChangePct || 0) / 100,
      goGoBonus: toDollars(scenario.goGoBonus),
      goGoYears: scenario.goGoYears || 0,
    },
    dynConfig: {
      enabled: scenario.enableDynamicAdjustments ?? true,
      low: { ret: scenario.dynLowRet, bal: toDollars(scenario.dynLowBal), adj: toDollars(scenario.dynLowAdj) },
      med: { ret: scenario.dynMedRet, bal: toDollars(scenario.dynMedBal), adj: toDollars(scenario.dynMedAdj) },
      high: { ret: scenario.dynHighRet, bal: toDollars(scenario.dynHighBal), adj: toDollars(scenario.dynHighAdj) },
    },
    logNormal: {
      usLgGrowth: { mean: num(scenario.usLgGrowthMean) / 100, stdDev: num(scenario.usLgGrowthStdDev) / 100 },
      usLgValue: { mean: num(scenario.usLgValueMean) / 100, stdDev: num(scenario.usLgValueStdDev) / 100 },
      usSmMid: { mean: num(scenario.usSmMidMean) / 100, stdDev: num(scenario.usSmMidStdDev) / 100 },
      exUs: { mean: num(scenario.exUsMean) / 100, stdDev: num(scenario.exUsStdDev) / 100 },
      bond: { mean: num(scenario.bondReturnMean) / 100, stdDev: num(scenario.bondReturnStdDev) / 100 },
      cash: { mean: num(scenario.cashReturnMean) / 100, stdDev: num(scenario.cashReturnStdDev) / 100 },
      inflation: { mean: num(scenario.inflationMean) / 100, stdDev: num(scenario.inflationStdDev) / 100 },
      // Cholesky factor of the historical correlation matrix (same year range as
      // the profiles). Lets log-normal draws preserve cross-asset correlations.
      chol: samples && samples.years ? correlationCholesky(samples.years) : null,
    },
    samples,
  };
}

function num(v) {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isNaN(n) ? 0 : n;
}

// Upper bounds keep a single run from locking up the browser for minutes.
export const MAX_NUM_YEARS = 100;
export const MAX_NUM_SIMULATIONS = 100000;

// Validate a scenario for running. Returns an array of human-readable errors.
export function validateScenario(scenario, { minYear, maxYear }) {
  const errors = [];

  if (!Number.isFinite(scenario.numYears) || scenario.numYears < 1 || scenario.numYears > MAX_NUM_YEARS) {
    errors.push(`Investment horizon must be between 1 and ${MAX_NUM_YEARS} years.`);
  }
  if (
    !Number.isFinite(scenario.numSimulations) ||
    scenario.numSimulations < 1 ||
    scenario.numSimulations > MAX_NUM_SIMULATIONS
  ) {
    errors.push(`Number of simulations must be between 1 and ${MAX_NUM_SIMULATIONS.toLocaleString('en-US')}.`);
  }

  // The dynamic adjustment curve interpolates between the three market-return
  // anchors, so they must be strictly increasing (low < expected < high).
  if (scenario.enableDynamicAdjustments) {
    const { dynLowRet, dynMedRet, dynHighRet } = scenario;
    if (
      !Number.isFinite(dynLowRet) || !Number.isFinite(dynMedRet) || !Number.isFinite(dynHighRet) ||
      !(dynLowRet < dynMedRet && dynMedRet < dynHighRet)
    ) {
      errors.push('Dynamic adjustment market triggers must increase: Low Return < Expected < High Return.');
    }

    // The spending scale needs a neutral band: when both a floor and a ceiling
    // are set (non-zero), the floor must sit below the ceiling.
    const floor = parseCurrency(scenario.floorBalance);
    const ceiling = parseCurrency(scenario.ceilingBalance);
    if (floor > 0 && ceiling > 0 && floor >= ceiling) {
      errors.push('Floor Balance must be less than Ceiling Balance.');
    }
  }

  const total = ALLOCATION_KEYS.reduce((sum, k) => sum + (scenario[k] || 0), 0);
  if (Math.abs(total - 100) > 0.01) {
    errors.push(`Total asset allocation must equal 100%. Current total: ${total.toFixed(2)}%`);
  }

  if (scenario.distMethod === 'lognormal') {
    const missing = [
      'usLgGrowthMean', 'usLgGrowthStdDev', 'usLgValueMean', 'usLgValueStdDev',
      'usSmMidMean', 'usSmMidStdDev', 'exUsMean', 'exUsStdDev',
      'bondReturnMean', 'bondReturnStdDev', 'cashReturnMean', 'cashReturnStdDev',
      'inflationMean', 'inflationStdDev',
    ].some((k) => scenario[k] == null || scenario[k] === '');
    if (missing) {
      errors.push('Log-normal profiles are incomplete. Click "Update From History" to populate them.');
    }
  }

  if (
    !Number.isFinite(scenario.startYear) ||
    !Number.isFinite(scenario.endYear) ||
    scenario.startYear > scenario.endYear ||
    scenario.startYear < minYear ||
    scenario.endYear > maxYear
  ) {
    errors.push(`Year range must be valid and within ${minYear}-${maxYear}.`);
  }

  return errors;
}

export { FIELDS, FIELD_BY_KEY };
