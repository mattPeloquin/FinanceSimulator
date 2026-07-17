// Single source of truth for all user inputs.
//
// A "scenario" is a flat, JSON-serialisable object. Each field declares the DOM
// element it binds to and how to parse/format it. This removes the scattered
// getElementById calls of the original app and makes persistence, export/import,
// and validation trivial.

import { correlationCholesky, computeStandardizedYears } from '../core/history.js';
import { formatPct1, roundPct1 } from '../core/precision.js';
import { buildWithdrawalFloorSeries, buildSpecificWithdrawalFloorSeries, buildGiftingSeries, buildSpendingOverTimeSeries, buildMajorEventsSeries } from '../core/withdrawal.js';
import { buildAllocationOverTimeSeries } from '../core/allocation.js';
import { SCENARIO_DEFAULTS } from './defaults.js';
import {
  earlyWeightSlotFromStrengthPct,
  resolveEarlyWeighting,
} from '../core/statistics.js';

export { SCENARIO_DEFAULTS } from './defaults.js';

export const SCHEMA_VERSION = 8;

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
  // Risk Level slider: the range input itself is the canonical field (no
  // paired number input), plus the "use preset" on/off checkbox.
  field('presetLevel', 'presetLevel', 'int'),
  field('presetActive', 'presetActive', 'boolean'),

  field('numYears', 'numYears', 'int'),
  field('horizonPlusYears', 'horizonPlusYears', 'int'),
  field('horizonMinusYears', 'horizonMinusYears', 'int'),
  field('numSimulations', 'numSimulations', 'int'),
  field('randomSeed', 'randomSeed', 'string'),
  field('smoothWindowPct', 'smoothWindowPct', 'float'),
  field('planRiskTolerancePct', 'planRiskTolerancePct', 'float'),
  field('withdrawalMetric', 'withdrawalMetric', 'string'),
  // Range input is the canonical control (no paired number box).
  field('earlyWeightSlot', 'earlyWeightSlot', 'int'),
  field('earlyWeightEmphasisPct', 'earlyWeightEmphasisPct', 'float'),
  field('earlyWeightLateFloorPct', 'earlyWeightLateFloorPct', 'float'),

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

  // 'optionalCurrency' so the blank Easy Mode default survives a session
  // save/restore instead of coming back as "0" (0 is never a valid start —
  // validateScenario requires a positive amount).
  field('startBalance', 'startBalance', 'optionalCurrency'),
  field('baseWithdrawal', 'baseWithdrawal', 'currency'),
  field('floorBalance', 'floorBalance', 'currency'),
  field('floorPenalty', 'floorPenalty', 'float'),
  field('ceilingBalance', 'ceilingBalance', 'currency'),
  field('ceilingBonus', 'ceilingBonus', 'float'),
  // 'string' (not 'currency'/'optionalCurrency') so blank stays distinct from
  // a typed 0: blank disables the glide lever, 0 is a "land on zero" target.
  field('glideTarget', 'glideTarget', 'string'),
  field('glideFraction', 'glideFraction', 'float'),
  field('glideRate', 'glideRate', 'float'),

  field('specificWithdrawals', 'specificWithdrawals', 'string'),
  field('maxConsecutiveMinWithdrawals', 'maxConsecutiveMinWithdrawals', 'int'),
  field('minWithdrawalPlanRecoveryYears', 'minWithdrawalPlanRecoveryYears', 'int'),

  field('enableDynamicAdjustments', 'enableDynamicAdjustments', 'boolean'),
  field('dynLowRet', 'dynLowRet', 'float'),
  field('dynLowAdj', 'dynLowAdj', 'currency'),
  field('dynMedRet', 'dynMedRet', 'float'),
  field('dynMedAdj', 'dynMedAdj', 'currency'),
  field('dynHighRet', 'dynHighRet', 'float'),
  field('dynHighAdj', 'dynHighAdj', 'currency'),
  field('dynNoCutBal', 'dynNoCutBal', 'optionalCurrency'),
  // Signed %; blank = off (0% is a real floor: end ≥ start).
  field('dynMaxBoostDrawdownPct', 'dynMaxBoostDrawdownPct', 'optionalPct'),

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
  field('goalSeekIncludeSpendingOverTime', 'goalSeekIncludeSpendingOverTime', 'boolean'),
  field('goalSeekIncludeMarketAdjustments', 'goalSeekIncludeMarketAdjustments', 'boolean'),
  field('goalSeekIncludeBalanceOverrides', 'goalSeekIncludeBalanceOverrides', 'boolean'),
  field('goalSeekIncludeGlidePath', 'goalSeekIncludeGlidePath', 'boolean'),
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

/** Short UI labels for each allocation category (tier rows + preview legend). */
export const ALLOCATION_LABELS = {
  usLgGrowthAllocation: 'US Lg Growth',
  usLgValueAllocation: 'US Lg Value',
  usSmMidAllocation: 'US Sm/Mid',
  exUsAllocation: 'ex-US',
  bondAllocation: 'Bonds',
  cashAllocation: 'Cash',
};

/** History / chart color key for each scenario allocation field. */
export const ALLOCATION_CHART_KEYS = {
  usLgGrowthAllocation: 'us_lg_growth',
  usLgValueAllocation: 'us_lg_value',
  usSmMidAllocation: 'us_sm_mid',
  exUsAllocation: 'ex_us',
  bondAllocation: 'bond',
  cashAllocation: 'cash',
};

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

/** Signed percent as a fraction for the engine, or null when blank (disabled).
 *  Zero is a real value (e.g. max-boost drawdown 0% = end ≥ start), not "off". */
export function optionalSignedPctFraction(pct) {
  if (pct == null || pct === '') return null;
  const n = typeof pct === 'number' ? pct : parseFloat(pct);
  if (!Number.isFinite(n)) return null;
  return n / 100;
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
      const isCurrency = f.type === 'currency' || f.type === 'optionalCurrency';
      if (isCurrency && migrated[f.key] != null && migrated[f.key] !== '') {
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

  if (schemaVersion < 4) {
    if (migrated.spendingOverTimeTiers == null) {
      const changePct = migrated.spendChangePct ?? 0;
      const extra = parseCurrency(migrated.goGoBonus);
      const years = parseInt(migrated.goGoYears, 10);
      if (Number.isFinite(years) && years > 0) {
        migrated.spendingOverTimeTiers = [
          { changePct, extra, years },
          { changePct, extra: 0 },
        ];
      } else {
        migrated.spendingOverTimeTiers = [{ changePct, extra: 0 }];
      }
    }
    delete migrated.spendChangePct;
    delete migrated.goGoBonus;
    delete migrated.goGoYears;
    if (migrated.goalSeekIncludeSpendingOverTime == null && migrated.goalSeekIncludeGoGoYears != null) {
      migrated.goalSeekIncludeSpendingOverTime = migrated.goalSeekIncludeGoGoYears;
    }
    delete migrated.goalSeekIncludeGoGoYears;
  }

  if (migrated.goalSeekIncludeBaseWithdrawal == null && migrated.goalSeekPinBaseWithdrawal != null) {
    migrated.goalSeekIncludeBaseWithdrawal = !migrated.goalSeekPinBaseWithdrawal;
  }
  delete migrated.goalSeekPinBaseWithdrawal;

  // Easy Mode (presetActive / presetLevel) is part of saved scenario state.
  // Missing flag → detached. New empty workbenches get presetActive:true from
  // defaultScenario() itself, not via migration. Any persisted scenario that
  // omits the field (pre-slider saves, partial imports, or current-schema
  // records that never stored it) must load detached so merging with defaults
  // cannot turn Easy Mode on and overwrite hand-tuned values on the next
  // balance/horizon edit.
  if (migrated.presetActive == null) migrated.presetActive = false;
  if (migrated.presetLevel == null) migrated.presetLevel = SCENARIO_DEFAULTS.presetLevel;

  if (schemaVersion < 6) {
    // The three per-band "Bal <> Override" thresholds collapsed into a single
    // "no cut if balance above X" rule. The old Expected override carried
    // exactly those semantics (raise a cut back to the ~0 Expected adjustment
    // while the balance is above it), so it becomes the new threshold. The
    // forced-cut (Low) and forced-boost (High) overrides have no equivalent
    // and are dropped — the Balance adjustment floor/ceiling covers their
    // intent.
    if (migrated.dynNoCutBal == null && migrated.dynMedBal != null) {
      migrated.dynNoCutBal = migrated.dynMedBal;
    }
    delete migrated.dynLowBal;
    delete migrated.dynMedBal;
    delete migrated.dynHighBal;
  }

  if (schemaVersion < 7) {
    // Optional allocation glide schedule; empty = fixed static mix every year.
    if (migrated.allocationOverTimeTiers == null) {
      migrated.allocationOverTimeTiers = [];
    }
  }

  if (schemaVersion < 8) {
    // 0–100 strength + named shapes → 5-stop slot + Early emphasis / Late floor.
    if (migrated.earlyWeightSlot == null && migrated.earlyWeightStrengthPct != null) {
      migrated.earlyWeightSlot = earlyWeightSlotFromStrengthPct(migrated.earlyWeightStrengthPct);
    }
    if (migrated.earlyWeightSlot == null) {
      migrated.earlyWeightSlot = SCENARIO_DEFAULTS.earlyWeightSlot;
    }
    if (migrated.earlyWeightEmphasisPct == null) {
      migrated.earlyWeightEmphasisPct = SCENARIO_DEFAULTS.earlyWeightEmphasisPct;
    }
    if (migrated.earlyWeightLateFloorPct == null) {
      migrated.earlyWeightLateFloorPct = SCENARIO_DEFAULTS.earlyWeightLateFloorPct;
    }
    delete migrated.earlyWeightStrengthPct;
    delete migrated.rankWeightingShape;
  }

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

/** Optional percent: blank/empty → null; otherwise a finite number.
 *  Accepts values typed with a trailing % (the field already shows a % suffix). */
function parseOptionalPct(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const normalized = String(value).replace(/%/g, '').replace(/,/g, '').trim();
  if (normalized === '') return null;
  const n = parseFloat(normalized);
  return Number.isFinite(n) ? n : null;
}

function formatOptionalPct(value) {
  const n = parseOptionalPct(value);
  return n == null ? '' : String(n);
}

/** Normalize gifting tiers; empty array means no gifting. */
export function normalizeGiftingTiers(tiers) {
  if (!Array.isArray(tiers) || tiers.length === 0) {
    return [];
  }
  return tiers.map((tier, index, arr) => {
    const amount = parseCurrency(tier?.amount);
    const balance = parseCurrency(tier?.balance);
    const triggerPct = parseOptionalPct(tier?.triggerPct);
    const targetPct = parseOptionalPct(tier?.targetPct);
    const isLast = index === arr.length - 1;
    if (isLast) return { amount, balance, triggerPct, targetPct };
    const years = parseInt(tier?.years, 10);
    return {
      amount,
      balance,
      triggerPct,
      targetPct,
      years: Number.isFinite(years) && years >= 1 ? years : 1,
    };
  });
}

export function readGiftingTiersFromDom(doc = document) {
  const list = doc.getElementById('giftingTiersList');
  if (!list) return normalizeGiftingTiers(SCENARIO_DEFAULTS.giftingTiers);

  const rows = list.querySelectorAll('[data-gifting-tier-row]');
  if (rows.length === 0) return [];

  const tiers = [];
  rows.forEach((row, index) => {
    const amountInput = row.querySelector('[data-gift-amount]');
    const balanceInput = row.querySelector('[data-gift-balance]');
    const triggerInput = row.querySelector('[data-gift-trigger-pct]');
    const targetInput = row.querySelector('[data-gift-target-pct]');
    const yearsInput = row.querySelector('[data-gift-years]');
    const amount = parseCurrency(amountInput?.value);
    const balance = parseCurrency(balanceInput?.value);
    const triggerPct = parseOptionalPct(triggerInput?.value);
    const targetPct = parseOptionalPct(targetInput?.value);
    const isLast = index === rows.length - 1;
    if (isLast) {
      tiers.push({ amount, balance, triggerPct, targetPct });
    } else {
      const years = parseInt(yearsInput?.value, 10);
      tiers.push({
        amount,
        balance,
        triggerPct,
        targetPct,
        years: Number.isFinite(years) ? years : null,
      });
    }
  });
  return tiers;
}

export function writeGiftingTiersToDom(tiers, doc = document) {
  const list = doc.getElementById('giftingTiersList');
  if (!list) return;

  const normalized = normalizeGiftingTiers(tiers);
  list.innerHTML = '';

  normalized.forEach((tier, index) => {
    const isLast = index === normalized.length - 1;
    const row = doc.createElement('div');
    row.className = 'flex flex-wrap items-end gap-2 mb-2';
    row.dataset.giftingTierRow = String(index);

    const amountWrap = doc.createElement('div');
    amountWrap.className = 'flex-1 min-w-[7rem]';
    amountWrap.innerHTML = `
      <label class="block text-[10px] uppercase text-theme-faint font-semibold">Gift</label>
      <div class="input-adorned has-suffix mt-1">
        <input type="text" data-gift-amount class="currency-input w-full rounded input-theme p-1 text-sm" value="${formatCurrency(tier.amount)}">
        <span class="input-adorn-suffix">000s</span>
      </div>`;
    row.appendChild(amountWrap);

    const balanceWrap = doc.createElement('div');
    balanceWrap.className = 'flex-1 min-w-[7rem]';
    balanceWrap.innerHTML = `
      <label class="block text-[10px] uppercase text-theme-faint font-semibold">Balance &gt;</label>
      <div class="input-adorned has-suffix mt-1">
        <input type="text" data-gift-balance class="currency-input w-full rounded input-theme p-1 text-sm" value="${formatCurrency(tier.balance)}">
        <span class="input-adorn-suffix">000s</span>
      </div>`;
    row.appendChild(balanceWrap);

    // Text inputs (not type=number): number inputs report value="" for
    // "10%" / partial keystrokes, so filled-looking fields were read as blank.
    const triggerWrap = doc.createElement('div');
    triggerWrap.className = 'w-24';
    triggerWrap.innerHTML = `
      <label class="block text-[10px] uppercase text-theme-faint font-semibold">Trigger</label>
      <div class="input-adorned has-suffix mt-1">
        <input type="text" inputmode="decimal" data-gift-trigger-pct class="w-full rounded input-theme p-1 text-sm text-center" value="${formatOptionalPct(tier.triggerPct)}">
        <span class="input-adorn-suffix">%</span>
      </div>`;
    row.appendChild(triggerWrap);

    const targetWrap = doc.createElement('div');
    targetWrap.className = 'w-24';
    targetWrap.innerHTML = `
      <label class="block text-[10px] uppercase text-theme-faint font-semibold">Target</label>
      <div class="input-adorned has-suffix mt-1">
        <input type="text" inputmode="decimal" data-gift-target-pct class="w-full rounded input-theme p-1 text-sm text-center" value="${formatOptionalPct(tier.targetPct)}">
        <span class="input-adorn-suffix">%</span>
      </div>`;
    row.appendChild(targetWrap);

    if (!isLast) {
      const yearsWrap = doc.createElement('div');
      yearsWrap.className = 'w-20';
      yearsWrap.innerHTML = `
        <label class="block text-[10px] uppercase text-theme-faint font-semibold">Years</label>
        <input type="number" data-gift-years min="1" class="w-full rounded input-theme p-1 text-sm text-center mt-1" value="${tier.years ?? 1}">`;
      row.appendChild(yearsWrap);
    } else if (normalized.length > 1) {
      const labelWrap = doc.createElement('div');
      labelWrap.className = 'pb-1 text-[10px] text-theme-faint';
      labelWrap.textContent = 'remaining years';
      row.appendChild(labelWrap);
    }

    const removeBtn = doc.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'remove-gifting-tier text-xs text-theme-muted hover:text-theme-danger px-2 py-1 mb-0.5';
    removeBtn.textContent = 'Remove';
    row.appendChild(removeBtn);

    list.appendChild(row);
  });
}

/** Normalize spending-over-time tiers; empty array becomes one flat tier. */
export function normalizeSpendingOverTimeTiers(tiers) {
  if (!Array.isArray(tiers) || tiers.length === 0) {
    return [{ changePct: 0, extra: 0 }];
  }
  return tiers.map((tier, index, arr) => {
    const changePct = typeof tier?.changePct === 'number' ? tier.changePct : parseFloat(tier?.changePct) || 0;
    const extra = parseCurrency(tier?.extra);
    const isLast = index === arr.length - 1;
    if (isLast) return { changePct, extra };
    const years = parseInt(tier?.years, 10);
    return { changePct, extra, years: Number.isFinite(years) && years >= 0 ? years : 0 };
  });
}

/** Year span of the first tier when multiple tiers exist; null for a single tier. */
export function spendingFirstTierYearsFromTiers(tiers) {
  const normalized = normalizeSpendingOverTimeTiers(tiers);
  if (normalized.length <= 1) return null;
  const years = parseInt(normalized[0].years, 10);
  return Number.isFinite(years) && years >= 0 ? years : 0;
}

export function readSpendingOverTimeTiersFromDom(doc = document) {
  const list = doc.getElementById('spendingOverTimeTiersList');
  if (!list) return normalizeSpendingOverTimeTiers(SCENARIO_DEFAULTS.spendingOverTimeTiers);

  const rows = list.querySelectorAll('[data-spending-tier-row]');
  if (rows.length === 0) return [{ changePct: 0, extra: 0 }];

  const tiers = [];
  rows.forEach((row, index) => {
    const changeInput = row.querySelector('[data-spending-change]');
    const extraInput = row.querySelector('[data-spending-extra]');
    const yearsInput = row.querySelector('[data-spending-years]');
    const changePct = parseFloat(changeInput?.value);
    const extra = parseCurrency(extraInput?.value);
    const isLast = index === rows.length - 1;
    if (isLast) {
      tiers.push({ changePct: Number.isFinite(changePct) ? changePct : 0, extra });
    } else {
      const years = parseInt(yearsInput?.value, 10);
      tiers.push({
        changePct: Number.isFinite(changePct) ? changePct : 0,
        extra,
        years: Number.isFinite(years) ? years : null,
      });
    }
  });
  return tiers;
}

/** True when Goal Seek owns the first tier's Extra Withdrawal field. */
function isFirstSpendingExtraSearchLocked(doc = document) {
  return !!doc.getElementById('goalSeekMode')?.checked
    && !!doc.getElementById('goalSeekIncludeSpendingOverTime')?.checked;
}

export function writeSpendingOverTimeTiersToDom(tiers, doc = document) {
  const list = doc.getElementById('spendingOverTimeTiersList');
  if (!list) return;

  const normalized = normalizeSpendingOverTimeTiers(tiers);
  const lockFirstExtra = isFirstSpendingExtraSearchLocked(doc);
  list.innerHTML = '';

  normalized.forEach((tier, index) => {
    const isLast = index === normalized.length - 1;
    const row = doc.createElement('div');
    row.className = 'flex flex-wrap items-end gap-2 mb-2';
    row.dataset.spendingTierRow = String(index);

    const changeWrap = doc.createElement('div');
    changeWrap.className = 'w-24';
    changeWrap.innerHTML = `
      <label class="block text-[10px] uppercase text-theme-faint font-semibold">Annual Change</label>
      <div class="input-adorned has-suffix mt-1">
        <input type="number" data-spending-change step="0.5" class="w-full rounded input-theme p-1 text-sm text-center" value="${tier.changePct ?? 0}">
        <span class="input-adorn-suffix">%</span>
      </div>`;
    row.appendChild(changeWrap);

    const extraWrap = doc.createElement('div');
    extraWrap.className = 'flex-1 min-w-[7rem]';
    // Re-apply Goal Seek lock here: this writer rebuilds the whole list, so a
    // prior disabled state on the first-tier Extra field would otherwise be lost
    // (Add/Remove tier, Easy Mode rescale, session load, etc.).
    const extraDisabled = index === 0 && lockFirstExtra ? ' disabled' : '';
    extraWrap.innerHTML = `
      <label class="block text-[10px] uppercase text-theme-faint font-semibold">Extra Withdrawal</label>
      <div class="input-adorned has-suffix mt-1">
        <input type="text" data-spending-extra class="currency-input w-full rounded input-theme p-1 text-sm" value="${formatCurrency(tier.extra)}"${extraDisabled}>
        <span class="input-adorn-suffix">000s</span>
      </div>`;
    row.appendChild(extraWrap);

    if (!isLast) {
      const yearsWrap = doc.createElement('div');
      yearsWrap.className = 'w-20';
      yearsWrap.innerHTML = `
        <label class="block text-[10px] uppercase text-theme-faint font-semibold">Years</label>
        <input type="number" data-spending-years min="0" class="w-full rounded input-theme p-1 text-sm text-center mt-1" value="${tier.years ?? 0}">`;
      row.appendChild(yearsWrap);
    } else if (normalized.length > 1) {
      const labelWrap = doc.createElement('div');
      labelWrap.className = 'pb-1 text-[10px] text-theme-faint';
      labelWrap.textContent = 'remaining years';
      row.appendChild(labelWrap);
    }

    const removeBtn = doc.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'remove-spending-over-time-tier text-xs text-theme-muted hover:text-theme-danger px-2 py-1 mb-0.5';
    removeBtn.textContent = 'Remove';
    row.appendChild(removeBtn);

    list.appendChild(row);
  });
}

/** Read the static Asset Allocation % fields from the form (seed for new tiers). */
export function readStaticAllocationFromDom(doc = document) {
  const mix = {};
  for (const key of ALLOCATION_KEYS) {
    const el = doc.getElementById(key);
    const pct = parseFloat(el?.value);
    mix[key] = Number.isFinite(pct) ? pct : 0;
  }
  return mix;
}

/** Build a single remaining-years tier from a mix of allocation % fields. */
function allocationTierFromMix(source) {
  const mix = {};
  for (const key of ALLOCATION_KEYS) {
    const pct = typeof source?.[key] === 'number' ? source[key] : parseFloat(source?.[key]);
    mix[key] = Number.isFinite(pct) ? pct : 0;
  }
  return mix;
}

/**
 * Normalize allocation-over-time tiers. Always at least one remaining-years
 * tier. Empty/missing lists become one tier copied from `fallbackMix` (usually
 * the static Asset Allocation) so the schedule stays flat until edited.
 */
export function normalizeAllocationOverTimeTiers(tiers, fallbackMix = null) {
  if (!Array.isArray(tiers) || tiers.length === 0) {
    return [allocationTierFromMix(fallbackMix ?? SCENARIO_DEFAULTS.allocationOverTimeTiers[0])];
  }
  return tiers.map((tier, index, arr) => {
    const mix = allocationTierFromMix(tier);
    const isLast = index === arr.length - 1;
    if (isLast) return mix;
    const years = parseInt(tier?.years, 10);
    return { ...mix, years: Number.isFinite(years) && years >= 0 ? years : 0 };
  });
}

export function readAllocationOverTimeTiersFromDom(doc = document) {
  const list = doc.getElementById('allocationOverTimeTiersList');
  const fallback = readStaticAllocationFromDom(doc);
  if (!list) return normalizeAllocationOverTimeTiers(SCENARIO_DEFAULTS.allocationOverTimeTiers, fallback);

  const rows = list.querySelectorAll('[data-allocation-tier-row]');
  if (rows.length === 0) return normalizeAllocationOverTimeTiers([], fallback);

  const tiers = [];
  rows.forEach((row, index) => {
    const mix = {};
    for (const key of ALLOCATION_KEYS) {
      const input = row.querySelector(`[data-allocation-key="${key}"]`);
      const pct = parseFloat(input?.value);
      mix[key] = Number.isFinite(pct) ? pct : 0;
    }
    const isLast = index === rows.length - 1;
    if (isLast) {
      tiers.push(mix);
    } else {
      const yearsInput = row.querySelector('[data-allocation-years]');
      const years = parseInt(yearsInput?.value, 10);
      tiers.push({ ...mix, years: Number.isFinite(years) ? years : null });
    }
  });
  return tiers;
}

function updateAllocationTierTotalDisplay(row) {
  const totalEl = row.querySelector('[data-allocation-tier-total]');
  if (!totalEl) return;
  let total = 0;
  row.querySelectorAll('[data-allocation-key]').forEach((input) => {
    total += parseFloat(input.value) || 0;
  });
  totalEl.textContent = `${total.toFixed(1).replace(/\.0$/, '')}%`;
  if (Math.abs(total - 100) > 0.01) {
    totalEl.classList.add('text-theme-danger');
    totalEl.classList.remove('text-theme-success');
  } else {
    totalEl.classList.remove('text-theme-danger');
    totalEl.classList.add('text-theme-success');
  }
}

export function writeAllocationOverTimeTiersToDom(tiers, doc = document) {
  const list = doc.getElementById('allocationOverTimeTiersList');
  if (!list) return;

  const fallback = readStaticAllocationFromDom(doc);
  const normalized = normalizeAllocationOverTimeTiers(tiers, fallback);
  list.innerHTML = '';

  normalized.forEach((tier, index) => {
    const isLast = index === normalized.length - 1;
    const row = doc.createElement('div');
    row.className = 'border border-theme-border rounded-md p-3 space-y-2';
    row.dataset.allocationTierRow = String(index);

    const grid = doc.createElement('div');
    grid.className = 'grid grid-cols-3 sm:grid-cols-6 gap-2';
    for (const key of ALLOCATION_KEYS) {
      const cell = doc.createElement('div');
      const label = ALLOCATION_LABELS[key] || key;
      cell.innerHTML = `
        <label class="block text-[10px] uppercase text-theme-faint font-semibold leading-tight">${label}</label>
        <div class="input-adorned has-suffix mt-1">
          <input type="number" data-allocation-key="${key}" step="1" class="allocation-tier-input w-full rounded input-theme p-1 text-xs text-center" value="${tier[key] ?? 0}">
          <span class="input-adorn-suffix">%</span>
        </div>`;
      grid.appendChild(cell);
    }
    row.appendChild(grid);

    const footer = doc.createElement('div');
    footer.className = 'flex flex-wrap items-end gap-2';

    const totalWrap = doc.createElement('div');
    totalWrap.className = 'text-[10px] font-semibold text-theme-body pb-1';
    totalWrap.innerHTML = `Total: <span data-allocation-tier-total>100%</span>`;
    footer.appendChild(totalWrap);

    if (!isLast) {
      const yearsWrap = doc.createElement('div');
      yearsWrap.className = 'w-20';
      yearsWrap.innerHTML = `
        <label class="block text-[10px] uppercase text-theme-faint font-semibold">Years</label>
        <input type="number" data-allocation-years min="0" class="w-full rounded input-theme p-1 text-sm text-center mt-1" value="${tier.years ?? 0}">`;
      footer.appendChild(yearsWrap);
    } else {
      const labelWrap = doc.createElement('div');
      labelWrap.className = 'pb-1 text-[10px] text-theme-faint';
      labelWrap.textContent = 'remaining years';
      footer.appendChild(labelWrap);
    }

    // Always keep at least one tier (mirrors Spending Over Time).
    if (normalized.length > 1) {
      const removeBtn = doc.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'remove-allocation-over-time-tier text-xs text-theme-muted hover:text-theme-danger px-2 py-1 mb-0.5 ml-auto';
      removeBtn.textContent = 'Remove';
      footer.appendChild(removeBtn);
    }

    row.appendChild(footer);
    list.appendChild(row);
    updateAllocationTierTotalDisplay(row);
  });
}

/** Refresh per-tier total badges after the user edits a % field. */
export function refreshAllocationOverTimeTierTotals(doc = document) {
  doc.querySelectorAll('[data-allocation-tier-row]').forEach((row) => {
    updateAllocationTierTotalDisplay(row);
  });
}

/** Normalize major-event rows; missing or empty list means no events. */
export function normalizeMajorEvents(events) {
  if (!Array.isArray(events) || events.length === 0) return [];
  return events.map((event) => {
    const amount = parseCurrency(event?.amount);
    const startYear = parseInt(event?.startYear, 10);
    const yearsRaw = event?.years;
    let years = null;
    if (yearsRaw !== null && yearsRaw !== undefined && yearsRaw !== '') {
      const parsed = parseInt(yearsRaw, 10);
      years = Number.isFinite(parsed) && parsed >= 1 ? parsed : 1;
    }
    return {
      amount,
      startYear: Number.isFinite(startYear) && startYear >= 1 ? startYear : 1,
      years,
    };
  });
}

export function readMajorEventsFromDom(doc = document) {
  const list = doc.getElementById('majorEventsList');
  if (!list) return normalizeMajorEvents(SCENARIO_DEFAULTS.majorEvents);

  const rows = list.querySelectorAll('[data-major-event-row]');
  if (rows.length === 0) return [];

  const events = [];
  rows.forEach((row) => {
    const amountInput = row.querySelector('[data-major-event-amount]');
    const startInput = row.querySelector('[data-major-event-start]');
    const yearsInput = row.querySelector('[data-major-event-years]');
    const amount = parseCurrency(amountInput?.value);
    const startYear = parseInt(startInput?.value, 10);
    const yearsRaw = yearsInput?.value;
    const years = yearsRaw === '' || yearsRaw == null
      ? null
      : parseInt(yearsRaw, 10);
    events.push({
      amount,
      startYear: Number.isFinite(startYear) ? startYear : 1,
      years: Number.isFinite(years) ? years : null,
    });
  });
  return events;
}

export function writeMajorEventsToDom(events, doc = document) {
  const list = doc.getElementById('majorEventsList');
  if (!list) return;

  const normalized = normalizeMajorEvents(events);
  list.innerHTML = '';

  normalized.forEach((event, index) => {
    const row = doc.createElement('div');
    row.className = 'flex flex-wrap items-end gap-2 mb-2';
    row.dataset.majorEventRow = String(index);

    const amountWrap = doc.createElement('div');
    amountWrap.className = 'flex-1 min-w-[7rem]';
    amountWrap.innerHTML = `
      <label class="block text-[10px] uppercase text-theme-faint font-semibold">Amount</label>
      <div class="input-adorned has-suffix mt-1">
        <input type="text" data-major-event-amount class="currency-input w-full rounded input-theme p-1 text-sm" value="${formatCurrency(event.amount)}">
        <span class="input-adorn-suffix">000s</span>
      </div>`;
    row.appendChild(amountWrap);

    const startWrap = doc.createElement('div');
    startWrap.className = 'w-20';
    startWrap.innerHTML = `
      <label class="block text-[10px] uppercase text-theme-faint font-semibold">Start year</label>
      <input type="number" data-major-event-start min="1" step="1" class="w-full rounded input-theme p-1 text-sm text-center mt-1" value="${event.startYear ?? 1}">`;
    row.appendChild(startWrap);

    const yearsWrap = doc.createElement('div');
    yearsWrap.className = 'w-20';
    yearsWrap.innerHTML = `
      <label class="block text-[10px] uppercase text-theme-faint font-semibold">Years</label>
      <input type="number" data-major-event-years min="1" step="1" placeholder="once" class="w-full rounded input-theme p-1 text-sm text-center mt-1" value="${event.years ?? ''}">`;
    row.appendChild(yearsWrap);

    const removeBtn = doc.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'remove-major-event text-xs text-theme-muted hover:text-theme-danger px-2 py-1 mb-0.5';
    removeBtn.textContent = 'Remove';
    row.appendChild(removeBtn);

    list.appendChild(row);
  });
}

/** Write Goal Seek's discovered first-tier extra withdrawal back into the form. */
export function writeFirstSpendingTierExtra(dollars, doc = document) {
  const input = doc.querySelector('[data-spending-tier-row="0"] [data-spending-extra]');
  if (input) input.value = formatCurrency(dollars / MONEY_SCALE);
}

export function defaultScenario() {
  return { ...SCENARIO_DEFAULTS };
}

/** True when the user set a +/- year range around the endpoint. */
export function isHorizonVariable(scenario) {
  return (scenario.horizonPlusYears || 0) > 0 || (scenario.horizonMinusYears || 0) > 0;
}

/** Resolve 'auto' to total (fixed horizon) or meanYearly (variable horizon).
 * Mean/yr is the horizon-normalized total, so at a fixed horizon it orders runs
 * identically to 'total' — enabling a horizon range never reorders results. */
export function resolveWithdrawalMetric(scenario) {
  const metric = scenario.withdrawalMetric ?? SCENARIO_DEFAULTS.withdrawalMetric;
  if (metric === 'medianYearly') return 'medianYearly';
  if (metric === 'meanYearly') return 'meanYearly';
  if (metric === 'total') return 'total';
  return isHorizonVariable(scenario) ? 'meanYearly' : 'total';
}

/** Max years any single run may simulate (endpoint + plus range). */
export function computeMaxYears(scenario) {
  const endpoint = scenario.numYears || SCENARIO_DEFAULTS.numYears;
  const plus = Math.max(0, scenario.horizonPlusYears || 0);
  return endpoint + plus;
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
  scenario.giftingTiers = readGiftingTiersFromDom(doc);
  scenario.spendingOverTimeTiers = readSpendingOverTimeTiersFromDom(doc);
  scenario.allocationOverTimeTiers = readAllocationOverTimeTiersFromDom(doc);
  scenario.majorEvents = readMajorEventsFromDom(doc);

  return scenario;
}

// Number inputs that mirror into a paired range slider; keep both in sync.
const PAIRED_SLIDER_IDS = {
  blockSize: 'blockSizeSlider',
  scaledHistoricalSmoothing: 'scaledHistoricalSmoothingSlider',
  goalSeekDesiredSuccessPct: 'goalSeekDesiredSuccessPctSlider',
  goalSeekRiskTolerancePct: 'goalSeekRiskTolerancePctSlider',
  planRiskTolerancePct: 'planRiskTolerancePctSlider',
  earlyWeightEmphasisPct: 'earlyWeightEmphasisPctSlider',
  earlyWeightLateFloorPct: 'earlyWeightLateFloorPctSlider',
};

// Same scenario value shown in both Base and Specific minimum-withdrawal panels.
const FIELD_DOM_MIRRORS = {
  maxConsecutiveMinWithdrawals: ['maxConsecutiveMinWithdrawalsSpecific'],
  minWithdrawalPlanRecoveryYears: ['minWithdrawalPlanRecoveryYearsSpecific'],
};

// Tier-list keys and their dedicated DOM writers (not in FIELDS).
const TIER_WRITERS = {
  withdrawalFloors: writeWithdrawalFloorsToDom,
  specificWithdrawalFloors: writeSpecificWithdrawalFloorsToDom,
  giftingTiers: writeGiftingTiersToDom,
  spendingOverTimeTiers: writeSpendingOverTimeTiersToDom,
  allocationOverTimeTiers: writeAllocationOverTimeTiersToDom,
  majorEvents: writeMajorEventsToDom,
};

// Write only the scenario keys present in `patch` back into the DOM. Handles
// typed formatting, the two radio groups, tier lists, and paired-slider sync.
// Used by writeScenarioToDom (full write) and the risk preset slider (subset).
export function writeScenarioFieldsToDom(patch, doc = document) {
  for (const key of Object.keys(patch)) {
    const value = patch[key];

    if (key === 'distMethod') {
      const method = value || SCENARIO_DEFAULTS.distMethod;
      const radio = doc.querySelector(`input[name="distribution-method"][value="${method}"]`);
      if (radio) radio.checked = true;
      continue;
    }
    if (key === 'withdrawalStrategy') {
      const strat = value || SCENARIO_DEFAULTS.withdrawalStrategy;
      const stratRadio = doc.querySelector(`input[name="withdrawal-strategy"][value="${strat}"]`);
      if (stratRadio) stratRadio.checked = true;
      continue;
    }
    if (TIER_WRITERS[key]) {
      TIER_WRITERS[key](value ?? SCENARIO_DEFAULTS[key], doc);
      continue;
    }

    const f = FIELD_BY_KEY.get(key);
    if (!f) continue;
    const el = doc.getElementById(f.dom);
    if (el) {
      if (f.type === 'boolean') {
        el.checked = !!value;
      } else {
        el.value = formatField(value, f.type);
      }
    }
    const mirrors = FIELD_DOM_MIRRORS[key];
    if (mirrors) {
      for (const mirrorId of mirrors) {
        const mirror = doc.getElementById(mirrorId);
        if (!mirror) continue;
        if (f.type === 'boolean') {
          mirror.checked = !!value;
        } else {
          mirror.value = formatField(value, f.type);
        }
      }
    }
    const pairedId = PAIRED_SLIDER_IDS[key];
    if (pairedId && value != null) {
      const slider = doc.getElementById(pairedId);
      if (slider) slider.value = value;
    }
  }
}

// Write a scenario object back into the DOM inputs.
export function writeScenarioToDom(scenario, doc = document) {
  // Every declared field is written (missing keys clear to ''), plus the
  // radios and the four tier lists (falling back to defaults when absent).
  const patch = {};
  for (const f of FIELDS) patch[f.key] = scenario[f.key];
  patch.distMethod = scenario.distMethod || SCENARIO_DEFAULTS.distMethod;
  patch.withdrawalStrategy = scenario.withdrawalStrategy || SCENARIO_DEFAULTS.withdrawalStrategy;
  for (const key of Object.keys(TIER_WRITERS)) {
    patch[key] = scenario[key] ?? SCENARIO_DEFAULTS[key];
  }
  writeScenarioFieldsToDom(patch, doc);
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
    case 'optionalPct': {
      if (raw == null || String(raw).trim() === '') return null;
      const n = parseFloat(raw);
      return Number.isNaN(n) ? null : n;
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
  if (type === 'optionalPct' && (value == null || value === '')) return '';
  if (type === 'currency' || type === 'optionalCurrency') return formatCurrency(value);
  if (type === 'pct1') return formatPct1(value);
  if (type === 'optionalPct') return String(value);
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

  const endpointYears = scenario.numYears;
  const horizonPlus = Math.max(0, scenario.horizonPlusYears || 0);
  const horizonMinus = Math.max(0, scenario.horizonMinusYears || 0);
  const maxYears = endpointYears + horizonPlus;
  const horizonRange =
    horizonPlus > 0 || horizonMinus > 0
      ? { endpoint: endpointYears, plus: horizonPlus, minus: horizonMinus }
      : null;
  const resolvedMetric = resolveWithdrawalMetric(scenario);
  const metricWasAuto = (scenario.withdrawalMetric ?? SCENARIO_DEFAULTS.withdrawalMetric) === 'auto';
  const earlyWeighting = resolveEarlyWeighting(scenario);

  return {
    numYears: endpointYears,
    maxYears,
    horizonRange,
    numSimulations: scenario.numSimulations,
    seed,
    distMethod: scenario.distMethod,
    blockSize: scenario.blockSize || 1,
    // Fraction of runs on each side of a percentile rank to average together
    // (clamped to a sane range). Consumed by the worker's path smoothing.
    smoothFraction: Math.min(Math.max(num(scenario.smoothWindowPct) / 100, 0), 0.1),
    withdrawalMetric: resolvedMetric,
    metricWasAuto,
    earlyWeightSlot: Math.min(Math.max(Math.round(num(scenario.earlyWeightSlot) || 0), 0), 4),
    earlyWeightStrengthPct: earlyWeighting.strengthPct,
    earlyWeightEmphasisPct: earlyWeighting.earlyEmphasisPct,
    earlyWeightLateFloorPct: earlyWeighting.lateFloorPct,
    allocation: {
      usLgGrowth: (scenario.usLgGrowthAllocation || 0) / 100,
      usLgValue: (scenario.usLgValueAllocation || 0) / 100,
      usSmMid: (scenario.usSmMidAllocation || 0) / 100,
      exUs: (scenario.exUsAllocation || 0) / 100,
      bond: (scenario.bondAllocation || 0) / 100,
      cash: (scenario.cashAllocation || 0) / 100,
    },
    // Per-year mixes: glide from the static Asset Allocation (year 0) toward
    // each allocation-over-time tier. A single tier matching the static mix
    // stays flat for the whole horizon.
    allocationSeries: (() => {
      const startAllocation = {
        usLgGrowth: (scenario.usLgGrowthAllocation || 0) / 100,
        usLgValue: (scenario.usLgValueAllocation || 0) / 100,
        usSmMid: (scenario.usSmMidAllocation || 0) / 100,
        exUs: (scenario.exUsAllocation || 0) / 100,
        bond: (scenario.bondAllocation || 0) / 100,
        cash: (scenario.cashAllocation || 0) / 100,
      };
      const fallbackMix = {};
      for (const key of ALLOCATION_KEYS) fallbackMix[key] = scenario[key] || 0;
      return buildAllocationOverTimeSeries(
        normalizeAllocationOverTimeTiers(scenario.allocationOverTimeTiers, fallbackMix),
        maxYears,
        startAllocation,
        ALLOCATION_KEYS,
      );
    })(),
    portfolio: {
      strategy: scenario.withdrawalStrategy || SCENARIO_DEFAULTS.withdrawalStrategy,
      specificWithdrawals: fitSpecificWithdrawalsToHorizon(
        parseSpecificWithdrawals(scenario.specificWithdrawals),
        maxYears,
      ),
      start: toDollars(scenario.startBalance),
      base: toDollars(scenario.baseWithdrawal),
      floorBalance: toDollars(scenario.floorBalance),
      floorPenalty: (scenario.floorPenalty || 0) / 100,
      ceilingBalance: toDollars(scenario.ceilingBalance) || Infinity,
      ceilingBonus: (scenario.ceilingBonus || 0) / 100,
      // Glide-path spend-down. Blank/missing target = null = lever off (a
      // typed 0 is a valid "land on zero" target, so blank and 0 differ here).
      glideTarget:
        scenario.glideTarget == null || scenario.glideTarget === ''
          ? null
          : toDollars(scenario.glideTarget),
      glideFraction: num(scenario.glideFraction ?? SCENARIO_DEFAULTS.glideFraction) / 100,
      glideRate: num(scenario.glideRate ?? SCENARIO_DEFAULTS.glideRate) / 100,
      withdrawalFloorSeries: (() => {
        if (scenario.withdrawalStrategy === 'specific') {
          const specificAmounts = fitSpecificWithdrawalsToHorizon(
            parseSpecificWithdrawals(scenario.specificWithdrawals),
            maxYears,
          );
          return buildSpecificWithdrawalFloorSeries(
            normalizeSpecificWithdrawalFloors(scenario.specificWithdrawalFloors),
            specificAmounts,
            maxYears,
          );
        }
        return buildWithdrawalFloorSeries(
          normalizeWithdrawalFloors(scenario.withdrawalFloors),
          maxYears,
          toDollars,
        );
      })(),
      spendingOverTimeSeries: buildSpendingOverTimeSeries(
        normalizeSpendingOverTimeTiers(scenario.spendingOverTimeTiers),
        maxYears,
        toDollars,
      ),
      giftingSeries: buildGiftingSeries(
        normalizeGiftingTiers(scenario.giftingTiers),
        maxYears,
        toDollars,
      ),
      majorEventsSeries: scenario.withdrawalStrategy === 'specific'
        ? new Array(maxYears).fill(0)
        : buildMajorEventsSeries(
            normalizeMajorEvents(scenario.majorEvents),
            maxYears,
            toDollars,
          ),
      maxConsecutiveMinWithdrawals: Math.max(0, parseInt(scenario.maxConsecutiveMinWithdrawals, 10) || 0),
      minWithdrawalPlanRecoveryYears: Math.max(0, parseInt(scenario.minWithdrawalPlanRecoveryYears, 10) || 0),
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

/** Fraction 0–0.35 from the advanced "Plan Risk Tolerance" setting. */
export function planShortfallTolerance(scenario) {
  return Math.min(Math.max(num(scenario.planRiskTolerancePct) / 100, 0), 0.35);
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
      adj: toDollars(scenario.dynLowAdj),
    },
    med: {
      ret: num(scenario.dynMedRet),
      adj: toDollars(scenario.dynMedAdj),
    },
    high: {
      ret: num(scenario.dynHighRet),
      adj: toDollars(scenario.dynHighAdj),
    },
    // "No cut while ahead" threshold in dollars; null (blank/zero) = off.
    noCutBal: optionalBalanceThreshold(scenario.dynNoCutBal),
    // Max boost drawdown vs start-of-year (fraction); null (blank) = off.
    // 0 means end ≥ start; negative means the year must still grow.
    maxBoostDrawdownPct: optionalSignedPctFraction(scenario.dynMaxBoostDrawdownPct),
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
  // only tunes the Market/Balance adjustment levers on top of it. Spending
  // over time has no effect on the specific-list engine path, so it's never
  // searched here either.
  const isSpecific = scenario.withdrawalStrategy === 'specific';
  return {
    targetEndingBalance: toDollars(scenario.goalSeekTargetEndingBalance),
    desiredSuccessRate: Math.min(Math.max(num(scenario.goalSeekDesiredSuccessPct) / 100, 0), 1),
    shortfallTolerance: Math.min(Math.max(num(scenario.goalSeekRiskTolerancePct) / 100, 0), 0.35),
    pinBaseWithdrawal: isSpecific ? true : !scenario.goalSeekIncludeBaseWithdrawal,
    includeSpendingOverTime: isSpecific ? false : !!scenario.goalSeekIncludeSpendingOverTime,
    spendingFirstTierYears: isSpecific
      ? null
      : spendingFirstTierYearsFromTiers(scenario.spendingOverTimeTiers),
    includeMarketAdjustments: !!scenario.goalSeekIncludeMarketAdjustments,
    includeBalanceOverrides: !!scenario.goalSeekIncludeBalanceOverrides,
    // Works for both strategies — the glide lever recycles surplus on top of
    // whatever schedule the engine is running.
    includeGlidePath: !!scenario.goalSeekIncludeGlidePath,
    searchNumSimulations: num(scenario.goalSeekNumSimulations) || undefined,
    withdrawalMetric: resolveWithdrawalMetric(scenario),
    ...(() => {
      const weighting = resolveEarlyWeighting(scenario);
      return {
        earlyWeightStrengthPct: weighting.strengthPct,
        earlyWeightEmphasisPct: weighting.earlyEmphasisPct,
        earlyWeightLateFloorPct: weighting.lateFloorPct,
      };
    })(),
  };
}

// Upper bounds keep a single run from locking up the browser for minutes.
export const MAX_NUM_YEARS = 100;
export const MAX_NUM_SIMULATIONS = 100000;

// Validate a scenario for running. Returns an array of human-readable errors.
export function validateScenario(scenario, { minYear, maxYear }) {
  const errors = [];

  const start = parseCurrency(scenario.startBalance);
  if (!Number.isFinite(start) || start <= 0) {
    errors.push('Starting portfolio must be a positive amount.');
  }

  if (!Number.isFinite(scenario.numYears) || scenario.numYears < 1 || scenario.numYears > MAX_NUM_YEARS) {
    errors.push(`Investment horizon must be between 1 and ${MAX_NUM_YEARS} years.`);
  }
  const plus = scenario.horizonPlusYears ?? 0;
  const minus = scenario.horizonMinusYears ?? 0;
  if (!Number.isFinite(plus) || plus < 0 || !Number.isInteger(plus)) {
    errors.push('Horizon + years must be a non-negative whole number.');
  }
  if (!Number.isFinite(minus) || minus < 0 || !Number.isInteger(minus)) {
    errors.push('Horizon − years must be a non-negative whole number.');
  }
  if (Number.isFinite(scenario.numYears) && Number.isFinite(minus) && scenario.numYears - minus < 1) {
    errors.push('Horizon − years cannot exceed endpoint − 1 (minimum simulated horizon is 1 year).');
  }
  if (Number.isFinite(scenario.numYears) && Number.isFinite(plus) && scenario.numYears + plus > MAX_NUM_YEARS) {
    errors.push(`Endpoint + horizon range cannot exceed ${MAX_NUM_YEARS} years.`);
  }
  const minHorizon =
    Number.isFinite(scenario.numYears) && Number.isFinite(minus)
      ? scenario.numYears - minus
      : scenario.numYears;
  if (
    !Number.isFinite(scenario.numSimulations) ||
    scenario.numSimulations < 1 ||
    scenario.numSimulations > MAX_NUM_SIMULATIONS
  ) {
    errors.push(`Number of simulations must be between 1 and ${MAX_NUM_SIMULATIONS.toLocaleString('en-US')}.`);
  }
  const planRisk = scenario.planRiskTolerancePct;
  if (!Number.isFinite(planRisk) || planRisk < 0 || planRisk > 35) {
    errors.push('Plan risk tolerance must be between 0 and 35.');
  }
  if (
    scenario.goalSeekMode &&
    (!Number.isFinite(scenario.goalSeekNumSimulations) ||
      scenario.goalSeekNumSimulations < 1 ||
      scenario.goalSeekNumSimulations > MAX_NUM_SIMULATIONS)
  ) {
    errors.push(`Find Best Plan's number of simulations must be between 1 and ${MAX_NUM_SIMULATIONS.toLocaleString('en-US')}.`);
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

    // Glide-path spend-down (also gated by the Dynamic Adjustments toggle):
    // a blank target means the lever is off and the other glide fields are
    // ignored — unless Goal Seek is allowed to tune the lever, in which case
    // the search supplies the target and the assumed return still matters.
    // Blank fraction/rate fall back to defaults, matching buildSimParams.
    const glideActive =
      (scenario.glideTarget !== '' && scenario.glideTarget != null)
      || (scenario.goalSeekMode && scenario.goalSeekIncludeGlidePath);
    if (glideActive) {
      if (scenario.glideTarget !== '' && scenario.glideTarget != null) {
        const glideTarget = parseCurrency(scenario.glideTarget);
        if (!Number.isFinite(glideTarget) || glideTarget < 0) {
          errors.push('Glide Target must be blank (off) or a non-negative amount.');
        }
      }
      const fraction = scenario.glideFraction ?? SCENARIO_DEFAULTS.glideFraction;
      if (!Number.isFinite(fraction) || fraction < 0 || fraction > 100) {
        errors.push('Glide Spend Rate must be between 0 and 100%.');
      }
      const rate = scenario.glideRate ?? SCENARIO_DEFAULTS.glideRate;
      if (!Number.isFinite(rate) || rate < -2 || rate > 0) {
        errors.push('Glide Spend Timing must be between -2% (later) and 0% (sooner).');
      }
    }
  }

  const total = ALLOCATION_KEYS.reduce((sum, k) => sum + (scenario[k] || 0), 0);
  if (Math.abs(total - 100) > 0.01) {
    errors.push(`Total asset allocation must equal 100%. Current total: ${total.toFixed(2)}%`);
  }

  const allocationFallback = {};
  for (const key of ALLOCATION_KEYS) allocationFallback[key] = scenario[key] || 0;
  const allocationTiers = normalizeAllocationOverTimeTiers(
    scenario.allocationOverTimeTiers,
    allocationFallback,
  );
  for (let i = 0; i < allocationTiers.length; i++) {
    const tierTotal = ALLOCATION_KEYS.reduce((sum, k) => sum + (allocationTiers[i][k] || 0), 0);
    if (Math.abs(tierTotal - 100) > 0.01) {
      errors.push(`Allocation-over-time tier ${i + 1} must equal 100%. Current total: ${tierTotal.toFixed(2)}%`);
      break;
    }
  }
  if (allocationTiers.length > 1) {
    for (let i = 0; i < allocationTiers.length - 1; i++) {
      const years = allocationTiers[i].years;
      if (!Number.isFinite(years) || years < 0) {
        errors.push('Each allocation-over-time tier (except the last) must have a zero or positive year count.');
        break;
      }
    }
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
    for (let i = 0; i < baseTiers.length - 1; i++) {
      const years = baseTiers[i].years;
      if (!Number.isFinite(years) || years < 1) {
        errors.push('Each minimum-withdrawal tier (except the last) must span at least 1 year.');
        break;
      }
    }
  }

  const specificTiers = normalizeSpecificWithdrawalFloors(scenario.specificWithdrawalFloors);
  if (scenario.withdrawalStrategy === 'specific' && specificTiers.length > 0) {
    if (specificTiers.some((tier) => tier.pct >= 100)) {
      errors.push('Specific List minimum % should be below 100% of each year\'s plan amount.');
    }
  }
  if (scenario.withdrawalStrategy === 'specific' && Number.isFinite(minHorizon) && specificTiers.length > 1) {
    for (let i = 0; i < specificTiers.length - 1; i++) {
      const years = specificTiers[i].years;
      if (!Number.isFinite(years) || years < 1) {
        errors.push('Each Specific List minimum tier (except the last) must span at least 1 year.');
        break;
      }
    }
  }

  const spendingTiers = normalizeSpendingOverTimeTiers(scenario.spendingOverTimeTiers);
  if (scenario.withdrawalStrategy !== 'specific' && Number.isFinite(minHorizon) && spendingTiers.length > 1) {
    for (let i = 0; i < spendingTiers.length - 1; i++) {
      const years = spendingTiers[i].years;
      if (!Number.isFinite(years) || years < 0) {
        errors.push('Each spending-over-time tier (except the last) must have a zero or positive year count.');
        break;
      }
    }
  }

  const giftingTiers = normalizeGiftingTiers(scenario.giftingTiers);
  if (Number.isFinite(minHorizon) && giftingTiers.length > 1) {
    for (let i = 0; i < giftingTiers.length - 1; i++) {
      const years = giftingTiers[i].years;
      if (!Number.isFinite(years) || years < 1) {
        errors.push('Each gifting tier (except the last) must span at least 1 year.');
        break;
      }
    }
  }
  for (const tier of giftingTiers) {
    if (!Number.isFinite(tier.amount) || tier.amount < 0) {
      errors.push('Each gifting tier must have a zero or positive gift amount.');
      break;
    }
    if (!Number.isFinite(tier.balance) || tier.balance < 0) {
      errors.push('Each gifting tier must have a zero or positive balance threshold.');
      break;
    }
    const usesPercentMode = tier.triggerPct != null || tier.targetPct != null;
    if (!usesPercentMode && tier.amount > 0 && tier.balance <= 0) {
      errors.push('Gifting tiers with a positive gift amount need a positive Balance > threshold (or set Trigger/Target %).');
      break;
    }
    // Trigger/Target may be negative (below remaining-plan need) or positive
    // (above it). When both are set, Target must be ≥ Trigger so the scale
    // band runs from lower surplus to higher surplus.
    if (
      tier.triggerPct != null
      && tier.targetPct != null
      && tier.targetPct < tier.triggerPct
    ) {
      errors.push('Each gifting Target % must be at least the Trigger %.');
      break;
    }
  }

  if (scenario.withdrawalStrategy !== 'specific') {
    const majorEvents = normalizeMajorEvents(scenario.majorEvents);
    for (const event of majorEvents) {
      if (!Number.isFinite(event.startYear) || event.startYear < 1) {
        errors.push('Each major event must start in year 1 or later.');
        break;
      }
      if (event.years != null && (!Number.isFinite(event.years) || event.years < 1)) {
        errors.push('Major event duration must be blank (one-time) or at least 1 year.');
        break;
      }
    }
  }

  if (scenario.goalSeekMode) {
    const target = parseCurrency(scenario.goalSeekTargetEndingBalance);
    if (!Number.isFinite(target) || target < 0) {
      errors.push('Find Best Plan target ending balance must be zero or a positive amount.');
    }
    const desired = scenario.goalSeekDesiredSuccessPct;
    if (!Number.isFinite(desired) || desired < 65 || desired > 99) {
      errors.push('Find Best Plan desired success % must be between 65 and 99.');
    }
    const riskTolerance = scenario.goalSeekRiskTolerancePct;
    if (!Number.isFinite(riskTolerance) || riskTolerance < 0 || riskTolerance > 35) {
      errors.push('Find Best Plan risk tolerance must be between 0 and 35.');
    }
    if (scenario.withdrawalStrategy === 'specific') {
      // With a Specific List, each year's amount is fixed as typed — Goal Seek
      // can only tune the Market/Balance adjustment levers on top of it.
      const hasSpecificLever =
        scenario.goalSeekIncludeMarketAdjustments
        || scenario.goalSeekIncludeBalanceOverrides
        || scenario.goalSeekIncludeGlidePath;
      if (!hasSpecificLever) {
        errors.push('With a Specific List, Find Best Plan keeps each year\'s amount fixed and can only tune the Market adjustment, Balance adjustment, or Glide-path levers — include at least one of those in the search.');
      }
    } else if (!scenario.goalSeekIncludeBaseWithdrawal) {
      const base = parseCurrency(scenario.baseWithdrawal);
      if (!Number.isFinite(base) || base <= 0) {
        errors.push('When the base withdrawal is not included in the search, it must be a positive amount.');
      }
      const hasLever =
        scenario.goalSeekIncludeSpendingOverTime
        || scenario.goalSeekIncludeMarketAdjustments
        || scenario.goalSeekIncludeBalanceOverrides
        || scenario.goalSeekIncludeGlidePath;
      if (!hasLever) {
        errors.push('When the base withdrawal is not included in the search, at least one other lever must be included.');
      }
    }
  }

  return errors;
}

export { FIELDS, FIELD_BY_KEY };
