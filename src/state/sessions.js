// Feature-keyed named sessions in IndexedDB (`fs-sessions`).
// Records are keyed by [feature, name]. Clean break from legacy `sor-sessions`.

import { SCHEMA_VERSION, migrateScenario } from './scenario.js';
import { optionalUiFromEnvelope } from './uiPrefs.js';
import { FEATURE_SOR_PLAN } from './storageKeys.js';

const DB_NAME = 'fs-sessions';
const STORE = 'sessions';
const LEGACY_DB_NAME = 'sor-sessions';

/** @type {Promise<void>|null} */
let legacyCleanupPromise = null;

/** Optional test hook — when set, replaces the real IndexedDB open. */
let testOpenDb = null;

/** @param {null|(() => Promise<IDBDatabase>)} opener */
export function _setOpenDbForTests(opener) {
  testOpenDb = opener;
}

/** Best-effort one-time drop of the pre-Phase-2 database. */
export function discardLegacySessionsDb() {
  if (legacyCleanupPromise) return legacyCleanupPromise;
  legacyCleanupPromise = new Promise((resolve) => {
    try {
      if (!('indexedDB' in globalThis) || typeof indexedDB.deleteDatabase !== 'function') {
        resolve();
        return;
      }
      const req = indexedDB.deleteDatabase(LEGACY_DB_NAME);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    } catch {
      resolve();
    }
  });
  return legacyCleanupPromise;
}

function openDb() {
  if (testOpenDb) return testOpenDb();
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in globalThis)) {
      reject(new Error('IndexedDB is not available in this browser.'));
      return;
    }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: ['feature', 'name'] });
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

function migratePayload(feature, payload, schemaVersion) {
  if (feature === FEATURE_SOR_PLAN) {
    return migrateScenario(payload || {}, schemaVersion);
  }
  return payload == null ? {} : payload;
}

/**
 * @param {string} feature
 * @returns {Promise<Array<{ name: string, description: string, updatedAt: number }>>}
 */
export async function list(feature) {
  const db = await openDb();
  try {
    const records = await requestToPromise(tx(db, 'readonly').getAll());
    return records
      .filter((r) => r.feature === feature)
      .map((r) => ({
        name: r.name,
        description: r.description || '',
        updatedAt: r.savedAt || 0,
      }))
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  } finally {
    db.close();
  }
}

/**
 * @param {string} feature
 * @param {string} name
 * @returns {Promise<null|{ payload: object, description: string, ui?: object, updatedAt: number }>}
 */
export async function load(feature, name) {
  const db = await openDb();
  try {
    const record = await requestToPromise(tx(db, 'readonly').get([feature, name]));
    if (!record) return null;
    const out = {
      payload: migratePayload(feature, record.payload, record.schemaVersion),
      description: record.description || '',
      updatedAt: record.savedAt || 0,
    };
    const ui = optionalUiFromEnvelope(record.ui);
    if (ui) out.ui = ui;
    return out;
  } finally {
    db.close();
  }
}

/**
 * @param {string} feature
 * @param {string} name
 * @param {object} payload
 * @param {string} [description]
 * @param {{ ui?: object }} [opts]
 */
export async function save(feature, name, payload, description = '', { ui } = {}) {
  const db = await openDb();
  try {
    const record = {
      feature,
      name,
      payload,
      description: description || '',
      schemaVersion: SCHEMA_VERSION,
      savedAt: Date.now(),
    };
    const attached = optionalUiFromEnvelope(ui);
    if (attached) record.ui = attached;
    await requestToPromise(tx(db, 'readwrite').put(record));
  } finally {
    db.close();
  }
}

/** @param {string} feature @param {string} name */
export async function deleteSession(feature, name) {
  const db = await openDb();
  try {
    await requestToPromise(tx(db, 'readwrite').delete([feature, name]));
  } finally {
    db.close();
  }
}

/**
 * Save under `name`, auto-renaming on collision ("My Plan", "My Plan (2)", …).
 * @returns {Promise<string>} final name used
 */
export async function importWithRename(feature, name, payload, description = '', { ui } = {}) {
  const base = String(name || 'Imported').trim() || 'Imported';
  const existing = await list(feature);
  const taken = new Set(existing.map((s) => s.name));
  let finalName = base;
  if (taken.has(finalName)) {
    let n = 2;
    while (taken.has(`${base} (${n})`)) n += 1;
    finalName = `${base} (${n})`;
  }
  await save(feature, finalName, payload, description, { ui });
  return finalName;
}

/** Test helper — clear the in-memory / IDB store when using the real DB. */
export async function _clearAllForTests() {
  const db = await openDb();
  try {
    await requestToPromise(tx(db, 'readwrite').clear());
  } finally {
    db.close();
  }
}
