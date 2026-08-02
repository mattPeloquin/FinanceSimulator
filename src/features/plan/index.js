// Lifetime Plan feature bootstrap — under More.

import { registerFeature } from '../../state/features.js';
import { FEATURE_PLAN } from '../../state/storageKeys.js';
import { migratePlanState, PLAN_STATE_VERSION } from '../../state/migrations.js';
import {
  registerSessionAdapter,
  restoreSessionUi,
  snapshotSessionUi,
} from '../../ui/sessionChrome.js';
import {
  registerPlanUiHooks,
  readPlanState,
  applyPlanState,
  applyImportedPlan,
  resetPlanToDefaults,
  getPlanState,
  applyPlanPreset,
  getPlanDependencies,
  getPlanCashflowSeries,
} from './session.js';
import { bindPlanInputs, renderPlanForm } from './ui/inputs.js';
import {
  bindPlanResults,
  renderPlanCharts,
  clearPlanResultsUi,
} from './ui/results.js';
import {
  handlePlanRunClick,
  cancelPlanRun,
  flushPendingPlanResults,
} from './run.js';

async function initPlanDom() {
  registerPlanUiHooks({
    onStateApplied: () => {
      renderPlanForm();
      renderPlanCharts();
    },
    onResultsCleared: () => {
      clearPlanResultsUi();
    },
  });

  registerSessionAdapter(FEATURE_PLAN, {
    getState: () => readPlanState(),
    applyState: (state) => applyPlanState(state),
    stateVersion: PLAN_STATE_VERSION,
    migrate: migratePlanState,
    applyImported: (loaded, opts) => applyImportedPlan(loaded, opts),
    onNewSession: () => resetPlanToDefaults(),
    getDependencies: () => getPlanDependencies(),
    getCashflowSeries: ({ sessionName } = {}) => getPlanCashflowSeries({ sessionName }),
  });

  bindPlanInputs();
  bindPlanResults();
  if (getPlanState().presetActive) {
    applyPlanPreset('working-years', { keepAttached: true });
  }
  renderPlanForm();

  document.getElementById('plan-run')?.addEventListener('click', () => {
    void handlePlanRunClick();
  });
  document.getElementById('plan-cancel')?.addEventListener('click', () => {
    cancelPlanRun();
  });
}

export function registerPlan() {
  registerFeature({
    id: FEATURE_PLAN,
    title: 'Lifetime Plan',
    rootId: 'feature-plan',
    placement: 'more',
    init: initPlanDom,
    onActivate() {
      flushPendingPlanResults();
      void restoreSessionUi(FEATURE_PLAN);
      renderPlanForm();
      // Hidden roots size to zero — recreate charts when the tab becomes visible.
      renderPlanCharts();
    },
    onDeactivate() {
      snapshotSessionUi(FEATURE_PLAN);
    },
  });
}
