// SOR Lab session state: config-only (sweep results stay in memory).
// Share/export embeds a snapshot of the referenced SOR Plan scenario.

import * as sessions from '../../state/sessions.js';
import { FEATURE_SOR_PLAN, FEATURE_SOR_LAB } from '../../state/storageKeys.js';
import {
  setSessionMeta,
  refreshSessionList,
  updateSessionNoteDisplay,
  updateSessionActionButtons,
  snapshotSessionUi,
  maybeApplyAttachedUi,
} from '../../ui/sessionChrome.js';
import {
  DEFAULT_SWEEP_POINTS,
  DEFAULT_PATHS_PER_POINT,
} from './sweep.js';

/** Optional UI hooks registered by the Lab feature bootstrap (avoids import cycles). */
let labUiHooks = {
  onStateApplied: null,
  onResultsCleared: null,
};

export function registerLabUiHooks(hooks) {
  labUiHooks = { ...labUiHooks, ...hooks };
}

export const LAB_STATE_VERSION = 1;

/** @type {object} */
let labConfig = defaultLabConfig();

/** In-memory sweep result for the current workbench (not persisted). */
let labSweepResult = null;

/** True when envelope/config changed after the last successful run. */
let labResultStale = false;

export function defaultLabConfig() {
  return {
    version: LAB_STATE_VERSION,
    scenarioRef: null, // { feature: 'sor-plan', name }
    seed: null,
    sweepPoints: DEFAULT_SWEEP_POINTS,
    pathsPerPoint: DEFAULT_PATHS_PER_POINT,
    envelopeOverrides: {},
    view: {
      metric: 'successRate',
      band: { low: 10, high: 90 },
      barStyle: 'band',
      categoryFilter: 'all',
      topN: 15,
      showBelowNoise: false,
      selectedVariableIds: [],
      focusedVariableId: null,
      curveThreshold: null,
    },
  };
}

export function getLabConfig() {
  return labConfig;
}

export function getLabSweepResult() {
  return labSweepResult;
}

export function setLabSweepResult(result) {
  labSweepResult = result;
  labResultStale = false;
}

export function isLabResultStale() {
  return labResultStale;
}

export function setLabResultStale(stale) {
  labResultStale = !!stale;
}

export function readLabState() {
  return structuredClone(labConfig);
}

export function applyLabState(state) {
  labConfig = normalizeLabState(state);
  labSweepResult = null;
  labResultStale = false;
  labUiHooks.onResultsCleared?.();
  labUiHooks.onStateApplied?.(labConfig);
}

export function normalizeLabState(raw) {
  const base = defaultLabConfig();
  if (!raw || typeof raw !== 'object') return base;
  const scenarioRef = raw.scenarioRef && typeof raw.scenarioRef === 'object'
    ? {
      feature: raw.scenarioRef.feature || FEATURE_SOR_PLAN,
      name: String(raw.scenarioRef.name || ''),
    }
    : null;
  if (scenarioRef && !scenarioRef.name) {
    // Empty name → treat as unset.
    scenarioRef.name = '';
  }
  const viewIn = raw.view && typeof raw.view === 'object' ? raw.view : {};
  const bandIn = viewIn.band && typeof viewIn.band === 'object' ? viewIn.band : {};
  let selectedVariableIds = [];
  if (Array.isArray(viewIn.selectedVariableIds)) {
    selectedVariableIds = viewIn.selectedVariableIds
      .filter((id) => typeof id === 'string' && id.length > 0)
      .slice(0, 5);
  } else if (typeof viewIn.selectedVariableId === 'string' && viewIn.selectedVariableId) {
    selectedVariableIds = [viewIn.selectedVariableId];
  }
  // Dedupe.
  selectedVariableIds = [...new Set(selectedVariableIds)];
  let focusedVariableId = typeof viewIn.focusedVariableId === 'string'
    ? viewIn.focusedVariableId
    : null;
  if (focusedVariableId && !selectedVariableIds.includes(focusedVariableId)) {
    focusedVariableId = selectedVariableIds[selectedVariableIds.length - 1] || null;
  } else if (!focusedVariableId && selectedVariableIds.length) {
    focusedVariableId = selectedVariableIds[selectedVariableIds.length - 1];
  }
  let curveThreshold = null;
  if (viewIn.curveThreshold !== null && viewIn.curveThreshold !== ''
    && Number.isFinite(Number(viewIn.curveThreshold))) {
    curveThreshold = Number(viewIn.curveThreshold);
  }
  return {
    version: LAB_STATE_VERSION,
    scenarioRef: scenarioRef && scenarioRef.name
      ? { feature: scenarioRef.feature, name: scenarioRef.name }
      : null,
    seed: Number.isFinite(Number(raw.seed)) ? (Number(raw.seed) >>> 0) : null,
    sweepPoints: [5, 7, 9].includes(Number(raw.sweepPoints))
      ? Number(raw.sweepPoints)
      : DEFAULT_SWEEP_POINTS,
    pathsPerPoint: [1000, 2000, 5000].includes(Number(raw.pathsPerPoint))
      ? Number(raw.pathsPerPoint)
      : DEFAULT_PATHS_PER_POINT,
    envelopeOverrides: normalizeEnvelopeOverrides(raw.envelopeOverrides),
    view: {
      metric: typeof viewIn.metric === 'string' ? viewIn.metric : base.view.metric,
      band: {
        low: Number.isFinite(Number(bandIn.low)) ? Number(bandIn.low) : base.view.band.low,
        high: Number.isFinite(Number(bandIn.high)) ? Number(bandIn.high) : base.view.band.high,
      },
      barStyle: viewIn.barStyle === 'median' ? 'median' : 'band',
      categoryFilter: ['all', 'decision', 'uncertainty'].includes(viewIn.categoryFilter)
        ? viewIn.categoryFilter
        : 'all',
      topN: Number.isFinite(Number(viewIn.topN)) ? Number(viewIn.topN) : base.view.topN,
      showBelowNoise: !!viewIn.showBelowNoise,
      selectedVariableIds,
      focusedVariableId,
      curveThreshold,
    },
  };
}

function normalizeEnvelopeOverrides(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  for (const [id, entry] of Object.entries(raw)) {
    if (!entry || typeof entry !== 'object') continue;
    out[id] = {
      low: Number.isFinite(Number(entry.low)) ? Number(entry.low) : undefined,
      high: Number.isFinite(Number(entry.high)) ? Number(entry.high) : undefined,
      enabled: entry.enabled !== false,
    };
  }
  return out;
}

export function patchLabConfig(partial) {
  labConfig = normalizeLabState({ ...labConfig, ...partial, view: { ...labConfig.view, ...(partial.view || {}) } });
  // Envelope / fidelity / scenario changes invalidate stored curves.
  if (
    partial.scenarioRef !== undefined
    || partial.sweepPoints !== undefined
    || partial.pathsPerPoint !== undefined
    || partial.envelopeOverrides !== undefined
    || partial.seed !== undefined
  ) {
    labResultStale = true;
  }
  return labConfig;
}

export function patchLabView(partial) {
  labConfig = normalizeLabState({
    ...labConfig,
    view: { ...labConfig.view, ...partial },
  });
  return labConfig.view;
}

export async function getLabDependencies() {
  const ref = labConfig.scenarioRef;
  if (!ref?.name) return [];
  try {
    const loaded = await sessions.load(ref.feature || FEATURE_SOR_PLAN, ref.name);
    if (!loaded?.payload) return [];
    return [{
      feature: ref.feature || FEATURE_SOR_PLAN,
      name: ref.name,
      state: loaded.payload,
      description: loaded.description || '',
    }];
  } catch {
    return [];
  }
}

/**
 * Apply an imported Lab envelope. `renames` comes from
 * importEnvelopeDependencies — remap scenarioRef when the Plan session
 * was auto-renamed on collision.
 */
export async function applyImportedLab(loaded, { statusMessage, renames } = {}) {
  let state = normalizeLabState(loaded.state || {});
  if (state.scenarioRef?.name && Array.isArray(renames) && renames.length) {
    // Prefer exact original-name match; else if only one Plan dep, use it.
    const planRenames = renames.filter((r) => (r.feature || FEATURE_SOR_PLAN) === FEATURE_SOR_PLAN);
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

  applyLabState(state);
  setSessionMeta({
    name: '',
    description: loaded.description || '',
    lastSelect: '',
  });
  updateSessionNoteDisplay();
  updateSessionActionButtons();
  await refreshSessionList('');
  snapshotSessionUi(FEATURE_SOR_LAB);
  await maybeApplyAttachedUi(loaded.ui);
  if (statusMessage) {
    const el = document.getElementById('sor-lab-status');
    if (el) el.textContent = statusMessage;
  }
}

export async function resetLabToDefaults() {
  applyLabState(defaultLabConfig());
  setSessionMeta({ name: '', description: '', lastSelect: '' });
  updateSessionNoteDisplay();
  updateSessionActionButtons();
  await refreshSessionList('');
  snapshotSessionUi(FEATURE_SOR_LAB);
}
