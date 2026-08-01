// House Equity run orchestration via shared jobs + worker dispatcher.

import SimulationWorker from '../../workers/simulation.worker.js?worker&inline';
import * as jobs from '../../state/jobs.js';
import { getActiveFeature } from '../../state/features.js';
import { FEATURE_HOUSE_EQUITY } from '../../state/storageKeys.js';
import { showAlert } from '../../ui/dialogs.js';
import { getHouseEquityState, setHouseEquityResultStale } from './session.js';
import { syncHouseEquityFormToState } from './ui/inputs.js';
import { buildHouseEquityWorkerPayload } from './params.js';
import {
  paintHouseEquityResults,
  setHouseEquityLoading,
  updateHouseEquityProgress,
} from './ui/results.js';

let pendingResults = null;

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    jobs.cancelAll(FEATURE_HOUSE_EQUITY);
  });
}

export function deliverHouseEquityResults(payload) {
  if (getActiveFeature()?.id === FEATURE_HOUSE_EQUITY) {
    pendingResults = null;
    paintHouseEquityResults(payload);
  } else {
    pendingResults = payload;
  }
}

export function flushPendingHouseEquityResults() {
  if (!pendingResults) return;
  const payload = pendingResults;
  pendingResults = null;
  setHouseEquityLoading(false);
  paintHouseEquityResults(payload);
}

export function cancelHouseEquityRun() {
  jobs.cancelAll(FEATURE_HOUSE_EQUITY);
  pendingResults = null;
  setHouseEquityLoading(false);
}

export async function handleHouseEquityRunClick() {
  syncHouseEquityFormToState();
  const state = getHouseEquityState();

  if (!(state.homeValue > 0)) {
    showAlert('Enter a home value to analyze.', 'House Equity');
    return;
  }

  let payload;
  try {
    payload = await buildHouseEquityWorkerPayload(state);
  } catch (err) {
    showAlert(err?.message || String(err), 'House Equity');
    return;
  }

  pendingResults = null;
  setHouseEquityResultStale(false);
  setHouseEquityLoading(true);
  updateHouseEquityProgress(0, 'Starting House Equity run');

  try {
    const job = jobs.start(FEATURE_HOUSE_EQUITY, {
      createWorker: () => new SimulationWorker(),
      onCleanup: () => {},
      onProgress(fraction, stage) {
        updateHouseEquityProgress(fraction, stage);
      },
      onDone(msg) {
        setHouseEquityLoading(false);
        try {
          deliverHouseEquityResults(msg.result);
        } catch (err) {
          showAlert(`Could not display results: ${err?.message || err}`, 'House Equity');
        }
      },
      onError(err) {
        setHouseEquityLoading(false);
        pendingResults = null;
        showAlert(`House Equity run failed: ${err?.message || err}`, 'House Equity');
      },
    });
    job.post(payload);
  } catch (err) {
    setHouseEquityLoading(false);
    showAlert(err?.message || String(err), 'House Equity');
  }
}
