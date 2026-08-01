// Accumulation run orchestration via shared jobs + worker dispatcher.

import SimulationWorker from '../../workers/simulation.worker.js?worker&inline';
import { resolveNumCores } from '../../workers/parallelConfig.js';
import * as jobs from '../../state/jobs.js';
import { getActiveFeature } from '../../state/features.js';
import { FEATURE_ACCUMULATION } from '../../state/storageKeys.js';
import { showAlert } from '../../ui/dialogs.js';
import {
  getAccumulationState,
  setAccumulationResultStale,
} from './session.js';
import { syncAccumulationFormToState } from './ui/inputs.js';
import { applyAccumulationHistoryProfiles } from './history.js';
import { buildAccumulationParams, ensureProfiles } from './params.js';
import {
  paintAccumulationResults,
  setAccumulationLoading,
  updateAccumulationProgress,
} from './ui/results.js';

let pendingResults = null;

function spawnSubWorkerPorts(numCores, bucket) {
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

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    jobs.cancelAll(FEATURE_ACCUMULATION);
  });
}

export function deliverAccumulationResults(payload) {
  if (getActiveFeature()?.id === FEATURE_ACCUMULATION) {
    pendingResults = null;
    paintAccumulationResults(payload);
  } else {
    pendingResults = payload;
  }
}

export function flushPendingAccumulationResults() {
  if (!pendingResults) return;
  const payload = pendingResults;
  pendingResults = null;
  setAccumulationLoading(false);
  paintAccumulationResults(payload);
}

export function cancelAccumulationRun() {
  jobs.cancelAll(FEATURE_ACCUMULATION);
  pendingResults = null;
  setAccumulationLoading(false);
}

export async function handleAccumulationRunClick() {
  syncAccumulationFormToState();
  applyAccumulationHistoryProfiles({ force: false });
  const state = getAccumulationState();
  const profiles = ensureProfiles(state);
  if (!profiles) {
    showAlert('Could not build return profiles from the selected year range.', 'Accumulation');
    return;
  }

  const seed = Number.isFinite(state.seed)
    ? (state.seed >>> 0)
    : (Math.random() * 0xffffffff) >>> 0;

  let params;
  try {
    params = buildAccumulationParams({ ...state, profiles }, { seed });
  } catch (err) {
    showAlert(err?.message || String(err), 'Accumulation');
    return;
  }

  if (!params.samples?.years?.length && state.distMethod !== 'lognormal') {
    showAlert('Historical sample is empty for this year range.', 'Accumulation');
    return;
  }

  const numCores = resolveNumCores(state.parallelCores || 'high', navigator.hardwareConcurrency);
  pendingResults = null;
  setAccumulationResultStale(false);
  setAccumulationLoading(true);
  updateAccumulationProgress(0, 'Starting accumulation run');

  try {
    const subWorkers = [];
    const job = jobs.start(FEATURE_ACCUMULATION, {
      createWorker: () => new SimulationWorker(),
      onCleanup: () => {
        for (const w of subWorkers) w.terminate();
        subWorkers.length = 0;
      },
      onProgress(fraction, stage) {
        updateAccumulationProgress(fraction, stage);
      },
      onDone(msg) {
        setAccumulationLoading(false);
        try {
          deliverAccumulationResults({ result: msg.result });
        } catch (err) {
          showAlert(err?.message || String(err), 'Accumulation');
        }
      },
      onError(err) {
        setAccumulationLoading(false);
        showAlert(err?.message || String(err), 'Accumulation');
      },
    });

    const ports = spawnSubWorkerPorts(numCores, subWorkers);
    job.post({
      type: 'accumulation',
      params,
      sweepPaths: state.sweepPaths,
      includeWeightExplore: state.exploreWeights !== false,
      numCores,
      subWorkerPorts: ports,
    }, ports);
  } catch (err) {
    setAccumulationLoading(false);
    showAlert(err?.message || String(err), 'Accumulation');
  }
}
