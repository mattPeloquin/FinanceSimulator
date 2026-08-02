// House Equity feature bootstrap — under More.

import { registerFeature } from '../../state/features.js';
import { FEATURE_HOUSE_EQUITY } from '../../state/storageKeys.js';
import { migrateHouseEquityState, HOUSE_EQUITY_STATE_VERSION } from '../../state/migrations.js';
import {
  registerSessionAdapter,
  restoreSessionUi,
  snapshotSessionUi,
} from '../../ui/sessionChrome.js';
import {
  registerHouseEquityUiHooks,
  readHouseEquityState,
  applyHouseEquityState,
  applyImportedHouseEquity,
  resetHouseEquityToDefaults,
  getHouseEquityState,
  applyHouseEquityPreset,
  getHouseEquityDependencies,
  getHouseEquityCashflowSeries,
} from './session.js';
import { bindHouseEquityInputs, renderHouseEquityForm } from './ui/inputs.js';
import {
  bindHouseEquityResults,
  renderHouseEquityCharts,
  clearHouseEquityResultsUi,
} from './ui/results.js';
import {
  handleHouseEquityRunClick,
  cancelHouseEquityRun,
  flushPendingHouseEquityResults,
} from './run.js';

async function initHouseEquityDom() {
  registerHouseEquityUiHooks({
    onStateApplied: () => {
      renderHouseEquityForm();
      renderHouseEquityCharts();
    },
    onResultsCleared: () => {
      clearHouseEquityResultsUi();
    },
  });

  registerSessionAdapter(FEATURE_HOUSE_EQUITY, {
    getState: () => readHouseEquityState(),
    applyState: (state) => applyHouseEquityState(state),
    stateVersion: HOUSE_EQUITY_STATE_VERSION,
    migrate: migrateHouseEquityState,
    applyImported: (loaded, opts) => applyImportedHouseEquity(loaded, opts),
    onNewSession: () => resetHouseEquityToDefaults(),
    getDependencies: () => getHouseEquityDependencies(),
    getCashflowSeries: ({ sessionName } = {}) => getHouseEquityCashflowSeries({ sessionName }),
  });

  bindHouseEquityInputs();
  bindHouseEquityResults();
  if (getHouseEquityState().presetActive) {
    applyHouseEquityPreset('access-now', { keepAttached: true });
  }
  renderHouseEquityForm();

  document.getElementById('house-equity-run')?.addEventListener('click', () => {
    void handleHouseEquityRunClick();
  });
  document.getElementById('house-equity-cancel')?.addEventListener('click', () => {
    cancelHouseEquityRun();
  });
}

export function registerHouseEquity() {
  registerFeature({
    id: FEATURE_HOUSE_EQUITY,
    title: 'House Equity',
    rootId: 'feature-house-equity',
    placement: 'more',
    moreGroup: 'plan-input',
    init: initHouseEquityDom,
    onActivate() {
      flushPendingHouseEquityResults();
      void restoreSessionUi(FEATURE_HOUSE_EQUITY);
      renderHouseEquityForm();
      renderHouseEquityCharts();
    },
    onDeactivate() {
      snapshotSessionUi(FEATURE_HOUSE_EQUITY);
    },
  });
}
