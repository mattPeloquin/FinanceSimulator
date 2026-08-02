import {
  readScenarioFromDom,
  writeScenarioToDom,
  defaultScenario,
  SCENARIO_DEFAULTS,
} from '../../state/scenario.js';
import {
  saveAutosave,
  saveUnsavedStash,
  loadUnsavedStash,
  clearUnsavedStash,
} from '../../state/persistence.js';
import {
  toggleDistMethod,
  updateAllocationTotal,
  toggleWithdrawalStrategy,
  toggleDynamicAdjustments,
  toggleFeesTaxes,
  toggleGoalSeekMode,
  refreshDynamicAdjustmentPreviews,
  syncEarlyWeightPreview,
  syncOnTargetYearlyPreview,
} from './ui/inputs.js';
import { syncRiskPresetUi } from './ui/riskPreset.js';
import { syncAllocationPreview } from './ui/charts/allocationPreview.js';
import { syncSectionSummaries } from './ui/sectionSummaries.js';
import { listSleeves } from '../../portfolio/registry.js';
import {
  getSessionMeta,
  setSessionMeta,
  setSuppressSessionSelect,
  refreshSessionList,
  updateSessionNoteDisplay,
  updateSessionActionButtons,
  snapshotSessionUi,
  maybeApplyAttachedUi,
} from '../../ui/sessionChrome.js';
import { FEATURE_WITHDRAW } from '../../state/storageKeys.js';
import {
  resetProfilesEdited,
  refreshHistoryView,
  applyHistoryProfiles,
} from './history.js';

let autosaveTimer = null;

export function stashUnsavedScenario() {
  saveUnsavedStash(readScenarioFromDom());
}

export async function restoreUnsavedScenario() {
  const stashed = loadUnsavedStash();
  setSuppressSessionSelect(true);
  try {
    setSessionMeta({ name: '', description: '', lastSelect: '' });
    await refreshSessionList('');
    applyScenario(stashed || {});
    updateSessionNoteDisplay();
    updateSessionActionButtons();
    flushAutosave();
  } finally {
    setSuppressSessionSelect(false);
  }
}

export async function resetUnsavedToDefaults() {
  clearUnsavedStash();
  setSuppressSessionSelect(true);
  try {
    setSessionMeta({ name: '', description: '', lastSelect: '' });
    await refreshSessionList('');
    applyScenario({});
    updateSessionNoteDisplay();
    updateSessionActionButtons();
    flushAutosave();
  } finally {
    setSuppressSessionSelect(false);
  }
}

export function flushAutosave() {
  clearTimeout(autosaveTimer);
  autosaveTimer = null;
  const scenario = readScenarioFromDom();
  const { name, description } = getSessionMeta();
  saveAutosave(scenario, name, description);
  if (!name) {
    saveUnsavedStash(scenario);
  }
  syncSectionSummaries(scenario);
}

export function scheduleAutosave() {
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(flushAutosave, 400);
  syncSectionSummaries();
}

// Apply a full scenario to the DOM and refresh dependent views.
export function applyScenario(scenario) {
  const incoming = scenario || {};
  const merged = { ...defaultScenario(), ...incoming };
  // Incomplete loads that omit Easy Mode must stay detached — otherwise
  // defaultScenario()'s presetActive:true would re-attach and risk overwriting
  // hand-tuned values. Blank new sessions pass {} and keep the default on.
  if (Object.keys(incoming).length > 0 && !Object.hasOwn(incoming, 'presetActive')) {
    merged.presetActive = false;
  }
  // Loading a scenario replaces the profile fields wholesale, so they no longer
  // count as hand-edited.
  resetProfilesEdited();
  writeScenarioToDom(merged);
  toggleDistMethod(merged.distMethod);
  toggleWithdrawalStrategy(merged.withdrawalStrategy || SCENARIO_DEFAULTS.withdrawalStrategy);
  toggleDynamicAdjustments(merged.enableDynamicAdjustments ?? true);
  toggleFeesTaxes(merged.enableFeesTaxes ?? false);
  toggleGoalSeekMode(merged.goalSeekMode ?? false, { expandSections: false });
  refreshDynamicAdjustmentPreviews();
  updateAllocationTotal();
  syncAllocationPreview();
  syncEarlyWeightPreview();
  syncOnTargetYearlyPreview();
  // Reflect the loaded scenario's slider state only — never re-apply the
  // preset patch here; the saved values are the truth.
  syncRiskPresetUi(merged);
  syncSectionSummaries(merged);
  // Refresh charts/samples for the range; keep the scenario's own profiles.
  const firstMean = listSleeves()[0]?.meanKey;
  const hasProfiles = firstMean != null && merged[firstMean] != null && merged[firstMean] !== '';
  if (hasProfiles) {
    refreshHistoryView(merged.startYear, merged.endYear);
  } else {
    applyHistoryProfiles();
  }
  scheduleAutosave();
}

/** Apply an imported/shared Withdraw scenario as an unsaved workbench, then auto-run. */
export async function applyImportedScenario({ scenario, state, name = '', description = '', ui } = {}, { statusMessage } = {}) {
  const planState = scenario || state;
  setSessionMeta({ name: '', description: description || '', lastSelect: '' });
  applyScenario(planState);
  saveUnsavedStash(planState);
  updateSessionNoteDisplay();
  updateSessionActionButtons();
  const msg =
    statusMessage ||
    (name ? `Imported "${name}".` : null);
  if (msg) document.getElementById('historical-range-msg').textContent = msg;
  await refreshSessionList('');
  flushAutosave();
  snapshotSessionUi(FEATURE_WITHDRAW);
  await maybeApplyAttachedUi(ui);
  const { handleRunClick } = await import('./run.js');
  handleRunClick();
}
