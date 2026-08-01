// Roth Convert session state — config persisted; results in memory only.

import { ROTH_CONVERT_STATE_VERSION } from '../../state/migrations.js';
import { FEATURE_ROTH_CONVERT, FEATURE_SOR_PLAN } from '../../state/storageKeys.js';
import { SCHEMA_VERSION } from '../../state/scenario.js';
import * as sessions from '../../state/sessions.js';
import {
  setSessionMeta,
  refreshSessionList,
  updateSessionNoteDisplay,
  updateSessionActionButtons,
  snapshotSessionUi,
} from '../../ui/sessionChrome.js';
import {
  defaultIllustrativeTaxLadder,
  normalizeTaxLadder,
} from '../../data/taxLadderIllustrative.js';
import { getRothConvertPresets } from './presets.js';

export { ROTH_CONVERT_STATE_VERSION };

/** @type {(() => void) | null} */
let onStateApplied = null;
/** @type {(() => void) | null} */
let onResultsCleared = null;

export function registerRothConvertUiHooks(hooks = {}) {
  if (hooks.onStateApplied) onStateApplied = hooks.onStateApplied;
  if (hooks.onResultsCleared) onResultsCleared = hooks.onResultsCleared;
}

/** Whole $000s (Plan convention). Engine converts to dollars in params.js. */
function moneyK(raw, fallback = 0) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.round(n));
}

export function defaultRothConvertState() {
  return {
    version: ROTH_CONVERT_STATE_VERSION,
    presetActive: true,
    presetLevel: 0,
    couple: true,
    ageA: 62,
    ageB: 60,
    // Money fields are $000s (nearest thousand).
    tradBalance: 800,
    rothBalance: 100,
    taxableBalance: 200,
    taxableBasis: 150,
    taxableGainRate: 0.15,
    otherTaxableIncome: 40,
    ladder: defaultIllustrativeTaxLadder(),
    fillTierRate: 0.22,
    annualConversionCap: 0,
    taxPayment: 'fromTaxable',
    ratePremium: 0.02,
    taxNoiseStd: 0.03,
    rmdEnabled: true,
    qcdEnabled: false,
    qcdAnnual: 0,
    spouseSoleBeneficiary: false,
    numYears: 20,
    numSimulations: 500,
    seed: null,
    // Soft-link to Plan for market returns; null → constant real return.
    scenarioRef: null,
    constantRealReturn: 0.04,
    focusStrategyId: 'custom',
  };
}

/** @type {object} */
let rothState = defaultRothConvertState();
let rothResult = null;
let rothResultStale = false;

export function getRothConvertState() {
  return rothState;
}

export function getRothConvertResult() {
  return rothResult;
}

export function setRothConvertResult(result) {
  rothResult = result;
  rothResultStale = false;
}

export function isRothConvertResultStale() {
  return rothResultStale;
}

export function setRothConvertResultStale(stale) {
  rothResultStale = !!stale;
}

export function normalizeRothConvertState(raw) {
  const base = defaultRothConvertState();
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

  return {
    version: ROTH_CONVERT_STATE_VERSION,
    presetActive: raw.presetActive !== false,
    presetLevel,
    couple: raw.couple !== false,
    ageA: Math.max(40, Math.min(100, parseInt(raw.ageA, 10) || base.ageA)),
    ageB: Math.max(40, Math.min(100, parseInt(raw.ageB, 10) || base.ageB)),
    tradBalance: moneyK(raw.tradBalance, base.tradBalance),
    rothBalance: moneyK(raw.rothBalance, base.rothBalance),
    taxableBalance: moneyK(raw.taxableBalance, base.taxableBalance),
    taxableBasis: moneyK(raw.taxableBasis, base.taxableBasis),
    taxableGainRate: Math.max(
      0,
      Math.min(
        1,
        Number.isFinite(Number(raw.taxableGainRate))
          ? Number(raw.taxableGainRate)
          : base.taxableGainRate,
      ),
    ),
    otherTaxableIncome: moneyK(raw.otherTaxableIncome, base.otherTaxableIncome),
    ladder: normalizeTaxLadder(raw.ladder),
    fillTierRate: [0.10, 0.12, 0.22, 0.24, 0.32, 0.35, 0.37].includes(Number(raw.fillTierRate))
      ? Number(raw.fillTierRate)
      : (Number(raw.fillTierRate) > 0 && Number(raw.fillTierRate) < 1
        ? Number(raw.fillTierRate)
        : base.fillTierRate),
    annualConversionCap: moneyK(raw.annualConversionCap, 0),
    taxPayment: raw.taxPayment === 'withhold' ? 'withhold' : 'fromTaxable',
    ratePremium: Math.max(
      0,
      Math.min(
        0.3,
        Number.isFinite(Number(raw.ratePremium)) ? Number(raw.ratePremium) : base.ratePremium,
      ),
    ),
    taxNoiseStd: Math.max(
      0,
      Math.min(
        0.2,
        Number.isFinite(Number(raw.taxNoiseStd)) ? Number(raw.taxNoiseStd) : base.taxNoiseStd,
      ),
    ),
    rmdEnabled: raw.rmdEnabled !== false,
    qcdEnabled: !!raw.qcdEnabled,
    qcdAnnual: moneyK(raw.qcdAnnual, 0),
    spouseSoleBeneficiary: !!raw.spouseSoleBeneficiary,
    numYears: Math.max(1, Math.min(60, parseInt(raw.numYears, 10) || base.numYears)),
    numSimulations: [200, 500, 1000, 2000].includes(Number(raw.numSimulations))
      ? Number(raw.numSimulations)
      : base.numSimulations,
    seed: Number.isFinite(Number(raw.seed)) ? (Number(raw.seed) >>> 0) : null,
    scenarioRef,
    constantRealReturn: Number.isFinite(Number(raw.constantRealReturn))
      ? Number(raw.constantRealReturn)
      : base.constantRealReturn,
    focusStrategyId: typeof raw.focusStrategyId === 'string'
      ? raw.focusStrategyId
      : base.focusStrategyId,
  };
}

export function readRothConvertState() {
  return structuredClone(rothState);
}

export function applyRothConvertState(state) {
  rothState = normalizeRothConvertState(state);
  rothResult = null;
  rothResultStale = false;
  onResultsCleared?.();
  onStateApplied?.();
}

export function patchRothConvertState(partial) {
  rothState = normalizeRothConvertState({ ...rothState, ...partial });
  rothResultStale = !!rothResult;
  onStateApplied?.();
}

export function applyRothConvertPreset(presetId, { keepAttached = true } = {}) {
  const presets = getRothConvertPresets();
  const index = presets.findIndex((p) => p.id === presetId);
  const preset = index >= 0 ? presets[index] : null;
  if (!preset) return;
  applyRothConvertState({
    ...rothState,
    ...preset.patch,
    ladder: rothState.ladder,
    presetLevel: index >= 0 ? index : rothState.presetLevel,
    presetActive: keepAttached,
  });
}

export function detachRothConvertPreset() {
  if (!rothState.presetActive) return;
  patchRothConvertState({ presetActive: false });
}

export function resetRothConvertToDefaults() {
  applyRothConvertState(defaultRothConvertState());
  const presets = getRothConvertPresets();
  if (presets[0]) applyRothConvertPreset(presets[0].id, { keepAttached: true });
}

export async function getRothConvertDependencies() {
  const ref = rothState.scenarioRef;
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

export async function applyImportedRothConvert(loaded, { statusMessage, renames } = {}) {
  let state = normalizeRothConvertState(loaded.state || {});
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

  applyRothConvertState(state);
  setSessionMeta({
    name: '',
    description: loaded.description || '',
    lastSelect: '',
  });
  await refreshSessionList('');
  updateSessionNoteDisplay();
  updateSessionActionButtons();
  snapshotSessionUi(FEATURE_ROTH_CONVERT);
  if (statusMessage) {
    const el = document.getElementById('roth-convert-status');
    if (el) el.textContent = statusMessage;
  }
}
