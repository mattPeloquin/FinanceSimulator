// Accumulation feature bootstrap — primary tab.

import { registerFeature } from '../../state/features.js';
import { FEATURE_ACCUMULATION } from '../../state/storageKeys.js';
import { migrateAccumulationState, ACCUMULATION_STATE_VERSION } from '../../state/migrations.js';
import {
  registerSessionAdapter,
  restoreSessionUi,
  snapshotSessionUi,
} from '../../ui/sessionChrome.js';
import {
  registerAccumulationUiHooks,
  readAccumulationState,
  applyAccumulationState,
  applyImportedAccumulation,
  resetAccumulationToDefaults,
  getAccumulationState,
  applyAccumulationPreset,
  getAccumulationCashflowSeries,
} from './session.js';
import { applyAccumulationHistoryProfiles } from './history.js';
import { bindAccumulationInputs, renderAccumulationForm } from './ui/inputs.js';
import {
  bindAccumulationResults,
  renderAccumulationCharts,
  clearAccumulationResultsUi,
} from './ui/results.js';
import {
  handleAccumulationRunClick,
  cancelAccumulationRun,
  flushPendingAccumulationResults,
} from './run.js';

async function initAccumulationDom() {
  registerAccumulationUiHooks({
    onStateApplied: () => {
      renderAccumulationForm();
      renderAccumulationCharts();
    },
    onResultsCleared: () => {
      clearAccumulationResultsUi();
    },
  });

  registerSessionAdapter(FEATURE_ACCUMULATION, {
    getState: () => readAccumulationState(),
    applyState: (state) => applyAccumulationState(state),
    stateVersion: ACCUMULATION_STATE_VERSION,
    migrate: migrateAccumulationState,
    applyImported: (loaded, opts) => applyImportedAccumulation(loaded, opts),
    onNewSession: () => resetAccumulationToDefaults(),
    getCashflowSeries: ({ sessionName } = {}) => getAccumulationCashflowSeries({ sessionName }),
  });

  bindAccumulationInputs();
  bindAccumulationResults();
  applyAccumulationHistoryProfiles({ force: !getAccumulationState().profiles });
  // Seed Easy Mode Steady Saver so the slider description matches the form.
  if (getAccumulationState().presetActive) {
    applyAccumulationPreset('steady-saver', { keepAttached: true });
  }
  renderAccumulationForm();

  document.getElementById('accumulation-run')?.addEventListener('click', () => {
    void handleAccumulationRunClick();
  });
  document.getElementById('accumulation-cancel')?.addEventListener('click', () => {
    cancelAccumulationRun();
  });
}

export function registerAccumulation() {
  registerFeature({
    id: FEATURE_ACCUMULATION,
    title: 'Accumulation',
    rootId: 'feature-accumulation',
    placement: 'primary',
    init: initAccumulationDom,
    onActivate() {
      flushPendingAccumulationResults();
      void restoreSessionUi(FEATURE_ACCUMULATION);
      renderAccumulationForm();
      // Hidden roots size to zero — recreate charts when the tab becomes visible.
      renderAccumulationCharts();
    },
    onDeactivate() {
      snapshotSessionUi(FEATURE_ACCUMULATION);
    },
  });
}
