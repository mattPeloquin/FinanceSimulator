import './styles.css';
import './ui/theme.js';

import * as sessions from './state/sessions.js';
import { mountFeatureTabs, initFeatures } from './state/features.js';
import { loadAutosave, loadUnsavedStash } from './state/persistence.js';
import {
  FEATURE_WITHDRAW,
  FEATURE_SOR_LAB,
  FEATURE_ACCUMULATE,
  FEATURE_SS_TIMING,
  FEATURE_ROTH_CONVERT,
  FEATURE_HOUSE_EQUITY,
  FEATURE_PLAN,
} from './state/storageKeys.js';
import { registerWithdraw } from './features/withdraw/index.js';
import { registerAccumulate } from './features/accumulate/index.js';
import { registerSorLab } from './features/sor-lab/index.js';
import { registerSsTiming } from './features/ss-timing/index.js';
import { registerRothConvert } from './features/roth-convert/index.js';
import { registerHouseEquity } from './features/house-equity/index.js';
import { registerPlan } from './features/plan/index.js';
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

// Registration order sets primary tab order and More menu order.
// Primary: Accumulate | Withdraw.
// More: Lifetime Plan → Plan inputs (SS, House Equity) → Standalone (Roth, SOR Lab).
// Default active tab stays Withdraw (fs:app:prefs / DEFAULT_APP_PREFS).
registerAccumulate();
registerWithdraw();
registerPlan();
registerSsTiming();
registerHouseEquity();
registerRothConvert();
registerSorLab();

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
      [FEATURE_ACCUMULATE]: { name: '', description: '', lastSelect: '' },
      [FEATURE_SOR_LAB]: { name: '', description: '', lastSelect: '' },
      [FEATURE_SS_TIMING]: { name: '', description: '', lastSelect: '' },
      [FEATURE_ROTH_CONVERT]: { name: '', description: '', lastSelect: '' },
      [FEATURE_HOUSE_EQUITY]: { name: '', description: '', lastSelect: '' },
      [FEATURE_PLAN]: { name: '', description: '', lastSelect: '' },
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
