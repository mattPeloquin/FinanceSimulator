// Accumulation session state — config is persisted; run results stay in memory.

import { ACCUMULATION_STATE_VERSION } from '../../state/migrations.js';
import { FEATURE_ACCUMULATION } from '../../state/storageKeys.js';
import {
  setSessionMeta,
  refreshSessionList,
  updateSessionNoteDisplay,
  updateSessionActionButtons,
  snapshotSessionUi,
} from '../../ui/sessionChrome.js';
import { getAccumulationPresets } from './presets.js';
import { minAvailableYear, maxAvailableYear } from '../../data/historicalData.js';

export { ACCUMULATION_STATE_VERSION };

const ALLOCATION_KEYS = [
  'usLgGrowthAllocation',
  'usLgValueAllocation',
  'usSmMidAllocation',
  'exUsAllocation',
  'bondAllocation',
  'cashAllocation',
];

/** @type {(() => void) | null} */
let onStateApplied = null;
/** @type {(() => void) | null} */
let onResultsCleared = null;

export function registerAccumulationUiHooks(hooks = {}) {
  if (hooks.onStateApplied) onStateApplied = hooks.onStateApplied;
  if (hooks.onResultsCleared) onResultsCleared = hooks.onResultsCleared;
}

function defaultSleeve(startBalance, amount) {
  return {
    startBalance,
    basis: startBalance,
    contributionTiers: [{ amount, growthPct: 2 }],
  };
}

export function defaultAccumulationState() {
  return {
    version: ACCUMULATION_STATE_VERSION,
    // Easy Mode: attached by default on Steady Saver (level 0).
    presetActive: true,
    presetLevel: 0,
    numYears: 20,
    afterTaxDragRate: 0.15,
    distMethod: 'lognormal',
    blockSize: 1,
    startYear: Math.max(minAvailableYear, 1970),
    endYear: maxAvailableYear,
    numSimulations: 1000,
    sweepPaths: 200,
    exploreWeights: true,
    seed: null,
    parallelCores: 'high',
    allocation: {
      usLgGrowthAllocation: 25,
      usLgValueAllocation: 25,
      usSmMidAllocation: 10,
      exUsAllocation: 15,
      bondAllocation: 20,
      cashAllocation: 5,
    },
    allocationOverTimeTiers: [
      {
        usLgGrowthAllocation: 25,
        usLgValueAllocation: 25,
        usSmMidAllocation: 10,
        exUsAllocation: 15,
        bondAllocation: 20,
        cashAllocation: 5,
      },
    ],
    sleeves: {
      ira: defaultSleeve(50, 7),
      roth: defaultSleeve(25, 5),
      afterTax: defaultSleeve(20, 3),
    },
    events: [],
    // Log-normal profile fields (%). Filled from history on first bind / refresh.
    profiles: null,
    view: {
      showSavingsOverlay: true,
    },
  };
}

/** @type {object} */
let accumState = defaultAccumulationState();

/** In-memory run result (not persisted). */
let accumResult = null;
let accumResultStale = false;

export function getAccumulationState() {
  return accumState;
}

export function getAccumulationResult() {
  return accumResult;
}

export function setAccumulationResult(result) {
  accumResult = result;
  accumResultStale = false;
}

export function isAccumulationResultStale() {
  return accumResultStale;
}

export function setAccumulationResultStale(stale) {
  accumResultStale = !!stale;
}

function normalizeTier(tier, isLast) {
  const amount = Number.isFinite(Number(tier?.amount)) ? Number(tier.amount) : 0;
  const growthPct = Number.isFinite(Number(tier?.growthPct)) ? Number(tier.growthPct) : 0;
  if (isLast) return { amount, growthPct };
  const years = Math.max(1, parseInt(tier?.years, 10) || 1);
  return { amount, growthPct, years };
}

function normalizeTiers(tiers) {
  if (!Array.isArray(tiers) || tiers.length === 0) {
    return [{ amount: 0, growthPct: 0 }];
  }
  return tiers.map((t, i, arr) => normalizeTier(t, i === arr.length - 1));
}

function normalizeAllocation(raw) {
  const out = {};
  for (const key of ALLOCATION_KEYS) {
    const n = Number(raw?.[key]);
    out[key] = Number.isFinite(n) ? n : 0;
  }
  return out;
}

function normalizeEvents(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map((e) => ({
    amount: Number.isFinite(Number(e?.amount)) ? Number(e.amount) : 0,
    startYear: Math.max(1, parseInt(e?.startYear, 10) || 1),
    years: e?.years === '' || e?.years == null
      ? ''
      : Math.max(1, parseInt(e.years, 10) || 1),
  }));
}

export function normalizeAccumulationState(raw) {
  const base = defaultAccumulationState();
  if (!raw || typeof raw !== 'object') return base;

  const sleevesIn = raw.sleeves && typeof raw.sleeves === 'object' ? raw.sleeves : {};
  const sleeves = {};
  for (const id of ['ira', 'roth', 'afterTax']) {
    const s = sleevesIn[id] && typeof sleevesIn[id] === 'object' ? sleevesIn[id] : {};
    const startBalance = Number.isFinite(Number(s.startBalance)) ? Number(s.startBalance) : 0;
    sleeves[id] = {
      startBalance,
      basis: Number.isFinite(Number(s.basis)) ? Number(s.basis) : startBalance,
      contributionTiers: normalizeTiers(s.contributionTiers),
    };
  }

  let allocationOverTimeTiers = Array.isArray(raw.allocationOverTimeTiers)
    ? raw.allocationOverTimeTiers.map((t, i, arr) => {
      const mix = normalizeAllocation(t);
      if (i === arr.length - 1) return mix;
      return { ...mix, years: Math.max(1, parseInt(t?.years, 10) || 1) };
    })
    : base.allocationOverTimeTiers;
  if (allocationOverTimeTiers.length === 0) {
    allocationOverTimeTiers = [normalizeAllocation(raw.allocation || base.allocation)];
  }

  const distMethod = ['historical', 'historicalSequence', 'lognormal', 'scaledHistorical']
    .includes(raw.distMethod)
    ? raw.distMethod
    : base.distMethod;

  const presetLevel = [0, 1, 2].includes(Number(raw.presetLevel))
    ? Number(raw.presetLevel)
    : base.presetLevel;

  return {
    version: ACCUMULATION_STATE_VERSION,
    presetActive: raw.presetActive !== false,
    presetLevel,
    numYears: Math.max(1, Math.min(80, parseInt(raw.numYears, 10) || base.numYears)),
    afterTaxDragRate: Math.max(0, Math.min(1, Number(raw.afterTaxDragRate) || 0)),
    distMethod,
    blockSize: Math.max(1, Math.min(6, parseInt(raw.blockSize, 10) || 1)),
    startYear: parseInt(raw.startYear, 10) || base.startYear,
    endYear: parseInt(raw.endYear, 10) || base.endYear,
    numSimulations: [500, 1000, 2000, 5000].includes(Number(raw.numSimulations))
      ? Number(raw.numSimulations)
      : base.numSimulations,
    sweepPaths: [100, 200, 500].includes(Number(raw.sweepPaths))
      ? Number(raw.sweepPaths)
      : base.sweepPaths,
    exploreWeights: raw.exploreWeights !== false,
    seed: Number.isFinite(Number(raw.seed)) ? (Number(raw.seed) >>> 0) : null,
    parallelCores: raw.parallelCores || 'high',
    allocation: normalizeAllocation(raw.allocation || base.allocation),
    allocationOverTimeTiers,
    sleeves,
    events: normalizeEvents(raw.events),
    profiles: raw.profiles && typeof raw.profiles === 'object' ? raw.profiles : null,
    view: {
      showSavingsOverlay: raw.view?.showSavingsOverlay !== false,
    },
  };
}

export function readAccumulationState() {
  return structuredClone(accumState);
}

export function applyAccumulationState(state) {
  accumState = normalizeAccumulationState(state);
  accumResult = null;
  accumResultStale = false;
  onResultsCleared?.();
  onStateApplied?.();
}

export function patchAccumulationState(partial) {
  accumState = normalizeAccumulationState({ ...accumState, ...partial });
  accumResultStale = !!accumResult;
  onStateApplied?.();
}

export function applyAccumulationPreset(presetId, { keepAttached = true } = {}) {
  const presets = getAccumulationPresets();
  const index = presets.findIndex((p) => p.id === presetId);
  const preset = index >= 0 ? presets[index] : null;
  if (!preset) return;
  applyAccumulationState({
    ...accumState,
    ...preset.patch,
    profiles: accumState.profiles,
    presetLevel: index >= 0 ? index : accumState.presetLevel,
    presetActive: keepAttached ? true : !!accumState.presetActive,
  });
}

/** Detach Easy Mode after a manual edit (keeps current field values). */
export function detachAccumulationPreset() {
  if (!accumState.presetActive) return;
  patchAccumulationState({ presetActive: false });
}

export async function applyImportedAccumulation(loaded) {
  applyAccumulationState(loaded?.payload ?? loaded);
}

export async function resetAccumulationToDefaults() {
  applyAccumulationState(defaultAccumulationState());
  setSessionMeta({ name: '', description: '', lastSelect: '' });
  updateSessionNoteDisplay();
  updateSessionActionButtons();
  await refreshSessionList('');
  snapshotSessionUi(FEATURE_ACCUMULATION);
}

export { ALLOCATION_KEYS };
