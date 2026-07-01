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

export function saveAutosave(scenario, name = '') {
  try {
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify({ schemaVersion: SCHEMA_VERSION, scenario, name }));
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
      name: parsed.name || ''
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

export async function saveSession(name, scenario) {
  const db = await openDb();
  try {
    await requestToPromise(
      tx(db, 'readwrite').put({ name, scenario, schemaVersion: SCHEMA_VERSION, savedAt: Date.now() })
    );
  } finally {
    db.close();
  }
}

export async function loadSession(name) {
  const db = await openDb();
  try {
    const record = await requestToPromise(tx(db, 'readonly').get(name));
    return record ? migrateScenario(record.scenario, record.schemaVersion ?? 1) : null;
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

// ---- Export / Import (JSON file) --------------------------------------------

export function exportScenario(scenario, name = 'scenario') {
  const payload = {
    type: EXPORT_TYPE,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    name,
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
  if (!parsed || parsed.type !== EXPORT_TYPE || !parsed.scenario) {
    throw new Error('Not a valid simulator scenario file.');
  }
  return {
    scenario: migrateScenario(parsed.scenario, parsed.schemaVersion ?? 1),
    name: parsed.name || '',
  };
}
