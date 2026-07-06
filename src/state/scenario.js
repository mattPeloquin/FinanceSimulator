// Single source of truth for all user inputs.
//
// A "scenario" is a flat, JSON-serialisable object. Each field declares the DOM
// element it binds to and how to parse/format it. This removes the scattered
// getElementById calls of the original app and makes persistence, export/import,
// and validation trivial.

import { correlationCholesky, computeStandardizedYears } from '../core/history.js';
import { formatPct1, roundPct1 } from '../core/precision.js';
import { buildWithdrawalFloorSeries, buildSpecificWithdrawalFloorSeries } from '../core/withdrawal.js';
import { SCENARIO_DEFAULTS } from './defaults.js';

export { SCENARIO_DEFAULTS } from './defaults.js';

export const SCHEMA_VERSION = 3;

// All currency fields are stored and edited in thousands ($000s). Simulation uses dollars.
export const MONEY_SCALE = 1000;

// type: how the raw input string is parsed and re-formatted.
//   int      -> integer
//   float    -> float
//   pct1     -> percent with one decimal (return assumptions)
//   currency -> float in thousands ($000s), displayed with thousands separators
//   string   -> raw string (e.g. optional seed)
function field(key, dom, type) {
  return { key, dom, type, def: SCENARIO_DEFAULTS[key] };
}

const FIELDS = [
  field('numYears', 'numYears', 'int'),
  field('numSimulations', 'numSimulations', 'int'),
  field('randomSeed', 'randomSeed', 'string'),
  field('smoothWindowPct', 'smoothWindowPct', 'float'),
  field('planRiskTolerancePct', 'planRiskTolerancePct', 'float'),

  field('startYear', 'startYear', 'int'),
  field('endYear', 'endYear', 'int'),
  field('blockSize', 'blockSize', 'int'),
  field('scaledHistoricalSmoothing', 'scaledHistoricalSmoothing', 'float'),

  field('usLgGrowthAllocation', 'usLgGrowthAllocation', 'float'),
  field('usLgValueAllocation', 'usLgValueAllocation', 'float'),
  field('usSmMidAllocation', 'usSmMidAllocation', 'float'),
  field('exUsAllocation', 'exUsAllocation', 'float'),
  field('bondAllocation', 'bondAllocation', 'float'),
  field('cashAllocation', 'cashAllocation', 'float'),

  field('startBalance', 'startBalance', 'currency'),
  field('baseWithdrawal', 'baseWithdrawal', 'currency'),
  field('floorBalance', 'floorBalance', 'currency'),
  field('floorPenalty', 'floorPenalty', 'float'),
  field('ceilingBalance', 'ceilingBalance', 'currency'),
  field('ceilingBonus', 'ceilingBonus', 'float'),

  field('spendChangePct', 'spendChangePct', 'float'),
  field('goGoBonus', 'goGoBonus', 'currency'),
  field('goGoYears', 'goGoYears', 'int'),
  field('specificWithdrawals', 'specificWithdrawals', 'string'),

  field('enableDynamicAdjustments', 'enableDynamicAdjustments', 'boolean'),
  field('dynLowRet', 'dynLowRet', 'float'),
  field('dynLowBal', 'dynLowBal', 'optionalCurrency'),
  field('dynLowAdj', 'dynLowAdj', 'currency'),
  field('dynMedRet', 'dynMedRet', 'float'),
  field('dynMedBal', 'dynMedBal', 'optionalCurrency'),
  field('dynMedAdj', 'dynMedAdj', 'currency'),
  field('dynHighRet', 'dynHighRet', 'float'),
  field('dynHighBal', 'dynHighBal', 'optionalCurrency'),
  field('dynHighAdj', 'dynHighAdj', 'currency'),

  field('usLgGrowthMean', 'usLgGrowthMean', 'pct1'),
  field('usLgGrowthStdDev', 'usLgGrowthStdDev', 'pct1'),
  field('usLgValueMean', 'usLgValueMean', 'pct1'),
  field('usLgValueStdDev', 'usLgValueStdDev', 'pct1'),
  field('usSmMidMean', 'usSmMidMean', 'pct1'),
  field('usSmMidStdDev', 'usSmMidStdDev', 'pct1'),
  field('exUsMean', 'exUsMean', 'pct1'),
  field('exUsStdDev', 'exUsStdDev', 'pct1'),
  field('bondReturnMean', 'bondReturnMean', 'pct1'),
  field('bondReturnStdDev', 'bondReturnStdDev', 'pct1'),
  field('cashReturnMean', 'cashReturnMean', 'pct1'),
  field('cashReturnStdDev', 'cashReturnStdDev', 'pct1'),
  field('inflationMean', 'inflationMean', 'pct1'),
  field('inflationStdDev', 'inflationStdDev', 'pct1'),

  field('goalSeekMode', 'goalSeekMode', 'boolean'),
  field('goalSeekTargetEndingBalance', 'goalSeekTargetEndingBalance', 'currency'),
  field('goalSeekDesiredSuccessPct', 'goalSeekDesiredSuccessPct', 'float'),
  field('goalSeekRiskTolerancePct', 'goalSeekRiskTolerancePct', 'float'),
  field('goalSeekIncludeBaseWithdrawal', 'goalSeekIncludeBaseWithdrawal', 'boolean'),
  field('goalSeekIncludeGoGoYears', 'goalSeekIncludeGoGoYears', 'boolean'),
  field('goalSeekIncludeMarketAdjustments', 'goalSeekIncludeMarketAdjustments', 'boolean'),
  field('goalSeekIncludeBalanceOverrides', 'goalSeekIncludeBalanceOverrides', 'boolean'),
  field('goalSeekNumSimulations', 'goalSeekNumSimulations', 'int'),
  field('parallelCores', 'parallelCores', 'string'),
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
  const normalized = String(val)
    .replace(/\u2212/g, '-')
    .replace(/[$,]/g, '')
    .trim();
  const n = parseFloat(normalized);
  return Number.isFinite(n) ? n : 0;
}

/** Convert a $000s scenario value to dollars for the simulation engine. */
export function toDollars(thousands) {
  return parseCurrency(thousands) * MONEY_SCALE;
}

/** Balance override threshold in dollars, or null when blank/zero (disabled). */
export function optionalBalanceThreshold(thousands) {
  const k = parseCurrency(thousands);
  return k > 0 ? k * MONEY_SCALE : null;
}

export function formatCurrency(val) {
  const n = parseCurrency(val);
  if (Number.isNaN(n)) return '';
  return n.toLocaleString('en-US');
}

/** Upgrade saved scenarios from older schema versions. */
export function migrateScenario(scenario, schemaVersion = SCHEMA_VERSION) {
  if (!scenario) return scenario;
  let migrated = { ...scenario };

  if (schemaVersion < 2) {
    for (const f of FIELDS) {
      if (f.type === 'currency' && migrated[f.key] != null && migrated[f.key] !== '') {
        migrated[f.key] = migrated[f.key] / MONEY_SCALE;
      }
    }
    if (migrated.withdrawalFloor != null && migrated.withdrawalFloor !== '') {
      migrated.withdrawalFloor = migrated.withdrawalFloor / MONEY_SCALE;
    }
  }

  if (schemaVersion < 3) {
    if (migrated.withdrawalFloors == null) {
      const legacyFloor = parseCurrency(migrated.withdrawalFloor);
      migrated.withdrawalFloors = legacyFloor > 0 ? [{ amount: legacyFloor }] : [];
    }
    delete migrated.withdrawalFloor;
  }

  if (migrated.goalSeekIncludeBaseWithdrawal == null && migrated.goalSeekPinBaseWithdrawal != null) {
    migrated.goalSeekIncludeBaseWithdrawal = !migrated.goalSeekPinBaseWithdrawal;
  }
  delete migrated.goalSeekPinBaseWithdrawal;

  return migrated;
}

/** Normalize withdrawal floor tiers; empty array means no minimum withdrawal. */
export function normalizeWithdrawalFloors(tiers) {
  if (!Array.isArray(tiers) || tiers.length === 0) {
    return [];
  }
  return tiers.map((tier, index, arr) => {
    const amount = parseCurrency(tier?.amount);
    const isLast = index === arr.length - 1;
    if (isLast) return { amount };
    const years = parseInt(tier?.years, 10);
    return { amount, years: Number.isFinite(years) && years >= 1 ? years : 1 };
  });
}

export function readWithdrawalFloorsFromDom(doc = document) {
  const list = doc.getElementById('withdrawalFloorsList');
  if (!list) return normalizeWithdrawalFloors(SCENARIO_DEFAULTS.withdrawalFloors);

  const rows = list.querySelectorAll('[data-withdrawal-floor-row]');
  if (rows.length === 0) return [];

  const tiers = [];
  rows.forEach((row, index) => {
    const amountInput = row.querySelector('[data-floor-amount]');
    const yearsInput = row.querySelector('[data-floor-years]');
    const amount = parseCurrency(amountInput?.value);
    const isLast = index === rows.length - 1;
    if (isLast) {
      tiers.push({ amount });
    } else {
      const years = parseInt(yearsInput?.value, 10);
      tiers.push({ amount, years: Number.isFinite(years) ? years : null });
    }
  });
  return tiers;
}

export function writeWithdrawalFloorsToDom(tiers, doc = document) {
  const list = doc.getElementById('withdrawalFloorsList');
  if (!list) return;

  const normalized = normalizeWithdrawalFloors(tiers);
  list.innerHTML = '';

  normalized.forEach((tier, index) => {
    const isLast = index === normalized.length - 1;
    const row = doc.createElement('div');
    row.className = 'flex flex-wrap items-end gap-2 mb-2';
    row.dataset.withdrawalFloorRow = String(index);

    const amountWrap = doc.createElement('div');
    amountWrap.className = 'flex-1 min-w-[7rem]';
    amountWrap.innerHTML = `
      <label class="block text-[10px] uppercase text-theme-faint font-semibold">Minimum</label>
      <div class="input-adorned has-suffix mt-1">
        <input type="text" data-floor-amount class="currency-input w-full rounded input-theme p-1 text-sm" value="${formatCurrency(tier.amount)}">
        <span class="input-adorn-suffix">000s</span>
      </div>`;

    row.appendChild(amountWrap);

    if (!isLast) {
      const yearsWrap = doc.createElement('div');
      yearsWrap.className = 'w-20';
      yearsWrap.innerHTML = `
        <label class="block text-[10px] uppercase text-theme-faint font-semibold">Years</label>
        <input type="number" data-floor-years min="1" class="w-full rounded input-theme p-1 text-sm text-center mt-1" value="${tier.years ?? 1}">`;
      row.appendChild(yearsWrap);
    } else if (normalized.length > 1) {
      const labelWrap = doc.createElement('div');
      labelWrap.className = 'pb-1 text-[10px] text-theme-faint';
      labelWrap.textContent = 'remaining years';
      row.appendChild(labelWrap);
    }

    const removeBtn = doc.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'remove-withdrawal-floor-tier text-xs text-theme-muted hover:text-theme-danger px-2 py-1 mb-0.5';
    removeBtn.textContent = 'Remove';
    row.appendChild(removeBtn);

    list.appendChild(row);
  });
}

function clampPct(value) {
  const n = typeof value === 'number' ? value : parseFloat(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(Math.max(n, 0), 100);
}

/** Normalize Specific List minimum tiers; empty array means no minimum. */
export function normalizeSpecificWithdrawalFloors(tiers) {
  if (!Array.isArray(tiers) || tiers.length === 0) {
    return [];
  }
  return tiers.map((tier, index, arr) => {
    const pct = clampPct(tier?.pct);
    const isLast = index === arr.length - 1;
    if (isLast) return { pct };
    const years = parseInt(tier?.years, 10);
    return { pct, years: Number.isFinite(years) && years >= 1 ? years : 1 };
  });
}

export function readSpecificWithdrawalFloorsFromDom(doc = document) {
  const list = doc.getElementById('specificWithdrawalFloorsList');
  if (!list) return normalizeSpecificWithdrawalFloors(SCENARIO_DEFAULTS.specificWithdrawalFloors);

  const rows = list.querySelectorAll('[data-specific-withdrawal-floor-row]');
  if (rows.length === 0) return [];

  const tiers = [];
  rows.forEach((row, index) => {
    const pctInput = row.querySelector('[data-specific-floor-pct]');
    const yearsInput = row.querySelector('[data-specific-floor-years]');
    const pct = clampPct(pctInput?.value);
    const isLast = index === rows.length - 1;
    if (isLast) {
      tiers.push({ pct });
    } else {
      const years = parseInt(yearsInput?.value, 10);
      tiers.push({ pct, years: Number.isFinite(years) ? years : null });
    }
  });
  return tiers;
}

export function writeSpecificWithdrawalFloorsToDom(tiers, doc = document) {
  const list = doc.getElementById('specificWithdrawalFloorsList');
  if (!list) return;

  const normalized = normalizeSpecificWithdrawalFloors(tiers);
  list.innerHTML = '';

  normalized.forEach((tier, index) => {
    const isLast = index === normalized.length - 1;
    const row = doc.createElement('div');
    row.className = 'flex flex-wrap items-end gap-2 mb-2';
    row.dataset.specificWithdrawalFloorRow = String(index);

    const pctWrap = doc.createElement('div');
    pctWrap.className = 'flex-1 min-w-[7rem]';
    pctWrap.innerHTML = `
      <label class="block text-[10px] uppercase text-theme-faint font-semibold">Minimum</label>
      <div class="input-adorned has-suffix mt-1">
        <input type="number" data-specific-floor-pct min="0" max="100" step="1" class="w-full rounded input-theme p-1 text-sm text-center" value="${tier.pct}">
        <span class="input-adorn-suffix">%</span>
      </div>`;

    row.appendChild(pctWrap);

    if (!isLast) {
      const yearsWrap = doc.createElement('div');
      yearsWrap.className = 'w-20';
      yearsWrap.innerHTML = `
        <label class="block text-[10px] uppercase text-theme-faint font-semibold">Years</label>
        <input type="number" data-specific-floor-years min="1" class="w-full rounded input-theme p-1 text-sm text-center mt-1" value="${tier.years ?? 1}">`;
      row.appendChild(yearsWrap);
    } else if (normalized.length > 1) {
      const labelWrap = doc.createElement('div');
      labelWrap.className = 'pb-1 text-[10px] text-theme-faint';
      labelWrap.textContent = 'remaining years';
      row.appendChild(labelWrap);
    }

    const removeBtn = doc.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'remove-specific-withdrawal-floor-tier text-xs text-theme-muted hover:text-theme-danger px-2 py-1 mb-0.5';
    removeBtn.textContent = 'Remove';
    row.appendChild(removeBtn);

    list.appendChild(row);
  });
}

export function defaultScenario() {
  return { ...SCENARIO_DEFAULTS };
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
  scenario.distMethod = checked ? checked.value : SCENARIO_DEFAULTS.distMethod;

  const strat = doc.querySelector('input[name="withdrawal-strategy"]:checked');
  scenario.withdrawalStrategy = strat ? strat.value : SCENARIO_DEFAULTS.withdrawalStrategy;
  scenario.withdrawalFloors = readWithdrawalFloorsFromDom(doc);
  scenario.specificWithdrawalFloors = readSpecificWithdrawalFloorsFromDom(doc);

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

  const method = scenario.distMethod || SCENARIO_DEFAULTS.distMethod;
  const radio = doc.querySelector(`input[name="distribution-method"][value="${method}"]`);
  if (radio) radio.checked = true;

  const strat = scenario.withdrawalStrategy || SCENARIO_DEFAULTS.withdrawalStrategy;
  const stratRadio = doc.querySelector(`input[name="withdrawal-strategy"][value="${strat}"]`);
  if (stratRadio) stratRadio.checked = true;

  // Keep the block-size and smoothing sliders in sync with their number inputs.
  const slider = doc.getElementById('blockSizeSlider');
  if (slider && scenario.blockSize != null) slider.value = scenario.blockSize;
  const smoothSlider = doc.getElementById('scaledHistoricalSmoothingSlider');
  if (smoothSlider && scenario.scaledHistoricalSmoothing != null) {
    smoothSlider.value = scenario.scaledHistoricalSmoothing;
  }
  const goalSeekSuccessSlider = doc.getElementById('goalSeekDesiredSuccessPctSlider');
  if (goalSeekSuccessSlider && scenario.goalSeekDesiredSuccessPct != null) {
    goalSeekSuccessSlider.value = scenario.goalSeekDesiredSuccessPct;
  }
  const goalSeekRiskSlider = doc.getElementById('goalSeekRiskTolerancePctSlider');
  if (goalSeekRiskSlider && scenario.goalSeekRiskTolerancePct != null) {
    goalSeekRiskSlider.value = scenario.goalSeekRiskTolerancePct;
  }
  const planRiskSlider = doc.getElementById('planRiskTolerancePctSlider');
  if (planRiskSlider && scenario.planRiskTolerancePct != null) {
    planRiskSlider.value = scenario.planRiskTolerancePct;
  }

  writeWithdrawalFloorsToDom(
    scenario.withdrawalFloors ?? SCENARIO_DEFAULTS.withdrawalFloors,
    doc,
  );
  writeSpecificWithdrawalFloorsToDom(
    scenario.specificWithdrawalFloors ?? SCENARIO_DEFAULTS.specificWithdrawalFloors,
    doc,
  );
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
    case 'pct1': {
      const n = parseFloat(raw);
      return Number.isNaN(n) ? null : roundPct1(n);
    }
    case 'currency':
      return parseCurrency(raw);
    case 'optionalCurrency':
      return parseCurrency(raw);
    case 'string':
    default:
      return raw == null ? '' : String(raw);
  }
}

function formatField(value, type) {
  if (value == null || value === '') return '';
  if (type === 'optionalCurrency' && parseCurrency(value) === 0) return '';
  if (type === 'currency' || type === 'optionalCurrency') return formatCurrency(value);
  if (type === 'pct1') return formatPct1(value);
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
      strategy: scenario.withdrawalStrategy || SCENARIO_DEFAULTS.withdrawalStrategy,
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
      withdrawalFloorSeries: (() => {
        if (scenario.withdrawalStrategy === 'specific') {
          const specificAmounts = fitSpecificWithdrawalsToHorizon(
            parseSpecificWithdrawals(scenario.specificWithdrawals),
            scenario.numYears,
          );
          return buildSpecificWithdrawalFloorSeries(
            normalizeSpecificWithdrawalFloors(scenario.specificWithdrawalFloors),
            specificAmounts,
            scenario.numYears,
          );
        }
        return buildWithdrawalFloorSeries(
          normalizeWithdrawalFloors(scenario.withdrawalFloors),
          scenario.numYears,
          toDollars,
        );
      })(),
      // Front-loading controls. Same name as the scenario's spendChangePct field,
      // but converted from a percentage to a decimal rate.
      spendChangeRate: (scenario.spendChangePct || 0) / 100,
      goGoBonus: toDollars(scenario.goGoBonus),
      goGoYears: scenario.goGoYears || 0,
    },
    dynConfig: readDynConfigFromScenario(scenario),
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
    scaledHistoricalShocks:
      samples && samples.years ? computeStandardizedYears(samples.years) : null,
    scaledHistoricalSmoothing: Math.min(
      Math.max(num(scenario.scaledHistoricalSmoothing) / 100, 0),
      1,
    ),
    // Max allowed lifetime spending shortfall vs. plan when packaging results.
    shortfallTolerance: planShortfallTolerance(scenario),
    samples,
  };
}

/** Fraction 0–0.65 from the advanced "Plan Risk Tolerance" setting. */
export function planShortfallTolerance(scenario) {
  return Math.min(Math.max(num(scenario.planRiskTolerancePct) / 100, 0), 0.65);
}

function num(v) {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isNaN(n) ? 0 : n;
}

/** Build engine-ready dynamic adjustment config from a scenario object. */
export function readDynConfigFromScenario(scenario) {
  return {
    enabled: scenario.enableDynamicAdjustments ?? true,
    low: {
      ret: num(scenario.dynLowRet),
      bal: optionalBalanceThreshold(scenario.dynLowBal),
      adj: toDollars(scenario.dynLowAdj),
    },
    med: {
      ret: num(scenario.dynMedRet),
      bal: optionalBalanceThreshold(scenario.dynMedBal),
      adj: toDollars(scenario.dynMedAdj),
    },
    high: {
      ret: num(scenario.dynHighRet),
      bal: optionalBalanceThreshold(scenario.dynHighBal),
      adj: toDollars(scenario.dynHighAdj),
    },
  };
}

/** Read dynamic adjustment config from the form — same path as Run Simulation. */
export function readDynConfigFromDom(doc = document) {
  return readDynConfigFromScenario(readScenarioFromDom(doc));
}

// Convert a scenario's Goal Seek fields into the config object consumed by
// src/core/goalSeek.js's runGoalSeek(). Mirrors buildSimParams's job of
// translating $000s/percentages into the raw dollars/fractions the search
// algorithm works with.
export function buildGoalSeekConfig(scenario) {
  // A Specific List has no single scalar "base" to search — each year's
  // amount is typed in directly — so Goal Seek always keeps it fixed and
  // only tunes the Market/Balance adjustment levers on top of it. Go-Go
  // years (bonus front-loading) has no effect on the specific-list engine
  // path, so it's never searched here either.
  const isSpecific = scenario.withdrawalStrategy === 'specific';
  return {
    targetEndingBalance: toDollars(scenario.goalSeekTargetEndingBalance),
    desiredSuccessRate: Math.min(Math.max(num(scenario.goalSeekDesiredSuccessPct) / 100, 0), 1),
    shortfallTolerance: Math.min(Math.max(num(scenario.goalSeekRiskTolerancePct) / 100, 0), 1),
    pinBaseWithdrawal: isSpecific ? true : !scenario.goalSeekIncludeBaseWithdrawal,
    includeGoGoYears: isSpecific ? false : !!scenario.goalSeekIncludeGoGoYears,
    includeMarketAdjustments: !!scenario.goalSeekIncludeMarketAdjustments,
    includeBalanceOverrides: !!scenario.goalSeekIncludeBalanceOverrides,
    searchNumSimulations: num(scenario.goalSeekNumSimulations) || undefined,
  };
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
  const planRisk = scenario.planRiskTolerancePct;
  if (!Number.isFinite(planRisk) || planRisk < 0 || planRisk > 65) {
    errors.push('Plan risk tolerance must be between 0 and 65.');
  }
  if (
    scenario.goalSeekMode &&
    (!Number.isFinite(scenario.goalSeekNumSimulations) ||
      scenario.goalSeekNumSimulations < 1 ||
      scenario.goalSeekNumSimulations > MAX_NUM_SIMULATIONS)
  ) {
    errors.push(`Goal Seek's number of simulations must be between 1 and ${MAX_NUM_SIMULATIONS.toLocaleString('en-US')}.`);
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

  if (scenario.distMethod === 'lognormal' || scenario.distMethod === 'scaledHistorical') {
    const missing = [
      'usLgGrowthMean', 'usLgGrowthStdDev', 'usLgValueMean', 'usLgValueStdDev',
      'usSmMidMean', 'usSmMidStdDev', 'exUsMean', 'exUsStdDev',
      'bondReturnMean', 'bondReturnStdDev', 'cashReturnMean', 'cashReturnStdDev',
      'inflationMean', 'inflationStdDev',
    ].some((k) => scenario[k] == null || scenario[k] === '');
    if (missing) {
      errors.push('Return assumptions are incomplete. Adjust the year range or edit the Mean / Std Dev fields.');
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

  // Minimum-withdrawal tiers: absolute $ for Base, percentage for Specific List.
  const baseTiers = normalizeWithdrawalFloors(scenario.withdrawalFloors);
  if (scenario.withdrawalStrategy !== 'specific' && Number.isFinite(scenario.numYears) && baseTiers.length > 1) {
    let intermediateYears = 0;
    for (let i = 0; i < baseTiers.length - 1; i++) {
      const years = baseTiers[i].years;
      if (!Number.isFinite(years) || years < 1) {
        errors.push('Each minimum-withdrawal tier (except the last) must span at least 1 year.');
        break;
      }
      intermediateYears += years;
    }
    if (intermediateYears >= scenario.numYears) {
      errors.push('Minimum-withdrawal tiers must leave at least 1 year for the final tier.');
    }
  }

  const specificTiers = normalizeSpecificWithdrawalFloors(scenario.specificWithdrawalFloors);
  if (scenario.withdrawalStrategy === 'specific' && Number.isFinite(scenario.numYears) && specificTiers.length > 1) {
    let intermediateYears = 0;
    for (let i = 0; i < specificTiers.length - 1; i++) {
      const years = specificTiers[i].years;
      if (!Number.isFinite(years) || years < 1) {
        errors.push('Each Specific List minimum tier (except the last) must span at least 1 year.');
        break;
      }
      intermediateYears += years;
    }
    if (intermediateYears >= scenario.numYears) {
      errors.push('Specific List minimum tiers must leave at least 1 year for the final tier.');
    }
  }

  if (scenario.goalSeekMode) {
    const target = parseCurrency(scenario.goalSeekTargetEndingBalance);
    if (!Number.isFinite(target) || target < 0) {
      errors.push('Goal Seek target ending balance must be zero or a positive amount.');
    }
    const desired = scenario.goalSeekDesiredSuccessPct;
    if (!Number.isFinite(desired) || desired < 65 || desired > 99) {
      errors.push('Goal Seek desired success % must be between 65 and 99.');
    }
    const riskTolerance = scenario.goalSeekRiskTolerancePct;
    if (!Number.isFinite(riskTolerance) || riskTolerance < 0 || riskTolerance > 65) {
      errors.push('Goal Seek risk tolerance must be between 0 and 65.');
    }
    if (scenario.withdrawalStrategy === 'specific') {
      // With a Specific List, each year's amount is fixed as typed — Goal Seek
      // can only tune the Market/Balance adjustment levers on top of it.
      const hasSpecificLever =
        scenario.goalSeekIncludeMarketAdjustments || scenario.goalSeekIncludeBalanceOverrides;
      if (!hasSpecificLever) {
        errors.push('With a Specific List, Goal Seek keeps each year\'s amount fixed and can only tune the Market adjustment or Balance adjustment levers — include at least one of those in the search.');
      }
    } else if (!scenario.goalSeekIncludeBaseWithdrawal) {
      const base = parseCurrency(scenario.baseWithdrawal);
      if (!Number.isFinite(base) || base <= 0) {
        errors.push('When the base withdrawal is not included in the search, it must be a positive amount.');
      }
      const hasLever =
        scenario.goalSeekIncludeGoGoYears
        || scenario.goalSeekIncludeMarketAdjustments
        || scenario.goalSeekIncludeBalanceOverrides;
      if (!hasLever) {
        errors.push('When the base withdrawal is not included in the search, at least one other lever must be included.');
      }
    }
  }

  return errors;
}

export { FIELDS, FIELD_BY_KEY };
