import './styles.css';
import './ui/theme.js';

import * as sessions from './state/sessions.js';
import { mountFeatureTabs, initFeatures } from './state/features.js';
import { loadAutosave, loadUnsavedStash } from './state/persistence.js';
import {
  FEATURE_WITHDRAW,
  FEATURE_SOR_LAB,
  FEATURE_ACCUMULATION,
  FEATURE_SS_TIMING,
  FEATURE_ROTH_CONVERT,
  FEATURE_HOUSE_EQUITY,
} from './state/storageKeys.js';
import { registerWithdraw } from './features/withdraw/index.js';
import { registerAccumulation } from './features/accumulation/index.js';
import { registerSorLab } from './features/sor-lab/index.js';
import { registerSsTiming } from './features/ss-timing/index.js';
import { registerRothConvert } from './features/roth-convert/index.js';
import { registerHouseEquity } from './features/house-equity/index.js';
import { restoreUnsavedScenario } from './features/withdraw/session.js';
import { initAppAbout } from './ui/appAbout.js';
import {
  seedSessionUi,
  bindSessionChrome,
  setSessionMeta,
  maybeLoadSharedScenarioFromUrl,
  getActiveFeatureId,
  restoreSessionUi,
} from './ui/sessionChrome.js';

// Registration order sets primary tab order: Accumulation | Withdraw | More.
// Default active tab stays Withdraw (fs:app:prefs / DEFAULT_APP_PREFS).
registerAccumulation();
registerWithdraw();
registerSorLab();
registerSsTiming();
registerRothConvert();
registerHouseEquity();

async function init() {
  try {
    if (import.meta.env.DEV) {
      window.__TEST_HOOKS__ = window.__TEST_HOOKS__ || {};
    }

    sessions.discardLegacySessionsDb();

    const autosaved = loadAutosave() || {};
    seedSessionUi({
      [FEATURE_WITHDRAW]: {
        name: autosaved.name || '',
        description: autosaved.description || '',
        lastSelect: autosaved.name || '',
      },
      [FEATURE_ACCUMULATION]: { name: '', description: '', lastSelect: '' },
      [FEATURE_SOR_LAB]: { name: '', description: '', lastSelect: '' },
      [FEATURE_SS_TIMING]: { name: '', description: '', lastSelect: '' },
      [FEATURE_ROTH_CONVERT]: { name: '', description: '', lastSelect: '' },
      [FEATURE_HOUSE_EQUITY]: { name: '', description: '', lastSelect: '' },
    });
    setSessionMeta({
      name: autosaved.name || '',
      description: autosaved.description || '',
      lastSelect: autosaved.name || '',
    });

    mountFeatureTabs(document.getElementById('feature-tabs'));
    await initFeatures({});
    if (getActiveFeatureId() !== FEATURE_WITHDRAW) {
      await restoreSessionUi(getActiveFeatureId());
    }
    initAppAbout();
    bindSessionChrome();

    if (import.meta.env.DEV) {
      window.__TEST_HOOKS__ = window.__TEST_HOOKS__ || {};
      window.__TEST_HOOKS__.initComplete = true;
      window.__TEST_HOOKS__.loadUnsavedStash = loadUnsavedStash;
      window.__TEST_HOOKS__.restoreUnsavedScenario = restoreUnsavedScenario;
    }

    await maybeLoadSharedScenarioFromUrl();
  } catch (err) {
    console.error('Failed to init:', err);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
