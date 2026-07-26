import { getSampleYears, computeProfiles, profilesToScenarioFields } from '../../core/history.js';
import { minAvailableYear, maxAvailableYear } from '../../data/historicalData.js';
import { updateMiniCharts } from './ui/charts/miniCharts.js';
import { renderYearLabels } from './ui/inputs.js';
import { showAlert } from '../../ui/dialogs.js';

export const YEAR_RANGE = { minYear: minAvailableYear, maxYear: maxAvailableYear };

// Mutable store (not `export let` reassignment) so importers always see the
// current sample pool — Vite/bundlers can snapshot live `let` bindings.
let historicalSamples = { years: [] };

/** @returns {{ startYear?: number, endYear?: number, years: object[] }} */
export function getHistoricalSamples() {
  return historicalSamples;
}

// True once the user hand-edits any log-normal profile field. While set, changing
// the year range no longer silently overwrites their numbers (see applyHistoryProfiles).
let profilesEdited = false;

/** @type {(() => void) | null} */
let onAutosave = null;

export function initHistory({ onAutosave: autosaveCb } = {}) {
  onAutosave = autosaveCb || null;
}

export function markProfilesEdited() {
  profilesEdited = true;
}

export function resetProfilesEdited() {
  profilesEdited = false;
}

function scheduleAutosave() {
  onAutosave?.();
}

// ---- History views ----------------------------------------------------------

// Refresh charts + sample pool for the current year range, WITHOUT touching the
// user's log-normal profile fields.
export function refreshHistoryView(startYear, endYear) {
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

/** True when the sample pool has at least one historical year record. */
export function hasHistoricalSamples() {
  return Array.isArray(historicalSamples.years) && historicalSamples.years.length > 0;
}

// Refresh the history view AND overwrite the log-normal profile fields from the
// selected range. `silent` suppresses the invalid-range alert (used while the
// user is still typing a year). `force` overwrites even hand-edited profiles.
export function applyHistoryProfiles({ silent = false, force = false } = {}) {
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
export function scheduleHistoryUpdate() {
  clearTimeout(historyTimer);
  historyTimer = setTimeout(() => applyHistoryProfiles({ silent: true }), 350);
}
