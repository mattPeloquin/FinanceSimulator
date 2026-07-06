import './styles.css';
import './ui/theme.js';

import SimulationWorker from './workers/simulation.worker.js?worker&inline';

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
} from './state/scenario.js';
import {
  saveAutosave,
  loadAutosave,
  saveUnsavedStash,
  loadUnsavedStash,
  clearUnsavedStash,
  saveSession,
  loadSession,
  deleteSession,
  listSessions,
  exportScenario,
  importScenarioFromFile,
} from './state/persistence.js';
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
  toggleGoalSeekMode,
} from './ui/inputs.js';
import { updateMiniCharts } from './ui/charts/miniCharts.js';
import { renderResults } from './ui/results.js';
import { openDialog, showAlert } from './ui/dialogs.js';

const YEAR_RANGE = { minYear: minAvailableYear, maxYear: maxAvailableYear };

let historicalSamples = { years: [] };
let currentWorker = null;
let currentSessionName = '';
let currentSessionDescription = '';
let suppressSessionSelect = false;
let lastSessionSelectValue = '';

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
  historicalSamples = { years: getSampleYears(startYear, endYear) };
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
  if (bar) bar.style.width = `${pct}%`;
  if (text) text.textContent = stage ? `${stage}… ${pct}%` : `Running simulations… ${pct}%`;
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

  setLoading(true);

  if (currentWorker) currentWorker.terminate();
  currentWorker = new SimulationWorker();
  currentWorker.onmessage = (e) => {
    const msg = e.data;
    if (msg.type === 'progress') {
      updateProgress(msg.fraction);
    } else if (msg.type === 'done') {
      setLoading(false);
      document.getElementById('resultsSection').classList.remove('hidden');
      renderResults(msg.result, params);
      currentWorker.terminate();
      currentWorker = null;
    } else if (msg.type === 'error') {
      setLoading(false);
      showAlert(`Simulation error: ${msg.message}`);
      currentWorker.terminate();
      currentWorker = null;
    }
  };
  currentWorker.onerror = (err) => {
    setLoading(false);
    showAlert(`Worker error: ${err.message}`);
    currentWorker.terminate();
    currentWorker = null;
  };
  currentWorker.postMessage({ type: 'run', params });
}

// Write the base withdrawal (and any levers Goal Seek was allowed to tune)
// back into the form, so the discovered plan is visible and editable like any
// other value once the search finishes.
function applyGoalSeekSummaryToDom(summary) {
  const setCurrencyField = (id, dollars) => {
    const el = document.getElementById(id);
    if (el) el.value = dollars == null ? '' : formatCurrency(dollars / MONEY_SCALE);
  };

  setCurrencyField('baseWithdrawal', summary.baseWithdrawal);

  if (summary.goGoBonus !== undefined) {
    setCurrencyField('goGoBonus', summary.goGoBonus);
  }

  if (summary.marketAdjustments) {
    setCurrencyField('dynLowAdj', summary.marketAdjustments.low);
    setCurrencyField('dynMedAdj', summary.marketAdjustments.med);
    setCurrencyField('dynHighAdj', summary.marketAdjustments.high);
  }

  if (summary.marketBalanceOverrides) {
    setCurrencyField('dynLowBal', summary.marketBalanceOverrides.low);
    setCurrencyField('dynMedBal', summary.marketBalanceOverrides.med);
    setCurrencyField('dynHighBal', summary.marketBalanceOverrides.high);
  }

  if (summary.balanceAdjustment) {
    const { floorBalance, ceilingBalance, floorPenalty, ceilingBonus } = summary.balanceAdjustment;
    setCurrencyField('floorBalance', floorBalance);
    setCurrencyField('ceilingBalance', ceilingBalance);

    const floorPenaltyEl = document.getElementById('floorPenalty');
    if (floorPenaltyEl) floorPenaltyEl.value = Math.round(floorPenalty * 100);
    const ceilingBonusEl = document.getElementById('ceilingBonus');
    if (ceilingBonusEl) ceilingBonusEl.value = Math.round(ceilingBonus * 100);
  }
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

  setLoading(true);

  if (currentWorker) currentWorker.terminate();
  currentWorker = new SimulationWorker();
  currentWorker.onmessage = (e) => {
    const msg = e.data;
    if (msg.type === 'progress') {
      updateProgress(msg.fraction, msg.stage);
    } else if (msg.type === 'done') {
      setLoading(false);
      currentWorker.terminate();
      currentWorker = null;

      if (!msg.goalSeekSummary.feasible) {
        showAlert(msg.goalSeekSummary.reason || 'Goal Seek could not find a plan meeting your target.', 'Goal not reachable');
        return;
      }

      applyGoalSeekSummaryToDom(msg.goalSeekSummary);
      scheduleAutosave();
      document.getElementById('resultsSection').classList.remove('hidden');
      renderResults(msg.result, params, msg.goalSeekSummary);
    } else if (msg.type === 'error') {
      setLoading(false);
      showAlert(`Goal Seek error: ${msg.message}`);
      currentWorker.terminate();
      currentWorker = null;
    }
  };
  currentWorker.onerror = (err) => {
    setLoading(false);
    showAlert(`Worker error: ${err.message}`);
    currentWorker.terminate();
    currentWorker = null;
  };
  currentWorker.postMessage({ type: 'goalSeek', params, goalSeekConfig });
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
  if (currentWorker) {
    currentWorker.terminate();
    currentWorker = null;
  }
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
}

function scheduleAutosave() {
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(flushAutosave, 400);
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
  for (const id of ['copySessionButton', 'deleteSessionButton']) {
    const btn = document.getElementById(id);
    if (btn) btn.disabled = !hasNamedSession;
  }
}

async function refreshSessionList(selectName = currentSessionName) {
  const select = document.getElementById('sessionSelect');
  let sessions = [];
  try {
    sessions = await listSessions();
  } catch {
    /* IndexedDB unavailable — leave the list empty */
  }
  const options = ['<option value="">Unsaved session</option>'];
  for (const s of sessions) {
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

async function persistSession(name, description) {
  const previousName = currentSessionName;
  if (!previousName) {
    stashUnsavedScenario();
  }
  await saveSession(name, readScenarioFromDom(), description);
  if (previousName && previousName !== name) {
    await deleteSession(previousName);
  }
  currentSessionName = name;
  currentSessionDescription = description;
  await refreshSessionList(name);
  updateSessionNoteDisplay();
  lastSessionSelectValue = name;
  flushAutosave();
}

async function persistCopySession(name, description) {
  const existing = await loadSession(name);
  if (existing) {
    showAlert(`A session named "${name}" already exists. Choose a different name.`);
    return;
  }
  await saveSession(name, readScenarioFromDom(), description);
  currentSessionName = name;
  currentSessionDescription = description;
  await refreshSessionList(name);
  updateSessionNoteDisplay();
  lastSessionSelectValue = name;
  flushAutosave();
}

function openSessionDialog(mode) {
  const dialog = document.getElementById('saveSessionDialog');
  const title = document.getElementById('saveSessionDialogTitle');
  const nameInput = document.getElementById('saveSessionName');
  const descInput = document.getElementById('saveSessionDescription');
  const confirmBtn = document.getElementById('confirmSaveSession');
  const isCopy = mode === 'copy';

  title.textContent = isCopy ? 'Copy Session' : 'Save Session';
  confirmBtn.textContent = isCopy ? 'Copy' : 'Save';
  nameInput.value = isCopy ? `Copy of ${currentSessionName}` : (currentSessionName || '');
  descInput.value = currentSessionDescription || '';

  const onConfirm = async () => {
    const name = nameInput.value.trim();
    if (!name) return;
    const description = descInput.value.trim();
    dialog.close();
    try {
      if (isCopy) {
        await persistCopySession(name, description);
      } else {
        await persistSession(name, description);
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

function handleCopySession() {
  if (!currentSessionName) return;
  openSessionDialog('copy');
}

async function handleNewSession() {
  if (currentSessionName) {
    try {
      await saveSession(currentSessionName, readScenarioFromDom(), currentSessionDescription);
    } catch (err) {
      showAlert(`Could not save session before starting new: ${err.message}`);
      return;
    }
  }
  await resetUnsavedToDefaults();
}

function handleDeleteSession() {
  const name = currentSessionName || document.getElementById('sessionSelect').value;
  if (!name) return;

  const dialog = document.getElementById('confirmDeleteDialog');
  document.getElementById('deleteSessionText').textContent = `Are you sure you want to delete session "${name}"?`;

  const onDelete = async () => {
    dialog.close();
    try {
      await deleteSession(name);
      if (currentSessionName === name) {
        currentSessionName = '';
        currentSessionDescription = '';
        updateSessionNoteDisplay();
        flushAutosave();
      }
      await refreshSessionList('');
      lastSessionSelectValue = '';
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
  if (!name) {
    await restoreUnsavedScenario();
    return;
  }
  if (lastSessionSelectValue === '') {
    stashUnsavedScenario();
  }
  try {
    const loaded = await loadSession(name);
    if (!loaded) return;
    currentSessionName = name;
    currentSessionDescription = loaded.description || '';
    applyScenario(loaded.scenario);
    updateSessionNoteDisplay();
    updateSessionActionButtons();
    lastSessionSelectValue = name;
    flushAutosave();
  } catch (err) {
    showAlert(`Could not load session: ${err.message}`);
  }
}

function handleExportSession() {
  exportScenario(
    readScenarioFromDom(),
    currentSessionName || 'scenario',
    currentSessionDescription,
  );
}

async function handleImportFile(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  try {
    const { scenario, name, description } = await importScenarioFromFile(file);
    currentSessionName = '';
    currentSessionDescription = description || '';
    applyScenario(scenario);
    saveUnsavedStash(scenario);
    updateSessionNoteDisplay();
    updateSessionActionButtons();
    if (name) document.getElementById('historical-range-msg').textContent = `Imported "${name}".`;
    await refreshSessionList('');
    lastSessionSelectValue = '';
    flushAutosave();
  } catch (err) {
    showAlert(`Could not import file: ${err.message}`);
  } finally {
    e.target.value = '';
  }
}

// Apply a full scenario to the DOM and refresh dependent views.
function applyScenario(scenario) {
  const merged = { ...defaultScenario(), ...scenario };
  // Loading a scenario replaces the profile fields wholesale, so they no longer
  // count as hand-edited.
  profilesEdited = false;
  writeScenarioToDom(merged);
  toggleDistMethod(merged.distMethod);
  toggleWithdrawalStrategy(merged.withdrawalStrategy || SCENARIO_DEFAULTS.withdrawalStrategy);
  toggleDynamicAdjustments(merged.enableDynamicAdjustments ?? true);
  toggleGoalSeekMode(merged.goalSeekMode ?? false);
  updateAllocationTotal();
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
    // Merge over defaults so fields added after an autosave was written (e.g.
    // smoothWindowPct) still get their default instead of rendering blank.
    const autosaved = loadAutosave() || {};
  const initial = { ...defaultScenario(), ...(autosaved.scenario || {}) };
    currentSessionName = autosaved.name || '';
    currentSessionDescription = autosaved.description || '';
    
    writeScenarioToDom(initial);
    toggleDistMethod(initial.distMethod);
    toggleWithdrawalStrategy(initial.withdrawalStrategy || SCENARIO_DEFAULTS.withdrawalStrategy);
    toggleDynamicAdjustments(initial.enableDynamicAdjustments ?? true);
    toggleGoalSeekMode(initial.goalSeekMode ?? false);

    setupInputBehaviors({
      onChange: scheduleAutosave,
      onDistMethodChange: () => {},
    });

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
    document.getElementById('copySessionButton').addEventListener('click', handleCopySession);
    document.getElementById('deleteSessionButton').addEventListener('click', handleDeleteSession);
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

  if (import.meta.env.DEV) {
    window.__TEST_HOOKS__ = window.__TEST_HOOKS__ || {};
    window.__TEST_HOOKS__.initComplete = true;
    window.__TEST_HOOKS__.loadUnsavedStash = loadUnsavedStash;
    window.__TEST_HOOKS__.restoreUnsavedScenario = restoreUnsavedScenario;
  }
} catch (err) {
    console.error('Failed to init:', err);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
