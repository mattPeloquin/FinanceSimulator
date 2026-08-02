// Lifetime Plan session state — config persisted; resolved series + aggregate in memory.

import { PLAN_STATE_VERSION } from '../../state/migrations.js';
import {
  FEATURE_PLAN,
  FEATURE_ACCUMULATE,
  FEATURE_SS_TIMING,
  FEATURE_HOUSE_EQUITY,
  FEATURE_WITHDRAW,
} from '../../state/storageKeys.js';
import * as sessions from '../../state/sessions.js';
import { getFeatureStateVersion } from '../../state/migrations.js';
import {
  setSessionMeta,
  refreshSessionList,
  updateSessionNoteDisplay,
  updateSessionActionButtons,
  snapshotSessionUi,
} from '../../ui/sessionChrome.js';
import {
  buildLifetimePlan,
  buildPlanCashflowSeries,
  composeNetWorth,
  resolveSourceStartYear,
} from '../../core/lifetimePlan.js';
import { getPlanPresets } from './presets.js';
import {
  listPlanSourceFeatures,
  defaultStrategyIdFor,
  getPlanSourceDescriptor,
} from './sources.js';

export { PLAN_STATE_VERSION };

/** @type {(() => void) | null} */
let onStateApplied = null;
/** @type {(() => void) | null} */
let onResultsCleared = null;

export function registerPlanUiHooks(hooks = {}) {
  if (hooks.onStateApplied) onStateApplied = hooks.onStateApplied;
  if (hooks.onResultsCleared) onResultsCleared = hooks.onResultsCleared;
}

let sourceIdCounter = 0;

/** @returns {string} */
export function newPlanSourceId() {
  sourceIdCounter += 1;
  return `src-${Date.now().toString(36)}-${sourceIdCounter}`;
}

const HANDOFF_PERCENTILES = new Set(['p10', 'p50', 'p90']);
const VIEW_MODES = new Set(['netWorth', 'cashflow']);

/**
 * @param {Partial<object>} [overrides]
 */
export function createPlanSourceRow(overrides = {}) {
  const feature = overrides.feature || FEATURE_ACCUMULATE;
  const desc = getPlanSourceDescriptor(feature);
  const handoff = HANDOFF_PERCENTILES.has(overrides.handoffPercentile)
    ? overrides.handoffPercentile
    : 'p50';
  return {
    id: overrides.id || newPlanSourceId(),
    feature,
    sessionName: overrides.sessionName == null ? '' : String(overrides.sessionName),
    strategyId: overrides.strategyId || defaultStrategyIdFor(feature) || '',
    offsetYears: Math.round(Number(overrides.offsetYears)) || 0,
    // Always included when listed — no per-row on/off or custom name in the UI.
    enabled: true,
    label: desc?.title || feature,
    // Withdraw → Accumulate handoff (ignored for non-withdraw rows).
    startsAfter: overrides.startsAfter == null || overrides.startsAfter === ''
      ? ''
      : String(overrides.startsAfter),
    gapYears: Math.max(0, Math.round(Number(overrides.gapYears)) || 0),
    handoffPercentile: handoff,
  };
}

export function defaultPlanState() {
  const year = new Date().getFullYear();
  return {
    version: PLAN_STATE_VERSION,
    presetActive: true,
    presetLevel: 0,
    planStartYear: year,
    planEndYear: year + 40,
    birthYearA: 1960,
    birthYearB: null,
    refreshSims: 200,
    view: 'netWorth',
    sources: [
      createPlanSourceRow({
        feature: FEATURE_ACCUMULATE,
        strategyId: 'med',
        label: 'Accumulate',
      }),
    ],
  };
}

/** @type {object} */
let planState = defaultPlanState();

/** @type {Map<string, object>} sourceId → CashflowSeries */
let resolvedSeriesBySource = new Map();

/**
 * Extra artifacts from worker runs (cones, fans, home equity residual).
 * @type {Map<string, object>}
 */
let resolvedArtifactsBySource = new Map();

/** @type {string[]} */
let planWarnings = [];

/** @type {object|null} buildLifetimePlan result (+ netWorth) */
let planResult = null;
let planResultStale = false;

export function getPlanState() {
  return planState;
}

export function getPlanResult() {
  return planResult;
}

export function isPlanResultStale() {
  return planResultStale;
}

export function setPlanResultStale(stale) {
  planResultStale = !!stale;
}

export function getPlanWarnings() {
  return planWarnings.slice();
}

export function setPlanWarnings(warnings) {
  planWarnings = Array.isArray(warnings) ? warnings.filter(Boolean) : [];
}

/** @returns {Map<string, object>} */
export function getResolvedSeriesMap() {
  return resolvedSeriesBySource;
}

/** @returns {Map<string, object>} */
export function getResolvedArtifactsMap() {
  return resolvedArtifactsBySource;
}

/**
 * @param {string} sourceId
 * @param {object|null} series
 */
export function setResolvedSeries(sourceId, series) {
  if (!sourceId) return;
  if (series) resolvedSeriesBySource.set(sourceId, series);
  else resolvedSeriesBySource.delete(sourceId);
}

/**
 * @param {string} sourceId
 * @param {object|null} artifacts
 */
export function setResolvedArtifacts(sourceId, artifacts) {
  if (!sourceId) return;
  if (artifacts) resolvedArtifactsBySource.set(sourceId, artifacts);
  else resolvedArtifactsBySource.delete(sourceId);
}

export function clearResolvedSeries() {
  resolvedSeriesBySource = new Map();
  resolvedArtifactsBySource = new Map();
  planResult = null;
  planResultStale = false;
  planWarnings = [];
}

function clampYear(raw, fallback) {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1900, Math.min(2200, n));
}

/**
 * @param {unknown} raw
 * @returns {object|null} null when feature is unknown / no longer a Plan source
 */
function normalizeSource(raw) {
  const allowed = new Set(listPlanSourceFeatures().map((f) => f.feature));
  if (!allowed.has(raw?.feature)) return null;
  const feature = raw.feature;
  return createPlanSourceRow({
    id: typeof raw?.id === 'string' && raw.id ? raw.id : undefined,
    feature,
    sessionName: raw?.sessionName == null ? '' : String(raw.sessionName),
    strategyId: typeof raw?.strategyId === 'string'
      ? raw.strategyId
      : defaultStrategyIdFor(feature),
    offsetYears: Math.round(Number(raw?.offsetYears)) || 0,
    startsAfter: raw?.startsAfter,
    gapYears: raw?.gapYears,
    handoffPercentile: raw?.handoffPercentile,
  });
}

export function normalizePlanState(raw) {
  const base = defaultPlanState();
  if (!raw || typeof raw !== 'object') return base;

  const planStartYear = clampYear(raw.planStartYear, base.planStartYear);
  let planEndYear = clampYear(raw.planEndYear, base.planEndYear);
  if (planEndYear < planStartYear) planEndYear = planStartYear;

  const birthYearA = raw.birthYearA == null || raw.birthYearA === ''
    ? null
    : clampYear(raw.birthYearA, base.birthYearA);
  const birthYearB = raw.birthYearB == null || raw.birthYearB === ''
    ? null
    : clampYear(raw.birthYearB, null);

  const refreshSims = [100, 200, 500, 1000].includes(Number(raw.refreshSims))
    ? Number(raw.refreshSims)
    : base.refreshSims;

  const presetLevel = [0, 1, 2].includes(Number(raw.presetLevel))
    ? Number(raw.presetLevel)
    : base.presetLevel;

  const view = VIEW_MODES.has(raw.view) ? raw.view : base.view;

  // Honor an explicit empty list (user removed every source). Only fall back
  // to the default Accumulate row when `sources` is missing/non-array.
  // Unknown feature ids (e.g. retired Roth Plan sources) are dropped, not remapped.
  const sources = Array.isArray(raw.sources)
    ? raw.sources.map((s) => normalizeSource(s)).filter(Boolean)
    : base.sources.map((s) => ({ ...s, id: newPlanSourceId() }));

  return {
    version: PLAN_STATE_VERSION,
    presetActive: raw.presetActive !== false,
    presetLevel,
    planStartYear,
    planEndYear,
    birthYearA,
    birthYearB,
    refreshSims,
    view,
    sources,
  };
}

export function readPlanState() {
  return structuredClone(planState);
}

export function applyPlanState(state) {
  planState = normalizePlanState(state);
  clearResolvedSeries();
  onResultsCleared?.();
  onStateApplied?.();
}

export function patchPlanState(partial) {
  planState = normalizePlanState({ ...planState, ...partial });
  if (planResult) planResultStale = true;
  onStateApplied?.();
}

/** Switch chart view without invalidating the resolved result. */
export function setPlanView(view) {
  const next = view === 'cashflow' ? 'cashflow' : 'netWorth';
  if (planState.view === next) return;
  planState = { ...planState, view: next };
}

export function applyPlanPreset(presetId, { keepAttached = true } = {}) {
  const presets = getPlanPresets();
  const index = presets.findIndex((p) => p.id === presetId);
  const preset = index >= 0 ? presets[index] : null;
  if (!preset) return;
  applyPlanState({
    ...planState,
    ...preset.patch,
    sources: planState.sources,
    view: planState.view,
    presetLevel: index >= 0 ? index : planState.presetLevel,
    presetActive: keepAttached,
  });
}

export function detachPlanPreset() {
  if (!planState.presetActive) return;
  patchPlanState({ presetActive: false });
}

export function resetPlanToDefaults() {
  applyPlanState(defaultPlanState());
  const presets = getPlanPresets();
  if (presets[0]) applyPlanPreset(presets[0].id, { keepAttached: true });
}

/**
 * Rebuild cashflow aggregate + net worth from resolved series/artifacts.
 * @returns {object|null}
 */
export function rebuildPlanResult() {
  const sources = planState.sources
    .filter((s) => s.enabled)
    .map((s) => {
      const series = resolvedSeriesBySource.get(s.id);
      if (!series) return null;
      let offsetYears = s.offsetYears;
      // Withdraw handoff: series is startAge 0, but the calendar start was set
      // during the run — map that onto offset so cashflow bars land in the
      // drawdown years (not the accumulate window).
      if (s.feature === FEATURE_WITHDRAW) {
        const art = resolvedArtifactsBySource.get(s.id);
        const cal = Number(art?.calendarStartYear);
        if (Number.isFinite(cal)) {
          offsetYears = cal - planState.planStartYear;
        }
      }
      return {
        id: s.id,
        feature: s.feature,
        label: s.label || s.feature,
        strategyId: s.strategyId,
        offsetYears,
        enabled: true,
        series,
      };
    })
    .filter(Boolean);

  if (!sources.length && resolvedArtifactsBySource.size === 0) {
    planResult = null;
    return null;
  }

  const cashflow = sources.length
    ? buildLifetimePlan({
      sources,
      planStartYear: planState.planStartYear,
      planEndYear: planState.planEndYear,
      birthYearA: planState.birthYearA,
      birthYearB: planState.birthYearB,
    })
    : {
      years: yearsInWindow(planState.planStartYear, planState.planEndYear),
      rows: [],
      net: [],
      cumulative: [],
      bySource: {},
      sourceMeta: [],
      totals: { net: 0, bySource: {} },
    };

  const netWorth = buildNetWorthFromArtifacts(cashflow.years);
  planResult = {
    ...cashflow,
    netWorth,
    warnings: planWarnings.slice(),
  };
  planResultStale = false;
  return planResult;
}

function yearsInWindow(start, end) {
  const s = Math.round(Number(start));
  const e = Math.round(Number(end));
  if (!Number.isFinite(s) || !Number.isFinite(e) || e < s) return [];
  return Array.from({ length: e - s + 1 }, (_, i) => s + i);
}

/**
 * Pick accumulate / withdraw / home-equity artifacts and compose net worth.
 * @param {number[]} planYears
 */
function buildNetWorthFromArtifacts(planYears) {
  let accumulate = null;
  let withdraw = null;
  let homeEquity = null;

  for (const src of planState.sources) {
    if (!src.enabled) continue;
    const art = resolvedArtifactsBySource.get(src.id);
    if (!art) continue;

    if (art.kind === 'accumulate' && art.cone) {
      const series = resolvedSeriesBySource.get(src.id);
      const startYear = resolveSourceStartYear({
        startAge: series?.startAge ?? 0,
        planStartYear: planState.planStartYear,
        birthYearA: planState.birthYearA,
        birthYearB: planState.birthYearB,
        offsetYears: src.offsetYears || 0,
      });
      // First accumulate row wins if multiple (unusual).
      if (!accumulate) {
        accumulate = { startYear, cone: art.cone };
      }
    }

    if (art.kind === 'withdraw' && art.fan) {
      const series = resolvedSeriesBySource.get(src.id);
      let startYear = Number.isFinite(Number(art.calendarStartYear))
        ? Number(art.calendarStartYear)
        : null;
      if (startYear == null && src.startsAfter) {
        const link = planState.sources.find((s) => s.id === src.startsAfter);
        const linkArt = link ? resolvedArtifactsBySource.get(link.id) : null;
        const linkSeries = link ? resolvedSeriesBySource.get(link.id) : null;
        if (link && linkArt?.kind === 'accumulate') {
          const accumStart = resolveSourceStartYear({
            startAge: linkSeries?.startAge ?? 0,
            planStartYear: planState.planStartYear,
            birthYearA: planState.birthYearA,
            birthYearB: planState.birthYearB,
            offsetYears: link.offsetYears || 0,
          });
          const n = linkArt.numYears
            ?? Math.max(0, (linkArt.cone?.length || 1) - 1);
          startYear = accumStart + n + (src.gapYears || 0);
        }
      }
      if (startYear == null) {
        startYear = resolveSourceStartYear({
          startAge: series?.startAge ?? 0,
          planStartYear: planState.planStartYear,
          birthYearA: planState.birthYearA,
          birthYearB: planState.birthYearB,
          offsetYears: src.offsetYears || 0,
        });
      }
      if (!withdraw) {
        withdraw = {
          startYear,
          low: art.fan.low,
          median: art.fan.median,
          high: art.fan.high,
        };
      }
    }

    if (art.kind === 'homeEquity' && art.residualEquityReal) {
      const series = resolvedSeriesBySource.get(src.id);
      const startYear = resolveSourceStartYear({
        startAge: series?.startAge ?? 0,
        planStartYear: planState.planStartYear,
        birthYearA: planState.birthYearA,
        birthYearB: planState.birthYearB,
        offsetYears: src.offsetYears || 0,
      });
      if (!homeEquity) {
        homeEquity = {
          startYear,
          residual: art.residualEquityReal,
        };
      }
    }
  }

  if (!accumulate && !withdraw && !homeEquity) return null;
  return composeNetWorth({
    planYears,
    accumulate,
    withdraw,
    homeEquity,
  });
}

/**
 * Plan aggregate as a cashflow series for export/share.
 * @param {{ sessionName?: string|null }} [opts]
 */
export function getPlanCashflowSeries(opts = {}) {
  if (!planResult || planResultStale) return null;
  return buildPlanCashflowSeries(planResult, {
    sessionName: opts.sessionName ?? null,
  });
}

/**
 * Snapshot every referenced saved session across source features.
 * @returns {Promise<object[]>}
 */
export async function getPlanDependencies() {
  /** @type {Map<string, object>} */
  const seen = new Map();
  for (const src of planState.sources) {
    if (!src.sessionName) continue;
    const key = `${src.feature}::${src.sessionName}`;
    if (seen.has(key)) continue;
    try {
      const loaded = await sessions.load(src.feature, src.sessionName);
      if (!loaded?.payload) continue;
      let stateVersion;
      try {
        stateVersion = getFeatureStateVersion(src.feature);
      } catch {
        stateVersion = 1;
      }
      seen.set(key, {
        feature: src.feature,
        name: src.sessionName,
        state: loaded.payload,
        stateVersion,
        description: loaded.description || '',
      });
    } catch {
      /* skip missing */
    }
  }
  return [...seen.values()];
}

/**
 * Remap sources[].sessionName against import renames (feature + requestedName).
 * @param {object} state
 * @param {Array<{ feature?: string, requestedName?: string, name?: string }>|undefined} renames
 */
export function remapPlanSourceRenames(state, renames) {
  if (!state || !Array.isArray(renames) || !renames.length) return state;
  const sources = (state.sources || []).map((src) => {
    if (!src?.sessionName) return src;
    const match = renames.find(
      (r) => (r.feature || '') === src.feature && r.requestedName === src.sessionName,
    );
    if (!match?.name) return src;
    return { ...src, sessionName: match.name };
  });
  return { ...state, sources };
}

export async function applyImportedPlan(loaded, { statusMessage, renames } = {}) {
  let state = normalizePlanState(loaded.state || {});
  state = remapPlanSourceRenames(state, renames);
  applyPlanState(state);
  setSessionMeta({
    name: '',
    description: loaded.description || '',
    lastSelect: '',
  });
  await refreshSessionList('');
  updateSessionNoteDisplay();
  updateSessionActionButtons();
  snapshotSessionUi(FEATURE_PLAN);
  if (statusMessage) {
    const el = document.getElementById('plan-status');
    if (el) el.textContent = statusMessage;
  }
}

/** Features Plan may list when populating session pickers. */
export const PLAN_SOURCE_FEATURE_IDS = Object.freeze([
  FEATURE_ACCUMULATE,
  FEATURE_WITHDRAW,
  FEATURE_SS_TIMING,
  FEATURE_HOUSE_EQUITY,
]);
