// Roth Convert run orchestration via shared jobs + worker dispatcher.

import SimulationWorker from '../../workers/simulation.worker.js?worker&inline';
import * as jobs from '../../state/jobs.js';
import { getActiveFeature } from '../../state/features.js';
import { FEATURE_ROTH_CONVERT } from '../../state/storageKeys.js';
import { showAlert } from '../../ui/dialogs.js';
import { getRothConvertState, setRothConvertResultStale } from './session.js';
import { syncRothConvertFormToState } from './ui/inputs.js';
import { buildRothWorkerPayload } from './params.js';
import {
  paintRothConvertResults,
  setRothConvertLoading,
  updateRothConvertProgress,
} from './ui/results.js';

let pendingResults = null;

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    jobs.cancelAll(FEATURE_ROTH_CONVERT);
  });
}

export function deliverRothConvertResults(payload) {
  if (getActiveFeature()?.id === FEATURE_ROTH_CONVERT) {
    pendingResults = null;
    paintRothConvertResults(payload);
  } else {
    pendingResults = payload;
  }
}

export function flushPendingRothConvertResults() {
  if (!pendingResults) return;
  const payload = pendingResults;
  pendingResults = null;
  setRothConvertLoading(false);
  paintRothConvertResults(payload);
}

export function cancelRothConvertRun() {
  jobs.cancelAll(FEATURE_ROTH_CONVERT);
  pendingResults = null;
  setRothConvertLoading(false);
}

export async function handleRothConvertRunClick() {
  syncRothConvertFormToState();
  const state = getRothConvertState();

  if (!(state.tradBalance > 0) && !(state.rothBalance > 0) && !(state.taxableBalance > 0)) {
    showAlert('Enter at least one account balance to analyze.', 'Roth Convert');
    return;
  }

  let payload;
  try {
    payload = await buildRothWorkerPayload(state);
  } catch (err) {
    showAlert(err?.message || String(err), 'Roth Convert');
    return;
  }

  pendingResults = null;
  setRothConvertResultStale(false);
  setRothConvertLoading(true);
  updateRothConvertProgress(0, 'Starting Roth Convert run');

  try {
    const job = jobs.start(FEATURE_ROTH_CONVERT, {
      createWorker: () => new SimulationWorker(),
      onCleanup: () => {},
      onProgress(fraction, stage) {
        updateRothConvertProgress(fraction, stage);
      },
      onDone(msg) {
        setRothConvertLoading(false);
        try {
          deliverRothConvertResults(msg.result);
        } catch (err) {
          showAlert(`Could not display results: ${err?.message || err}`, 'Roth Convert');
        }
      },
      onError(err) {
        setRothConvertLoading(false);
        pendingResults = null;
        showAlert(`Roth Convert run failed: ${err?.message || err}`, 'Roth Convert');
      },
    });
    job.post(payload);
  } catch (err) {
    setRothConvertLoading(false);
    showAlert(err?.message || String(err), 'Roth Convert');
  }
}
