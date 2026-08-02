// Roth Convert feature bootstrap — under More.

import { registerFeature } from '../../state/features.js';
import { FEATURE_ROTH_CONVERT } from '../../state/storageKeys.js';
import { migrateRothConvertState, ROTH_CONVERT_STATE_VERSION } from '../../state/migrations.js';
import {
  registerSessionAdapter,
  restoreSessionUi,
  snapshotSessionUi,
} from '../../ui/sessionChrome.js';
import {
  registerRothConvertUiHooks,
  readRothConvertState,
  applyRothConvertState,
  applyImportedRothConvert,
  resetRothConvertToDefaults,
  getRothConvertState,
  applyRothConvertPreset,
  getRothConvertDependencies,
  getRothConvertCashflowSeries,
} from './session.js';
import { bindRothConvertInputs, renderRothConvertForm } from './ui/inputs.js';
import {
  bindRothConvertResults,
  renderRothConvertCharts,
  clearRothConvertResultsUi,
} from './ui/results.js';
import {
  handleRothConvertRunClick,
  cancelRothConvertRun,
  flushPendingRothConvertResults,
} from './run.js';

async function initRothConvertDom() {
  registerRothConvertUiHooks({
    onStateApplied: () => {
      renderRothConvertForm();
      renderRothConvertCharts();
    },
    onResultsCleared: () => {
      clearRothConvertResultsUi();
    },
  });

  registerSessionAdapter(FEATURE_ROTH_CONVERT, {
    getState: () => readRothConvertState(),
    applyState: (state) => applyRothConvertState(state),
    stateVersion: ROTH_CONVERT_STATE_VERSION,
    migrate: migrateRothConvertState,
    applyImported: (loaded, opts) => applyImportedRothConvert(loaded, opts),
    onNewSession: () => resetRothConvertToDefaults(),
    getDependencies: () => getRothConvertDependencies(),
    getCashflowSeries: ({ sessionName } = {}) => getRothConvertCashflowSeries({ sessionName }),
  });

  bindRothConvertInputs();
  bindRothConvertResults();
  if (getRothConvertState().presetActive) {
    applyRothConvertPreset('fill-22', { keepAttached: true });
  }
  renderRothConvertForm();

  document.getElementById('roth-convert-run')?.addEventListener('click', () => {
    void handleRothConvertRunClick();
  });
  document.getElementById('roth-convert-cancel')?.addEventListener('click', () => {
    cancelRothConvertRun();
  });
}

export function registerRothConvert() {
  registerFeature({
    id: FEATURE_ROTH_CONVERT,
    title: 'Roth Convert',
    rootId: 'feature-roth-convert',
    placement: 'more',
    moreGroup: 'standalone',
    init: initRothConvertDom,
    onActivate() {
      flushPendingRothConvertResults();
      void restoreSessionUi(FEATURE_ROTH_CONVERT);
      renderRothConvertForm();
      renderRothConvertCharts();
    },
    onDeactivate() {
      snapshotSessionUi(FEATURE_ROTH_CONVERT);
    },
  });
}
