// Autosave (localStorage) + feature-aware export / import / share links.
// Named sessions live in `sessions.js` (`fs-sessions` IndexedDB).

import { SCHEMA_VERSION } from './scenario.js';
import {
  migrateFeatureState,
  migrateScenario,
  getFeatureStateVersion,
} from './migrations.js';
import {
  loadAccordionState,
  saveAccordionState,
  setAccordionOpen,
  optionalUiFromEnvelope,
} from './uiPrefs.js';
import {
  WITHDRAW_AUTOSAVE_KEY,
  WITHDRAW_UNSAVED_STASH_KEY,
  FEATURE_WITHDRAW,
} from './storageKeys.js';
import * as sessions from './sessions.js';

export { loadAccordionState, saveAccordionState, setAccordionOpen };

const AUTOSAVE_KEY = WITHDRAW_AUTOSAVE_KEY;
const EXPORT_TYPE = 'fs-scenario';
const SHARE_PARAM = 's';

/** Full share URL length ceiling; over this, use Export instead. */
export const SHARE_URL_MAX_LENGTH = 8000;

export class ShareUrlTooLargeError extends Error {
  constructor(length = 0) {
    super('Share link is too large. Use Export instead.');
    this.name = 'ShareUrlTooLargeError';
    this.length = length;
  }
}

// ---- Autosave (localStorage) ------------------------------------------------

export function saveAutosave(scenario, name = '', description = '') {
  try {
    localStorage.setItem(
      AUTOSAVE_KEY,
      JSON.stringify({ stateVersion: SCHEMA_VERSION, scenario, name, description }),
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
      scenario: migrateScenario(parsed.scenario, parsed.stateVersion),
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

const UNSAVED_STASH_KEY = WITHDRAW_UNSAVED_STASH_KEY;

/** Snapshot of the unsaved workbench, kept when switching to a named session. */
export function saveUnsavedStash(scenario) {
  try {
    localStorage.setItem(
      UNSAVED_STASH_KEY,
      JSON.stringify({ stateVersion: SCHEMA_VERSION, scenario }),
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
    return migrateScenario(parsed.scenario, parsed.stateVersion);
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

// ---- Export / Import (JSON file) + share-link encoding -----------------------

/**
 * Normalize a parsed export/share envelope (`fs-scenario` only).
 * @returns {{
 *   feature: string,
 *   state: object,
 *   scenario: object,
 *   name: string,
 *   description: string,
 *   dependencies: Array<{ feature: string, name: string, state: object, stateVersion?: number, description?: string }>,
 *   cashflowSeries?: object,
 *   ui?: object,
 * }}
 */
export function parseScenarioPayload(parsed) {
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Not a valid simulator scenario file.');
  }

  if (parsed.type !== EXPORT_TYPE) {
    throw new Error('Not a valid simulator scenario file.');
  }

  const feature = parsed.feature || FEATURE_WITHDRAW;
  const rawState = parsed.state != null ? parsed.state : parsed.scenario;
  if (rawState == null) {
    throw new Error('Not a valid simulator scenario file.');
  }

  const state = migrateFeatureState(feature, rawState, parsed.stateVersion);

  const dependencies = Array.isArray(parsed.dependencies)
    ? parsed.dependencies
        .filter((d) => d && typeof d === 'object' && d.feature && d.name != null && d.state != null)
        .map((d) => ({
          feature: d.feature,
          name: String(d.name),
          state: migrateFeatureState(d.feature, d.state, d.stateVersion),
          stateVersion: getFeatureStateVersion(d.feature),
          description: d.description || '',
        }))
    : [];

  const out = {
    feature,
    state,
    // Alias for Withdraw callers / older tests.
    scenario: state,
    name: parsed.name || '',
    description: parsed.description || '',
    dependencies,
  };
  // Optional producer attachment — ignored by import until a future consumer lands.
  if (parsed.cashflowSeries && typeof parsed.cashflowSeries === 'object') {
    out.cashflowSeries = parsed.cashflowSeries;
  }
  const ui = optionalUiFromEnvelope(parsed.ui);
  if (ui) out.ui = ui;
  return out;
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

async function gzipBytes(bytes) {
  if (typeof CompressionStream === 'undefined') {
    throw new Error('CompressionStream is not available in this browser.');
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

async function gunzipBytes(bytes) {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('DecompressionStream is not available in this browser.');
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

/**
 * Build a compact fs-scenario envelope for share/export.
 * @param {object} state
 * @param {{
 *   feature?: string,
 *   stateVersion?: number,
 *   name?: string,
 *   description?: string,
 *   ui?: object,
 *   dependencies?: object[],
 *   cashflowSeries?: object,
 *   includeExportedAt?: boolean,
 * }} [meta]
 */
export function buildExportEnvelope(state, meta = {}) {
  const feature = meta.feature || FEATURE_WITHDRAW;
  const stateVersion = meta.stateVersion ?? getFeatureStateVersion(feature);
  const payload = {
    type: EXPORT_TYPE,
    feature,
    stateVersion,
    state,
    dependencies: Array.isArray(meta.dependencies) ? meta.dependencies : [],
  };
  if (meta.includeExportedAt) {
    payload.exportedAt = new Date().toISOString();
  }
  if (meta.name) payload.name = meta.name;
  if (meta.description) payload.description = meta.description;
  if (meta.cashflowSeries && typeof meta.cashflowSeries === 'object') {
    payload.cashflowSeries = meta.cashflowSeries;
  }
  const attached = optionalUiFromEnvelope(meta.ui);
  if (attached) payload.ui = attached;
  return payload;
}

/**
 * Compact JSON envelope → gzip → base64url for the `s` query param.
 * @param {object} state
 * @param {{ feature?: string, name?: string, description?: string, ui?: object, dependencies?: object[] }} [meta]
 */
export async function encodeScenarioToShareParam(state, meta = {}) {
  const payload = buildExportEnvelope(state, { ...meta, includeExportedAt: false });
  const compressed = await gzipBytes(utf8Encode(JSON.stringify(payload)));
  return bytesToBase64Url(compressed);
}

/**
 * Decode a share param.
 * @returns {Promise<
 *   | { status: 'ok', data: ReturnType<typeof parseScenarioPayload> }
 *   | { status: 'legacy' }
 *   | { status: 'invalid', error: Error }
 * >}
 */
export async function decodeShareParam(param) {
  if (!param || typeof param !== 'string') {
    return { status: 'invalid', error: new Error('Not a valid simulator scenario link.') };
  }

  let bytes;
  try {
    bytes = base64UrlToBytes(param);
  } catch {
    return { status: 'invalid', error: new Error('Not a valid simulator scenario link.') };
  }

  let jsonText;
  try {
    jsonText = utf8Decode(await gunzipBytes(bytes));
  } catch {
    // Uncompressed / pre-fs share links are a silent clean break.
    return { status: 'legacy' };
  }

  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return { status: 'invalid', error: new Error('Not a valid simulator scenario link.') };
  }

  if (!parsed || parsed.type !== EXPORT_TYPE) {
    // Compressed but not the new envelope — treat as unusable new-format payload.
    return { status: 'invalid', error: new Error('Not a valid simulator scenario link.') };
  }

  try {
    return { status: 'ok', data: parseScenarioPayload(parsed) };
  } catch (err) {
    return {
      status: 'invalid',
      error: err instanceof Error ? err : new Error('Not a valid simulator scenario link.'),
    };
  }
}

/** @deprecated Prefer decodeShareParam — throws on invalid; returns null for legacy. */
export async function decodeScenarioFromShareParam(param) {
  const result = await decodeShareParam(param);
  if (result.status === 'legacy') return null;
  if (result.status === 'invalid') {
    throw new Error('Not a valid simulator scenario link.');
  }
  return result.data;
}

/** Build a shareable URL with the scenario in query param `s`. */
export async function buildShareUrl(
  state,
  meta = {},
  baseUrl = typeof location !== 'undefined' ? location.href : '',
) {
  const url = new URL(baseUrl);
  url.searchParams.set(SHARE_PARAM, await encodeScenarioToShareParam(state, meta));
  const href = url.toString();
  if (href.length > SHARE_URL_MAX_LENGTH) {
    throw new ShareUrlTooLargeError(href.length);
  }
  return href;
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

export function exportScenario(
  state,
  name = 'scenario',
  description = '',
  { ui, feature = FEATURE_WITHDRAW, dependencies = [], cashflowSeries } = {},
) {
  const payload = buildExportEnvelope(state, {
    feature,
    name,
    description: description || '',
    ui,
    dependencies,
    ...(cashflowSeries ? { cashflowSeries } : {}),
    includeExportedAt: true,
  });
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

/**
 * Import envelope dependencies as named sessions (collision auto-rename).
 * Never overwrites existing sessions.
 */
export async function importEnvelopeDependencies(dependencies = []) {
  const renamed = [];
  for (const dep of dependencies) {
    const requestedName = dep.name;
    const finalName = await sessions.importWithRename(
      dep.feature,
      dep.name,
      dep.state,
      dep.description || '',
    );
    renamed.push({ ...dep, requestedName, name: finalName });
  }
  return renamed;
}
