import * as sessions from '../state/sessions.js';
import {
  exportScenario,
  importScenarioFromFile,
  importEnvelopeDependencies,
  buildShareUrl,
  decodeShareParam,
  peekShareParamFromUrl,
  stripShareParamFromUrl,
  ShareUrlTooLargeError,
} from '../state/persistence.js';
import { registerFeatureMigrator } from '../state/migrations.js';
import { readUiPrefsSnapshot } from '../state/uiPrefs.js';
import { applyUiPrefs } from './applyUiPrefs.js';
import { openDialog, showAlert } from './dialogs.js';
import { getActiveFeature, setActiveFeature } from '../state/features.js';
import { FEATURE_WITHDRAW } from '../state/storageKeys.js';

/** @type {Map<string, { name: string, description: string, lastSelect: string }>} */
const sessionUiByFeature = new Map();

let currentSessionName = '';
let currentSessionDescription = '';
let suppressSessionSelect = false;
let lastSessionSelectValue = '';

/** @type {Map<string, SessionAdapter>} */
const sessionAdapters = new Map();

/**
 * @typedef {object} SessionAdapter
 * @property {() => object} getState
 * @property {(state: object) => void} applyState
 * @property {number} [stateVersion]
 * @property {(state: object, fromVersion: number) => object} [migrate]
 * @property {(loaded: object, opts?: object) => Promise<void>} [applyImported]
 * @property {() => void | Promise<void>} [onNewSession]
 * @property {() => void | Promise<void>} [onSelectUnsaved]
 * @property {() => void} [beforeLeavingUnsaved]
 * @property {() => void} [afterPersist]
 * @property {() => void} [afterDeleteCurrent]
 * @property {() => Promise<object[]> | object[]} [getDependencies]
 * @property {(opts?: { sessionName?: string|null }) => object|null|undefined} [getCashflowSeries]
 */

export function registerSessionAdapter(featureId, adapter) {
  sessionAdapters.set(featureId, adapter);
  if (
    typeof adapter?.stateVersion === 'number'
    && typeof adapter?.migrate === 'function'
  ) {
    registerFeatureMigrator({
      id: featureId,
      stateVersion: adapter.stateVersion,
      migrate: adapter.migrate,
    });
  }
}

/**
 * Read-only lookup of a registered session adapter (used by Plan to reach
 * live state / cashflowSeries of other features without importing their modules).
 * @param {string} featureId
 * @returns {SessionAdapter|undefined}
 */
export function getSessionAdapter(featureId) {
  return sessionAdapters.get(featureId);
}

/**
 * Current (or last-snapshotted) session name for a feature.
 * Empty string means the feature's unsaved working state.
 * @param {string} featureId
 * @returns {string}
 */
export function getFeatureSessionName(featureId) {
  if (!featureId) return '';
  if (getActiveFeatureId() === featureId) return currentSessionName || '';
  return sessionUiByFeature.get(featureId)?.name || '';
}

export function getActiveFeatureId() {
  return getActiveFeature()?.id || FEATURE_WITHDRAW;
}

export function getSessionMeta() {
  return {
    name: currentSessionName,
    description: currentSessionDescription,
    lastSelect: lastSessionSelectValue,
  };
}

export function setSessionMeta({ name, description, lastSelect }) {
  if (name !== undefined) currentSessionName = name;
  if (description !== undefined) currentSessionDescription = description;
  if (lastSelect !== undefined) lastSessionSelectValue = lastSelect;
}

export function getSuppressSessionSelect() {
  return suppressSessionSelect;
}

export function setSuppressSessionSelect(value) {
  suppressSessionSelect = value;
}

export function seedSessionUi(byFeature) {
  for (const [featureId, ui] of Object.entries(byFeature)) {
    sessionUiByFeature.set(featureId, { ...ui });
  }
}

export function snapshotSessionUi(featureId) {
  sessionUiByFeature.set(featureId, {
    name: currentSessionName,
    description: currentSessionDescription,
    lastSelect: lastSessionSelectValue,
  });
}

export async function restoreSessionUi(featureId) {
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
  const adapter = sessionAdapters.get(getActiveFeatureId());
  return adapter ? adapter.getState() : {};
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

export function updateSessionNoteDisplay() {
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

export function updateSessionActionButtons() {
  const hasNamedSession = Boolean(currentSessionName);
  for (const id of ['resetSessionButton', 'copySessionButton', 'deleteSessionButton']) {
    const btn = document.getElementById(id);
    if (btn) btn.disabled = !hasNamedSession;
  }
}

export async function refreshSessionList(selectName = currentSessionName) {
  const select = document.getElementById('sessionSelect');
  let listed = [];
  try {
    listed = await sessions.list(getActiveFeatureId());
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

async function resolveDependencies(adapter) {
  if (!adapter?.getDependencies) return [];
  const deps = await adapter.getDependencies();
  return Array.isArray(deps) ? deps : [];
}

function resolveCashflowSeries(adapter, sessionName) {
  if (!adapter?.getCashflowSeries) return null;
  try {
    const series = adapter.getCashflowSeries({ sessionName: sessionName || null });
    return series && typeof series === 'object' ? series : null;
  } catch {
    return null;
  }
}

async function persistSession(name, description, { includeUi = false } = {}) {
  const feature = getActiveFeatureId();
  const adapter = sessionAdapters.get(feature);
  const previousName = currentSessionName;
  if (!previousName) {
    adapter?.beforeLeavingUnsaved?.();
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
  adapter?.afterPersist?.();
  snapshotSessionUi(feature);
}

async function persistCopySession(name, description, { includeUi = false } = {}) {
  const feature = getActiveFeatureId();
  const adapter = sessionAdapters.get(feature);
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
  adapter?.afterPersist?.();
  snapshotSessionUi(feature);
}

/** Ask whether to apply attached view settings. Resolves true = Apply. */
export function promptApplyUiPrefs() {
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

export async function maybeApplyAttachedUi(ui) {
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
  const feature = getActiveFeatureId();
  const adapter = sessionAdapters.get(feature);
  try {
    const loaded = await sessions.load(feature, currentSessionName);
    if (!loaded) {
      showAlert(`Could not find saved session "${currentSessionName}".`);
      return;
    }
    currentSessionDescription = loaded.description || '';
    if (adapter) {
      adapter.applyState(loaded.payload);
      adapter.afterPersist?.();
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
  const feature = getActiveFeatureId();
  const adapter = sessionAdapters.get(feature);
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
  if (adapter?.onNewSession) {
    await adapter.onNewSession();
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
  const feature = getActiveFeatureId();
  const adapter = sessionAdapters.get(feature);

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
        adapter?.afterDeleteCurrent?.();
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
  const feature = getActiveFeatureId();
  const adapter = sessionAdapters.get(feature);
  if (!name) {
    if (adapter?.onSelectUnsaved) {
      await adapter.onSelectUnsaved();
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
  if (lastSessionSelectValue === '') {
    adapter?.beforeLeavingUnsaved?.();
  }
  try {
    const loaded = await sessions.load(feature, name);
    if (!loaded) return;
    currentSessionName = name;
    currentSessionDescription = loaded.description || '';
    if (adapter) {
      adapter.applyState(loaded.payload);
      adapter.afterPersist?.();
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
  const feature = getActiveFeatureId();
  const adapter = sessionAdapters.get(feature);
  const dependencies = await resolveDependencies(adapter);
  const cashflowSeries = resolveCashflowSeries(adapter, currentSessionName);
  exportScenario(
    readActiveFeatureState(),
    currentSessionName || 'scenario',
    currentSessionDescription,
    {
      feature,
      dependencies,
      ...(cashflowSeries ? { cashflowSeries } : {}),
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
  const feature = getActiveFeatureId();
  const adapter = sessionAdapters.get(feature);
  const dependencies = await resolveDependencies(adapter);
  const cashflowSeries = resolveCashflowSeries(adapter, currentSessionName);
  let url;
  try {
    url = await buildShareUrl(readActiveFeatureState(), {
      feature,
      name: currentSessionName || '',
      description: currentSessionDescription || '',
      dependencies,
      ...(cashflowSeries ? { cashflowSeries } : {}),
      ...(includeUi ? { ui: readUiPrefsSnapshot() } : {}),
    });
  } catch (err) {
    if (err instanceof ShareUrlTooLargeError) {
      showAlert(err.message, 'Share link too large');
      return;
    }
    throw err;
  }
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

/** Open a feature-aware envelope: import deps, switch feature, apply state. */
export async function applyImportedEnvelope(loaded, { statusMessage } = {}) {
  const renames = await importEnvelopeDependencies(loaded.dependencies || []);
  if (loaded.feature && loaded.feature !== getActiveFeatureId()) {
    snapshotSessionUi(getActiveFeatureId());
    setActiveFeature(loaded.feature);
    await restoreSessionUi(loaded.feature);
  }
  const feature = loaded.feature || FEATURE_WITHDRAW;
  const adapter = sessionAdapters.get(feature);
  if (adapter?.applyImported) {
    await adapter.applyImported(loaded, { statusMessage, renames });
    return;
  }
  // Fallback when a feature has no custom import hook: clear named session,
  // apply payload through applyState when present, then optional UI prefs.
  currentSessionName = '';
  currentSessionDescription = loaded.description || '';
  if (adapter?.applyState && loaded.state) {
    adapter.applyState(loaded.state);
  }
  updateSessionNoteDisplay();
  updateSessionActionButtons();
  await refreshSessionList('');
  lastSessionSelectValue = '';
  snapshotSessionUi(feature);
  await maybeApplyAttachedUi(loaded.ui);
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
export async function maybeLoadSharedScenarioFromUrl() {
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

export function bindSessionChrome() {
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
}
