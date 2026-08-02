import SimulationWorker from '../../workers/simulation.worker.js?worker&inline';
import { resolveNumCores } from '../../workers/parallelConfig.js';
import {
  readScenarioFromDom,
  buildSimParams,
  buildGoalSeekConfig,
  validateScenario,
  formatCurrency,
  MONEY_SCALE,
  writeFirstSpendingTierExtra,
} from '../../state/scenario.js';
import * as jobs from '../../state/jobs.js';
import { getActiveFeature } from '../../state/features.js';
import { FEATURE_WITHDRAW } from '../../state/storageKeys.js';
import { showAlert } from '../../ui/dialogs.js';
import { refreshDynamicAdjustmentPreviews } from './ui/inputs.js';
import { renderResults } from './ui/results.js';
import { onNewRun as onReportNewRun } from './ui/report.js';
import {
  getHistoricalSamples,
  hasHistoricalSamples,
  refreshHistoryView,
  YEAR_RANGE,
} from './history.js';
import { scheduleAutosave } from './session.js';

/** Stashed Withdraw results when a job finishes while another tab is active. */
let pendingWithdrawResults = null;

let currentNumCores = 1;

export function setLoading(isLoading) {
  const loading = document.getElementById('loadingIndicator');
  const results = document.getElementById('resultsSection');
  if (isLoading) {
    results.classList.add('hidden');
    loading.classList.remove('hidden');
    loading.classList.add('flex');
    updateProgress(0);
  } else {
    loading.classList.add('hidden');
    loading.classList.remove('flex');
  }
}

export function updateProgress(fraction, stage) {
  const bar = document.getElementById('progressBar');
  const text = document.getElementById('loadingText');
  const pct = Math.round(fraction * 100);

  // currentNumCores holds the number of *sub-workers* returned by resolveNumCores.
  // We add 1 for the Master worker thread for the UI display.
  const totalThreads = currentNumCores === 1 && document.getElementById('parallelCores').value === 'low'
    ? 1
    : currentNumCores + 1;

  const coreLabel = totalThreads === 1 ? '1 core' : `${totalThreads} cores`;

  if (bar) bar.style.width = `${pct}%`;
  if (text) {
    const prefix = stage ? `${stage}… ${pct}%` : `Running simulations… ${pct}%`;
    text.textContent = `${prefix} (using ${coreLabel})`;
  }
}

export function resolveRunNumCores(scenario) {
  return resolveNumCores(scenario.parallelCores, navigator.hardwareConcurrency);
}

// Drop in-flight workers before Vite replaces this module so ports/threads
// from a previous HMR generation cannot outlive the page logic that owns them.
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    jobs.cancelAll(FEATURE_WITHDRAW);
  });
}

// Sub-workers must be spawned here on the main thread: a worker created from a
// blob/data URL (single-file build) has a null origin and cannot spawn its own
// sub-workers, e.g. when the app is opened directly from disk (file://).
// Each sub-worker gets one end of a MessageChannel; the other ends are
// transferred to the master worker, which farms chunks out over them.
export function spawnSubWorkerPorts(numCores, bucket) {
  const masterPorts = [];
  if (numCores <= 1) return masterPorts;
  for (let i = 0; i < numCores; i++) {
    const subWorker = new SimulationWorker();
    const channel = new MessageChannel();
    subWorker.postMessage({ type: 'connect', port: channel.port1 }, [channel.port1]);
    bucket.push(subWorker);
    masterPorts.push(channel.port2);
  }
  return masterPorts;
}

export function paintWithdrawResults(payload) {
  document.getElementById('resultsSection').classList.remove('hidden');

  let reportScenario = payload.reportScenario;
  if (payload.kind === 'goalSeek' && payload.goalSeekSummary) {
    applyGoalSeekSummaryToDom(payload.goalSeekSummary, payload.scenario.withdrawalStrategy);
    scheduleAutosave();
    reportScenario = readScenarioFromDom();
  }

  onReportNewRun({
    result: payload.result,
    params: payload.params,
    scenario: reportScenario,
    fourPercentComparison: payload.fourPercentComparison,
    goalSeekWarning: payload.goalSeekWarning ?? null,
  });
  renderResults(payload.result, payload.params, {
    goalSeekWarning: payload.goalSeekWarning,
    fourPercentComparison: payload.fourPercentComparison,
    classicResult: payload.classicResult,
  });
}

/** Deliver results now, or stash until Withdraw is visible (Chart.js sizing). */
export function deliverWithdrawResults(payload) {
  if (getActiveFeature()?.id === FEATURE_WITHDRAW) {
    pendingWithdrawResults = null;
    paintWithdrawResults(payload);
  } else {
    pendingWithdrawResults = payload;
  }
}

export function flushPendingWithdrawResults() {
  if (!pendingWithdrawResults) return;
  const payload = pendingWithdrawResults;
  pendingWithdrawResults = null;
  setLoading(false);
  paintWithdrawResults(payload);
}

function finishWithError(prefix, err) {
  setLoading(false);
  pendingWithdrawResults = null;
  showAlert(`${prefix}: ${err?.message || err}`);
}

function ensureSamplesReady(scenario) {
  refreshHistoryView(scenario.startYear, scenario.endYear);
  if (!hasHistoricalSamples()) {
    showAlert(
      'No historical years are available for the selected range. Check Start/End Year under Returns.',
      'Please fix these inputs',
    );
    return null;
  }
  return buildSimParams(scenario, getHistoricalSamples());
}

export function runSimulation() {
  const scenario = readScenarioFromDom();
  const errors = validateScenario(scenario, YEAR_RANGE);
  if (errors.length) {
    showAlert(errors.join('\n'), 'Please fix these inputs');
    return;
  }

  const params = ensureSamplesReady(scenario);
  if (!params) return;
  currentNumCores = resolveRunNumCores(scenario);

  pendingWithdrawResults = null;
  setLoading(true);

  try {
    const subWorkers = [];
    const job = jobs.start(FEATURE_WITHDRAW, {
      createWorker: () => new SimulationWorker(),
      onCleanup: () => {
        for (const w of subWorkers) w.terminate();
        subWorkers.length = 0;
      },
      onProgress(fraction, stage) {
        updateProgress(fraction, stage);
      },
      onDone(msg) {
        setLoading(false);
        try {
          const fourPercentComparison = msg.fourPercentComparison ?? null;
          deliverWithdrawResults({
            kind: 'sim',
            result: msg.result,
            params,
            reportScenario: scenario,
            fourPercentComparison,
            classicResult: msg.classicResult,
            goalSeekWarning: null,
          });
        } catch (err) {
          finishWithError('Could not display simulation results', err);
        }
      },
      onError(err) {
        setLoading(false);
        showAlert(`Simulation error: ${err.message}`);
      },
    });

    const subWorkerPorts = spawnSubWorkerPorts(currentNumCores, subWorkers);
    job.post(
      { type: 'withdraw', params, numCores: currentNumCores, subWorkerPorts },
      subWorkerPorts,
    );
  } catch (err) {
    finishWithError('Could not start simulation', err);
  }
}

// Write the base withdrawal (and any levers Goal Seek was allowed to tune)
// back into the form, so the discovered plan is visible and editable like any
// other value once the search finishes.
export function applyGoalSeekSummaryToDom(summary, strategy) {
  const setCurrencyField = (id, dollars) => {
    const el = document.getElementById(id);
    if (el) el.value = dollars == null ? '' : formatCurrency(dollars / MONEY_SCALE);
  };

  // The base withdrawal field is hidden and unused under a Specific List, so
  // Goal Seek never searches it (see buildGoalSeekConfig) — leave it alone
  // rather than writing back a stray, irrelevant value.
  if (strategy !== 'specific') {
    setCurrencyField('baseWithdrawal', summary.baseWithdrawal);
  }

  if (summary.spendingOverTimeBonus !== undefined) {
    writeFirstSpendingTierExtra(summary.spendingOverTimeBonus);
  }

  // The Expected (med) adjustment is never searched — it is the user's fixed
  // on-plan anchor — so only the tuned Low/High bands are written back.
  // Optional calibration knobs (no-cut balance / max boost drawdown) stay as
  // the user/preset left them.
  if (summary.marketAdjustments) {
    setCurrencyField('dynLowAdj', summary.marketAdjustments.low);
    setCurrencyField('dynHighAdj', summary.marketAdjustments.high);
  }

  // Floor/Ceiling dollars stay Easy Mode / user-owned — Find Best Plan only
  // tunes Max Cut / Boost Rate against those fixed thresholds.
  if (summary.balanceAdjustment) {
    const { floorPenalty, ceilingBonus } = summary.balanceAdjustment;
    const floorPenaltyEl = document.getElementById('floorPenalty');
    if (floorPenaltyEl) floorPenaltyEl.value = Math.round(floorPenalty * 100);
    const ceilingBonusEl = document.getElementById('ceilingBonus');
    if (ceilingBonusEl) ceilingBonusEl.value = Math.round(ceilingBonus * 100);
  }

  if (summary.glideSpendDown) {
    setCurrencyField('glideTarget', summary.glideSpendDown.target);
    const glideFractionEl = document.getElementById('glideFraction');
    if (glideFractionEl) glideFractionEl.value = Math.round(summary.glideSpendDown.fraction * 100);
  }

  refreshDynamicAdjustmentPreviews();
}

export function runGoalSeekSearch() {
  const scenario = readScenarioFromDom();
  const errors = validateScenario(scenario, YEAR_RANGE);
  if (errors.length) {
    showAlert(errors.join('\n'), 'Please fix these inputs');
    return;
  }

  const params = ensureSamplesReady(scenario);
  if (!params) return;
  const goalSeekConfig = buildGoalSeekConfig(scenario);
  currentNumCores = resolveRunNumCores(scenario);

  pendingWithdrawResults = null;
  setLoading(true);

  try {
    const subWorkers = [];
    const job = jobs.start(FEATURE_WITHDRAW, {
      createWorker: () => new SimulationWorker(),
      onCleanup: () => {
        for (const w of subWorkers) w.terminate();
        subWorkers.length = 0;
      },
      onProgress(fraction, stage) {
        updateProgress(fraction, stage);
      },
      onDone(msg) {
        setLoading(false);
        try {
          const summary = msg.goalSeekSummary;
          const goalSeekWarning = summary?.feasible
            ? null
            : summary?.reason || 'Find Best Plan could not find a plan meeting your target.';
          const finalParams = msg.finalParams ?? params;
          const fourPercentComparison = msg.fourPercentComparison ?? null;
          deliverWithdrawResults({
            kind: 'goalSeek',
            goalSeekSummary: summary,
            scenario,
            result: msg.result,
            params: finalParams,
            reportScenario: scenario,
            fourPercentComparison,
            classicResult: msg.classicResult,
            goalSeekWarning,
          });
        } catch (err) {
          finishWithError('Could not display Find Best Plan results', err);
        }
      },
      onError(err) {
        setLoading(false);
        showAlert(`Find Best Plan error: ${err.message}`);
      },
    });

    const subWorkerPorts = spawnSubWorkerPorts(currentNumCores, subWorkers);
    job.post(
      { type: 'withdrawGoalSeek', params, goalSeekConfig, numCores: currentNumCores, subWorkerPorts },
      subWorkerPorts,
    );
  } catch (err) {
    finishWithError('Could not start Find Best Plan', err);
  }
}

// Fork between a normal simulation and a Goal Seek search based on the mode toggle.
export function handleRunClick() {
  const scenario = readScenarioFromDom();
  if (scenario.goalSeekMode) {
    runGoalSeekSearch();
  } else {
    runSimulation();
  }
}

// Stop an in-flight simulation and return the UI to its idle state.
export function cancelSimulation() {
  jobs.cancelAll(FEATURE_WITHDRAW);
  pendingWithdrawResults = null;
  setLoading(false);
}
