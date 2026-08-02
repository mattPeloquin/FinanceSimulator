// SOR Lab run orchestration: start/cancel sensitivity jobs through the shared
// job manager, defer Chart.js painting until the Lab tab is visible.

import SimulationWorker from '../../workers/simulation.worker.js?worker&inline';
import { resolveNumCores } from '../../workers/parallelConfig.js';
import * as jobs from '../../state/jobs.js';
import * as sessions from '../../state/sessions.js';
import { getActiveFeature } from '../../state/features.js';
import { FEATURE_SOR_LAB, FEATURE_WITHDRAW } from '../../state/storageKeys.js';
import { showAlert } from '../../ui/dialogs.js';
import { buildSweepJob, estimateSweepCost, DEFAULT_SWEEP_POINTS, DEFAULT_PATHS_PER_POINT } from './sweep.js';
import { getLabConfig, setLabResultStale } from './session.js';
import { paintLabResults, setLabLoading, updateLabProgress } from './ui/results.js';

/** Stashed Lab results when a job finishes while another tab is active. */
let pendingSorLabResults = null;

let currentNumCores = 1;

// Sub-workers must be spawned on the main thread (same constraint as Withdraw).
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
    jobs.cancelAll(FEATURE_SOR_LAB);
  });
}

export function deliverSorLabResults(payload) {
  if (getActiveFeature()?.id === FEATURE_SOR_LAB) {
    pendingSorLabResults = null;
    paintLabResults(payload);
  } else {
    pendingSorLabResults = payload;
  }
}

export function flushPendingSorLabResults() {
  if (!pendingSorLabResults) return;
  const payload = pendingSorLabResults;
  pendingSorLabResults = null;
  setLabLoading(false);
  paintLabResults(payload);
}

export function cancelLabRun() {
  jobs.cancelAll(FEATURE_SOR_LAB);
  pendingSorLabResults = null;
  setLabLoading(false);
}

export function getLabCostEstimate() {
  const config = getLabConfig();
  if (!config.scenarioRef?.name) {
    return { error: 'Pick a saved Withdraw session first.' };
  }
  return sessions.load(FEATURE_WITHDRAW, config.scenarioRef.name).then((loaded) => {
    if (!loaded?.payload) {
      return { error: `Could not load Withdraw session "${config.scenarioRef.name}".` };
    }
    return estimateSweepCost(loaded.payload, {
      sweepPoints: config.sweepPoints || DEFAULT_SWEEP_POINTS,
      pathsPerPoint: config.pathsPerPoint || DEFAULT_PATHS_PER_POINT,
      envelopeOverrides: config.envelopeOverrides || {},
    });
  }).catch((err) => ({ error: err?.message || String(err) }));
}

export async function handleLabRunClick() {
  const config = getLabConfig();
  if (!config.scenarioRef?.name) {
    showAlert('Pick a saved Withdraw session to analyze.', 'SOR Lab');
    return;
  }

  let loaded;
  try {
    loaded = await sessions.load(FEATURE_WITHDRAW, config.scenarioRef.name);
  } catch (err) {
    showAlert(`Could not load Withdraw session: ${err.message}`, 'SOR Lab');
    return;
  }
  if (!loaded?.payload) {
    showAlert(
      `Could not find saved Withdraw session "${config.scenarioRef.name}". Save a scenario in Withdraw first.`,
      'SOR Lab',
    );
    return;
  }

  const seed = Number.isFinite(config.seed)
    ? (config.seed >>> 0)
    : (Math.random() * 0xffffffff) >>> 0;

  let jobPayload;
  try {
    jobPayload = buildSweepJob(loaded.payload, {
      seed,
      sweepPoints: config.sweepPoints || DEFAULT_SWEEP_POINTS,
      pathsPerPoint: config.pathsPerPoint || DEFAULT_PATHS_PER_POINT,
      envelopeOverrides: config.envelopeOverrides || {},
      baselineRef: { feature: FEATURE_WITHDRAW, name: config.scenarioRef.name },
    });
  } catch (err) {
    showAlert(err?.message || String(err), 'SOR Lab');
    return;
  }

  currentNumCores = resolveNumCores(
    loaded.payload.parallelCores || 'high',
    navigator.hardwareConcurrency,
  );

  pendingSorLabResults = null;
  setLabResultStale(false);
  setLabLoading(true);
  updateLabProgress(0, 'Starting sensitivity sweep');

  try {
    const subWorkers = [];
    const job = jobs.start(FEATURE_SOR_LAB, {
      createWorker: () => new SimulationWorker(),
      onCleanup: () => {
        for (const w of subWorkers) w.terminate();
        subWorkers.length = 0;
      },
      onProgress(fraction, stage) {
        updateLabProgress(fraction, stage, currentNumCores);
      },
      onDone(msg) {
        setLabLoading(false);
        try {
          deliverSorLabResults({
            result: msg.result,
            config: {
              ...config,
              seed,
              scenarioRef: { feature: FEATURE_WITHDRAW, name: config.scenarioRef.name },
            },
          });
        } catch (err) {
          showAlert(`Could not display Lab results: ${err?.message || err}`, 'SOR Lab');
        }
      },
      onError(err) {
        setLabLoading(false);
        pendingSorLabResults = null;
        showAlert(`Lab run failed: ${err?.message || err}`, 'SOR Lab');
      },
    });

    const subWorkerPorts = spawnSubWorkerPorts(currentNumCores, subWorkers);
    job.post(
      {
        type: 'sensitivity',
        baseParams: jobPayload.baseParams,
        designPoints: jobPayload.designPoints,
        variableDefs: jobPayload.variableDefs,
        baselineRef: jobPayload.meta.baselineRef,
        meta: {
          ...jobPayload.meta,
          startedAt: Date.now(),
        },
        numCores: currentNumCores,
        subWorkerPorts,
      },
      subWorkerPorts,
    );
  } catch (err) {
    setLabLoading(false);
    showAlert(`Could not start Lab run: ${err?.message || err}`, 'SOR Lab');
  }
}
