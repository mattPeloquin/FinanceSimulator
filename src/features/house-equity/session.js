// House Equity session state — config persisted; results in memory only.
// Money fields are whole $000s; rate fields are percents (4 = 4%), matching Plan.

import { HOUSE_EQUITY_STATE_VERSION } from '../../state/migrations.js';
import { FEATURE_HOUSE_EQUITY, FEATURE_SOR_PLAN } from '../../state/storageKeys.js';
import { SCHEMA_VERSION } from '../../state/scenario.js';
import * as sessions from '../../state/sessions.js';
import {
  setSessionMeta,
  refreshSessionList,
  updateSessionNoteDisplay,
  updateSessionActionButtons,
  snapshotSessionUi,
} from '../../ui/sessionChrome.js';
import { getHouseEquityPresets } from './presets.js';

export { HOUSE_EQUITY_STATE_VERSION };

/** @type {(() => void) | null} */
let onStateApplied = null;
/** @type {(() => void) | null} */
let onResultsCleared = null;

export function registerHouseEquityUiHooks(hooks = {}) {
  if (hooks.onStateApplied) onStateApplied = hooks.onStateApplied;
  if (hooks.onResultsCleared) onResultsCleared = hooks.onResultsCleared;
}

/** Whole $000s (Plan convention). */
function moneyK(raw, fallback = 0) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.round(n));
}

/**
 * Percent in UI/state (4 = 4%). Accepts legacy decimals (0.04) from early v1 sessions.
 * @param {unknown} raw
 * @param {number} fallback - percent
 * @param {{ min?: number, max?: number, allowLegacyDecimal?: boolean }} [opts]
 */
function pct(raw, fallback, { min = 0, max = 100, allowLegacyDecimal = true } = {}) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  let value = n;
  // Early v1 stored decimals (0.04). Values in (0, 1] with a fallback > 1 are upgraded.
  if (allowLegacyDecimal && value > 0 && value <= 1 && fallback > 1) {
    value *= 100;
  }
  return Math.max(min, Math.min(max, value));
}

export function defaultHouseEquityState() {
  return {
    version: HOUSE_EQUITY_STATE_VERSION,
    presetActive: true,
    presetLevel: 0,
    currentAge: 65,
    numYears: 25,
    accessYear: 0,
    // Money fields are $000s.
    homeValue: 800,
    costBasis: 350,
    cgExclusion: 250,
    existingMortgageBalance: 200,
    annualSpendTarget: 30,
    annualRent: 36,
    // Rate fields are percents (Plan convention).
    longTermCgRate: 15,
    saleCommissionPct: 5,
    saleOtherClosingPct: 2,
    existingMortgageRate: 4,
    existingMortgageTermYears: 15,
    expectedRealAppreciation: 1,
    expectedInflation: 2.5,
    realRentGrowth: 0,
    // Simplified RM
    simplifiedRmMode: 'loc',
    simplifiedRmFeePct: 2,
    simplifiedRmRate: 6,
    simplifiedRmLineGrowth: 3,
    // Private RM
    privateRmMode: 'loc',
    privateRmProceedsPct: 50,
    privateRmFeePct: 3,
    privateRmRate: 7,
    privateRmLineGrowth: 4,
    // HELOC
    helocLtv: 75,
    helocRate: 8,
    // Cash-out
    cashOutLtv: 70,
    cashOutRate: 6.5,
    cashOutTermYears: 30,
    cashOutClosingPct: 2,
    numSimulations: 500,
    seed: null,
    scenarioRef: null,
    constantRealReturn: 4,
    focusStrategyId: 'simplifiedRm',
  };
}

/** @type {object} */
let heState = defaultHouseEquityState();
let heResult = null;
let heResultStale = false;

export function getHouseEquityState() {
  return heState;
}

export function getHouseEquityResult() {
  return heResult;
}

export function setHouseEquityResult(result) {
  heResult = result;
  heResultStale = false;
}

export function isHouseEquityResultStale() {
  return heResultStale;
}

export function setHouseEquityResultStale(stale) {
  heResultStale = !!stale;
}

export function normalizeHouseEquityState(raw) {
  const base = defaultHouseEquityState();
  if (!raw || typeof raw !== 'object') return base;

  const presetLevel = [0, 1, 2].includes(Number(raw.presetLevel))
    ? Number(raw.presetLevel)
    : base.presetLevel;

  let scenarioRef = null;
  if (raw.scenarioRef && typeof raw.scenarioRef === 'object' && raw.scenarioRef.name) {
    scenarioRef = {
      feature: raw.scenarioRef.feature || FEATURE_SOR_PLAN,
      name: String(raw.scenarioRef.name),
    };
  }

  const numYears = Math.max(1, Math.min(60, parseInt(raw.numYears, 10) || base.numYears));
  const accessYear = Math.max(
    0,
    Math.min(numYears, parseInt(raw.accessYear, 10) ?? base.accessYear),
  );

  return {
    version: HOUSE_EQUITY_STATE_VERSION,
    presetActive: raw.presetActive !== false,
    presetLevel,
    currentAge: Math.max(40, Math.min(100, parseInt(raw.currentAge, 10) || base.currentAge)),
    numYears,
    accessYear,
    homeValue: moneyK(raw.homeValue, base.homeValue),
    costBasis: moneyK(raw.costBasis, base.costBasis),
    cgExclusion: moneyK(raw.cgExclusion, base.cgExclusion),
    existingMortgageBalance: moneyK(raw.existingMortgageBalance, base.existingMortgageBalance),
    annualSpendTarget: moneyK(raw.annualSpendTarget, base.annualSpendTarget),
    annualRent: moneyK(raw.annualRent, base.annualRent),
    longTermCgRate: pct(raw.longTermCgRate, base.longTermCgRate, { max: 100 }),
    saleCommissionPct: pct(raw.saleCommissionPct, base.saleCommissionPct, { max: 20 }),
    saleOtherClosingPct: pct(raw.saleOtherClosingPct, base.saleOtherClosingPct, { max: 20 }),
    existingMortgageRate: pct(raw.existingMortgageRate, base.existingMortgageRate, { max: 20 }),
    existingMortgageTermYears: Math.max(
      0,
      Math.min(40, parseInt(raw.existingMortgageTermYears, 10) || base.existingMortgageTermYears),
    ),
    expectedRealAppreciation: pct(raw.expectedRealAppreciation, base.expectedRealAppreciation, {
      min: -10,
      max: 20,
    }),
    expectedInflation: pct(raw.expectedInflation, base.expectedInflation, { max: 15 }),
    realRentGrowth: pct(raw.realRentGrowth, base.realRentGrowth, {
      min: -5,
      max: 10,
      allowLegacyDecimal: false,
    }),
    simplifiedRmMode: raw.simplifiedRmMode === 'tenure' ? 'tenure' : 'loc',
    simplifiedRmFeePct: pct(raw.simplifiedRmFeePct, base.simplifiedRmFeePct, { max: 20 }),
    simplifiedRmRate: pct(raw.simplifiedRmRate, base.simplifiedRmRate, { max: 20 }),
    simplifiedRmLineGrowth: pct(raw.simplifiedRmLineGrowth, base.simplifiedRmLineGrowth, { max: 20 }),
    privateRmMode: raw.privateRmMode === 'tenure' ? 'tenure' : 'loc',
    privateRmProceedsPct: pct(raw.privateRmProceedsPct, base.privateRmProceedsPct, { max: 90 }),
    privateRmFeePct: pct(raw.privateRmFeePct, base.privateRmFeePct, { max: 20 }),
    privateRmRate: pct(raw.privateRmRate, base.privateRmRate, { max: 20 }),
    privateRmLineGrowth: pct(raw.privateRmLineGrowth, base.privateRmLineGrowth, { max: 20 }),
    helocLtv: pct(raw.helocLtv, base.helocLtv, { max: 100 }),
    helocRate: pct(raw.helocRate, base.helocRate, { max: 25 }),
    cashOutLtv: pct(raw.cashOutLtv, base.cashOutLtv, { max: 95 }),
    cashOutRate: pct(raw.cashOutRate, base.cashOutRate, { max: 20 }),
    cashOutTermYears: Math.max(1, Math.min(40, parseInt(raw.cashOutTermYears, 10) || base.cashOutTermYears)),
    cashOutClosingPct: pct(raw.cashOutClosingPct, base.cashOutClosingPct, { max: 20 }),
    numSimulations: [200, 500, 1000, 2000].includes(Number(raw.numSimulations))
      ? Number(raw.numSimulations)
      : base.numSimulations,
    seed: Number.isFinite(Number(raw.seed)) ? (Number(raw.seed) >>> 0) : null,
    scenarioRef,
    constantRealReturn: pct(raw.constantRealReturn, base.constantRealReturn, {
      min: -20,
      max: 30,
    }),
    focusStrategyId: typeof raw.focusStrategyId === 'string'
      ? raw.focusStrategyId
      : base.focusStrategyId,
  };
}

export function readHouseEquityState() {
  return structuredClone(heState);
}

export function applyHouseEquityState(state) {
  heState = normalizeHouseEquityState(state);
  heResult = null;
  heResultStale = false;
  onResultsCleared?.();
  onStateApplied?.();
}

export function patchHouseEquityState(partial) {
  heState = normalizeHouseEquityState({ ...heState, ...partial });
  heResultStale = !!heResult;
  onStateApplied?.();
}

export function applyHouseEquityPreset(presetId, { keepAttached = true } = {}) {
  const presets = getHouseEquityPresets();
  const index = presets.findIndex((p) => p.id === presetId);
  const preset = index >= 0 ? presets[index] : null;
  if (!preset) return;
  applyHouseEquityState({
    ...heState,
    ...preset.patch,
    presetLevel: index >= 0 ? index : heState.presetLevel,
    presetActive: keepAttached,
  });
}

export function detachHouseEquityPreset() {
  if (!heState.presetActive) return;
  patchHouseEquityState({ presetActive: false });
}

export function resetHouseEquityToDefaults() {
  applyHouseEquityState(defaultHouseEquityState());
  const presets = getHouseEquityPresets();
  if (presets[0]) applyHouseEquityPreset(presets[0].id, { keepAttached: true });
}

export async function getHouseEquityDependencies() {
  const ref = heState.scenarioRef;
  if (!ref?.name) return [];
  try {
    const loaded = await sessions.load(ref.feature || FEATURE_SOR_PLAN, ref.name);
    if (!loaded?.payload) return [];
    return [{
      feature: ref.feature || FEATURE_SOR_PLAN,
      name: ref.name,
      state: loaded.payload,
      stateVersion: SCHEMA_VERSION,
      description: loaded.description || '',
    }];
  } catch {
    return [];
  }
}

export async function applyImportedHouseEquity(loaded, { statusMessage, renames } = {}) {
  let state = normalizeHouseEquityState(loaded.state || {});
  if (state.scenarioRef?.name && Array.isArray(renames) && renames.length) {
    const planRenames = renames.filter(
      (r) => (r.feature || FEATURE_SOR_PLAN) === FEATURE_SOR_PLAN,
    );
    const exact = planRenames.find((r) => r.requestedName === state.scenarioRef.name);
    if (exact) {
      state = {
        ...state,
        scenarioRef: { ...state.scenarioRef, name: exact.name },
      };
    } else if (planRenames.length === 1) {
      state = {
        ...state,
        scenarioRef: { ...state.scenarioRef, name: planRenames[0].name },
      };
    }
  }

  applyHouseEquityState(state);
  setSessionMeta({
    name: '',
    description: loaded.description || '',
    lastSelect: '',
  });
  await refreshSessionList('');
  updateSessionNoteDisplay();
  updateSessionActionButtons();
  snapshotSessionUi(FEATURE_HOUSE_EQUITY);
  if (statusMessage) {
    const el = document.getElementById('house-equity-status');
    if (el) el.textContent = statusMessage;
  }
}
