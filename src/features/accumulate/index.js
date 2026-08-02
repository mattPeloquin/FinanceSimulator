// Accumulate feature bootstrap — primary tab.

import { registerFeature } from '../../state/features.js';
import { FEATURE_ACCUMULATE } from '../../state/storageKeys.js';
import { migrateAccumulateState, ACCUMULATE_STATE_VERSION } from '../../state/migrations.js';
import {
  registerSessionAdapter,
  restoreSessionUi,
  snapshotSessionUi,
} from '../../ui/sessionChrome.js';
import {
  registerAccumulateUiHooks,
  readAccumulateState,
  applyAccumulateState,
  applyImportedAccumulate,
  resetAccumulateToDefaults,
  getAccumulateState,
  applyAccumulatePreset,
  getAccumulateCashflowSeries,
  getAccumulateDependencies,
} from './session.js';
import { applyAccumulateHistoryProfiles } from './history.js';
import { bindAccumulateInputs, renderAccumulateForm } from './ui/inputs.js';
import {
  bindAccumulateResults,
  renderAccumulateCharts,
  clearAccumulateResultsUi,
} from './ui/results.js';
import {
  handleAccumulateRunClick,
  cancelAccumulateRun,
  flushPendingAccumulateResults,
} from './run.js';

async function initAccumulateDom() {
  registerAccumulateUiHooks({
    onStateApplied: () => {
      renderAccumulateForm();
      renderAccumulateCharts();
    },
    onResultsCleared: () => {
      clearAccumulateResultsUi();
    },
  });

  registerSessionAdapter(FEATURE_ACCUMULATE, {
    getState: () => readAccumulateState(),
    applyState: (state) => applyAccumulateState(state),
    stateVersion: ACCUMULATE_STATE_VERSION,
    migrate: migrateAccumulateState,
    applyImported: (loaded, opts) => applyImportedAccumulate(loaded, opts),
    onNewSession: () => resetAccumulateToDefaults(),
    getCashflowSeries: ({ sessionName } = {}) => getAccumulateCashflowSeries({ sessionName }),
    getDependencies: () => getAccumulateDependencies(),
  });

  bindAccumulateInputs();
  bindAccumulateResults();
  applyAccumulateHistoryProfiles({ force: !getAccumulateState().profiles });
  // Seed Easy Mode Steady Saver so the slider description matches the form.
  if (getAccumulateState().presetActive) {
    applyAccumulatePreset('steady-saver', { keepAttached: true });
  }
  renderAccumulateForm();

  document.getElementById('accumulate-run')?.addEventListener('click', () => {
    void handleAccumulateRunClick();
  });
  document.getElementById('accumulate-cancel')?.addEventListener('click', () => {
    cancelAccumulateRun();
  });
}

export function registerAccumulate() {
  registerFeature({
    id: FEATURE_ACCUMULATE,
    title: 'Accumulate',
    rootId: 'feature-accumulate',
    placement: 'primary',
    init: initAccumulateDom,
    onActivate() {
      flushPendingAccumulateResults();
      void restoreSessionUi(FEATURE_ACCUMULATE);
      renderAccumulateForm();
      // Hidden roots size to zero — recreate charts when the tab becomes visible.
      renderAccumulateCharts();
    },
    onDeactivate() {
      snapshotSessionUi(FEATURE_ACCUMULATE);
    },
  });
}
