// Risk preset levels for the "simple use" slider (conservative → aggressive).
//
// Each level is a JSON file with two sections:
//   scenario — a subset of the save/restore scenario keys, applied verbatim.
//              These configure the Goal Seek search (success %, risk tolerance,
//              levers), the return model, the asset mix, the market-return
//              triggers, and glide spend timing. The actual spending plan (base
//              withdrawal, spending adjustments, glide spend rate) is NOT stored
//              here — Goal Seek finds it when the user clicks Run.
//   derived  — formula parameters for values that scale with the user's own
//              starting balance / time horizon (minimum withdrawal, gifting,
//              balance triggers, target ending balance, spending timeline).
//
// IMPORTANT: this module must not import scenario.js or defaults.js —
// defaults.js imports from here (balanced.json is the source of the app's
// out-of-the-box values), so that would create an import cycle.

import conservative from './conservative.json';
import cautious from './cautious.json';
import balanced from './balanced.json';
import growth from './growth.json';
import aggressive from './aggressive.json';

/** Slider positions 0–4, ordered least to most aggressive. */
export const PRESETS = [conservative, cautious, balanced, growth, aggressive];

/** Out-of-the-box slider position ("Balanced" — also the source of app defaults). */
export const DEFAULT_PRESET_LEVEL = 2;

// Scenario keys a preset's "scenario" section may contain. Enforced by unit
// test so a typo in a JSON file fails fast instead of silently doing nothing.
export const PRESET_SCENARIO_KEYS = [
  'distMethod',
  'goalSeekDesiredSuccessPct',
  'goalSeekRiskTolerancePct',
  'goalSeekIncludeBaseWithdrawal',
  'goalSeekIncludeSpendingOverTime',
  'goalSeekIncludeMarketAdjustments',
  'goalSeekIncludeBalanceOverrides',
  'goalSeekIncludeGlidePath',
  'planRiskTolerancePct',
  'usLgGrowthAllocation',
  'usLgValueAllocation',
  'usSmMidAllocation',
  'exUsAllocation',
  'bondAllocation',
  'cashAllocation',
  'dynLowRet',
  'dynMedRet',
  'dynHighRet',
  'glideRate',
  // Consecutive years at the minimum before forcing spending back to plan,
  // and how many years that recovery stretch lasts (0 = off).
  'maxConsecutiveMinWithdrawals',
  'minWithdrawalPlanRecoveryYears',
];

// Scalar scenario keys whose values are computed from the derived formulas
// (in addition to the tier lists, which are patched in place — see below).
export const PRESET_DERIVED_SCALAR_KEYS = [
  'dynNoCutBal',
  'goalSeekTargetEndingBalance',
  // Kept in lockstep with Goal Seek's target: Goal Seek pins the glide target
  // to that value when the lever is included, and Easy Mode should show the
  // same number in the Glide-path Target field before a search runs.
  'glideTarget',
];

// Spending-plan scalars computed from derived formulas when Easy Mode is on
// and Goal Seek is off (or for unit tests with includePlanFields).
export const PRESET_PLAN_SCALAR_KEYS = [
  'baseWithdrawal',
  'floorBalance',
  'ceilingBalance',
  'floorPenalty',
  'ceilingBonus',
  'dynLowAdj',
  'dynMedAdj',
  'dynHighAdj',
  'glideFraction',
];

// Everything the slider writes — used by the UI to decide which manual edits
// "detach" the preset. Tier lists are only partially controlled (first tiers),
// which the UI handles with row-aware listeners.
export const PRESET_CONTROLLED_KEYS = [
  ...PRESET_SCENARIO_KEYS,
  ...PRESET_DERIVED_SCALAR_KEYS,
  ...PRESET_PLAN_SCALAR_KEYS,
  'withdrawalFloors',
  'giftingTiers',
  'spendingOverTimeTiers',
];

function clampLevel(level) {
  const n = parseInt(level, 10);
  if (!Number.isFinite(n)) return DEFAULT_PRESET_LEVEL;
  return Math.min(Math.max(n, 0), PRESETS.length - 1);
}

/** Preset for a slider position (clamped to the valid 0–4 range). */
export function presetForLevel(level) {
  return PRESETS[clampLevel(level)];
}

function isPositiveFinite(n) {
  return typeof n === 'number' && Number.isFinite(n) && n > 0;
}

/**
 * Compute the balance/horizon-derived values for a preset.
 *
 * All currency values are in thousands ($000s), matching scenario fields, and
 * are rounded to whole $000s so the currency inputs never show fractions.
 *
 * Tier lists are PATCHED, not replaced: the slider only manages the first
 * tier of the minimum-withdrawal and gifting lists, and the first two tiers
 * of the spending-over-time list. Any additional tiers the user created (and
 * the first spending tier's "extra" amount, which Goal Seek searches) are
 * preserved untouched.
 *
 * @param preset  one of PRESETS
 * @param context {
 *   startThousands — current starting portfolio ($000s); if not > 0, all
 *                    balance-derived writes are skipped (current values kept),
 *   numYears       — current horizon; if not > 0, the minimum-withdrawal and
 *                    spending-timeline writes are skipped,
 *   withdrawalFloors / giftingTiers / spendingOverTimeTiers — the CURRENT tier
 *                    lists to patch (arrays; may be empty/missing).
 *   includePlanFields — when true and start > 0, also compute the full spending
 *                       plan (base withdrawal, guardrails, adjustments, glide
 *                       fraction, tier-0 extra). Used when Easy Mode is on and
 *                       Goal Seek is off.
 * }
 * @returns partial scenario: patched tier lists + derived scalar fields.
 */
export function computeDerivedPresetValues(preset, {
  startThousands,
  numYears,
  withdrawalFloors = [],
  giftingTiers = [],
  spendingOverTimeTiers = [],
  includePlanFields = false,
} = {}) {
  const d = preset.derived || {};
  const out = {};
  const hasStart = isPositiveFinite(startThousands);
  const hasYears = isPositiveFinite(numYears);

  // --- Minimum withdrawal: first tier = a lifetime floor spread over the
  // horizon. lifetimePctOfStart is the total minimum spending (as % of start)
  // guaranteed across all years; the annual amount is that total ÷ years.
  // e.g. Balanced 40% of a 3,000 start over 35 years → 34/yr.
  // Conservative uses a higher lifetime % (steadier cash flow); Aggressive a
  // lower one (more willing to cut spending in bad markets). The absolute
  // levels stay modest so Conservative's high success + high ending-balance
  // targets remain Goal-Seek feasible.
  if (
    hasStart
    && hasYears
    && isPositiveFinite(d.minWithdrawalLifetimePctOfStart)
  ) {
    const amount = Math.max(
      0,
      Math.round(startThousands * (d.minWithdrawalLifetimePctOfStart / 100) / numYears),
    );
    const floors = withdrawalFloors.map((t) => ({ ...t }));
    if (floors.length === 0) {
      floors.push({ amount });
    } else {
      floors[0] = { ...floors[0], amount };
    }
    out.withdrawalFloors = floors;
  }

  // --- Gifting: first tier gives Y% of start each year, but only while the
  // balance stays above a multiple of start (so gifts pause in bad markets).
  if (hasStart && d.gifting && isPositiveFinite(d.gifting.amountPctOfStart)) {
    const amount = Math.round(startThousands * (d.gifting.amountPctOfStart / 100));
    const balance = Math.round(startThousands * (d.gifting.balanceMultipleOfStart || 0));
    const gifts = giftingTiers.map((t) => ({ ...t }));
    if (gifts.length === 0) {
      gifts.push({ amount, balance });
    } else {
      gifts[0] = { ...gifts[0], amount, balance };
    }
    out.giftingTiers = gifts;
  }

  // --- Spending over time: the level's annual real change % applies to the
  // first two tiers; the first tier spans a fraction of the horizon (the
  // "active years"); the second tier's extra withdrawal is pinned to 0.
  // Tier-0 extra is set below when includePlanFields; otherwise Goal Seek owns it.
  if (d.spending) {
    const tiers = spendingOverTimeTiers.map((t) => ({ ...t }));
    const changePct = d.spending.changePct;
    if (tiers.length >= 2) {
      if (Number.isFinite(changePct)) {
        tiers[0].changePct = changePct;
        tiers[1].changePct = changePct;
      }
      if (hasYears && isPositiveFinite(d.spending.firstTierYearsFractionOfHorizon)) {
        tiers[0].years = Math.max(1, Math.round(numYears * d.spending.firstTierYearsFractionOfHorizon));
      }
      tiers[1].extra = 0;
      out.spendingOverTimeTiers = tiers;
    } else if (tiers.length === 1) {
      // A single tier has no year span (it covers all remaining years), so
      // only the change % applies.
      if (Number.isFinite(changePct)) {
        tiers[0].changePct = changePct;
        out.spendingOverTimeTiers = tiers;
      }
    }
    // Empty list: leave alone — the app normalizes it to one flat tier.
  }

  // --- Full spending plan (Easy Mode + Goal Seek off): base withdrawal,
  // balance guardrails, market adjustment amounts, glide recycle rate, and
  // tier-0 go-go extra — all from per-preset derived parameters.
  if (includePlanFields && hasStart) {
    let baseWithdrawal = 0;
    if (isPositiveFinite(d.baseWithdrawalPctOfStart)) {
      baseWithdrawal = Math.max(
        0,
        Math.round(startThousands * (d.baseWithdrawalPctOfStart / 100)),
      );
      out.baseWithdrawal = baseWithdrawal;
    }

    if (isPositiveFinite(d.floorBalanceMultipleOfStart)) {
      out.floorBalance = Math.round(startThousands * d.floorBalanceMultipleOfStart);
    }
    if (isPositiveFinite(d.ceilingBalanceMultipleOfStart)) {
      out.ceilingBalance = Math.round(startThousands * d.ceilingBalanceMultipleOfStart);
    }
    if (Number.isFinite(d.floorPenalty)) out.floorPenalty = d.floorPenalty;
    if (Number.isFinite(d.ceilingBonus)) out.ceilingBonus = d.ceilingBonus;
    if (Number.isFinite(d.glideFraction)) out.glideFraction = d.glideFraction;

    const adj = d.dynAdjPctOfBase;
    if (baseWithdrawal > 0 && adj) {
      if (Number.isFinite(adj.low)) {
        out.dynLowAdj = Math.round(baseWithdrawal * (adj.low / 100));
      }
      if (Number.isFinite(adj.med)) {
        out.dynMedAdj = Math.round(baseWithdrawal * (adj.med / 100));
      }
      if (Number.isFinite(adj.high)) {
        out.dynHighAdj = Math.round(baseWithdrawal * (adj.high / 100));
      }
    }

    if (
      baseWithdrawal > 0
      && isPositiveFinite(d.spendingExtraPctOfBase)
      && out.spendingOverTimeTiers
      && out.spendingOverTimeTiers.length > 0
    ) {
      const tiers = out.spendingOverTimeTiers.map((t) => ({ ...t }));
      tiers[0].extra = Math.round(baseWithdrawal * (d.spendingExtraPctOfBase / 100));
      out.spendingOverTimeTiers = tiers;
    } else if (
      baseWithdrawal > 0
      && isPositiveFinite(d.spendingExtraPctOfBase)
      && spendingOverTimeTiers.length > 0
    ) {
      const tiers = spendingOverTimeTiers.map((t) => ({ ...t }));
      tiers[0].extra = Math.round(baseWithdrawal * (d.spendingExtraPctOfBase / 100));
      out.spendingOverTimeTiers = tiers;
    }
  }

  // --- "No cut while ahead" threshold, as a multiple of start. 1 × start
  // means a bad market year never cuts spending while the portfolio is still
  // above where it began.
  if (hasStart && isPositiveFinite(d.noCutBalanceMultipleOfStart)) {
    out.dynNoCutBal = Math.round(startThousands * d.noCutBalanceMultipleOfStart);
  }

  // --- Goal Seek target ending balance: % of start the plan should leave
  // behind at the horizon (100 = preserve fully, 0 = spend down fully).
  // The glide-path Target mirrors it so the UI (and preview chart) stay in
  // sync with Easy Mode before Goal Seek runs and pins them together.
  if (hasStart && Number.isFinite(d.targetEndingBalancePctOfStart)) {
    const target = Math.round(
      startThousands * (d.targetEndingBalancePctOfStart / 100),
    );
    out.goalSeekTargetEndingBalance = target;
    out.glideTarget = target;
  }

  return out;
}

/**
 * Full scenario patch for a slider level: static preset keys + derived values.
 * `context` is the same object computeDerivedPresetValues takes.
 */
export function presetScenarioPatch(level, context = {}) {
  const preset = presetForLevel(level);
  return {
    ...preset.scenario,
    ...computeDerivedPresetValues(preset, context),
  };
}
