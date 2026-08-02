// Social Security session state — config persisted; results in memory only.

import { SS_TIMING_STATE_VERSION } from '../../state/migrations.js';
import { SCHEMA_VERSION } from '../../state/scenario.js';
import { FEATURE_SS_TIMING, FEATURE_WITHDRAW } from '../../state/storageKeys.js';
import * as sessions from '../../state/sessions.js';
import {
  setSessionMeta,
  refreshSessionList,
  updateSessionNoteDisplay,
  updateSessionActionButtons,
  snapshotSessionUi,
} from '../../ui/sessionChrome.js';
import { getSsTimingPresets } from './presets.js';
import {
  defaultReturnsAllocationSlice,
  normalizeReturnsAllocationSlice,
  canonicalizeDistMethod,
} from '../../state/returnsAllocationSlice.js';
import { listSleeves } from '../../portfolio/registry.js';
import { remapWithdrawScenarioRef } from '../../portfolio/ui/sourceControls.js';
import {
  fraFromBirthYear,
  DEFAULT_END_AGES,
  buildSsCashflowSeries,
} from '../../core/socialSecurity.js';

function allocationFromOrdered(pcts) {
  const allocation = {};
  listSleeves().forEach((s, i) => {
    allocation[s.pctKey] = pcts[i] ?? s.defaultPct;
  });
  return allocation;
}

export { SS_TIMING_STATE_VERSION };

/** @type {(() => void) | null} */
let onStateApplied = null;
/** @type {(() => void) | null} */
let onResultsCleared = null;

export function registerSsTimingUiHooks(hooks = {}) {
  if (hooks.onStateApplied) onStateApplied = hooks.onStateApplied;
  if (hooks.onResultsCleared) onResultsCleared = hooks.onResultsCleared;
}

function defaultPerson(label, birthYear, pia, claimAge) {
  return {
    label,
    birthYear,
    currentAge: Math.max(50, Math.min(70, new Date().getFullYear() - birthYear)),
    piaMonthly: pia,
    claimAge,
    planningEndAge: null,
    earningsGrid: [],
  };
}

export function defaultSsTimingState() {
  const returns = defaultReturnsAllocationSlice({
    allocation: allocationFromOrdered([20, 20, 10, 15, 25, 10]),
  });
  return {
    version: SS_TIMING_STATE_VERSION,
    presetActive: true,
    presetLevel: 0,
    couple: true,
    personA: defaultPerson('Person A', 1960, 2500, 67),
    personB: defaultPerson('Person B', 1962, 1600, 67),
    endAges: [...DEFAULT_END_AGES],
    numSimulations: 500,
    seed: null,
    ...returns,
    bridge: {
      enabled: true,
      startBalance: 300000,
      annualSpend: 0,
    },
    policy: {
      baseTaxRate: 0.15,
      taxNoiseStd: 0.03,
      benefitCut: {
        mode: 'none',
        cutFraction: 0.2,
        cutYearIndex: 10,
        phaseYears: 5,
        jitterYears: 2,
      },
    },
    portfolioSource: 'local',
    scenarioRef: null,
  };
}

/** @type {object} */
let ssState = defaultSsTimingState();
let ssResult = null;
let ssResultStale = false;

export function getSsTimingState() {
  return ssState;
}

export function getSsTimingResult() {
  return ssResult;
}

export function setSsTimingResult(result) {
  ssResult = result;
  ssResultStale = false;
}

export function isSsTimingResultStale() {
  return ssResultStale;
}

export function setSsTimingResultStale(stale) {
  ssResultStale = !!stale;
}

/**
 * Last-run (or rebuilt) SS benefit cashflow series for export.
 * @param {{ sessionName?: string|null }} [opts]
 */
export function getSsTimingCashflowSeries(opts = {}) {
  if (!ssResult || ssResultStale) return null;
  if (ssResult.cashflowSeries) {
    return {
      ...ssResult.cashflowSeries,
      sessionName: opts.sessionName ?? ssResult.cashflowSeries.sessionName ?? null,
    };
  }
  if (!ssResult.deterministic) return null;
  return buildSsCashflowSeries(ssResult.deterministic, {
    startAge: ssState.personA?.currentAge || 62,
    primaryEnd: ssResult.meta?.primaryEnd,
    sessionName: opts.sessionName ?? null,
  });
}

function normalizePerson(raw, fallback) {
  const base = fallback || defaultPerson('Person', 1960, 2000, 67);
  if (!raw || typeof raw !== 'object') return { ...base };
  const birthYear = parseInt(raw.birthYear, 10) || base.birthYear;
  return {
    label: String(raw.label || base.label),
    birthYear,
    currentAge: Math.max(50, Math.min(75, parseInt(raw.currentAge, 10) || base.currentAge)),
    piaMonthly: Math.max(0, Number(raw.piaMonthly) || 0),
    claimAge: Math.max(62, Math.min(70, parseInt(raw.claimAge, 10) || base.claimAge)),
    planningEndAge: raw.planningEndAge == null || raw.planningEndAge === ''
      ? null
      : Math.max(70, Math.min(120, parseInt(raw.planningEndAge, 10) || 90)),
    earningsGrid: Array.isArray(raw.earningsGrid) ? raw.earningsGrid : [],
    fra: Number(raw.fra) || fraFromBirthYear(birthYear),
  };
}

export function normalizeSsTimingState(raw) {
  const base = defaultSsTimingState();
  if (!raw || typeof raw !== 'object') return base;

  const returns = normalizeReturnsAllocationSlice(raw, base);
  returns.distMethod = canonicalizeDistMethod(raw.distMethod, base.distMethod);

  let endAges = Array.isArray(raw.endAges)
    ? raw.endAges.map((n) => Math.round(Number(n))).filter((n) => n >= 70 && n <= 120)
    : base.endAges;
  if (endAges.length === 0) endAges = [...DEFAULT_END_AGES];

  const presetLevel = [0, 1, 2].includes(Number(raw.presetLevel))
    ? Number(raw.presetLevel)
    : base.presetLevel;

  let scenarioRef = null;
  if (raw.scenarioRef && typeof raw.scenarioRef === 'object' && raw.scenarioRef.name) {
    scenarioRef = {
      feature: raw.scenarioRef.feature || FEATURE_WITHDRAW,
      name: String(raw.scenarioRef.name),
    };
  }
  const portfolioSource = scenarioRef
    ? 'link'
    : (raw.portfolioSource === 'link' ? 'link' : 'local');

  return {
    version: SS_TIMING_STATE_VERSION,
    presetActive: raw.presetActive !== false,
    presetLevel,
    couple: raw.couple !== false,
    personA: normalizePerson(raw.personA, base.personA),
    personB: normalizePerson(raw.personB, base.personB),
    endAges,
    numSimulations: [200, 500, 1000, 2000].includes(Number(raw.numSimulations))
      ? Number(raw.numSimulations)
      : base.numSimulations,
    seed: Number.isFinite(Number(raw.seed)) ? (Number(raw.seed) >>> 0) : null,
    ...returns,
    bridge: {
      enabled: raw.bridge?.enabled !== false,
      startBalance: Math.max(0, Number(raw.bridge?.startBalance) || 0),
      annualSpend: Math.max(0, Number(raw.bridge?.annualSpend) || 0),
    },
    policy: {
      baseTaxRate: Math.max(0, Math.min(0.5, Number(raw.policy?.baseTaxRate) || 0)),
      taxNoiseStd: Math.max(0, Math.min(0.2, Number(raw.policy?.taxNoiseStd) || 0)),
      benefitCut: {
        mode: ['none', 'discrete', 'phased'].includes(raw.policy?.benefitCut?.mode)
          ? raw.policy.benefitCut.mode
          : 'none',
        cutFraction: Math.max(0, Math.min(0.5, Number(raw.policy?.benefitCut?.cutFraction) || 0.2)),
        cutYearIndex: Math.max(0, parseInt(raw.policy?.benefitCut?.cutYearIndex, 10) || 10),
        phaseYears: Math.max(1, parseInt(raw.policy?.benefitCut?.phaseYears, 10) || 5),
        jitterYears: Math.max(0, parseInt(raw.policy?.benefitCut?.jitterYears, 10) || 0),
      },
    },
    portfolioSource,
    scenarioRef: portfolioSource === 'link' ? scenarioRef : null,
  };
}

export function readSsTimingState() {
  return structuredClone(ssState);
}

export function applySsTimingState(state) {
  ssState = normalizeSsTimingState(state);
  ssResult = null;
  ssResultStale = false;
  onResultsCleared?.();
  onStateApplied?.();
}

export function patchSsTimingState(partial) {
  ssState = normalizeSsTimingState({ ...ssState, ...partial });
  ssResultStale = !!ssResult;
  onStateApplied?.();
}

export function applySsTimingPreset(presetId, { keepAttached = true } = {}) {
  const presets = getSsTimingPresets();
  const index = presets.findIndex((p) => p.id === presetId);
  const preset = index >= 0 ? presets[index] : null;
  if (!preset) return;
  applySsTimingState({
    ...ssState,
    ...preset.patch,
    personA: { ...ssState.personA, ...preset.patch.personA },
    personB: { ...ssState.personB, ...preset.patch.personB },
    bridge: { ...ssState.bridge, ...preset.patch.bridge },
    profiles: ssState.profiles,
    presetLevel: index >= 0 ? index : ssState.presetLevel,
    presetActive: keepAttached,
  });
}

export function detachSsTimingPreset() {
  if (!ssState.presetActive) return;
  patchSsTimingState({ presetActive: false });
}

export function resetSsTimingToDefaults() {
  applySsTimingState(defaultSsTimingState());
  const presets = getSsTimingPresets();
  if (presets[0]) applySsTimingPreset(presets[0].id, { keepAttached: true });
}

export async function getSsTimingDependencies() {
  const ref = ssState.scenarioRef;
  if (!ref?.name) return [];
  try {
    const loaded = await sessions.load(ref.feature || FEATURE_WITHDRAW, ref.name);
    if (!loaded?.payload) return [];
    return [{
      feature: ref.feature || FEATURE_WITHDRAW,
      name: ref.name,
      state: loaded.payload,
      stateVersion: SCHEMA_VERSION,
      description: loaded.description || '',
    }];
  } catch {
    return [];
  }
}

export async function applyImportedSsTiming(loaded, { statusMessage, renames } = {}) {
  let state = normalizeSsTimingState(loaded.state || {});
  state = remapWithdrawScenarioRef(state, renames);
  applySsTimingState(state);
  setSessionMeta({
    name: '',
    description: loaded.description || '',
    lastSelect: '',
  });
  await refreshSessionList('');
  updateSessionNoteDisplay();
  updateSessionActionButtons();
  snapshotSessionUi(FEATURE_SS_TIMING);
  if (statusMessage) {
    // optional status surface
  }
}
