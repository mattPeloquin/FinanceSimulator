// SOR Lab sweep variable registry.
//
// Each entry declares how to read a baseline value from a Withdraw scenario,
// the wide default envelope to sweep, and how to apply a swept value back onto
// a scenario clone. Envelopes are deliberately wide because widening later
// costs a re-run; the UI lets users narrow ranges for display or override
// before the next run.
//
// Deliberately excluded (not an oversight — see module comments below):
//   CRN-hostile plumbing: blockSize, distMethod, startYear/endYear,
//     scaledHistoricalSmoothing (crossing zero gates extra RNG draws/year)
//   Run mechanics: randomSeed, numSimulations, smoothWindowPct, parallelCores
//   Grading / search yardsticks: withdrawRiskTolerancePct, withdrawalMetric,
//     onTargetMeasure, onTargetYearly*, earlyWeight*, all goalSeek*, preset*

import {
  ALLOCATION_KEYS,
  normalizeSpendingOverTimeTiers,
  normalizeWithdrawalFloors,
  normalizeGiftingTiers,
  normalizeMajorEvents,
  normalizeWithdrawalTaxTiers,
  normalizeAllocationOverTimeTiers,
} from '../../state/scenario.js';

const EQUITY_KEYS = [
  'usLgGrowthAllocation',
  'usLgValueAllocation',
  'usSmMidAllocation',
  'exUsAllocation',
];

const EQUITY_MEAN_KEYS = [
  'usLgGrowthMean',
  'usLgValueMean',
  'usSmMidMean',
  'exUsMean',
];

const EQUITY_STD_KEYS = [
  'usLgGrowthStdDev',
  'usLgValueStdDev',
  'usSmMidStdDev',
  'exUsStdDev',
];

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function cloneScenario(scenario) {
  return structuredClone(scenario);
}

function clamp(value, lo, hi) {
  return Math.min(hi, Math.max(lo, value));
}

function scaleAround(baseline, loMult, hiMult, { minAbs = null } = {}) {
  const b = num(baseline);
  let low = b * loMult;
  let high = b * hiMult;
  if (minAbs != null) {
    if (Math.abs(high - low) < minAbs) {
      low = b - minAbs / 2;
      high = b + minAbs / 2;
    }
  }
  if (low > high) [low, high] = [high, low];
  return { low, high };
}

function hasGlideTarget(scenario) {
  return scenario.glideTarget != null && scenario.glideTarget !== '';
}

function hasActiveFloor(scenario) {
  return num(scenario.floorBalance) > 0;
}

function hasActiveCeiling(scenario) {
  return num(scenario.ceilingBalance) > 0;
}

function isBaseStrategy(scenario) {
  return (scenario.withdrawalStrategy || 'base') === 'base';
}

function isSpecificStrategy(scenario) {
  return scenario.withdrawalStrategy === 'specific';
}

function readEquityShare(scenario) {
  return EQUITY_KEYS.reduce((sum, k) => sum + num(scenario[k]), 0);
}

/** Apply an equity-share target while preserving within-equity proportions. */
export function applyEquitySharePct(scenario, equitySharePct) {
  const out = cloneScenario(scenario);
  const targetEquity = clamp(num(equitySharePct), 0, 100);
  const currentEquity = readEquityShare(out);
  const bond = num(out.bondAllocation);
  const cash = num(out.cashAllocation);
  const defensive = bond + cash;

  if (currentEquity > 1e-9) {
    const scale = targetEquity / currentEquity;
    for (const key of EQUITY_KEYS) {
      out[key] = num(out[key]) * scale;
    }
  } else if (targetEquity > 0) {
    // Flat equity mix when baseline had none.
    const each = targetEquity / EQUITY_KEYS.length;
    for (const key of EQUITY_KEYS) out[key] = each;
  } else {
    for (const key of EQUITY_KEYS) out[key] = 0;
  }

  const remaining = 100 - targetEquity;
  if (defensive > 1e-9) {
    out.bondAllocation = remaining * (bond / defensive);
    out.cashAllocation = remaining * (cash / defensive);
  } else {
    out.bondAllocation = remaining;
    out.cashAllocation = 0;
  }
  renormalizeAllocations(out);
  return out;
}

/** Split the defensive sleeve (bonds + cash) while holding equity fixed. */
export function applyBondVsCashSplit(scenario, bondPctOfDefensive) {
  const out = cloneScenario(scenario);
  const equity = readEquityShare(out);
  const defensive = Math.max(0, 100 - equity);
  const bondShare = clamp(num(bondPctOfDefensive), 0, 100) / 100;
  out.bondAllocation = defensive * bondShare;
  out.cashAllocation = defensive * (1 - bondShare);
  renormalizeAllocations(out);
  return out;
}

function renormalizeAllocations(scenario) {
  let total = 0;
  for (const key of ALLOCATION_KEYS) total += num(scenario[key]);
  if (total <= 1e-12) {
    scenario.cashAllocation = 100;
    return;
  }
  for (const key of ALLOCATION_KEYS) {
    scenario[key] = (num(scenario[key]) / total) * 100;
  }
}

function applyOffsetToKeys(scenario, keys, offsetPts) {
  const out = cloneScenario(scenario);
  for (const key of keys) {
    const current = out[key];
    if (current == null || current === '') continue;
    out[key] = num(current) + offsetPts;
  }
  return out;
}

function applyScaleToKeys(scenario, keys, scale) {
  const out = cloneScenario(scenario);
  for (const key of keys) {
    const current = out[key];
    if (current == null || current === '') continue;
    out[key] = Math.max(0, num(current) * scale);
  }
  return out;
}

function scaleSpecificWithdrawalText(raw, scale) {
  const lines = String(raw || '').split(/\r?\n/);
  const out = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      out.push('');
      continue;
    }
    const n = parseFloat(trimmed.replace(/[$,]/g, ''));
    if (!Number.isFinite(n)) {
      out.push(line);
      continue;
    }
    out.push(String(n * scale));
  }
  return out.join('\n');
}

/**
 * @typedef {object} LabVariable
 * @property {string} id
 * @property {string} label
 * @property {string} group
 * @property {'decision'|'uncertainty'} category
 * @property {string} unit
 * @property {(scenario: object) => boolean} isLive
 * @property {(scenario: object) => string|null} [gateReason]
 * @property {(scenario: object) => number} baselineValue
 * @property {(scenario: object) => { low: number, high: number }} defaultEnvelope
 * @property {(scenario: object, value: number) => object} apply
 * @property {boolean} [isSentinel]
 * @property {boolean} [crnSafe]
 */

/** @type {LabVariable[]} */
export const LAB_VARIABLES = [
  // ---- Portfolio and horizon ------------------------------------------------
  {
    id: 'startBalance',
    label: 'Starting portfolio',
    group: 'Portfolio & horizon',
    category: 'decision',
    unit: '$000s',
    isLive: (s) => num(s.startBalance) > 0,
    gateReason: () => 'Enter a starting portfolio in the Withdraw scenario',
    baselineValue: (s) => num(s.startBalance),
    defaultEnvelope: (s) => scaleAround(num(s.startBalance), 0.7, 1.3),
    apply: (s, v) => {
      const out = cloneScenario(s);
      out.startBalance = v;
      return out;
    },
  },
  {
    id: 'retirementYears',
    label: 'Retirement length',
    group: 'Portfolio & horizon',
    category: 'uncertainty',
    unit: 'years',
    isLive: () => true,
    baselineValue: (s) => num(s.numYears, 30),
    defaultEnvelope: (s) => {
      const b = num(s.numYears, 30);
      return { low: clamp(b - 10, 5, 60), high: clamp(b + 10, 5, 60) };
    },
    apply: (s, v) => {
      const out = cloneScenario(s);
      out.numYears = Math.round(clamp(v, 1, 100));
      return out;
    },
  },
  {
    id: 'horizonSpread',
    label: 'Horizon uncertainty',
    group: 'Portfolio & horizon',
    category: 'uncertainty',
    unit: 'years',
    isLive: () => true,
    baselineValue: (s) => Math.max(num(s.horizonPlusYears), num(s.horizonMinusYears)),
    defaultEnvelope: () => ({ low: 0, high: 10 }),
    apply: (s, v) => {
      const out = cloneScenario(s);
      const spread = Math.round(clamp(v, 0, 30));
      out.horizonPlusYears = spread;
      out.horizonMinusYears = spread;
      return out;
    },
  },
  {
    id: 'advisorFeePct',
    label: 'Advisor & fund fee',
    group: 'Portfolio & horizon',
    category: 'decision',
    unit: '%',
    isLive: (s) => !!s.enableFeesTaxes,
    gateReason: () => 'Enable Fees & Taxes in the Withdraw scenario',
    baselineValue: (s) => num(s.advisorFeePct),
    defaultEnvelope: () => ({ low: 0, high: 1.5 }),
    apply: (s, v) => {
      const out = cloneScenario(s);
      out.advisorFeePct = clamp(v, 0, 5);
      out.enableFeesTaxes = true;
      return out;
    },
  },

  // ---- Spending -------------------------------------------------------------
  {
    id: 'baseWithdrawal',
    label: 'Base annual withdrawal',
    group: 'Spending',
    category: 'decision',
    unit: '$000s',
    isLive: (s) => isBaseStrategy(s) && num(s.baseWithdrawal) > 0,
    gateReason: (s) => (isSpecificStrategy(s)
      ? 'Base strategy only (this Plan uses a Specific List)'
      : 'Set a base withdrawal in the Withdraw scenario'),
    baselineValue: (s) => num(s.baseWithdrawal),
    defaultEnvelope: (s) => scaleAround(num(s.baseWithdrawal), 0.7, 1.3, { minAbs: 1 }),
    apply: (s, v) => {
      const out = cloneScenario(s);
      out.baseWithdrawal = Math.max(0, v);
      return out;
    },
  },
  {
    id: 'spendingChangeOffset',
    label: 'Annual real spending change',
    group: 'Spending',
    category: 'decision',
    unit: 'pp',
    isLive: (s) => isBaseStrategy(s),
    gateReason: () => 'Base strategy only',
    baselineValue: () => 0,
    defaultEnvelope: () => ({ low: -3, high: 3 }),
    apply: (s, v) => {
      const out = cloneScenario(s);
      const tiers = normalizeSpendingOverTimeTiers(out.spendingOverTimeTiers);
      out.spendingOverTimeTiers = tiers.map((t) => ({
        ...t,
        changePct: num(t.changePct) + v,
      }));
      return out;
    },
  },
  {
    id: 'spendingExtraScale',
    label: 'Front-loaded extra spending',
    group: 'Spending',
    category: 'decision',
    unit: '×',
    isLive: (s) => isBaseStrategy(s),
    gateReason: () => 'Base strategy only',
    baselineValue: (s) => {
      const tiers = normalizeSpendingOverTimeTiers(s.spendingOverTimeTiers);
      const extra = num(tiers[0]?.extra);
      // Store as a scale relative to baseline extra (1 = unchanged). When
      // baseline extra is 0, baselineValue is 0 and the envelope is absolute $000s
      // expressed as a 0…0.5× baseWithdrawal scale of "extra dollars / base".
      return extra > 0 ? 1 : 0;
    },
    defaultEnvelope: (s) => {
      const tiers = normalizeSpendingOverTimeTiers(s.spendingOverTimeTiers);
      const extra = num(tiers[0]?.extra);
      if (extra > 0) return { low: 0, high: 2 };
      return { low: 0, high: 0.5 };
    },
    apply: (s, v) => {
      const out = cloneScenario(s);
      const tiers = normalizeSpendingOverTimeTiers(out.spendingOverTimeTiers).map((t) => ({ ...t }));
      if (tiers.length === 0) {
        out.spendingOverTimeTiers = tiers;
        return out;
      }
      const baselineExtra = num(
        normalizeSpendingOverTimeTiers(s.spendingOverTimeTiers)[0]?.extra,
      );
      if (baselineExtra > 0) {
        tiers[0].extra = baselineExtra * v;
      } else {
        // v is a fraction of base withdrawal when baseline extra is zero.
        tiers[0].extra = num(s.baseWithdrawal) * v;
      }
      out.spendingOverTimeTiers = tiers;
      return out;
    },
  },
  {
    id: 'specificWithdrawalScale',
    label: 'Specific list amounts',
    group: 'Spending',
    category: 'decision',
    unit: '×',
    isLive: (s) => isSpecificStrategy(s) && String(s.specificWithdrawals || '').trim() !== '',
    gateReason: () => 'Specific List strategy only',
    baselineValue: () => 1,
    defaultEnvelope: () => ({ low: 0.7, high: 1.3 }),
    apply: (s, v) => {
      const out = cloneScenario(s);
      out.specificWithdrawals = scaleSpecificWithdrawalText(s.specificWithdrawals, v);
      return out;
    },
  },
  {
    id: 'withdrawalFloorScale',
    label: 'Minimum withdrawal floor',
    group: 'Spending',
    category: 'decision',
    unit: '×',
    isLive: (s) => {
      if (isSpecificStrategy(s)) {
        return Array.isArray(s.specificWithdrawalFloors) && s.specificWithdrawalFloors.length > 0;
      }
      const floors = normalizeWithdrawalFloors(s.withdrawalFloors);
      return floors.length > 0 && floors.some((f) => num(f.amount) > 0);
    },
    gateReason: () => 'Add a minimum-withdrawal floor in the Withdraw scenario',
    baselineValue: () => 1,
    defaultEnvelope: () => ({ low: 0.5, high: 1.5 }),
    apply: (s, v) => {
      const out = cloneScenario(s);
      if (isSpecificStrategy(s)) {
        out.specificWithdrawalFloors = (s.specificWithdrawalFloors || []).map((f) => ({
          ...f,
          minPct: num(f.minPct) * v,
        }));
      } else {
        out.withdrawalFloors = normalizeWithdrawalFloors(s.withdrawalFloors).map((f) => ({
          ...f,
          amount: num(f.amount) * v,
        }));
      }
      return out;
    },
  },

  // ---- Balance guardrails ---------------------------------------------------
  {
    id: 'floorBalance',
    label: 'Floor threshold',
    group: 'Balance guardrails',
    category: 'decision',
    unit: '$000s',
    isLive: (s) => !!s.enableDynamicAdjustments && hasActiveFloor(s),
    gateReason: () => 'Enable dynamic adjustments with a floor balance',
    baselineValue: (s) => num(s.floorBalance),
    defaultEnvelope: (s) => {
      const start = Math.max(num(s.startBalance), 1);
      return { low: start * 0.4, high: start * 1.2 };
    },
    apply: (s, v) => {
      const out = cloneScenario(s);
      out.floorBalance = Math.max(0, v);
      out.enableDynamicAdjustments = true;
      return out;
    },
  },
  {
    id: 'floorPenalty',
    label: 'Max cut below floor',
    group: 'Balance guardrails',
    category: 'decision',
    unit: '%',
    isLive: (s) => !!s.enableDynamicAdjustments && hasActiveFloor(s),
    gateReason: () => 'Requires an active floor threshold',
    baselineValue: (s) => num(s.floorPenalty),
    defaultEnvelope: () => ({ low: 0, high: 100 }),
    apply: (s, v) => {
      const out = cloneScenario(s);
      out.floorPenalty = clamp(v, 0, 100);
      return out;
    },
  },
  {
    id: 'ceilingBalance',
    label: 'Ceiling threshold',
    group: 'Balance guardrails',
    category: 'decision',
    unit: '$000s',
    isLive: (s) => !!s.enableDynamicAdjustments && hasActiveCeiling(s),
    gateReason: () => 'Enable dynamic adjustments with a ceiling balance',
    baselineValue: (s) => num(s.ceilingBalance),
    defaultEnvelope: (s) => {
      const start = Math.max(num(s.startBalance), 1);
      return { low: start * 1.0, high: start * 2.0 };
    },
    apply: (s, v) => {
      const out = cloneScenario(s);
      out.ceilingBalance = Math.max(0, v);
      out.enableDynamicAdjustments = true;
      return out;
    },
  },
  {
    id: 'ceilingBonus',
    label: 'Boost above ceiling',
    group: 'Balance guardrails',
    category: 'decision',
    unit: '%',
    isLive: (s) => !!s.enableDynamicAdjustments && hasActiveCeiling(s),
    gateReason: () => 'Requires an active ceiling threshold',
    baselineValue: (s) => num(s.ceilingBonus),
    defaultEnvelope: () => ({ low: 0, high: 150 }),
    apply: (s, v) => {
      const out = cloneScenario(s);
      out.ceilingBonus = clamp(v, 0, 300);
      return out;
    },
  },

  // ---- Market-return adjustments --------------------------------------------
  {
    id: 'dynLowAdj',
    label: 'Cut in poor markets',
    group: 'Market adjustments',
    category: 'decision',
    unit: '$000s',
    isLive: (s) => !!s.enableDynamicAdjustments,
    gateReason: () => 'Enable dynamic adjustments',
    baselineValue: (s) => num(s.dynLowAdj),
    defaultEnvelope: (s) => {
      const base = Math.max(num(s.baseWithdrawal), 1);
      return { low: -0.6 * base, high: 0 };
    },
    apply: (s, v) => {
      const out = cloneScenario(s);
      out.dynLowAdj = v;
      out.enableDynamicAdjustments = true;
      return out;
    },
  },
  {
    id: 'dynHighAdj',
    label: 'Boost in strong markets',
    group: 'Market adjustments',
    category: 'decision',
    unit: '$000s',
    isLive: (s) => !!s.enableDynamicAdjustments,
    gateReason: () => 'Enable dynamic adjustments',
    baselineValue: (s) => num(s.dynHighAdj),
    defaultEnvelope: (s) => {
      const base = Math.max(num(s.baseWithdrawal), 1);
      return { low: 0, high: 0.6 * base };
    },
    apply: (s, v) => {
      const out = cloneScenario(s);
      out.dynHighAdj = v;
      out.enableDynamicAdjustments = true;
      return out;
    },
  },
  {
    id: 'dynLowRet',
    label: 'Poor-market trigger',
    group: 'Market adjustments',
    category: 'decision',
    unit: '%',
    isLive: (s) => !!s.enableDynamicAdjustments,
    gateReason: () => 'Enable dynamic adjustments',
    baselineValue: (s) => num(s.dynLowRet),
    defaultEnvelope: () => ({ low: -30, high: -5 }),
    apply: (s, v) => {
      const out = cloneScenario(s);
      out.dynLowRet = v;
      return out;
    },
  },
  {
    id: 'dynHighRet',
    label: 'Strong-market trigger',
    group: 'Market adjustments',
    category: 'decision',
    unit: '%',
    isLive: (s) => !!s.enableDynamicAdjustments,
    gateReason: () => 'Enable dynamic adjustments',
    baselineValue: (s) => num(s.dynHighRet),
    defaultEnvelope: () => ({ low: 15, high: 45 }),
    apply: (s, v) => {
      const out = cloneScenario(s);
      out.dynHighRet = v;
      return out;
    },
  },
  {
    id: 'dynNoCutBal',
    label: 'No-cut balance shield',
    group: 'Market adjustments',
    category: 'decision',
    unit: '$000s',
    isLive: (s) => !!s.enableDynamicAdjustments
      && s.dynNoCutBal != null && s.dynNoCutBal !== '',
    gateReason: () => 'Set a no-cut balance in the Withdraw scenario',
    baselineValue: (s) => num(s.dynNoCutBal),
    defaultEnvelope: (s) => {
      const start = Math.max(num(s.startBalance), 1);
      return { low: start * 0.4, high: start * 1.2 };
    },
    apply: (s, v) => {
      const out = cloneScenario(s);
      out.dynNoCutBal = Math.max(0, v);
      return out;
    },
  },

  // ---- Glide and legacy -----------------------------------------------------
  {
    id: 'glideTarget',
    label: 'Glide-path target',
    group: 'Glide & legacy',
    category: 'decision',
    unit: '$000s',
    isLive: (s) => hasGlideTarget(s),
    gateReason: () => 'Set a glide-path target in the Withdraw scenario',
    baselineValue: (s) => num(s.glideTarget),
    defaultEnvelope: (s) => {
      const start = Math.max(num(s.startBalance), 1);
      return { low: 0, high: start * 0.5 };
    },
    apply: (s, v) => {
      const out = cloneScenario(s);
      out.glideTarget = Math.max(0, v);
      return out;
    },
  },
  {
    id: 'glideFraction',
    label: 'Surplus recycled',
    group: 'Glide & legacy',
    category: 'decision',
    unit: '%',
    isLive: (s) => hasGlideTarget(s),
    gateReason: () => 'Requires a glide-path target',
    baselineValue: (s) => num(s.glideFraction),
    defaultEnvelope: () => ({ low: 0, high: 100 }),
    apply: (s, v) => {
      const out = cloneScenario(s);
      out.glideFraction = clamp(v, 0, 100);
      return out;
    },
  },
  {
    id: 'glideRate',
    label: 'Spend timing',
    group: 'Glide & legacy',
    category: 'decision',
    unit: '%',
    isLive: (s) => hasGlideTarget(s),
    gateReason: () => 'Requires a glide-path target',
    baselineValue: (s) => num(s.glideRate),
    defaultEnvelope: () => ({ low: -5, high: 5 }),
    apply: (s, v) => {
      const out = cloneScenario(s);
      out.glideRate = v;
      return out;
    },
  },

  // ---- Allocation (reparameterized) -----------------------------------------
  {
    id: 'equitySharePct',
    label: 'Equity share',
    group: 'Allocation',
    category: 'decision',
    unit: '%',
    isLive: () => true,
    baselineValue: (s) => readEquityShare(s),
    defaultEnvelope: (s) => {
      const b = readEquityShare(s);
      return { low: clamp(b - 25, 0, 100), high: clamp(b + 25, 0, 100) };
    },
    apply: applyEquitySharePct,
  },
  {
    id: 'bondVsCashSplit',
    label: 'Bonds vs cash (defensive)',
    group: 'Allocation',
    category: 'decision',
    unit: '%',
    isLive: (s) => num(s.bondAllocation) + num(s.cashAllocation) > 0,
    gateReason: () => 'Needs a non-zero bond + cash sleeve',
    baselineValue: (s) => {
      const bond = num(s.bondAllocation);
      const cash = num(s.cashAllocation);
      const def = bond + cash;
      return def > 0 ? (bond / def) * 100 : 50;
    },
    defaultEnvelope: () => ({ low: 0, high: 100 }),
    apply: applyBondVsCashSplit,
  },
  {
    id: 'allocationGlideDelta',
    label: 'Equity drift by horizon end',
    group: 'Allocation',
    category: 'decision',
    unit: 'pp',
    isLive: (s) => {
      const fallback = {};
      for (const key of ALLOCATION_KEYS) fallback[key] = num(s[key]);
      const tiers = normalizeAllocationOverTimeTiers(s.allocationOverTimeTiers, fallback);
      return tiers.length > 0;
    },
    gateReason: () => 'Needs an allocation-over-time tier',
    baselineValue: () => 0,
    defaultEnvelope: () => ({ low: -30, high: 30 }),
    apply: (s, v) => {
      const out = cloneScenario(s);
      const fallback = {};
      for (const key of ALLOCATION_KEYS) fallback[key] = num(s[key]);
      const tiers = normalizeAllocationOverTimeTiers(s.allocationOverTimeTiers, fallback)
        .map((t) => ({ ...t }));
      if (tiers.length === 0) {
        out.allocationOverTimeTiers = tiers;
        return out;
      }
      const last = tiers[tiers.length - 1];
      const currentEquity = EQUITY_KEYS.reduce((sum, k) => sum + num(last[k]), 0);
      const targetEquity = clamp(currentEquity + v, 0, 100);
      // Reuse the same equity-share logic on the tier object.
      const tierAsScenario = { ...last };
      const adjusted = applyEquitySharePct(tierAsScenario, targetEquity);
      for (const key of ALLOCATION_KEYS) last[key] = adjusted[key];
      out.allocationOverTimeTiers = tiers;
      return out;
    },
  },

  // ---- Return and inflation assumptions -------------------------------------
  {
    id: 'equityReturnOffset',
    label: 'Equity return',
    group: 'Returns & inflation',
    category: 'uncertainty',
    unit: 'pp',
    isLive: (s) => EQUITY_MEAN_KEYS.some((k) => s[k] != null && s[k] !== ''),
    gateReason: () => 'Fill return profiles in the Withdraw scenario',
    baselineValue: () => 0,
    defaultEnvelope: () => ({ low: -3, high: 3 }),
    apply: (s, v) => applyOffsetToKeys(s, EQUITY_MEAN_KEYS, v),
  },
  {
    id: 'bondReturnOffset',
    label: 'Bond return',
    group: 'Returns & inflation',
    category: 'uncertainty',
    unit: 'pp',
    isLive: (s) => s.bondReturnMean != null && s.bondReturnMean !== '',
    gateReason: () => 'Fill bond return profile in the Withdraw scenario',
    baselineValue: () => 0,
    defaultEnvelope: () => ({ low: -2, high: 2 }),
    apply: (s, v) => applyOffsetToKeys(s, ['bondReturnMean'], v),
  },
  {
    id: 'cashReturnOffset',
    label: 'Cash return',
    group: 'Returns & inflation',
    category: 'uncertainty',
    unit: 'pp',
    isLive: (s) => s.cashReturnMean != null && s.cashReturnMean !== '',
    gateReason: () => 'Fill cash return profile in the Withdraw scenario',
    baselineValue: () => 0,
    defaultEnvelope: () => ({ low: -2, high: 2 }),
    apply: (s, v) => applyOffsetToKeys(s, ['cashReturnMean'], v),
  },
  {
    id: 'equityVolScale',
    label: 'Equity volatility',
    group: 'Returns & inflation',
    category: 'uncertainty',
    unit: '×',
    isLive: (s) => EQUITY_STD_KEYS.some((k) => s[k] != null && s[k] !== ''),
    gateReason: () => 'Fill equity volatility profiles in the Withdraw scenario',
    baselineValue: () => 1,
    defaultEnvelope: () => ({ low: 0.7, high: 1.4 }),
    apply: (s, v) => applyScaleToKeys(s, EQUITY_STD_KEYS, v),
  },
  {
    id: 'bondVolScale',
    label: 'Bond volatility',
    group: 'Returns & inflation',
    category: 'uncertainty',
    unit: '×',
    isLive: (s) => s.bondReturnStdDev != null && s.bondReturnStdDev !== '',
    gateReason: () => 'Fill bond volatility profile in the Withdraw scenario',
    baselineValue: () => 1,
    defaultEnvelope: () => ({ low: 0.7, high: 1.4 }),
    apply: (s, v) => applyScaleToKeys(s, ['bondReturnStdDev'], v),
  },
  {
    id: 'inflationOffset',
    label: 'Inflation',
    group: 'Returns & inflation',
    category: 'uncertainty',
    unit: 'pp',
    isLive: (s) => s.inflationMean != null && s.inflationMean !== '',
    gateReason: () => 'Fill inflation profile in the Withdraw scenario',
    baselineValue: () => 0,
    defaultEnvelope: () => ({ low: -2, high: 3 }),
    apply: (s, v) => applyOffsetToKeys(s, ['inflationMean'], v),
  },
  {
    id: 'inflationVolScale',
    label: 'Inflation volatility',
    group: 'Returns & inflation',
    category: 'uncertainty',
    unit: '×',
    isLive: (s) => s.inflationStdDev != null && s.inflationStdDev !== '',
    gateReason: () => 'Fill inflation volatility in the Withdraw scenario',
    baselineValue: () => 1,
    defaultEnvelope: () => ({ low: 0.7, high: 1.5 }),
    apply: (s, v) => applyScaleToKeys(s, ['inflationStdDev'], v),
  },

  // ---- Taxes and transfers --------------------------------------------------
  {
    id: 'withdrawalTaxOffset',
    label: 'Withdrawal tax rate',
    group: 'Taxes & transfers',
    category: 'uncertainty',
    unit: 'pp',
    isLive: (s) => !!s.enableFeesTaxes
      && normalizeWithdrawalTaxTiers(s.withdrawalTaxTiers).length > 0,
    gateReason: () => 'Enable Fees & Taxes with at least one tax tier',
    baselineValue: () => 0,
    defaultEnvelope: () => ({ low: -10, high: 10 }),
    apply: (s, v) => {
      const out = cloneScenario(s);
      out.withdrawalTaxTiers = normalizeWithdrawalTaxTiers(s.withdrawalTaxTiers).map((t) => ({
        ...t,
        taxPct: clamp(num(t.taxPct) + v, 0, 100),
      }));
      out.enableFeesTaxes = true;
      return out;
    },
  },
  {
    id: 'giftingAmountScale',
    label: 'Gifting amount',
    group: 'Taxes & transfers',
    category: 'decision',
    unit: '×',
    isLive: (s) => normalizeGiftingTiers(s.giftingTiers).length > 0,
    gateReason: () => 'Add gifting tiers in the Withdraw scenario',
    baselineValue: () => 1,
    defaultEnvelope: () => ({ low: 0, high: 2 }),
    apply: (s, v) => {
      const out = cloneScenario(s);
      out.giftingTiers = normalizeGiftingTiers(s.giftingTiers).map((t) => ({
        ...t,
        amount: num(t.amount) * v,
      }));
      return out;
    },
  },
  {
    id: 'giftingTriggerScale',
    label: 'Gifting balance trigger',
    group: 'Taxes & transfers',
    category: 'decision',
    unit: '×',
    isLive: (s) => normalizeGiftingTiers(s.giftingTiers).length > 0,
    gateReason: () => 'Add gifting tiers in the Withdraw scenario',
    baselineValue: () => 1,
    defaultEnvelope: () => ({ low: 0.6, high: 1.4 }),
    apply: (s, v) => {
      const out = cloneScenario(s);
      out.giftingTiers = normalizeGiftingTiers(s.giftingTiers).map((t) => ({
        ...t,
        balance: num(t.balance) * v,
      }));
      return out;
    },
  },
  {
    id: 'majorEventsScale',
    label: 'Major cash events',
    group: 'Taxes & transfers',
    category: 'decision',
    unit: '×',
    isLive: (s) => isBaseStrategy(s) && normalizeMajorEvents(s.majorEvents).length > 0,
    gateReason: () => 'Add major cash events (Base strategy)',
    baselineValue: () => 1,
    defaultEnvelope: () => ({ low: 0, high: 2 }),
    apply: (s, v) => {
      const out = cloneScenario(s);
      out.majorEvents = normalizeMajorEvents(s.majorEvents).map((e) => ({
        ...e,
        amount: num(e.amount) * v,
      }));
      return out;
    },
  },

  // ---- Sentinels (swept but never applied) ----------------------------------
  {
    id: 'sentinelA',
    label: 'Noise floor A',
    group: 'Sentinels',
    category: 'uncertainty',
    unit: 'index',
    isLive: () => true,
    isSentinel: true,
    baselineValue: () => 0,
    defaultEnvelope: () => ({ low: -1, high: 1 }),
    apply: (s) => cloneScenario(s),
  },
  {
    id: 'sentinelB',
    label: 'Noise floor B',
    group: 'Sentinels',
    category: 'uncertainty',
    unit: 'index',
    isLive: () => true,
    isSentinel: true,
    baselineValue: () => 0,
    defaultEnvelope: () => ({ low: -1, high: 1 }),
    apply: (s) => cloneScenario(s),
  },
];

const VARIABLE_BY_ID = new Map(LAB_VARIABLES.map((v) => [v.id, v]));

export function getLabVariable(id) {
  return VARIABLE_BY_ID.get(id) || null;
}

/**
 * Resolve live + gated variables for a scenario, merging envelope overrides.
 * @param {object} scenario
 * @param {Record<string, { low?: number, high?: number, enabled?: boolean }>} [overrides]
 */
export function resolveLabVariables(scenario, overrides = {}) {
  const live = [];
  const gated = [];
  for (const def of LAB_VARIABLES) {
    const override = overrides[def.id] || {};
    const enabled = override.enabled !== false;
    const isLive = def.isLive(scenario);
    const baselineValue = def.baselineValue(scenario);
    const defaults = def.defaultEnvelope(scenario);
    let low = Number.isFinite(override.low) ? override.low : defaults.low;
    let high = Number.isFinite(override.high) ? override.high : defaults.high;
    if (low > high) [low, high] = [high, low];
    const entry = {
      id: def.id,
      label: def.label,
      group: def.group,
      category: def.category,
      unit: def.unit,
      baselineValue,
      envelope: { low, high },
      defaultEnvelope: { ...defaults },
      crnSafe: def.crnSafe !== false,
      isSentinel: !!def.isSentinel,
      gatedOff: !isLive,
      gateReason: isLive ? null : (def.gateReason?.(scenario) || 'Not available'),
      enabled: enabled && isLive,
      apply: def.apply,
    };
    if (isLive && enabled) live.push(entry);
    else gated.push(entry);
  }
  return { live, gated, all: [...live, ...gated] };
}
