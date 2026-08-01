import './styles.css';
import './ui/theme.js';

import * as sessions from './state/sessions.js';
import { mountFeatureTabs, initFeatures } from './state/features.js';
import { loadAutosave, loadUnsavedStash } from './state/persistence.js';
import {
  FEATURE_SOR_PLAN,
  FEATURE_SOR_LAB,
  FEATURE_ACCUMULATION,
  FEATURE_SS_TIMING,
  FEATURE_ROTH_CONVERT,
} from './state/storageKeys.js';
import { registerSorPlan } from './features/sor-plan/index.js';
import { registerAccumulation } from './features/accumulation/index.js';
import { registerSorLab } from './features/sor-lab/index.js';
import { registerSsTiming } from './features/ss-timing/index.js';
import { registerRothConvert } from './features/roth-convert/index.js';
import { restoreUnsavedScenario } from './features/sor-plan/session.js';
import { initAppAbout } from './ui/appAbout.js';
import {
  seedSessionUi,
  bindSessionChrome,
  setSessionMeta,
  maybeLoadSharedScenarioFromUrl,
  getActiveFeatureId,
  restoreSessionUi,
} from './ui/sessionChrome.js';

// Registration order: primary Plan + Accumulation, then More features.
registerSorPlan();
registerAccumulation();
registerSorLab();
registerSsTiming();
registerRothConvert();

async function init() {
  try {
    if (import.meta.env.DEV) {
      window.__TEST_HOOKS__ = window.__TEST_HOOKS__ || {};
    }

    sessions.discardLegacySessionsDb();

    const autosaved = loadAutosave() || {};
    seedSessionUi({
      [FEATURE_SOR_PLAN]: {
        name: autosaved.name || '',
        description: autosaved.description || '',
        lastSelect: autosaved.name || '',
      },
      [FEATURE_ACCUMULATION]: { name: '', description: '', lastSelect: '' },
      [FEATURE_SOR_LAB]: { name: '', description: '', lastSelect: '' },
      [FEATURE_SS_TIMING]: { name: '', description: '', lastSelect: '' },
      [FEATURE_ROTH_CONVERT]: { name: '', description: '', lastSelect: '' },
    });
    setSessionMeta({
      name: autosaved.name || '',
      description: autosaved.description || '',
      lastSelect: autosaved.name || '',
    });

    mountFeatureTabs(document.getElementById('feature-tabs'));
    await initFeatures({});
    if (getActiveFeatureId() !== FEATURE_SOR_PLAN) {
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
