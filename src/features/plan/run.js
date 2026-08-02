// Lifetime Plan refresh — phased pipeline:
// 1) external sources (SS / Roth / House Equity)
// 2) sum external flows on the calendar
// 3) Accumulate (with injected events)
// 4) Withdraw (with majorEventsSeries + optional Accumulate handoff)
// 5) compose cashflow + net worth

import SimulationWorker from '../../workers/simulation.worker.js?worker&inline';
import * as jobs from '../../state/jobs.js';
import * as sessions from '../../state/sessions.js';
import { getActiveFeature } from '../../state/features.js';
import { FEATURE_PLAN, FEATURE_ACCUMULATE, FEATURE_WITHDRAW } from '../../state/storageKeys.js';
import {
  getSessionAdapter,
  getFeatureSessionName,
} from '../../ui/sessionChrome.js';
import { showAlert } from '../../ui/dialogs.js';
import {
  externalFlowsForWindow,
  flowsForEngineWindow,
  flowsToAccumulateEvents,
  flowsToWithdrawMajorEventsSeries,
  resolveSourceStartYear,
  resolveWithdrawStartAfterAccumulate,
  withdrawBlocksExternalInjection,
} from '../../core/lifetimePlan.js';
import {
  getPlanState,
  setResolvedSeries,
  setResolvedArtifacts,
  clearResolvedSeries,
  rebuildPlanResult,
  setPlanResultStale,
  setPlanWarnings,
} from './session.js';
import { getPlanSourceDescriptor } from './sources.js';
import { syncPlanFormToState } from './ui/inputs.js';
import {
  paintPlanResults,
  setPlanLoading,
  updatePlanProgress,
} from './ui/results.js';

let pendingResults = null;
let refreshCancelled = false;

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    refreshCancelled = true;
    jobs.cancelAll(FEATURE_PLAN);
  });
}

export function deliverPlanResults(payload) {
  if (getActiveFeature()?.id === FEATURE_PLAN) {
    pendingResults = null;
    paintPlanResults(payload);
  } else {
    pendingResults = payload;
  }
}

export function flushPendingPlanResults() {
  if (!pendingResults) return;
  const payload = pendingResults;
  pendingResults = null;
  setPlanLoading(false);
  paintPlanResults(payload);
}

export function cancelPlanRun() {
  refreshCancelled = true;
  jobs.cancelAll(FEATURE_PLAN);
  pendingResults = null;
  setPlanLoading(false);
}

/** Stable deep equality for session state comparison. */
function deepEqual(a, b) {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

/**
 * Decide whether the live in-memory feature state matches the Plan selection.
 * @param {string} feature
 * @param {string} sessionName - '' means current unsaved
 * @param {object|null} loadedPayload - migrated saved payload when named
 */
function canUseLiveSeries(feature, sessionName, loadedPayload) {
  const adapter = getSessionAdapter(feature);
  if (!adapter?.getCashflowSeries) return false;

  if (!sessionName) {
    return true;
  }

  if (getFeatureSessionName(feature) !== sessionName) return false;
  if (!loadedPayload || typeof adapter.getState !== 'function') return false;
  return deepEqual(adapter.getState(), loadedPayload);
}

/**
 * Run one worker job under FEATURE_PLAN and resolve with the done message.
 * @param {object} payload
 * @param {(fraction: number, stage?: string) => void} onProgress
 */
function runWorkerJob(payload, onProgress) {
  return new Promise((resolve, reject) => {
    if (refreshCancelled) {
      reject(new Error('cancelled'));
      return;
    }
    const job = jobs.start(FEATURE_PLAN, {
      createWorker: () => new SimulationWorker(),
      onProgress(fraction, stage) {
        onProgress?.(fraction, stage);
      },
      onDone(msg) {
        resolve(msg);
      },
      onError(err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      },
    });
    job.post(payload);
  });
}

/**
 * Extract cashflowSeries from a worker done message / analysis result.
 * @param {object} msg
 */
function seriesFromWorkerMsg(msg) {
  const result = msg?.result;
  if (!result) return null;
  if (result.cashflowSeries) return result.cashflowSeries;
  return null;
}

/**
 * Cap numSimulations on a worker payload / nested input.
 * @param {object} payload
 * @param {number} cap
 */
function applySimCap(payload, cap) {
  const next = { ...payload };
  if (Number.isFinite(Number(next.numSimulations))) {
    next.numSimulations = Math.min(Number(next.numSimulations), cap);
  }
  if (next.input && typeof next.input === 'object') {
    next.input = {
      ...next.input,
      numSimulations: Math.min(
        Number(next.input.numSimulations) || cap,
        cap,
      ),
    };
  }
  if (next.params && typeof next.params === 'object') {
    next.params = {
      ...next.params,
      numSimulations: Math.min(
        Number(next.params.numSimulations) || cap,
        cap,
      ),
    };
  }
  return next;
}

/**
 * Load state for a source row (live unsaved or named session).
 * @param {object} sourceRow
 */
async function loadSourceState(sourceRow) {
  const desc = getPlanSourceDescriptor(sourceRow.feature);
  if (!desc) return { state: null, loadedPayload: null, useLive: false };

  const sessionName = sourceRow.sessionName || '';
  let loadedPayload = null;

  if (sessionName) {
    try {
      const loaded = await sessions.load(sourceRow.feature, sessionName);
      loadedPayload = loaded?.payload || null;
    } catch {
      loadedPayload = null;
    }
    if (!loadedPayload) {
      throw new Error(
        `Could not load ${desc.title} session “${sessionName}”.`,
      );
    }
  }

  const adapter = getSessionAdapter(sourceRow.feature);
  const useLive = canUseLiveSeries(sourceRow.feature, sessionName, loadedPayload);
  const state = sessionName
    ? loadedPayload
    : (adapter?.getState?.() || null);

  return { state, loadedPayload, useLive, adapter, desc, sessionName };
}

/**
 * Resolve an external (SS/Roth/HE) source to a cashflow series + optional artifacts.
 */
async function resolveExternalSource(sourceRow, refreshSims, onProgress) {
  const { state, useLive, adapter, desc, sessionName } = await loadSourceState(sourceRow);
  if (!desc) return { series: null, artifacts: null };

  if (useLive) {
    try {
      const live = adapter.getCashflowSeries({ sessionName: sessionName || null });
      if (live && typeof live === 'object') {
        // Live path has no worker artifacts — HE residual unavailable unless re-run.
        // Re-run when we need home-equity residual for net worth.
        if (desc.phase === 'external' && typeof desc.extractArtifacts === 'function') {
          // Fall through to worker so we capture residualEquityReal.
        } else {
          return { series: live, artifacts: null };
        }
      }
    } catch {
      /* fall through */
    }
  }

  if (!state) {
    throw new Error(`No ${desc.title} state available for this source.`);
  }

  if (typeof desc.pureSeries === 'function' && !desc.workerType) {
    return {
      series: desc.pureSeries(state, { sessionName: sessionName || null }),
      artifacts: null,
    };
  }

  if (typeof desc.buildPayload !== 'function' || !desc.workerType) {
    throw new Error(`${desc.title} cannot be resolved without a prior run.`);
  }

  const cappedState = {
    ...state,
    numSimulations: Math.min(Number(state.numSimulations) || refreshSims, refreshSims),
  };
  let payload = await desc.buildPayload(cappedState);
  payload = applySimCap(payload, refreshSims);

  const msg = await runWorkerJob(payload, onProgress);
  let series = seriesFromWorkerMsg(msg);
  if (!series && typeof desc.extractSeries === 'function') {
    series = desc.extractSeries(msg, { sessionName: sessionName || null, state });
  }
  if (!series) {
    throw new Error(`${desc.title} run did not produce a cashflow series.`);
  }
  series = {
    ...series,
    sessionName: sessionName || series.sessionName || null,
  };

  const artifacts = typeof desc.extractArtifacts === 'function'
    ? desc.extractArtifacts(msg, { strategyId: sourceRow.strategyId })
    : null;

  return { series, artifacts };
}

/**
 * Resolve Accumulate with optional injected events; always runs worker for cone.
 */
async function resolveAccumulateSource(sourceRow, refreshSims, extraEvents, onProgress) {
  const { state, desc, sessionName } = await loadSourceState(sourceRow);
  if (!desc) return { series: null, artifacts: null };
  if (!state) {
    throw new Error(`No ${desc.title} state available for this source.`);
  }

  let payload = await desc.buildPayload(state, {
    refreshSims,
    extraEvents,
  });
  payload = applySimCap(payload, refreshSims);

  const msg = await runWorkerJob(payload, onProgress);
  const series = typeof desc.extractSeries === 'function'
    ? desc.extractSeries(msg, { sessionName: sessionName || null, state })
    : (desc.pureSeries?.(state, { sessionName: sessionName || null }) || null);

  if (!series) {
    throw new Error('Accumulate run did not produce a cashflow series.');
  }

  const artifacts = typeof desc.extractArtifacts === 'function'
    ? desc.extractArtifacts(msg, { strategyId: sourceRow.strategyId })
    : null;

  return {
    series: { ...series, sessionName: sessionName || series.sessionName || null },
    artifacts,
  };
}

/**
 * Resolve Withdraw with injection + optional Accumulate handoff.
 */
async function resolveWithdrawSource(
  sourceRow,
  refreshSims,
  {
    majorEventsSeries,
    startBalanceDollars,
    onProgress,
  },
) {
  const { state, desc, sessionName } = await loadSourceState(sourceRow);
  if (!desc) return { series: null, artifacts: null, warning: null };
  if (!state) {
    throw new Error(`No ${desc.title} state available for this source.`);
  }

  let warning = null;
  let seriesToInject = majorEventsSeries;
  // Only block when Specific List actually has amounts — an empty Goal-Seek
  // shell is rewritten to a base 4% spend for the Plan run.
  const specificList = String(state.specificWithdrawals || '').trim();
  if (
    withdrawBlocksExternalInjection(state)
    && specificList
    && Array.isArray(majorEventsSeries)
    && majorEventsSeries.some((v) => v !== 0)
  ) {
    warning = 'This Withdraw session uses specific withdrawals; outside cashflows cannot be applied to it.';
    seriesToInject = null;
  }

  // Withdraw Easy Mode leaves Starting Portfolio blank until the user types
  // one — Plan must not silently run a $0 portfolio (cashflow + NW all zero).
  const hasHandoff = Number.isFinite(Number(startBalanceDollars))
    && Number(startBalanceDollars) > 0;
  // Scenario startBalance is in $000s (same units as the Withdraw form).
  const hasOwnStart = (Number(state.startBalance) || 0) > 0;
  if (!hasHandoff && !hasOwnStart) {
    throw new Error(
      'Withdraw needs a Starting Portfolio (set it in Withdraw), or link this row to “starts after” an Accumulate source.',
    );
  }

  let payload = await desc.buildPayload(state, {
    refreshSims,
    majorEventsSeries: seriesToInject,
    startBalanceDollars: hasHandoff ? startBalanceDollars : undefined,
  });
  payload = applySimCap(payload, refreshSims);

  const paramStart = Number(payload?.params?.portfolio?.start);
  if (!(paramStart > 0)) {
    throw new Error(
      'Withdraw starting balance is zero after resolve — check Starting Portfolio or the Accumulate handoff.',
    );
  }
  if (payload?._planMeta?.appliedDefaultSpend && !warning) {
    warning = 'Withdraw had no spending amount — Plan used 4% of the starting balance for this run only.';
  }

  const msg = await runWorkerJob(payload, onProgress);
  const series = typeof desc.extractSeries === 'function'
    ? desc.extractSeries(msg, { sessionName: sessionName || null })
    : null;
  if (!series) {
    throw new Error('Withdraw run did not produce a cashflow series.');
  }
  const artifacts = typeof desc.extractArtifacts === 'function'
    ? desc.extractArtifacts(msg, { strategyId: sourceRow.strategyId })
    : null;

  return {
    series: { ...series, sessionName: sessionName || series.sessionName || null },
    artifacts,
    warning,
  };
}

function sourceStartYear(src, series, planState) {
  return resolveSourceStartYear({
    startAge: series?.startAge ?? (src.feature === FEATURE_ACCUMULATE ? 0 : 0),
    planStartYear: planState.planStartYear,
    birthYearA: planState.birthYearA,
    birthYearB: planState.birthYearB,
    offsetYears: src.offsetYears || 0,
  });
}

export async function handlePlanRunClick() {
  syncPlanFormToState();
  const state = getPlanState();
  const enabled = (state.sources || []).filter((s) => s.enabled);

  if (!enabled.length) {
    showAlert('Add at least one enabled source before refreshing.', 'Lifetime Plan');
    return;
  }

  refreshCancelled = false;
  pendingResults = null;
  setPlanResultStale(false);
  clearResolvedSeries();
  setPlanLoading(true);
  updatePlanProgress(0, 'Resolving sources…');

  const refreshSims = state.refreshSims || 200;
  const warnings = [];

  const external = enabled.filter((s) => {
    const d = getPlanSourceDescriptor(s.feature);
    return d?.phase === 'external';
  });
  const accumulates = enabled.filter((s) => s.feature === FEATURE_ACCUMULATE);
  const withdraws = enabled.filter((s) => s.feature === FEATURE_WITHDRAW);

  // Progress weights: externals + accumulates + withdraws
  const totalSteps = Math.max(1, external.length + accumulates.length + withdraws.length);
  let step = 0;

  const bump = (label) => {
    updatePlanProgress(step / totalSteps, label);
  };

  try {
    // ---- Phase 1: external sources ----
    /** @type {Array<object>} */
    const resolvedExternals = [];
    for (const src of external) {
      if (refreshCancelled) throw new Error('cancelled');
      const desc = getPlanSourceDescriptor(src.feature);
      const label = src.label || desc?.title || src.feature;
      bump(`Resolving ${label}…`);
      const { series, artifacts } = await resolveExternalSource(
        src,
        refreshSims,
        (fraction, stage) => {
          const overall = (step + Math.max(0, Math.min(1, fraction))) / totalSteps;
          updatePlanProgress(overall, stage || `Running ${label}…`);
        },
      );
      if (series) {
        setResolvedSeries(src.id, series);
        resolvedExternals.push({
          id: src.id,
          feature: src.feature,
          label: src.label || src.feature,
          strategyId: src.strategyId,
          offsetYears: src.offsetYears,
          enabled: true,
          series,
        });
      }
      if (artifacts) setResolvedArtifacts(src.id, artifacts);
      step += 1;
    }

    // ---- Phase 2: sum external flows ----
    const { byYear: externalByYear } = externalFlowsForWindow({
      sources: resolvedExternals,
      planStartYear: state.planStartYear,
      planEndYear: state.planEndYear,
      birthYearA: state.birthYearA,
      birthYearB: state.birthYearB,
    });

    // ---- Phase 3: Accumulate ----
    /** @type {Map<string, { artifacts: object, series: object, startYear: number }>} */
    const accumById = new Map();
    for (const src of accumulates) {
      if (refreshCancelled) throw new Error('cancelled');
      const desc = getPlanSourceDescriptor(src.feature);
      const label = src.label || desc?.title || src.feature;
      bump(`Growing ${label}…`);

      // Peek state for numYears to size the injection window.
      const loaded = await loadSourceState(src);
      const numYears = Math.max(0, Number(loaded.state?.numYears) || 0);
      const startYear = sourceStartYear(src, null, state);
      const windowFlows = flowsForEngineWindow(externalByYear, startYear, numYears);
      const extraEvents = flowsToAccumulateEvents(windowFlows);

      const { series, artifacts } = await resolveAccumulateSource(
        src,
        refreshSims,
        extraEvents,
        (fraction, stage) => {
          const overall = (step + Math.max(0, Math.min(1, fraction))) / totalSteps;
          updatePlanProgress(overall, stage || `Running ${label}…`);
        },
      );
      if (series) setResolvedSeries(src.id, series);
      if (artifacts) setResolvedArtifacts(src.id, artifacts);
      accumById.set(src.id, {
        artifacts,
        series,
        startYear: sourceStartYear(src, series, state),
        numYears: artifacts?.numYears ?? numYears,
      });
      step += 1;
    }

    // ---- Phase 4: Withdraw ----
    for (const src of withdraws) {
      if (refreshCancelled) throw new Error('cancelled');
      const desc = getPlanSourceDescriptor(src.feature);
      const label = src.label || desc?.title || src.feature;
      bump(`Drawing ${label}…`);

      const loaded = await loadSourceState(src);
      let startBalanceDollars;
      let withdrawStartYear = sourceStartYear(src, null, state);

      if (src.startsAfter) {
        const link = accumById.get(src.startsAfter);
        if (!link?.artifacts?.ending) {
          throw new Error(
            `${label}: “starts after” Accumulate source has not been resolved.`,
          );
        }
        const pct = src.handoffPercentile || 'p50';
        const ending = link.artifacts.ending;
        const handoff = Number(ending[pct] ?? ending.p50 ?? ending.median);
        if (!Number.isFinite(handoff)) {
          throw new Error(`${label}: Accumulate ending balance is missing.`);
        }
        startBalanceDollars = handoff;
        withdrawStartYear = resolveWithdrawStartAfterAccumulate({
          accumulateStartYear: link.startYear,
          accumulateNumYears: link.numYears,
          gapYears: src.gapYears || 0,
        });
      }

      // Engine years for Withdraw — use scenario horizon (maxYears ≈ numYears + plus).
      const numYears = Math.max(0, Number(loaded.state?.numYears) || 0);
      const horizonPlus = Math.max(0, Number(loaded.state?.horizonPlusYears) || 0);
      const maxYears = numYears + horizonPlus;
      const windowFlows = flowsForEngineWindow(
        externalByYear,
        withdrawStartYear,
        maxYears || numYears,
      );
      const majorEventsSeries = flowsToWithdrawMajorEventsSeries(
        windowFlows,
        maxYears || numYears,
      );

      const { series, artifacts, warning } = await resolveWithdrawSource(
        src,
        refreshSims,
        {
          majorEventsSeries,
          startBalanceDollars,
          onProgress: (fraction, stage) => {
            const overall = (step + Math.max(0, Math.min(1, fraction))) / totalSteps;
            updatePlanProgress(overall, stage || `Running ${label}…`);
          },
        },
      );
      if (warning) warnings.push(warning);
      if (series) {
        // Override startAge 0 placement via offset so calendar start matches handoff.
        // resolveSourceStartYear uses offsetYears; set effective offset so
        // planStart + offset = withdrawStartYear when startAge is 0.
        setResolvedSeries(src.id, series);
        // Stash calendar start on artifacts for composeNetWorth.
        if (artifacts) {
          setResolvedArtifacts(src.id, {
            ...artifacts,
            calendarStartYear: withdrawStartYear,
          });
        }
        // Patch the source row's offset in-memory for this result rebuild only
        // by adjusting artifacts; compose uses startsAfter path preferentially.
      } else if (artifacts) {
        setResolvedArtifacts(src.id, artifacts);
      }
      step += 1;
    }

    if (refreshCancelled) throw new Error('cancelled');

    setPlanWarnings(warnings);
    const result = rebuildPlanResult();
    setPlanLoading(false);
    if (!result) {
      showAlert(
        'No data could be resolved. Add Accumulate or Withdraw, or run the source features first.',
        'Lifetime Plan',
      );
      return;
    }
    if (warnings.length) {
      const status = document.getElementById('plan-status');
      if (status) status.textContent = warnings.join(' ');
    }
    deliverPlanResults(result);
  } catch (err) {
    setPlanLoading(false);
    if (String(err?.message) === 'cancelled') return;
    showAlert(err?.message || String(err), 'Lifetime Plan');
  }
}
