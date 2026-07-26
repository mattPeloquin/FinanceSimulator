// Feature registry + tab shell.
// Features register once at boot; the header tab bar is rendered from this list.
// Session/job wiring arrives in Phase 2 — init/onActivate/onDeactivate are
// hooks for that later work.

import { loadAppPrefs, saveAppPrefs } from './appPrefs.js';

/** @typedef {{ busy?: boolean, progress?: number|null }} FeatureBadge */

/**
 * @typedef {object} FeatureDescriptor
 * @property {string} id              kebab-case feature id
 * @property {string} title           tab label
 * @property {string} rootId          DOM id of the feature root element
 * @property {(ctx?: object) => void} [init]
 * @property {() => void} [onActivate]
 * @property {() => void} [onDeactivate]
 */

/** @type {Map<string, FeatureDescriptor>} */
const registry = new Map();

/** @type {Map<string, FeatureBadge>} */
const badges = new Map();

/** @type {string|null} */
let activeFeatureId = null;

/** @type {HTMLElement|null} */
let tabsContainer = null;

/**
 * Register a feature. Ids must be unique kebab-case strings.
 * @param {FeatureDescriptor} feature
 */
export function registerFeature(feature) {
  if (!feature || typeof feature !== 'object') {
    throw new Error('registerFeature requires a feature descriptor');
  }
  const { id, title, rootId } = feature;
  if (!id || typeof id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(id)) {
    throw new Error(`registerFeature: invalid id "${id}"`);
  }
  if (!title || typeof title !== 'string') {
    throw new Error(`registerFeature: feature "${id}" needs a title`);
  }
  if (!rootId || typeof rootId !== 'string') {
    throw new Error(`registerFeature: feature "${id}" needs a rootId`);
  }
  if (registry.has(id)) {
    throw new Error(`registerFeature: duplicate id "${id}"`);
  }
  registry.set(id, {
    id,
    title,
    rootId,
    init: typeof feature.init === 'function' ? feature.init : () => {},
    onActivate: typeof feature.onActivate === 'function' ? feature.onActivate : () => {},
    onDeactivate: typeof feature.onDeactivate === 'function' ? feature.onDeactivate : () => {},
  });
  if (!badges.has(id)) badges.set(id, { busy: false, progress: null });
}

/** @returns {FeatureDescriptor[]} registration order */
export function listFeatures() {
  return [...registry.values()];
}

/** @param {string} id */
export function getFeature(id) {
  return registry.get(id) || null;
}

export function getActiveFeature() {
  return activeFeatureId ? registry.get(activeFeatureId) || null : null;
}

/**
 * Update the busy/progress badge for a feature tab.
 * @param {string} id
 * @param {FeatureBadge} badge
 */
export function setFeatureBadge(id, badge = {}) {
  if (!registry.has(id)) return;
  const prev = badges.get(id) || { busy: false, progress: null };
  const next = {
    busy: badge.busy != null ? !!badge.busy : prev.busy,
    progress:
      badge.progress === undefined
        ? prev.progress
        : badge.progress == null || !Number.isFinite(badge.progress)
          ? null
          : Math.max(0, Math.min(100, Math.round(badge.progress))),
  };
  badges.set(id, next);
  paintTabBadges();
}

/** @param {string} id */
export function getFeatureBadge(id) {
  return badges.get(id) || { busy: false, progress: null };
}

/**
 * Show the given feature root, hide others, persist active tab, fire hooks.
 * @param {string} id
 * @param {{ persist?: boolean }} [opts]
 */
export function setActiveFeature(id, { persist = true } = {}) {
  if (!registry.has(id)) {
    throw new Error(`setActiveFeature: unknown feature "${id}"`);
  }
  if (activeFeatureId === id) {
    syncTabSelection();
    syncFeatureRoots();
    return getActiveFeature();
  }

  const prev = activeFeatureId ? registry.get(activeFeatureId) : null;
  if (prev) {
    try {
      prev.onDeactivate();
    } catch (err) {
      console.error(`onDeactivate failed for ${prev.id}`, err);
    }
  }

  activeFeatureId = id;
  syncFeatureRoots();
  syncTabSelection();

  if (persist) saveAppPrefs({ activeFeature: id });

  const next = registry.get(id);
  try {
    next.onActivate();
  } catch (err) {
    console.error(`onActivate failed for ${id}`, err);
  }
  return next;
}

/**
 * Call each feature's init once. Safe to call after DOM is ready.
 * @param {object} [ctx]
 */
export async function initFeatures(ctx = {}) {
  for (const feature of registry.values()) {
    try {
      await feature.init(ctx);
    } catch (err) {
      console.error(`init failed for ${feature.id}`, err);
    }
  }
}

/**
 * Mount the tab bar into `container` and restore the persisted active feature.
 * @param {HTMLElement|null} container
 */
export function mountFeatureTabs(container) {
  tabsContainer = container || null;
  if (!tabsContainer) return;

  tabsContainer.replaceChildren();
  tabsContainer.setAttribute('role', 'tablist');
  tabsContainer.setAttribute('aria-label', 'Features');
  tabsContainer.classList.add('feature-tab-bar');

  for (const feature of registry.values()) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = `tab-${feature.id}`;
    btn.dataset.featureId = feature.id;
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-controls', feature.rootId);
    btn.className = 'feature-tab';

    const label = document.createElement('span');
    label.className = 'feature-tab-label';
    label.textContent = feature.title;
    btn.appendChild(label);

    const badge = document.createElement('span');
    badge.className = 'feature-tab-badge hidden';
    badge.setAttribute('aria-hidden', 'true');
    btn.appendChild(badge);

    btn.addEventListener('click', () => setActiveFeature(feature.id));
    tabsContainer.appendChild(btn);
  }

  const prefs = loadAppPrefs();
  const preferred =
    prefs.activeFeature && registry.has(prefs.activeFeature)
      ? prefs.activeFeature
      : registry.keys().next().value;
  if (preferred) {
    // First paint: do not re-persist (already loaded from storage).
    activeFeatureId = null;
    setActiveFeature(preferred, { persist: false });
  }
  paintTabBadges();
}

function syncFeatureRoots() {
  for (const feature of registry.values()) {
    const root = document.getElementById(feature.rootId);
    if (!root) continue;
    const active = feature.id === activeFeatureId;
    root.classList.toggle('hidden', !active);
    root.setAttribute('aria-hidden', active ? 'false' : 'true');
  }
}

function syncTabSelection() {
  if (!tabsContainer) return;
  for (const btn of tabsContainer.querySelectorAll('[role="tab"]')) {
    const id = btn.dataset.featureId;
    const selected = id === activeFeatureId;
    btn.setAttribute('aria-selected', selected ? 'true' : 'false');
    btn.tabIndex = selected ? 0 : -1;
  }
}

function paintTabBadges() {
  if (!tabsContainer) return;
  for (const btn of tabsContainer.querySelectorAll('[role="tab"]')) {
    const id = btn.dataset.featureId;
    const badgeEl = btn.querySelector('.feature-tab-badge');
    if (!badgeEl) continue;
    const badge = badges.get(id) || { busy: false, progress: null };
    if (badge.busy) {
      badgeEl.textContent = badge.progress != null ? `${badge.progress}%` : '…';
      badgeEl.classList.remove('hidden');
    } else {
      badgeEl.textContent = '';
      badgeEl.classList.add('hidden');
    }
  }
}

/** Test helper — clear registry/badge state between unit tests. */
export function _resetFeaturesForTests() {
  registry.clear();
  badges.clear();
  activeFeatureId = null;
  tabsContainer = null;
}
