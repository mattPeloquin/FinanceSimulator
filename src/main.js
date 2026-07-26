import './styles.css';
import './ui/theme.js';

import SimulationWorker from './workers/simulation.worker.js?worker&inline';
import { resolveNumCores } from './workers/parallelConfig.js';

import {
  readScenarioFromDom,
  writeScenarioToDom,
  defaultScenario,
  buildSimParams,
  buildGoalSeekConfig,
  validateScenario,
  formatCurrency,
  MONEY_SCALE,
  SCENARIO_DEFAULTS,
  writeFirstSpendingTierExtra,
} from './state/scenario.js';
import {
  saveAutosave,
  loadAutosave,
  saveUnsavedStash,
  loadUnsavedStash,
  clearUnsavedStash,
  exportScenario,
  importScenarioFromFile,
  importEnvelopeDependencies,
  buildShareUrl,
  decodeShareParam,
  peekShareParamFromUrl,
  stripShareParamFromUrl,
} from './state/persistence.js';
import * as sessions from './state/sessions.js';
import * as jobs from './state/jobs.js';
import {
  getSampleYears,
  computeProfiles,
  profilesToScenarioFields,
} from './core/history.js';
import { minAvailableYear, maxAvailableYear, STYLE_INDEX_DATA_FROM_YEAR } from './data/historicalData.js';
import {
  setupInputBehaviors,
  setupHistoricalYearRangeInputs,
  toggleDistMethod,
  updateAllocationTotal,
  renderYearLabels,
  toggleWithdrawalStrategy,
  toggleDynamicAdjustments,
  toggleFeesTaxes,
  toggleGoalSeekMode,
  refreshDynamicAdjustmentPreviews,
  syncEarlyWeightPreview,
  syncOnPlanYearlyPreview,
} from './ui/inputs.js';
import { setupRiskPresetControl, syncRiskPresetUi } from './ui/riskPreset.js';
import { updateMiniCharts } from './ui/charts/miniCharts.js';
import { syncAllocationPreview } from './ui/charts/allocationPreview.js';
import { setupBalanceLogScaleControl } from './ui/charts/timeline.js';
import { renderResults } from './ui/results.js';
import { syncSectionSummaries } from './ui/sectionSummaries.js';
import { initReport, onNewRun as onReportNewRun } from './ui/report.js';
import { applyUiPrefs } from './ui/applyUiPrefs.js';
import { readUiPrefsSnapshot } from './state/uiPrefs.js';
import { openDialog, showAlert } from './ui/dialogs.js';
import {
  registerFeature,
  mountFeatureTabs,
  initFeatures,
  getActiveFeature,
  setActiveFeature,
} from './state/features.js';
import { FEATURE_SOR_PLAN, FEATURE_SOR_LAB } from './state/storageKeys.js';

/** Minimal Lab workbench until Phase 4 owns real Lab state. */
const LAB_STUB_STATE = { version: 1 };

/** @type {Map<string, { name: string, description: string, lastSelect: string }>} */
const sessionUiByFeature = new Map();

let currentSessionName = '';
let currentSessionDescription = '';
let suppressSessionSelect = false;
let lastSessionSelectValue = '';

/** Stashed SOR Plan results when a job finishes while another tab is active. */
let pendingSorPlanResults = null;

function activeFeatureId() {
  return getActiveFeature()?.id || FEATURE_SOR_PLAN;
}

function snapshotSessionUi(featureId) {
  sessionUiByFeature.set(featureId, {
    name: currentSessionName,
    description: currentSessionDescription,
    lastSelect: lastSessionSelectValue,
  });
}

async function restoreSessionUi(featureId) {
  const saved = sessionUiByFeature.get(featureId) || {
    name: '',
    description: '',
    lastSelect: '',
  };
  currentSessionName = saved.name;
  currentSessionDescription = saved.description;
  lastSessionSelectValue = saved.lastSelect;
  await refreshSessionList(currentSessionName);
  updateSessionNoteDisplay();
  updateSessionActionButtons();
}

function readActiveFeatureState() {
  return activeFeatureId() === FEATURE_SOR_LAB ? { ...LAB_STUB_STATE } : readScenarioFromDom();
}

function flushPendingSorPlanResults() {
  if (!pendingSorPlanResults) return;
  const payload = pendingSorPlanResults;
  pendingSorPlanResults = null;
  setLoading(false);
  paintSorPlanResults(payload);
}

registerFeature({
  id: FEATURE_SOR_PLAN,
  title: 'SOR Plan',
  rootId: 'feature-sor-plan',
  init() {},
  onActivate() {
    flushPendingSorPlanResults();
    void restoreSessionUi(FEATURE_SOR_PLAN);
  },
  onDeactivate() {
    snapshotSessionUi(FEATURE_SOR_PLAN);
  },
});

registerFeature({
  id: FEATURE_SOR_LAB,
  title: 'SOR Lab',
  rootId: 'feature-sor-lab',
  init() {},
  onActivate() {
    void restoreSessionUi(FEATURE_SOR_LAB);
  },
  onDeactivate() {
    snapshotSessionUi(FEATURE_SOR_LAB);
  },
});

const YEAR_RANGE = { minYear: minAvailableYear, maxYear: maxAvailableYear };

let historicalSamples = { years: [] };
let currentNumCores = 1;

// True once the user hand-edits any log-normal profile field. While set, changing
// the year range no longer silently overwrites their numbers (see applyHistoryProfiles).
let profilesEdited = false;

// ---- History views ----------------------------------------------------------

// Refresh charts + sample pool for the current year range, WITHOUT touching the
// user's log-normal profile fields.
function refreshHistoryView(startYear, endYear) {
  if (
    !Number.isFinite(startYear) ||
    !Number.isFinite(endYear) ||
    startYear > endYear ||
    startYear < YEAR_RANGE.minYear ||
    endYear > YEAR_RANGE.maxYear
  ) {
    return false;
  }
  const years = updateMiniCharts(startYear, endYear);
  renderYearLabels(years);
  historicalSamples = { startYear, endYear, years: getSampleYears(startYear, endYear) };
  return true;
}

// Refresh the history view AND overwrite the log-normal profile fields from the
// selected range. `silent` suppresses the invalid-range alert (used while the
// user is still typing a year). `force` overwrites even hand-edited profiles.
function applyHistoryProfiles({ silent = false, force = false } = {}) {
  const startYear = parseInt(document.getElementById('startYear').value, 10);
  const endYear = parseInt(document.getElementById('endYear').value, 10);
  if (!refreshHistoryView(startYear, endYear)) {
    if (!silent) {
      showAlert(`Please enter a valid year range between ${YEAR_RANGE.minYear} and ${YEAR_RANGE.maxYear}.`);
    }
    return;
  }
  const records = historicalSamples.years;
  if (records.length === 0) return;

  const msg = document.getElementById('historical-range-msg');

  // The user hand-edited the profiles: keep their numbers and offer an explicit
  // overwrite instead of silently clobbering them.
  if (profilesEdited && !force) {
    msg.textContent = 'Your edited profiles were kept. ';
    const overwrite = document.createElement('button');
    overwrite.type = 'button';
    overwrite.className = 'text-theme-accent underline hover:text-theme-accent-text';
    overwrite.textContent = 'Overwrite from history';
    overwrite.addEventListener('click', () => applyHistoryProfiles({ force: true }));
    msg.appendChild(overwrite);
    scheduleAutosave();
    return;
  }

  const fields = profilesToScenarioFields(computeProfiles(records));
  for (const [key, value] of Object.entries(fields)) {
    const el = document.getElementById(key);
    if (el) el.value = value;
  }
  profilesEdited = false;
  msg.textContent = `Profiles updated based on ${records.length} years of data.`;
  scheduleAutosave();
}

// Debounced auto-update so charts/profiles track the year-range inputs as the
// user types, without the now-removed "Update From History" button.
let historyTimer = null;
function scheduleHistoryUpdate() {
  clearTimeout(historyTimer);
  historyTimer = setTimeout(() => applyHistoryProfiles({ silent: true }), 350);
}

// ---- Simulation run ---------------------------------------------------------

function setLoading(isLoading) {
  const loading = document.getElementById('loadingIndicator');
  const results = document.getElementById('resultsSection');
  if (isLoading) {
    results.classList.add('hidden');
    loading.classList.remove('hidden');
    loading.classList.add('flex');
    updateProgress(0);
  } else {
    loading.classList.add('hidden');
    loading.classList.remove('flex');
  }
}

function updateProgress(fraction, stage) {
  const bar = document.getElementById('progressBar');
  const text = document.getElementById('loadingText');
  const pct = Math.round(fraction * 100);
  
  // currentNumCores holds the number of *sub-workers* returned by resolveNumCores.
  // We add 1 for the Master worker thread for the UI display.
  const totalThreads = currentNumCores === 1 && document.getElementById('parallelCores').value === 'low' 
    ? 1 
    : currentNumCores + 1;
    
  const coreLabel = totalThreads === 1 ? '1 core' : `${totalThreads} cores`;
  
  if (bar) bar.style.width = `${pct}%`;
  if (text) {
    const prefix = stage ? `${stage}… ${pct}%` : `Running simulations… ${pct}%`;
    text.textContent = `${prefix} (using ${coreLabel})`;
  }
}

function resolveRunNumCores(scenario) {
  return resolveNumCores(scenario.parallelCores, navigator.hardwareConcurrency);
}

// Drop in-flight workers before Vite replaces this module so ports/threads
// from a previous HMR generation cannot outlive the page logic that owns them.
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    jobs.cancelAll(FEATURE_SOR_PLAN);
  });
}

// Sub-workers must be spawned here on the main thread: a worker created from a
// blob/data URL (single-file build) has a null origin and cannot spawn its own
// sub-workers, e.g. when the app is opened directly from disk (file://).
// Each sub-worker gets one end of a MessageChannel; the other ends are
// transferred to the master worker, which farms chunks out over them.
function spawnSubWorkerPorts(numCores, bucket) {
  const masterPorts = [];
  if (numCores <= 1) return masterPorts;
  for (let i = 0; i < numCores; i++) {
    const subWorker = new SimulationWorker();
    const channel = new MessageChannel();
    subWorker.postMessage({ type: 'connect', port: channel.port1 }, [channel.port1]);
    bucket.push(subWorker);
    masterPorts.push(channel.port2);
  }
  return masterPorts;
}

function paintSorPlanResults(payload) {
  document.getElementById('resultsSection').classList.remove('hidden');

  let reportScenario = payload.reportScenario;
  if (payload.kind === 'goalSeek') {
    applyGoalSeekSummaryToDom(payload.goalSeekSummary, payload.scenario.withdrawalStrategy);
    scheduleAutosave();
    reportScenario = readScenarioFromDom();
  }

  onReportNewRun({
    result: payload.result,
    params: payload.params,
    scenario: reportScenario,
    fourPercentComparison: payload.fourPercentComparison,
    goalSeekWarning: payload.goalSeekWarning ?? null,
  });
  renderResults(payload.result, payload.params, {
    goalSeekWarning: payload.goalSeekWarning,
    fourPercentComparison: payload.fourPercentComparison,
    classicResult: payload.classicResult,
  });
}

/** Deliver results now, or stash until SOR Plan is visible (Chart.js sizing). */
function deliverSorPlanResults(payload) {
  if (getActiveFeature()?.id === FEATURE_SOR_PLAN) {
    pendingSorPlanResults = null;
    paintSorPlanResults(payload);
  } else {
    pendingSorPlanResults = payload;
  }
}

function runSimulation() {
  const scenario = readScenarioFromDom();
  const errors = validateScenario(scenario, YEAR_RANGE);
  if (errors.length) {
    showAlert(errors.join('\n'), 'Please fix these inputs');
    return;
  }

  // Ensure the sample pool matches the current year range.
  refreshHistoryView(scenario.startYear, scenario.endYear);
  const params = buildSimParams(scenario, historicalSamples);
  currentNumCores = resolveRunNumCores(scenario);

  pendingSorPlanResults = null;
  setLoading(true);

  const subWorkers = [];
  const job = jobs.start(FEATURE_SOR_PLAN, {
    createWorker: () => new SimulationWorker(),
    onCleanup: () => {
      for (const w of subWorkers) w.terminate();
      subWorkers.length = 0;
    },
    onProgress(fraction, stage) {
      updateProgress(fraction, stage);
    },
    onDone(msg) {
      setLoading(false);
      const fourPercentComparison = msg.fourPercentComparison ?? null;
      deliverSorPlanResults({
        kind: 'sim',
        result: msg.result,
        params,
        reportScenario: scenario,
        fourPercentComparison,
        classicResult: msg.classicResult,
        goalSeekWarning: null,
      });
    },
    onError(err) {
      setLoading(false);
      showAlert(`Simulation error: ${err.message}`);
    },
  });

  const subWorkerPorts = spawnSubWorkerPorts(currentNumCores, subWorkers);
  job.post(
    { type: 'run', params, numCores: currentNumCores, subWorkerPorts },
    subWorkerPorts,
  );
}

// Write the base withdrawal (and any levers Goal Seek was allowed to tune)
// back into the form, so the discovered plan is visible and editable like any
// other value once the search finishes.
function applyGoalSeekSummaryToDom(summary, strategy) {
  const setCurrencyField = (id, dollars) => {
    const el = document.getElementById(id);
    if (el) el.value = dollars == null ? '' : formatCurrency(dollars / MONEY_SCALE);
  };

  // The base withdrawal field is hidden and unused under a Specific List, so
  // Goal Seek never searches it (see buildGoalSeekConfig) — leave it alone
  // rather than writing back a stray, irrelevant value.
  if (strategy !== 'specific') {
    setCurrencyField('baseWithdrawal', summary.baseWithdrawal);
  }

  if (summary.spendingOverTimeBonus !== undefined) {
    writeFirstSpendingTierExtra(summary.spendingOverTimeBonus);
  }

  // The Expected (med) adjustment is never searched — it is the user's fixed
  // on-plan anchor — so only the tuned Low/High bands are written back.
  // Optional calibration knobs (no-cut balance / max boost drawdown) stay as
  // the user/preset left them.
  if (summary.marketAdjustments) {
    setCurrencyField('dynLowAdj', summary.marketAdjustments.low);
    setCurrencyField('dynHighAdj', summary.marketAdjustments.high);
  }

  // Floor/Ceiling dollars stay Easy Mode / user-owned — Find Best Plan only
  // tunes Max Cut / Boost Rate against those fixed thresholds.
  if (summary.balanceAdjustment) {
    const { floorPenalty, ceilingBonus } = summary.balanceAdjustment;
    const floorPenaltyEl = document.getElementById('floorPenalty');
    if (floorPenaltyEl) floorPenaltyEl.value = Math.round(floorPenalty * 100);
    const ceilingBonusEl = document.getElementById('ceilingBonus');
    if (ceilingBonusEl) ceilingBonusEl.value = Math.round(ceilingBonus * 100);
  }

  if (summary.glideSpendDown) {
    setCurrencyField('glideTarget', summary.glideSpendDown.target);
    const glideFractionEl = document.getElementById('glideFraction');
    if (glideFractionEl) glideFractionEl.value = Math.round(summary.glideSpendDown.fraction * 100);
  }

  refreshDynamicAdjustmentPreviews();
}

function runGoalSeekSearch() {
  const scenario = readScenarioFromDom();
  const errors = validateScenario(scenario, YEAR_RANGE);
  if (errors.length) {
    showAlert(errors.join('\n'), 'Please fix these inputs');
    return;
  }

  refreshHistoryView(scenario.startYear, scenario.endYear);
  const params = buildSimParams(scenario, historicalSamples);
  const goalSeekConfig = buildGoalSeekConfig(scenario);
  currentNumCores = resolveRunNumCores(scenario);

  pendingSorPlanResults = null;
  setLoading(true);

  const subWorkers = [];
  const job = jobs.start(FEATURE_SOR_PLAN, {
    createWorker: () => new SimulationWorker(),
    onCleanup: () => {
      for (const w of subWorkers) w.terminate();
      subWorkers.length = 0;
    },
    onProgress(fraction, stage) {
      updateProgress(fraction, stage);
    },
    onDone(msg) {
      setLoading(false);
      const goalSeekWarning = msg.goalSeekSummary.feasible
        ? null
        : msg.goalSeekSummary.reason || 'Find Best Plan could not find a plan meeting your target.';
      const finalParams = msg.finalParams ?? params;
      const fourPercentComparison = msg.fourPercentComparison ?? null;
      deliverSorPlanResults({
        kind: 'goalSeek',
        goalSeekSummary: msg.goalSeekSummary,
        scenario,
        result: msg.result,
        params: finalParams,
        reportScenario: scenario,
        fourPercentComparison,
        classicResult: msg.classicResult,
        goalSeekWarning,
      });
    },
    onError(err) {
      setLoading(false);
      showAlert(`Find Best Plan error: ${err.message}`);
    },
  });

  const subWorkerPorts = spawnSubWorkerPorts(currentNumCores, subWorkers);
  job.post(
    { type: 'goalSeek', params, goalSeekConfig, numCores: currentNumCores, subWorkerPorts },
    subWorkerPorts,
  );
}

// Fork between a normal simulation and a Goal Seek search based on the mode toggle.
function handleRunClick() {
  const scenario = readScenarioFromDom();
  if (scenario.goalSeekMode) {
    runGoalSeekSearch();
  } else {
    runSimulation();
  }
}

// Stop an in-flight simulation and return the UI to its idle state.
function cancelSimulation() {
  jobs.cancelAll(FEATURE_SOR_PLAN);
  pendingSorPlanResults = null;
  setLoading(false);
}

// ---- Persistence: autosave + named sessions ---------------------------------

let autosaveTimer = null;

function stashUnsavedScenario() {
  saveUnsavedStash(readScenarioFromDom());
}

async function restoreUnsavedScenario() {
  const stashed = loadUnsavedStash();
  suppressSessionSelect = true;
  try {
    currentSessionName = '';
    currentSessionDescription = '';
    await refreshSessionList('');
    applyScenario(stashed || {});
    updateSessionNoteDisplay();
    updateSessionActionButtons();
    lastSessionSelectValue = '';
    flushAutosave();
  } finally {
    suppressSessionSelect = false;
  }
}

async function resetUnsavedToDefaults() {
  clearUnsavedStash();
  suppressSessionSelect = true;
  try {
    currentSessionName = '';
    currentSessionDescription = '';
    await refreshSessionList('');
    applyScenario({});
    updateSessionNoteDisplay();
    updateSessionActionButtons();
    lastSessionSelectValue = '';
    flushAutosave();
  } finally {
    suppressSessionSelect = false;
  }
}
function flushAutosave() {
  clearTimeout(autosaveTimer);
  autosaveTimer = null;
  const scenario = readScenarioFromDom();
  saveAutosave(scenario, currentSessionName, currentSessionDescription);
  if (!currentSessionName) {
    saveUnsavedStash(scenario);
  }
  syncSectionSummaries(scenario);
}

function scheduleAutosave() {
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(flushAutosave, 400);
  syncSectionSummaries();
}

function updateSessionNoteDisplay() {
  const note = document.getElementById('sessionNote');
  if (!note) return;
  const text = currentSessionName && currentSessionDescription.trim()
    ? currentSessionDescription.trim()
    : '';
  if (text) {
    note.textContent = text;
    note.classList.remove('hidden');
  } else {
    note.textContent = '';
    note.classList.add('hidden');
  }
}

function updateSessionActionButtons() {
  const hasNamedSession = Boolean(currentSessionName);
  for (const id of ['resetSessionButton', 'copySessionButton', 'deleteSessionButton']) {
    const btn = document.getElementById(id);
    if (btn) btn.disabled = !hasNamedSession;
  }
}

async function refreshSessionList(selectName = currentSessionName) {
  const select = document.getElementById('sessionSelect');
  let listed = [];
  try {
    listed = await sessions.list(activeFeatureId());
  } catch {
    /* IndexedDB unavailable — leave the list empty */
  }
  const options = ['<option value="">Unsaved session</option>'];
  for (const s of listed) {
    options.push(`<option value="${escapeHtml(s.name)}">${escapeHtml(s.name)}</option>`);
  }
  const wasSuppressed = suppressSessionSelect;
  suppressSessionSelect = true;
  try {
    select.innerHTML = options.join('');
    select.value = selectName || '';
  } finally {
    suppressSessionSelect = wasSuppressed;
  }
  updateSessionActionButtons();
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

async function persistSession(name, description, { includeUi = false } = {}) {
  const feature = activeFeatureId();
  const previousName = currentSessionName;
  if (!previousName && feature === FEATURE_SOR_PLAN) {
    stashUnsavedScenario();
  }
  const opts = includeUi ? { ui: readUiPrefsSnapshot() } : {};
  await sessions.save(feature, name, readActiveFeatureState(), description, opts);
  if (previousName && previousName !== name) {
    await sessions.deleteSession(feature, previousName);
  }
  currentSessionName = name;
  currentSessionDescription = description;
  await refreshSessionList(name);
  updateSessionNoteDisplay();
  lastSessionSelectValue = name;
  if (feature === FEATURE_SOR_PLAN) flushAutosave();
  snapshotSessionUi(feature);
}

async function persistCopySession(name, description, { includeUi = false } = {}) {
  const feature = activeFeatureId();
  const existing = await sessions.load(feature, name);
  if (existing) {
    showAlert(`A session named "${name}" already exists. Choose a different name.`);
    return;
  }
  const opts = includeUi ? { ui: readUiPrefsSnapshot() } : {};
  await sessions.save(feature, name, readActiveFeatureState(), description, opts);
  currentSessionName = name;
  currentSessionDescription = description;
  await refreshSessionList(name);
  updateSessionNoteDisplay();
  lastSessionSelectValue = name;
  if (feature === FEATURE_SOR_PLAN) flushAutosave();
  snapshotSessionUi(feature);
}

/** Ask whether to apply attached view settings. Resolves true = Apply. */
function promptApplyUiPrefs() {
  return new Promise((resolve) => {
    const dialog = document.getElementById('applyUiDialog');
    if (!dialog) {
      resolve(false);
      return;
    }
    openDialog(dialog, [
      {
        el: document.getElementById('applyUiPrefs'),
        event: 'click',
        fn: () => {
          dialog.close();
          resolve(true);
        },
      },
      {
        el: document.getElementById('keepUiMine'),
        event: 'click',
        fn: () => {
          dialog.close();
          resolve(false);
        },
      },
    ]);
  });
}

async function maybeApplyAttachedUi(ui) {
  if (!ui) return;
  const apply = await promptApplyUiPrefs();
  if (apply) applyUiPrefs(ui);
}

/** Export / Link: confirm with optional include-view checkbox (default off). */
function promptIncludeUi(title, body) {
  return new Promise((resolve) => {
    const dialog = document.getElementById('includeUiDialog');
    const titleEl = document.getElementById('includeUiDialogTitle');
    const textEl = document.getElementById('includeUiDialogText');
    const checkbox = document.getElementById('includeUiCheckbox');
    if (!dialog) {
      resolve({ confirmed: false, includeUi: false });
      return;
    }
    if (titleEl) titleEl.textContent = title;
    if (textEl) textEl.textContent = body;
    if (checkbox) checkbox.checked = false;
    openDialog(dialog, [
      {
        el: document.getElementById('confirmIncludeUi'),
        event: 'click',
        fn: () => {
          const includeUi = !!checkbox?.checked;
          dialog.close();
          resolve({ confirmed: true, includeUi });
        },
      },
      {
        el: document.getElementById('cancelIncludeUi'),
        event: 'click',
        fn: () => {
          dialog.close();
          resolve({ confirmed: false, includeUi: false });
        },
      },
    ]);
  });
}

function openSessionDialog(mode) {
  const dialog = document.getElementById('saveSessionDialog');
  const title = document.getElementById('saveSessionDialogTitle');
  const nameInput = document.getElementById('saveSessionName');
  const descInput = document.getElementById('saveSessionDescription');
  const includeUiEl = document.getElementById('saveSessionIncludeUi');
  const confirmBtn = document.getElementById('confirmSaveSession');
  const isCopy = mode === 'copy';

  title.textContent = isCopy ? 'Copy Session' : 'Save Session';
  confirmBtn.textContent = isCopy ? 'Copy' : 'Save';
  nameInput.value = isCopy ? `Copy of ${currentSessionName}` : (currentSessionName || '');
  descInput.value = currentSessionDescription || '';
  if (includeUiEl) includeUiEl.checked = false;

  const onConfirm = async () => {
    const name = nameInput.value.trim();
    if (!name) return;
    const description = descInput.value.trim();
    const includeUi = !!includeUiEl?.checked;
    dialog.close();
    try {
      if (isCopy) {
        await persistCopySession(name, description, { includeUi });
      } else {
        await persistSession(name, description, { includeUi });
      }
    } catch (err) {
      showAlert(`Could not ${isCopy ? 'copy' : 'save'} session: ${err.message}`);
    }
  };

  openDialog(dialog, [
    { el: confirmBtn, event: 'click', fn: onConfirm },
    { el: document.getElementById('cancelSaveSession'), event: 'click', fn: () => dialog.close() },
    { el: nameInput, event: 'keydown', fn: (e) => { if (e.key === 'Enter' && !e.shiftKey) onConfirm(); } },
  ]);
  nameInput.focus();
  nameInput.select();
}

function handleSaveSession() {
  openSessionDialog('save');
}

async function handleResetSession() {
  if (!currentSessionName) return;
  const feature = activeFeatureId();
  try {
    const loaded = await sessions.load(feature, currentSessionName);
    if (!loaded) {
      showAlert(`Could not find saved session "${currentSessionName}".`);
      return;
    }
    currentSessionDescription = loaded.description || '';
    if (feature === FEATURE_SOR_PLAN) {
      applyScenario(loaded.payload);
      flushAutosave();
    }
    updateSessionNoteDisplay();
    await maybeApplyAttachedUi(loaded.ui);
  } catch (err) {
    showAlert(`Could not reset session: ${err.message}`);
  }
}

function handleCopySession() {
  if (!currentSessionName) return;
  openSessionDialog('copy');
}

async function handleNewSession() {
  const feature = activeFeatureId();
  if (currentSessionName) {
    try {
      await sessions.save(
        feature,
        currentSessionName,
        readActiveFeatureState(),
        currentSessionDescription,
      );
    } catch (err) {
      showAlert(`Could not save session before starting new: ${err.message}`);
      return;
    }
  }
  if (feature === FEATURE_SOR_PLAN) {
    await resetUnsavedToDefaults();
  } else {
    currentSessionName = '';
    currentSessionDescription = '';
    await refreshSessionList('');
    updateSessionNoteDisplay();
    updateSessionActionButtons();
    lastSessionSelectValue = '';
    snapshotSessionUi(feature);
  }
}

function handleDeleteSession() {
  const name = currentSessionName || document.getElementById('sessionSelect').value;
  if (!name) return;
  const feature = activeFeatureId();

  const dialog = document.getElementById('confirmDeleteDialog');
  document.getElementById('deleteSessionText').textContent = `Are you sure you want to delete session "${name}"?`;

  const onDelete = async () => {
    dialog.close();
    try {
      await sessions.deleteSession(feature, name);
      if (currentSessionName === name) {
        currentSessionName = '';
        currentSessionDescription = '';
        updateSessionNoteDisplay();
        if (feature === FEATURE_SOR_PLAN) flushAutosave();
      }
      await refreshSessionList('');
      lastSessionSelectValue = '';
      snapshotSessionUi(feature);
    } catch (err) {
      showAlert(`Could not delete session: ${err.message}`);
    }
  };

  openDialog(dialog, [
    { el: document.getElementById('confirmDeleteSession'), event: 'click', fn: onDelete },
    { el: document.getElementById('cancelDeleteSession'), event: 'click', fn: () => dialog.close() },
  ]);
}

async function handleSelectSession(e) {
  if (suppressSessionSelect) return;
  const name = e.target.value;
  const feature = activeFeatureId();
  if (!name) {
    if (feature === FEATURE_SOR_PLAN) {
      await restoreUnsavedScenario();
    } else {
      currentSessionName = '';
      currentSessionDescription = '';
      await refreshSessionList('');
      updateSessionNoteDisplay();
      updateSessionActionButtons();
      lastSessionSelectValue = '';
      snapshotSessionUi(feature);
    }
    return;
  }
  if (lastSessionSelectValue === '' && feature === FEATURE_SOR_PLAN) {
    stashUnsavedScenario();
  }
  try {
    const loaded = await sessions.load(feature, name);
    if (!loaded) return;
    currentSessionName = name;
    currentSessionDescription = loaded.description || '';
    if (feature === FEATURE_SOR_PLAN) {
      applyScenario(loaded.payload);
      flushAutosave();
    }
    updateSessionNoteDisplay();
    updateSessionActionButtons();
    lastSessionSelectValue = name;
    snapshotSessionUi(feature);
    await maybeApplyAttachedUi(loaded.ui);
  } catch (err) {
    showAlert(`Could not load session: ${err.message}`);
  }
}

async function handleExportSession() {
  const { confirmed, includeUi } = await promptIncludeUi(
    'Export scenario',
    'Download a JSON file of this scenario. Optionally attach your current view settings.',
  );
  if (!confirmed) return;
  exportScenario(
    readActiveFeatureState(),
    currentSessionName || 'scenario',
    currentSessionDescription,
    {
      feature: activeFeatureId(),
      ...(includeUi ? { ui: readUiPrefsSnapshot() } : {}),
    },
  );
}

async function handleLinkCopy() {
  const { confirmed, includeUi } = await promptIncludeUi(
    'Copy share link',
    'Copy a link to this scenario. Optionally attach your current view settings so the recipient can match your display.',
  );
  if (!confirmed) return;
  const btn = document.getElementById('linkCopyButton');
  const url = await buildShareUrl(readActiveFeatureState(), {
    feature: activeFeatureId(),
    name: currentSessionName || '',
    description: currentSessionDescription || '',
    ...(includeUi ? { ui: readUiPrefsSnapshot() } : {}),
  });
  try {
    await navigator.clipboard.writeText(url);
    if (btn) {
      const prev = btn.textContent;
      btn.textContent = 'Copied!';
      setTimeout(() => {
        btn.textContent = prev;
      }, 1500);
    }
  } catch {
    showAlert(url, 'Copy this share link');
  }
}

/** Apply an imported/shared SOR Plan scenario as an unsaved workbench, then auto-run. */
async function applyImportedScenario({ scenario, state, name = '', description = '', ui } = {}, { statusMessage } = {}) {
  const planState = scenario || state;
  currentSessionName = '';
  currentSessionDescription = description || '';
  applyScenario(planState);
  saveUnsavedStash(planState);
  updateSessionNoteDisplay();
  updateSessionActionButtons();
  const msg =
    statusMessage ||
    (name ? `Imported "${name}".` : null);
  if (msg) document.getElementById('historical-range-msg').textContent = msg;
  await refreshSessionList('');
  lastSessionSelectValue = '';
  flushAutosave();
  snapshotSessionUi(FEATURE_SOR_PLAN);
  await maybeApplyAttachedUi(ui);
  handleRunClick();
}

/** Open a feature-aware envelope: import deps, switch feature, apply state. */
async function applyImportedEnvelope(loaded, { statusMessage } = {}) {
  await importEnvelopeDependencies(loaded.dependencies || []);
  if (loaded.feature && loaded.feature !== activeFeatureId()) {
    snapshotSessionUi(activeFeatureId());
    setActiveFeature(loaded.feature);
    await restoreSessionUi(loaded.feature);
  }
  if (loaded.feature === FEATURE_SOR_LAB) {
    currentSessionName = '';
    currentSessionDescription = loaded.description || '';
    updateSessionNoteDisplay();
    updateSessionActionButtons();
    await refreshSessionList('');
    lastSessionSelectValue = '';
    snapshotSessionUi(FEATURE_SOR_LAB);
    await maybeApplyAttachedUi(loaded.ui);
    return;
  }
  await applyImportedScenario(loaded, { statusMessage });
}

function stripShareParamFromHistory() {
  const next = stripShareParamFromUrl(window.location.href);
  history.replaceState(null, '', next);
}

async function handleImportFile(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  try {
    const loaded = await importScenarioFromFile(file);
    await applyImportedEnvelope(loaded);
  } catch (err) {
    showAlert(`Could not import file: ${err.message}`);
  } finally {
    e.target.value = '';
  }
}

/**
 * If the URL carries a share param, load it (confirm when a named session is open).
 * Legacy (pre-fs) share links are stripped silently — clean break, no alert.
 * Strips the param and auto-runs only after a successful load.
 */
async function maybeLoadSharedScenarioFromUrl() {
  const param = peekShareParamFromUrl();
  if (!param) return;

  const decoded = await decodeShareParam(param);
  if (decoded.status === 'legacy') {
    stripShareParamFromHistory();
    return;
  }
  if (decoded.status === 'invalid') {
    showAlert(decoded.error?.message || 'Not a valid simulator scenario link.');
    return;
  }

  const loaded = decoded.data;

  const applyShared = async () => {
    stripShareParamFromHistory();
    await applyImportedEnvelope(loaded, {
      statusMessage: loaded.name ? `Loaded shared "${loaded.name}".` : 'Loaded shared scenario.',
    });
  };

  if (!currentSessionName) {
    await applyShared();
    return;
  }

  const dialog = document.getElementById('confirmLoadSharedDialog');
  openDialog(dialog, [
    {
      el: document.getElementById('confirmLoadShared'),
      event: 'click',
      fn: () => {
        dialog.close();
        applyShared();
      },
    },
    {
      el: document.getElementById('cancelLoadShared'),
      event: 'click',
      fn: () => dialog.close(),
    },
  ]);
}

// Apply a full scenario to the DOM and refresh dependent views.
function applyScenario(scenario) {
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
  profilesEdited = false;
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
  syncOnPlanYearlyPreview();
  // Reflect the loaded scenario's slider state only — never re-apply the
  // preset patch here; the saved values are the truth.
  syncRiskPresetUi(merged);
  syncSectionSummaries(merged);
  // Refresh charts/samples for the range; keep the scenario's own profiles.
  const hasProfiles = merged.usLgGrowthMean != null && merged.usLgGrowthMean !== '';
  if (hasProfiles) {
    refreshHistoryView(merged.startYear, merged.endYear);
  } else {
    applyHistoryProfiles();
  }
  scheduleAutosave();
}

// ---- Bootstrap --------------------------------------------------------------

async function init() {
  try {
    if (import.meta.env.DEV) {
      window.__TEST_HOOKS__ = window.__TEST_HOOKS__ || {};
    }

    sessions.discardLegacySessionsDb();

function getDefaultCoreUsage() {
  const cores = navigator.hardwareConcurrency || 4;
  if (cores >= 8) return 'high';
  if (cores >= 4) return 'med';
  return 'low';
}

// Merge over defaults so fields added after an autosave was written (e.g.
// smoothWindowPct) still get their default instead of rendering blank.
// Unsupported / malformed autosave returns null → defaults. Missing Easy Mode
// on a non-empty load is detached in applyScenario.
const autosaved = loadAutosave() || {};
const initial = { ...defaultScenario(), parallelCores: getDefaultCoreUsage(), ...(autosaved.scenario || {}) };
    sessionUiByFeature.set(FEATURE_SOR_PLAN, {
      name: autosaved.name || '',
      description: autosaved.description || '',
      lastSelect: autosaved.name || '',
    });
    sessionUiByFeature.set(FEATURE_SOR_LAB, {
      name: '',
      description: '',
      lastSelect: '',
    });
    // Seed chrome before tabs mount so onActivate restoreSessionUi sees autosave.
    currentSessionName = autosaved.name || '';
    currentSessionDescription = autosaved.description || '';
    lastSessionSelectValue = autosaved.name || '';

    mountFeatureTabs(document.getElementById('feature-tabs'));
    initFeatures({});
    // If Lab was the persisted tab, session chrome should not keep Plan's name.
    if (activeFeatureId() !== FEATURE_SOR_PLAN) {
      await restoreSessionUi(activeFeatureId());
    }
    
    writeScenarioToDom(initial);
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
    syncOnPlanYearlyPreview();
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
        profilesEdited = true;
      });
    });

    document.getElementById('newSessionButton').addEventListener('click', handleNewSession);
    document.getElementById('saveSessionButton').addEventListener('click', handleSaveSession);
    document.getElementById('resetSessionButton').addEventListener('click', handleResetSession);
    document.getElementById('copySessionButton').addEventListener('click', handleCopySession);
    document.getElementById('deleteSessionButton').addEventListener('click', handleDeleteSession);
    document.getElementById('linkCopyButton').addEventListener('click', handleLinkCopy);
    document.getElementById('exportSessionButton').addEventListener('click', handleExportSession);
    document.getElementById('importSessionButton').addEventListener('click', () =>
      document.getElementById('importFileInput').click()
    );
    document.getElementById('importFileInput').addEventListener('change', handleImportFile);
    document.getElementById('sessionSelect').addEventListener('change', handleSelectSession);

    updateAllocationTotal();

  // Populate profiles + mini charts on first paint (mirrors original behaviour).
  const hasProfiles = initial.usLgGrowthMean != null && initial.usLgGrowthMean !== '';
  if (hasProfiles) {
    refreshHistoryView(initial.startYear, initial.endYear);
  } else {
    applyHistoryProfiles();
  }

  await refreshSessionList();
  suppressSessionSelect = true;
  try {
    document.getElementById('sessionSelect').value = currentSessionName || '';
    lastSessionSelectValue = currentSessionName || '';
  } finally {
    suppressSessionSelect = false;
  }
  updateSessionNoteDisplay();

  flushAutosave();

  // Mark ready before share-link prompts (Apply view settings / replace session)
  // so the UI can accept dialog clicks without blocking initComplete.
  if (import.meta.env.DEV) {
    window.__TEST_HOOKS__ = window.__TEST_HOOKS__ || {};
    window.__TEST_HOOKS__.initComplete = true;
    window.__TEST_HOOKS__.loadUnsavedStash = loadUnsavedStash;
    window.__TEST_HOOKS__.restoreUnsavedScenario = restoreUnsavedScenario;
  }

  // Share links apply after first paint / history samples are ready so auto-run
  // matches a user click on Run / Find Best Plan.
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
