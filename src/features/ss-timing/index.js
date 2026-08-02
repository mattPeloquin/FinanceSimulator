// Social Security feature bootstrap — under More.

import { registerFeature } from '../../state/features.js';
import { FEATURE_SS_TIMING } from '../../state/storageKeys.js';
import { migrateSsTimingState, SS_TIMING_STATE_VERSION } from '../../state/migrations.js';
import {
  registerSessionAdapter,
  restoreSessionUi,
  snapshotSessionUi,
} from '../../ui/sessionChrome.js';
import {
  registerSsTimingUiHooks,
  readSsTimingState,
  applySsTimingState,
  applyImportedSsTiming,
  resetSsTimingToDefaults,
  getSsTimingState,
  applySsTimingPreset,
  getSsTimingCashflowSeries,
  getSsTimingDependencies,
} from './session.js';
import { bindSsTimingInputs, renderSsTimingForm } from './ui/inputs.js';
import {
  bindSsTimingResults,
  renderSsTimingCharts,
  clearSsTimingResultsUi,
} from './ui/results.js';
import {
  handleSsTimingRunClick,
  cancelSsTimingRun,
  flushPendingSsTimingResults,
} from './run.js';

async function initSsTimingDom() {
  registerSsTimingUiHooks({
    onStateApplied: () => {
      renderSsTimingForm();
      renderSsTimingCharts();
    },
    onResultsCleared: () => {
      clearSsTimingResultsUi();
    },
  });

  registerSessionAdapter(FEATURE_SS_TIMING, {
    getState: () => readSsTimingState(),
    applyState: (state) => applySsTimingState(state),
    stateVersion: SS_TIMING_STATE_VERSION,
    migrate: migrateSsTimingState,
    applyImported: (loaded, opts) => applyImportedSsTiming(loaded, opts),
    onNewSession: () => resetSsTimingToDefaults(),
    getCashflowSeries: ({ sessionName } = {}) => getSsTimingCashflowSeries({ sessionName }),
    getDependencies: () => getSsTimingDependencies(),
  });

  bindSsTimingInputs();
  bindSsTimingResults();
  if (getSsTimingState().presetActive) {
    applySsTimingPreset('both-delay', { keepAttached: true });
  }
  renderSsTimingForm();

  document.getElementById('ss-timing-run')?.addEventListener('click', () => {
    void handleSsTimingRunClick();
  });
  document.getElementById('ss-timing-cancel')?.addEventListener('click', () => {
    cancelSsTimingRun();
  });
}

export function registerSsTiming() {
  registerFeature({
    id: FEATURE_SS_TIMING,
    title: 'Social Security',
    rootId: 'feature-ss-timing',
    placement: 'more',
    moreGroup: 'plan-input',
    init: initSsTimingDom,
    onActivate() {
      flushPendingSsTimingResults();
      void restoreSessionUi(FEATURE_SS_TIMING);
      renderSsTimingForm();
      renderSsTimingCharts();
    },
    onDeactivate() {
      snapshotSessionUi(FEATURE_SS_TIMING);
    },
  });
}
