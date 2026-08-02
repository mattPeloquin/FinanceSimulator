// Shared Withdraw soft-link UI: scenario picker + read-only portfolio preview.

import * as sessions from '../../state/sessions.js';
import { FEATURE_WITHDRAW } from '../../state/storageKeys.js';
import { fromWithdrawScenario } from '../adapters.js';
import { renderPortfolioPreview } from './preview.js';

/**
 * Fill a <select> with saved Withdraw session names.
 * @param {HTMLSelectElement|null} selectEl
 * @param {string} [currentName]
 */
export async function populateWithdrawScenarioSelect(selectEl, currentName = '') {
  if (!selectEl) return;
  let names;
  try {
    const list = await sessions.list(FEATURE_WITHDRAW);
    names = (list || []).map((s) => s.name).filter(Boolean);
  } catch {
    names = [];
  }
  selectEl.innerHTML = '';
  const none = document.createElement('option');
  none.value = '';
  none.textContent = 'Select a saved Withdraw session…';
  selectEl.appendChild(none);
  for (const name of names) {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    selectEl.appendChild(opt);
  }
  if (currentName && !names.includes(currentName)) {
    const missing = document.createElement('option');
    missing.value = currentName;
    missing.textContent = `(missing) ${currentName}`;
    selectEl.appendChild(missing);
  }
  selectEl.value = currentName || '';
}

/**
 * Load a Withdraw session and render its portfolio preview.
 * @param {HTMLElement|null} previewEl
 * @param {string} [sessionName]
 */
export async function refreshLinkedPortfolioPreview(previewEl, sessionName) {
  if (!sessionName) {
    renderPortfolioPreview(previewEl, null);
    return;
  }
  try {
    const loaded = await sessions.load(FEATURE_WITHDRAW, sessionName);
    if (!loaded?.payload) {
      renderPortfolioPreview(previewEl, null);
      return;
    }
    renderPortfolioPreview(previewEl, fromWithdrawScenario(loaded.payload), {
      sessionName,
    });
  } catch {
    renderPortfolioPreview(previewEl, null);
  }
}

/**
 * Toggle link vs local portfolio hosts.
 * @param {{ source: string, linkWrapEl?: HTMLElement|null, localHostEl?: HTMLElement|null }} opts
 */
export function syncPortfolioSourceVisibility({ source, linkWrapEl, localHostEl }) {
  const linkMode = source === 'link';
  linkWrapEl?.classList.toggle('hidden', !linkMode);
  localHostEl?.classList.toggle('hidden', linkMode);
}

/**
 * Remap scenarioRef.name after import dependency renames.
 * @param {object} state
 * @param {Array<{ feature?: string, requestedName?: string, name?: string }>|undefined} renames
 */
export function remapWithdrawScenarioRef(state, renames) {
  if (!state?.scenarioRef?.name || !Array.isArray(renames) || !renames.length) {
    return state;
  }
  const planRenames = renames.filter(
    (r) => (r.feature || FEATURE_WITHDRAW) === FEATURE_WITHDRAW,
  );
  const exact = planRenames.find((r) => r.requestedName === state.scenarioRef.name);
  if (exact) {
    return { ...state, scenarioRef: { ...state.scenarioRef, name: exact.name } };
  }
  if (planRenames.length === 1) {
    return {
      ...state,
      scenarioRef: { ...state.scenarioRef, name: planRenames[0].name },
    };
  }
  return state;
}
