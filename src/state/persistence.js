// Session persistence:
//   - autosave of the working scenario to localStorage (instant restore on reload)
//   - named sessions in IndexedDB
//   - JSON export / import for sharing

import { SCHEMA_VERSION, migrateScenario } from './scenario.js';

const AUTOSAVE_KEY = 'sor:autosave';
const DB_NAME = 'sor-sessions';
const STORE = 'sessions';
const EXPORT_TYPE = 'sor-scenario';

// ---- Autosave (localStorage) ------------------------------------------------

export function saveAutosave(scenario, name = '', description = '') {
  try {
    localStorage.setItem(
      AUTOSAVE_KEY,
      JSON.stringify({ schemaVersion: SCHEMA_VERSION, scenario, name, description }),
    );
  } catch {
    /* storage may be unavailable (private mode / quota) — non-fatal */
  }
}

export function loadAutosave() {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.scenario) return null;
    return {
      scenario: migrateScenario(parsed.scenario, parsed.schemaVersion ?? 1),
      name: parsed.name || '',
      description: parsed.description || '',
    };
  } catch {
    return null;
  }
}

export function clearAutosave() {
  try {
    localStorage.removeItem(AUTOSAVE_KEY);
  } catch {
    /* non-fatal */
  }
}

const UNSAVED_STASH_KEY = 'sor:unsaved-stash';

/** Snapshot of the unsaved workbench, kept when switching to a named session. */
export function saveUnsavedStash(scenario) {
  try {
    localStorage.setItem(
      UNSAVED_STASH_KEY,
      JSON.stringify({ schemaVersion: SCHEMA_VERSION, scenario }),
    );
  } catch {
    /* non-fatal */
  }
}

export function loadUnsavedStash() {
  try {
    const raw = localStorage.getItem(UNSAVED_STASH_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.scenario) return null;
    return migrateScenario(parsed.scenario, parsed.schemaVersion ?? 1);
  } catch {
    return null;
  }
}

export function clearUnsavedStash() {
  try {
    localStorage.removeItem(UNSAVED_STASH_KEY);
  } catch {
    /* non-fatal */
  }
}

// ---- Accordion open/closed (UI chrome, not scenario data) --------------------
// Kept in a separate key so expand/collapse survives refresh and is independent
// of autosaved settings, named sessions, and import/export.

const ACCORDION_KEY = 'sor:ui-accordions';

/** @returns {Record<string, boolean>} id → open */
export function loadAccordionState() {
  try {
    const raw = localStorage.getItem(ACCORDION_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out = {};
    for (const [id, open] of Object.entries(parsed)) {
      if (typeof open === 'boolean') out[id] = open;
    }
    return out;
  } catch {
    return {};
  }
}

/** @param {Record<string, boolean>} state */
export function saveAccordionState(state) {
  try {
    localStorage.setItem(ACCORDION_KEY, JSON.stringify(state));
  } catch {
    /* non-fatal */
  }
}

/** Merge one accordion's open flag into the persisted map. */
export function setAccordionOpen(id, open) {
  if (!id) return;
  const state = loadAccordionState();
  state[id] = !!open;
  saveAccordionState(state);
}

// ---- Named sessions (IndexedDB) ---------------------------------------------

function openDb() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in self)) {
      reject(new Error('IndexedDB is not available in this browser.'));
      return;
    }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'name' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(db, mode) {
  return db.transaction(STORE, mode).objectStore(STORE);
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveSession(name, scenario, description = '') {
  const db = await openDb();
  try {
    await requestToPromise(
      tx(db, 'readwrite').put({
        name,
        scenario,
        description: description || '',
        schemaVersion: SCHEMA_VERSION,
        savedAt: Date.now(),
      }),
    );
  } finally {
    db.close();
  }
}

export async function loadSession(name) {
  const db = await openDb();
  try {
    const record = await requestToPromise(tx(db, 'readonly').get(name));
    if (!record) return null;
    return {
      scenario: migrateScenario(record.scenario, record.schemaVersion ?? 1),
      description: record.description || '',
    };
  } finally {
    db.close();
  }
}

export async function deleteSession(name) {
  const db = await openDb();
  try {
    await requestToPromise(tx(db, 'readwrite').delete(name));
  } finally {
    db.close();
  }
}

export async function listSessions() {
  const db = await openDb();
  try {
    const records = await requestToPromise(tx(db, 'readonly').getAll());
    return records
      .map((r) => ({ name: r.name, savedAt: r.savedAt }))
      .sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
  } finally {
    db.close();
  }
}

// ---- Export / Import (JSON file) + share-link encoding -----------------------

const SHARE_PARAM = 's';

/** Validate a parsed export/share envelope and migrate its scenario. */
export function parseScenarioPayload(parsed) {
  if (!parsed || parsed.type !== EXPORT_TYPE || !parsed.scenario) {
    throw new Error('Not a valid simulator scenario file.');
  }
  return {
    scenario: migrateScenario(parsed.scenario, parsed.schemaVersion ?? 1),
    name: parsed.name || '',
    description: parsed.description || '',
  };
}

function bytesToBase64Url(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(param) {
  const padded = param.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (padded.length % 4)) % 4;
  const binary = atob(padded + '='.repeat(padLen));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function utf8Encode(str) {
  return new TextEncoder().encode(str);
}

function utf8Decode(bytes) {
  return new TextDecoder().decode(bytes);
}

/**
 * Compact JSON envelope → base64url (no padding) for the `s` query param.
 * Omits exportedAt; includes name/description only when non-empty.
 */
export function encodeScenarioToShareParam(scenario, { name = '', description = '' } = {}) {
  const payload = {
    type: EXPORT_TYPE,
    schemaVersion: SCHEMA_VERSION,
    scenario,
  };
  if (name) payload.name = name;
  if (description) payload.description = description;
  return bytesToBase64Url(utf8Encode(JSON.stringify(payload)));
}

export function decodeScenarioFromShareParam(param) {
  if (!param || typeof param !== 'string') {
    throw new Error('Not a valid simulator scenario link.');
  }
  let parsed;
  try {
    parsed = JSON.parse(utf8Decode(base64UrlToBytes(param)));
  } catch {
    throw new Error('Not a valid simulator scenario link.');
  }
  try {
    return parseScenarioPayload(parsed);
  } catch {
    throw new Error('Not a valid simulator scenario link.');
  }
}

/** Build a shareable URL with the scenario in query param `s`. */
export function buildShareUrl(scenario, meta = {}, baseUrl = typeof location !== 'undefined' ? location.href : '') {
  const url = new URL(baseUrl);
  url.searchParams.set(SHARE_PARAM, encodeScenarioToShareParam(scenario, meta));
  return url.toString();
}

/** Read and remove `s` from the current location (does not change history). */
export function peekShareParamFromUrl(href = typeof location !== 'undefined' ? location.href : '') {
  const url = new URL(href);
  const param = url.searchParams.get(SHARE_PARAM);
  return param || null;
}

/** Return href with the share param stripped (for history.replaceState). */
export function stripShareParamFromUrl(href = typeof location !== 'undefined' ? location.href : '') {
  const url = new URL(href);
  url.searchParams.delete(SHARE_PARAM);
  return url.pathname + url.search + url.hash;
}

export function exportScenario(scenario, name = 'scenario', description = '') {
  const payload = {
    type: EXPORT_TYPE,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    name,
    description: description || '',
    scenario,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const safeName = String(name).replace(/[^a-z0-9-_]+/gi, '_') || 'scenario';
  a.href = url;
  a.download = `${safeName}.sor.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function importScenarioFromFile(file) {
  const text = await file.text();
  const parsed = JSON.parse(text);
  return parseScenarioPayload(parsed);
}
