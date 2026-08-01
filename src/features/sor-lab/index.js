import { registerFeature } from '../../state/features.js';
import { FEATURE_SOR_LAB } from '../../state/storageKeys.js';
import {
  registerSessionAdapter,
  restoreSessionUi,
  snapshotSessionUi,
} from '../../ui/sessionChrome.js';
import { migrateLabState } from '../../state/migrations.js';
import {
  readLabState,
  applyLabState,
  applyImportedLab,
  resetLabToDefaults,
  getLabDependencies,
  registerLabUiHooks,
  defaultLabConfig,
  LAB_STATE_VERSION,
} from './session.js';
import { handleLabRunClick, cancelLabRun, flushPendingSorLabResults } from './run.js';
import { bindLabConfig, renderLabConfig } from './ui/config.js';
import {
  bindLabResults,
  applyLabViewPrefs,
  clearLabResults,
  renderLabCharts,
} from './ui/results.js';

async function initLabDom() {
  registerLabUiHooks({
    onStateApplied: (config) => {
      void renderLabConfig();
      applyLabViewPrefs(config.view);
    },
    onResultsCleared: () => clearLabResults(),
  });

  registerSessionAdapter(FEATURE_SOR_LAB, {
    getState: () => readLabState(),
    applyState: (state) => applyLabState(state),
    stateVersion: LAB_STATE_VERSION,
    migrate: migrateLabState,
    applyImported: (loaded, opts) => applyImportedLab(loaded, opts),
    onNewSession: () => resetLabToDefaults(),
    getDependencies: () => getLabDependencies(),
  });

  // Start from defaults (or leave whatever applyState set during session restore).
  if (!readLabState().scenarioRef) {
    applyLabState(defaultLabConfig());
  }

  bindLabConfig();
  bindLabResults();
  await renderLabConfig();
  applyLabViewPrefs(readLabState().view);

  document.getElementById('sor-lab-run')?.addEventListener('click', () => {
    void handleLabRunClick();
  });
  document.getElementById('sor-lab-cancel')?.addEventListener('click', cancelLabRun);
}

export function registerSorLab() {
  registerFeature({
    id: FEATURE_SOR_LAB,
    title: 'SOR Lab',
    rootId: 'feature-sor-lab',
    placement: 'more',
    init: initLabDom,
    onActivate() {
      flushPendingSorLabResults();
      void restoreSessionUi(FEATURE_SOR_LAB);
      void renderLabConfig();
      // Resize charts that may have painted while hidden.
      renderLabCharts();
    },
    onDeactivate() {
      snapshotSessionUi(FEATURE_SOR_LAB);
    },
  });
}
