import './styles.css';

import SimulationWorker from './workers/simulation.worker.js?worker&inline';

import {
  readScenarioFromDom,
  writeScenarioToDom,
  defaultScenario,
  buildSimParams,
  validateScenario,
} from './state/scenario.js';
import {
  saveAutosave,
  loadAutosave,
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
import { minAvailableYear, maxAvailableYear } from './data/historicalData.js';
import {
  setupInputBehaviors,
  toggleDistMethod,
  updateAllocationTotal,
  renderYearLabels,
} from './ui/inputs.js';
import { updateMiniCharts } from './ui/charts/miniCharts.js';
import { renderResults } from './ui/results.js';

const YEAR_RANGE = { minYear: minAvailableYear, maxYear: maxAvailableYear };

let historicalSamples = { years: [] };
let currentWorker = null;
let currentSessionName = '';

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
// user is still typing a year).
function applyHistoryProfiles({ silent = false } = {}) {
  const startYear = parseInt(document.getElementById('startYear').value, 10);
  const endYear = parseInt(document.getElementById('endYear').value, 10);
  if (!refreshHistoryView(startYear, endYear)) {
    if (!silent) {
      alert(`Please enter a valid year range between ${YEAR_RANGE.minYear} and ${YEAR_RANGE.maxYear}.`);
    }
    return;
  }
  const records = historicalSamples.years;
  if (records.length === 0) return;

  const fields = profilesToScenarioFields(computeProfiles(records));
  for (const [key, value] of Object.entries(fields)) {
    const el = document.getElementById(key);
    if (el) el.value = value;
  }
  document.getElementById('historical-range-msg').textContent =
    `Profiles updated based on ${records.length} years of data.`;
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

function updateProgress(fraction) {
  const bar = document.getElementById('progressBar');
  const text = document.getElementById('loadingText');
  const pct = Math.round(fraction * 100);
  if (bar) bar.style.width = `${pct}%`;
  if (text) text.textContent = `Running simulations… ${pct}%`;
}

function runSimulation() {
  const scenario = readScenarioFromDom();
  const errors = validateScenario(scenario, YEAR_RANGE);
  if (errors.length) {
    alert(errors.join('\n'));
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
      renderResults(msg.result);
      currentWorker.terminate();
      currentWorker = null;
    } else if (msg.type === 'error') {
      setLoading(false);
      alert(`Simulation error: ${msg.message}`);
      currentWorker.terminate();
      currentWorker = null;
    }
  };
  currentWorker.onerror = (err) => {
    setLoading(false);
    alert(`Worker error: ${err.message}`);
  };
  currentWorker.postMessage({ type: 'run', params });
}

// ---- Persistence: autosave + named sessions ---------------------------------

let autosaveTimer = null;
function scheduleAutosave() {
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => saveAutosave(readScenarioFromDom()), 400);
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
  select.innerHTML = options.join('');
  select.value = selectName || '';
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

async function handleSaveSession() {
  const suggested = currentSessionName || '';
  const name = (window.prompt('Save session as:', suggested) || '').trim();
  if (!name) return;
  try {
    await saveSession(name, readScenarioFromDom());
    currentSessionName = name;
    await refreshSessionList(name);
  } catch (err) {
    alert(`Could not save session: ${err.message}`);
  }
}

async function handleDeleteSession() {
  const select = document.getElementById('sessionSelect');
  const name = select.value;
  if (!name) return;
  if (!window.confirm(`Delete session "${name}"?`)) return;
  try {
    await deleteSession(name);
    if (currentSessionName === name) currentSessionName = '';
    await refreshSessionList('');
  } catch (err) {
    alert(`Could not delete session: ${err.message}`);
  }
}

async function handleSelectSession(e) {
  const name = e.target.value;
  if (!name) {
    currentSessionName = '';
    return;
  }
  try {
    const scenario = await loadSession(name);
    if (!scenario) return;
    applyScenario(scenario);
    currentSessionName = name;
  } catch (err) {
    alert(`Could not load session: ${err.message}`);
  }
}

function handleExportSession() {
  exportScenario(readScenarioFromDom(), currentSessionName || 'scenario');
}

async function handleImportFile(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  try {
    const { scenario, name } = await importScenarioFromFile(file);
    applyScenario(scenario);
    currentSessionName = '';
    if (name) document.getElementById('historical-range-msg').textContent = `Imported "${name}".`;
    await refreshSessionList('');
  } catch (err) {
    alert(`Could not import file: ${err.message}`);
  } finally {
    e.target.value = '';
  }
}

// Apply a full scenario to the DOM and refresh dependent views.
function applyScenario(scenario) {
  const merged = { ...defaultScenario(), ...scenario };
  writeScenarioToDom(merged);
  toggleDistMethod(merged.distMethod);
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

function init() {
  const initial = loadAutosave() || defaultScenario();
  writeScenarioToDom(initial);
  toggleDistMethod(initial.distMethod);

  setupInputBehaviors({
    onChange: scheduleAutosave,
    onDistMethodChange: () => {},
  });

  document.getElementById('runButton').addEventListener('click', runSimulation);

  // Year-range inputs drive the charts + profiles directly (debounced typing).
  document.getElementById('startYear').addEventListener('input', scheduleHistoryUpdate);
  document.getElementById('endYear').addEventListener('input', scheduleHistoryUpdate);

  document.getElementById('saveSessionButton').addEventListener('click', handleSaveSession);
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

  refreshSessionList();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
