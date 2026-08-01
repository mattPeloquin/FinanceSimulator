// Social Security run orchestration via shared jobs + worker dispatcher.

import SimulationWorker from '../../workers/simulation.worker.js?worker&inline';
import * as jobs from '../../state/jobs.js';
import { getActiveFeature } from '../../state/features.js';
import { FEATURE_SS_TIMING } from '../../state/storageKeys.js';
import { showAlert } from '../../ui/dialogs.js';
import { getSsTimingState, setSsTimingResultStale } from './session.js';
import { syncSsTimingFormToState } from './ui/inputs.js';
import { buildSsTimingWorkerPayload } from './params.js';
import {
  paintSsTimingResults,
  setSsTimingLoading,
  updateSsTimingProgress,
} from './ui/results.js';

let pendingResults = null;

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    jobs.cancelAll(FEATURE_SS_TIMING);
  });
}

export function deliverSsTimingResults(payload) {
  if (getActiveFeature()?.id === FEATURE_SS_TIMING) {
    pendingResults = null;
    paintSsTimingResults(payload);
  } else {
    pendingResults = payload;
  }
}

export function flushPendingSsTimingResults() {
  if (!pendingResults) return;
  const payload = pendingResults;
  pendingResults = null;
  setSsTimingLoading(false);
  paintSsTimingResults(payload);
}

export function cancelSsTimingRun() {
  jobs.cancelAll(FEATURE_SS_TIMING);
  pendingResults = null;
  setSsTimingLoading(false);
}

export async function handleSsTimingRunClick() {
  syncSsTimingFormToState();
  const state = getSsTimingState();

  if (!(state.personA?.piaMonthly > 0)) {
    showAlert('Enter a monthly PIA for Person A (or fill the earnings helper).', 'Social Security');
    return;
  }

  let payload;
  try {
    payload = buildSsTimingWorkerPayload(state);
  } catch (err) {
    showAlert(err?.message || String(err), 'Social Security');
    return;
  }

  pendingResults = null;
  setSsTimingResultStale(false);
  setSsTimingLoading(true);
  updateSsTimingProgress(0, 'Starting Social Security run');

  try {
    const job = jobs.start(FEATURE_SS_TIMING, {
      createWorker: () => new SimulationWorker(),
      onCleanup: () => {},
      onProgress(fraction, stage) {
        updateSsTimingProgress(fraction, stage);
      },
      onDone(msg) {
        setSsTimingLoading(false);
        try {
          deliverSsTimingResults(msg.result);
        } catch (err) {
          showAlert(`Could not display results: ${err?.message || err}`, 'Social Security');
        }
      },
      onError(err) {
        setSsTimingLoading(false);
        pendingResults = null;
        showAlert(`Social Security run failed: ${err?.message || err}`, 'Social Security');
      },
    });
    job.post(payload);
  } catch (err) {
    setSsTimingLoading(false);
    showAlert(err?.message || String(err), 'Social Security');
  }
}
