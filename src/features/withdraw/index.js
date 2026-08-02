import { registerFeature } from '../../state/features.js';
import { FEATURE_WITHDRAW } from '../../state/storageKeys.js';
import { loadAutosave } from '../../state/persistence.js';
import {
  writeScenarioToDom,
  defaultScenario,
  readScenarioFromDom,
  SCENARIO_DEFAULTS,
  SCHEMA_VERSION,
} from '../../state/scenario.js';
import { migrateScenario } from '../../state/migrations.js';
import { minAvailableYear, maxAvailableYear, STYLE_INDEX_DATA_FROM_YEAR } from '../../data/historicalData.js';
import {
  setupInputBehaviors,
  setupHistoricalYearRangeInputs,
  toggleDistMethod,
  updateAllocationTotal,
  toggleWithdrawalStrategy,
  toggleDynamicAdjustments,
  toggleFeesTaxes,
  toggleGoalSeekMode,
  syncEarlyWeightPreview,
  syncOnTargetYearlyPreview,
} from './ui/inputs.js';
import { setupRiskPresetControl, syncRiskPresetUi } from './ui/riskPreset.js';
import { setupBalanceLogScaleControl } from './ui/charts/timeline.js';
import { syncSectionSummaries } from './ui/sectionSummaries.js';
import { initReport } from './ui/report.js';
import {
  registerSessionAdapter,
  restoreSessionUi,
  refreshSessionList,
  updateSessionNoteDisplay,
  setSuppressSessionSelect,
  snapshotSessionUi,
  getSessionMeta,
  setSessionMeta,
} from '../../ui/sessionChrome.js';
import {
  initHistory,
  applyHistoryProfiles,
  refreshHistoryView,
  scheduleHistoryUpdate,
  markProfilesEdited,
} from './history.js';
import { handleRunClick, cancelSimulation, flushPendingWithdrawResults } from './run.js';
import {
  applyScenario,
  scheduleAutosave,
  flushAutosave,
  stashUnsavedScenario,
  restoreUnsavedScenario,
  resetUnsavedToDefaults,
  applyImportedScenario,
} from './session.js';
import { mountPortfolioPanel } from '../../portfolio/ui/panel.js';
import { fromWithdrawScenario } from '../../portfolio/adapters.js';
import { listSleeves } from '../../portfolio/registry.js';

function getDefaultCoreUsage() {
  const cores = navigator.hardwareConcurrency || 4;
  if (cores >= 8) return 'high';
  if (cores >= 4) return 'med';
  return 'low';
}

async function initWithdrawDom() {
  initHistory({ onAutosave: scheduleAutosave });

  // Mount shared portfolio panel (registry-generated sleeve rows) before scenario DOM write.
  const autosavedEarly = loadAutosave() || {};
  const initialForMount = {
    ...defaultScenario(),
    parallelCores: getDefaultCoreUsage(),
    ...(autosavedEarly.scenario || {}),
  };
  let portfolioDomReady = false;
  mountPortfolioPanel(document.getElementById('withdraw-portfolio-host'), {
    idPrefix: '',
    wrapAccordion: true,
    showOverTime: true,
    syncSparklines: false,
    getPortfolio: () => fromWithdrawScenario(
      portfolioDomReady ? readScenarioFromDom() : initialForMount,
    ),
    setPortfolio: () => { scheduleAutosave(); },
    onChange: () => { scheduleAutosave(); },
  });

  registerSessionAdapter(FEATURE_WITHDRAW, {
    getState: () => readScenarioFromDom(),
    applyState: (state) => applyScenario(state),
    stateVersion: SCHEMA_VERSION,
    migrate: migrateScenario,
    applyImported: (loaded, opts) => applyImportedScenario(loaded, opts),
    onNewSession: () => resetUnsavedToDefaults(),
    onSelectUnsaved: () => restoreUnsavedScenario(),
    beforeLeavingUnsaved: () => stashUnsavedScenario(),
    afterPersist: () => flushAutosave(),
    afterDeleteCurrent: () => flushAutosave(),
  });

  // Merge over defaults so fields added after an autosave was written (e.g.
  // smoothWindowPct) still get their default instead of rendering blank.
  // Unsupported / malformed autosave returns null → defaults. Missing Easy Mode
  // on a non-empty load is detached in applyScenario.
  const initial = initialForMount;

  writeScenarioToDom(initial);
  portfolioDomReady = true;
  toggleDistMethod(initial.distMethod);
  toggleWithdrawalStrategy(initial.withdrawalStrategy || SCENARIO_DEFAULTS.withdrawalStrategy);
  toggleDynamicAdjustments(initial.enableDynamicAdjustments ?? true);
  toggleFeesTaxes(initial.enableFeesTaxes ?? false);
  toggleGoalSeekMode(initial.goalSeekMode ?? false, { expandSections: false });

  setupInputBehaviors({
    onChange: scheduleAutosave,
    onDistMethodChange: () => {},
  });
  initReport();
  syncEarlyWeightPreview();
  syncOnTargetYearlyPreview();
  setupBalanceLogScaleControl();

  setupRiskPresetControl({ onChange: scheduleAutosave });
  syncRiskPresetUi(initial);
  syncSectionSummaries(initial);

  setupHistoricalYearRangeInputs({
    minYear: minAvailableYear,
    maxYear: maxAvailableYear,
    styleIndexFromYear: STYLE_INDEX_DATA_FROM_YEAR,
    onChange: scheduleHistoryUpdate,
  });

  document.getElementById('runButton').addEventListener('click', handleRunClick);
  document.getElementById('cancelSimulationButton').addEventListener('click', cancelSimulation);

  // Year-range inputs drive the charts + profiles directly (debounced typing).
  document.getElementById('startYear').addEventListener('input', scheduleHistoryUpdate);
  document.getElementById('endYear').addEventListener('input', scheduleHistoryUpdate);

  // Typing in any log-normal profile field marks the profiles as hand-edited.
  document.querySelectorAll('#lognormal-profiles input').forEach((input) => {
    input.addEventListener('input', () => {
      markProfilesEdited();
    });
  });

  updateAllocationTotal();

  // Populate profiles + mini charts on first paint (mirrors original behaviour).
  const hasProfiles = listSleeves().some(
    (s) => initial[s.meanKey] != null && initial[s.meanKey] !== '',
  );
  if (hasProfiles) {
    refreshHistoryView(initial.startYear, initial.endYear);
  } else {
    applyHistoryProfiles();
  }

  await refreshSessionList();
  setSuppressSessionSelect(true);
  try {
    const { name } = getSessionMeta();
    document.getElementById('sessionSelect').value = name || '';
    setSessionMeta({ lastSelect: name || '' });
  } finally {
    setSuppressSessionSelect(false);
  }
  updateSessionNoteDisplay();

  flushAutosave();
}

export function registerWithdraw() {
  registerFeature({
    id: FEATURE_WITHDRAW,
    title: 'Withdraw',
    rootId: 'feature-withdraw',
    placement: 'primary',
    init: initWithdrawDom,
    onActivate() {
      flushPendingWithdrawResults();
      void restoreSessionUi(FEATURE_WITHDRAW);
    },
    onDeactivate() {
      snapshotSessionUi(FEATURE_WITHDRAW);
    },
  });
}
