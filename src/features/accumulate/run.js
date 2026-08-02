// Accumulate run orchestration via shared jobs + worker dispatcher.

import SimulationWorker from '../../workers/simulation.worker.js?worker&inline';
import { resolveNumCores } from '../../workers/parallelConfig.js';
import * as jobs from '../../state/jobs.js';
import { getActiveFeature } from '../../state/features.js';
import { FEATURE_ACCUMULATE } from '../../state/storageKeys.js';
import { showAlert } from '../../ui/dialogs.js';
import {
  getAccumulateState,
  setAccumulateResultStale,
} from './session.js';
import { syncAccumulateFormToState } from './ui/inputs.js';
import { applyAccumulateHistoryProfiles } from './history.js';
import { buildAccumulateParams, ensureProfiles } from './params.js';
import {
  paintAccumulateResults,
  setAccumulateLoading,
  updateAccumulateProgress,
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
    jobs.cancelAll(FEATURE_ACCUMULATE);
  });
}

export function deliverAccumulateResults(payload) {
  if (getActiveFeature()?.id === FEATURE_ACCUMULATE) {
    pendingResults = null;
    paintAccumulateResults(payload);
  } else {
    pendingResults = payload;
  }
}

export function flushPendingAccumulateResults() {
  if (!pendingResults) return;
  const payload = pendingResults;
  pendingResults = null;
  setAccumulateLoading(false);
  paintAccumulateResults(payload);
}

export function cancelAccumulateRun() {
  jobs.cancelAll(FEATURE_ACCUMULATE);
  pendingResults = null;
  setAccumulateLoading(false);
}

export async function handleAccumulateRunClick() {
  syncAccumulateFormToState();
  const state = getAccumulateState();
  if (state.portfolioSource === 'link' && !state.scenarioRef?.name) {
    showAlert('Select a saved Withdraw session, or switch to a local portfolio.', 'Accumulate');
    return;
  }

  if (!state.scenarioRef?.name) {
    applyAccumulateHistoryProfiles({ force: false });
    const profiles = ensureProfiles(getAccumulateState());
    if (!profiles) {
      showAlert('Could not build return profiles from the selected year range.', 'Accumulate');
      return;
    }
  }

  const latest = getAccumulateState();
  const seed = Number.isFinite(latest.seed)
    ? (latest.seed >>> 0)
    : (Math.random() * 0xffffffff) >>> 0;

  let params;
  try {
    params = await buildAccumulateParams(latest, { seed });
  } catch (err) {
    showAlert(err?.message || String(err), 'Accumulate');
    return;
  }

  if (!params.samples?.years?.length && params.distMethod !== 'lognormal') {
    showAlert('Historical sample is empty for this year range.', 'Accumulate');
    return;
  }

  const numCores = resolveNumCores(latest.parallelCores || 'high', navigator.hardwareConcurrency);
  pendingResults = null;
  setAccumulateResultStale(false);
  setAccumulateLoading(true);
  updateAccumulateProgress(0, 'Starting accumulate run');

  try {
    const subWorkers = [];
    const job = jobs.start(FEATURE_ACCUMULATE, {
      createWorker: () => new SimulationWorker(),
      onCleanup: () => {
        for (const w of subWorkers) w.terminate();
        subWorkers.length = 0;
      },
      onProgress(fraction, stage) {
        updateAccumulateProgress(fraction, stage);
      },
      onDone(msg) {
        setAccumulateLoading(false);
        try {
          deliverAccumulateResults({ result: msg.result });
        } catch (err) {
          showAlert(err?.message || String(err), 'Accumulate');
        }
      },
      onError(err) {
        setAccumulateLoading(false);
        showAlert(err?.message || String(err), 'Accumulate');
      },
    });

    const ports = spawnSubWorkerPorts(numCores, subWorkers);
    job.post({
      type: 'accumulate',
      params,
      sweepPaths: state.sweepPaths,
      includeWeightExplore: state.exploreWeights !== false,
      numCores,
      subWorkerPorts: ports,
    }, ports);
  } catch (err) {
    setAccumulateLoading(false);
    showAlert(err?.message || String(err), 'Accumulate');
  }
}
