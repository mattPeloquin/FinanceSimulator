// Feature registry + tab shell.
// Features register once at boot; the header tab bar is rendered from this list.
// Primary features are top-level tabs; `more` features live under a More control
// (button + listbox). Busy badges roll up onto More when a menu feature is running.

import { loadAppPrefs, saveAppPrefs, DEFAULT_APP_PREFS } from './appPrefs.js';

/** @typedef {'primary' | 'more'} FeaturePlacement */
/** @typedef {{ busy?: boolean, progress?: number|null }} FeatureBadge */

/**
 * @typedef {object} FeatureDescriptor
 * @property {string} id              kebab-case feature id
 * @property {string} title           tab / menu label
 * @property {string} rootId          DOM id of the feature root element
 * @property {FeaturePlacement} placement
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

/** @type {HTMLElement|null} */
let moreButton = null;

/** @type {HTMLElement|null} */
let moreMenu = null;

/** @type {boolean} */
let moreOpen = false;

/** @type {((e: MouseEvent) => void)|null} */
let outsideClickHandler = null;

/** @type {((e: KeyboardEvent) => void)|null} */
let documentKeyHandler = null;

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
  const placement = feature.placement === 'more' ? 'more' : 'primary';
  registry.set(id, {
    id,
    title,
    rootId,
    placement,
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

/** @param {FeaturePlacement} placement */
export function listFeaturesByPlacement(placement) {
  return listFeatures().filter((f) => f.placement === placement);
}

/** @param {string} id */
export function getFeature(id) {
  return registry.get(id) || null;
}

export function getActiveFeature() {
  return activeFeatureId ? registry.get(activeFeatureId) || null : null;
}

/**
 * Update the busy/progress badge for a feature tab / More item.
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
    syncMoreControl();
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
  syncMoreControl();
  closeMoreMenu({ restoreFocus: false });

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
  teardownMoreListeners();
  tabsContainer = container || null;
  moreButton = null;
  moreMenu = null;
  moreOpen = false;
  if (!tabsContainer) return;

  tabsContainer.replaceChildren();
  tabsContainer.setAttribute('role', 'tablist');
  tabsContainer.setAttribute('aria-label', 'Features');
  tabsContainer.classList.add('feature-tab-bar');

  for (const feature of listFeaturesByPlacement('primary')) {
    tabsContainer.appendChild(createPrimaryTab(feature));
  }
  tabsContainer.appendChild(createMoreControl(listFeaturesByPlacement('more')));

  const prefs = loadAppPrefs();
  // Prefer persisted tab, then the app default (Withdraw), then first registered.
  const preferred =
    prefs.activeFeature && registry.has(prefs.activeFeature)
      ? prefs.activeFeature
      : registry.has(DEFAULT_APP_PREFS.activeFeature)
        ? DEFAULT_APP_PREFS.activeFeature
        : registry.keys().next().value;
  if (preferred) {
    // First paint: do not re-persist (already loaded from storage).
    activeFeatureId = null;
    setActiveFeature(preferred, { persist: false });
  }
  paintTabBadges();
}

function createPrimaryTab(feature) {
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
  btn.addEventListener('keydown', onTablistKeydown);
  return btn;
}

/**
 * More control: always present. Acts as the selected tab stand-in when a
 * `more` feature is active (label becomes that feature's title).
 * @param {FeatureDescriptor[]} moreFeatures
 */
function createMoreControl(moreFeatures) {
  const wrap = document.createElement('div');
  wrap.className = 'feature-more';
  wrap.dataset.featureMore = 'true';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.id = 'feature-more-button';
  btn.className = 'feature-tab feature-more-button';
  btn.setAttribute('role', 'tab');
  btn.setAttribute('aria-haspopup', 'listbox');
  btn.setAttribute('aria-expanded', 'false');
  btn.setAttribute('aria-controls', 'feature-more-menu');
  btn.setAttribute('aria-label', 'More features');

  const label = document.createElement('span');
  label.className = 'feature-tab-label';
  label.dataset.moreLabel = 'true';
  label.textContent = 'More';
  btn.appendChild(label);

  const badge = document.createElement('span');
  badge.className = 'feature-tab-badge hidden';
  badge.dataset.moreBadge = 'true';
  badge.setAttribute('aria-hidden', 'true');
  btn.appendChild(badge);

  const menu = document.createElement('ul');
  menu.id = 'feature-more-menu';
  menu.className = 'feature-more-menu hidden';
  menu.setAttribute('role', 'listbox');
  menu.setAttribute('aria-label', 'More features');
  menu.tabIndex = -1;

  if (moreFeatures.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'feature-more-empty';
    empty.setAttribute('role', 'presentation');
    empty.textContent = 'No additional features yet';
    menu.appendChild(empty);
  } else {
    for (const feature of moreFeatures) {
      menu.appendChild(createMoreOption(feature));
    }
  }

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (moreOpen) closeMoreMenu({ restoreFocus: true });
    else openMoreMenu();
  });
  btn.addEventListener('keydown', (e) => {
    onTablistKeydown(e);
    if (!e.defaultPrevented) onMoreButtonKeydown(e);
  });

  menu.addEventListener('keydown', onMoreMenuKeydown);
  menu.addEventListener('click', (e) => e.stopPropagation());

  wrap.appendChild(btn);
  wrap.appendChild(menu);
  moreButton = btn;
  moreMenu = menu;
  return wrap;
}

function createMoreOption(feature) {
  const option = document.createElement('li');
  option.id = `more-item-${feature.id}`;
  option.dataset.featureId = feature.id;
  option.setAttribute('role', 'option');
  option.setAttribute('aria-selected', 'false');
  option.className = 'feature-more-option';
  option.tabIndex = -1;

  const label = document.createElement('span');
  label.className = 'feature-more-option-label';
  label.textContent = feature.title;
  option.appendChild(label);

  const badge = document.createElement('span');
  badge.className = 'feature-tab-badge hidden';
  badge.setAttribute('aria-hidden', 'true');
  option.appendChild(badge);

  option.addEventListener('click', () => {
    setActiveFeature(feature.id);
    closeMoreMenu({ restoreFocus: true });
  });
  return option;
}

function openMoreMenu() {
  if (!moreButton || !moreMenu || moreOpen) return;
  moreOpen = true;
  moreMenu.classList.remove('hidden');
  moreButton.setAttribute('aria-expanded', 'true');
  syncMoreOptions();

  const options = getMoreOptions();
  const selected =
    options.find((o) => o.dataset.featureId === activeFeatureId) || options[0];
  if (selected) {
    selected.focus();
    setActiveDescendant(selected);
  }

  outsideClickHandler = (e) => {
    if (!moreButton || !moreMenu) return;
    const t = e.target;
    if (moreButton.contains(t) || moreMenu.contains(t)) return;
    closeMoreMenu({ restoreFocus: false });
  };
  documentKeyHandler = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeMoreMenu({ restoreFocus: true });
    }
  };
  document.addEventListener('mousedown', outsideClickHandler);
  document.addEventListener('keydown', documentKeyHandler);
}

/**
 * @param {{ restoreFocus?: boolean }} [opts]
 */
function closeMoreMenu({ restoreFocus = false } = {}) {
  if (!moreButton || !moreMenu) {
    moreOpen = false;
    return;
  }
  if (!moreOpen && !restoreFocus) return;
  moreOpen = false;
  moreMenu.classList.add('hidden');
  moreButton.setAttribute('aria-expanded', 'false');
  moreButton.removeAttribute('aria-activedescendant');
  teardownMoreListeners();
  if (restoreFocus) moreButton.focus();
}

function teardownMoreListeners() {
  if (outsideClickHandler) {
    document.removeEventListener('mousedown', outsideClickHandler);
    outsideClickHandler = null;
  }
  if (documentKeyHandler) {
    document.removeEventListener('keydown', documentKeyHandler);
    documentKeyHandler = null;
  }
}

/** @returns {HTMLElement[]} */
function getMoreOptions() {
  if (!moreMenu) return [];
  return [...moreMenu.querySelectorAll('[role="option"]')];
}

/** @param {HTMLElement|null} option */
function setActiveDescendant(option) {
  if (!moreButton || !moreMenu) return;
  for (const opt of getMoreOptions()) {
    opt.classList.toggle('feature-more-option-active', opt === option);
  }
  if (option) moreButton.setAttribute('aria-activedescendant', option.id);
  else moreButton.removeAttribute('aria-activedescendant');
}

/** @returns {HTMLElement[]} primary tabs + More button, in bar order */
function getTablistTabs() {
  if (!tabsContainer) return [];
  const tabs = [];
  for (const child of tabsContainer.children) {
    if (child.getAttribute?.('role') === 'tab') {
      tabs.push(/** @type {HTMLElement} */ (child));
    } else if (child.classList?.contains('feature-more') && moreButton) {
      tabs.push(moreButton);
    }
  }
  return tabs;
}

/** Roving tabindex: Left/Right (and Home/End) across primary tabs + More. */
function onTablistKeydown(e) {
  const tabs = getTablistTabs();
  if (tabs.length === 0) return;
  const current = /** @type {HTMLElement} */ (e.currentTarget);
  const idx = tabs.indexOf(current);
  if (idx < 0) return;

  let nextIdx;
  if (e.key === 'ArrowRight') nextIdx = (idx + 1) % tabs.length;
  else if (e.key === 'ArrowLeft') nextIdx = (idx - 1 + tabs.length) % tabs.length;
  else if (e.key === 'Home') nextIdx = 0;
  else if (e.key === 'End') nextIdx = tabs.length - 1;
  else return;

  e.preventDefault();
  const next = tabs[nextIdx];
  // Temporarily make the target focusable even if not selected.
  next.tabIndex = 0;
  next.focus();
}

/** @param {KeyboardEvent} e */
function onMoreButtonKeydown(e) {
  // Enter/Space use the button's native click (toggle). ArrowDown only opens.
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (!moreOpen) openMoreMenu();
  } else if (e.key === 'Escape' && moreOpen) {
    e.preventDefault();
    closeMoreMenu({ restoreFocus: true });
  }
}

/** @param {KeyboardEvent} e */
function onMoreMenuKeydown(e) {
  const options = getMoreOptions();
  if (options.length === 0) {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeMoreMenu({ restoreFocus: true });
    }
    return;
  }
  const current = document.activeElement;
  const idx = options.indexOf(/** @type {HTMLElement} */ (current));
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    const next = options[idx < 0 ? 0 : (idx + 1) % options.length];
    next.focus();
    setActiveDescendant(next);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    const next = options[idx < 0 ? options.length - 1 : (idx - 1 + options.length) % options.length];
    next.focus();
    setActiveDescendant(next);
  } else if (e.key === 'Home') {
    e.preventDefault();
    options[0].focus();
    setActiveDescendant(options[0]);
  } else if (e.key === 'End') {
    e.preventDefault();
    options[options.length - 1].focus();
    setActiveDescendant(options[options.length - 1]);
  } else if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    if (idx >= 0) {
      const id = options[idx].dataset.featureId;
      if (id) setActiveFeature(id);
      closeMoreMenu({ restoreFocus: true });
    }
  } else if (e.key === 'Escape') {
    e.preventDefault();
    closeMoreMenu({ restoreFocus: true });
  } else if (e.key === 'Tab') {
    closeMoreMenu({ restoreFocus: false });
  }
}

function syncFeatureRoots() {
  for (const feature of registry.values()) {
    const root = document.getElementById(feature.rootId);
    if (!root) continue;
    const active = feature.id === activeFeatureId;
    root.classList.toggle('hidden', !active);
    root.setAttribute('aria-hidden', active ? 'false' : 'true');
    // Primary tabs label the panel; More features are labelled by their option.
    const labelId =
      feature.placement === 'more' ? `more-item-${feature.id}` : `tab-${feature.id}`;
    root.setAttribute('aria-labelledby', labelId);
  }
}

function syncTabSelection() {
  if (!tabsContainer) return;
  const active = activeFeatureId ? registry.get(activeFeatureId) : null;
  for (const btn of tabsContainer.querySelectorAll(':scope > [role="tab"]')) {
    const id = btn.dataset.featureId;
    if (!id) continue; // More button handled in syncMoreControl
    const selected = id === activeFeatureId;
    btn.setAttribute('aria-selected', selected ? 'true' : 'false');
    btn.tabIndex = selected ? 0 : -1;
  }
  // When a more feature is active, primary tabs are not selected.
  if (active?.placement === 'more') {
    for (const btn of tabsContainer.querySelectorAll(':scope > [role="tab"]')) {
      if (btn.dataset.featureId) {
        btn.setAttribute('aria-selected', 'false');
        btn.tabIndex = -1;
      }
    }
  }
}

function syncMoreControl() {
  if (!moreButton) return;
  const active = activeFeatureId ? registry.get(activeFeatureId) : null;
  const moreActive = active?.placement === 'more';
  const labelEl = moreButton.querySelector('[data-more-label]');
  if (labelEl) labelEl.textContent = moreActive ? active.title : 'More';

  // More stands in as the selected tab when a menu feature is active.
  moreButton.setAttribute('aria-selected', moreActive ? 'true' : 'false');
  moreButton.tabIndex = moreActive ? 0 : -1;

  // Tint More with the active more-feature id for CSS hooks.
  if (moreActive) {
    moreButton.dataset.featureId = active.id;
    moreButton.setAttribute('aria-controls', active.rootId);
  } else {
    delete moreButton.dataset.featureId;
    moreButton.setAttribute('aria-controls', 'feature-more-menu');
  }

  moreButton.setAttribute(
    'aria-label',
    moreActive ? `${active.title}, More features` : 'More features',
  );

  syncMoreOptions();
}

function syncMoreOptions() {
  if (!moreMenu) return;
  for (const option of getMoreOptions()) {
    const selected = option.dataset.featureId === activeFeatureId;
    option.setAttribute('aria-selected', selected ? 'true' : 'false');
  }
}

function paintBadgeEl(badgeEl, badge) {
  if (!badgeEl) return;
  if (badge.busy) {
    badgeEl.textContent = badge.progress != null ? `${badge.progress}%` : '…';
    badgeEl.classList.remove('hidden');
  } else {
    badgeEl.textContent = '';
    badgeEl.classList.add('hidden');
  }
}

/** Roll up busy badges from `more` features onto the More control. */
function rollupMoreBadge() {
  if (!moreButton) return null;
  const busy = listFeaturesByPlacement('more')
    .map((f) => ({ id: f.id, badge: badges.get(f.id) || { busy: false, progress: null } }))
    .filter((x) => x.badge.busy);
  if (busy.length === 0) return { busy: false, progress: null };
  if (busy.length === 1) return busy[0].badge;
  // Multiple running jobs: show ellipsis rather than a misleading single %.
  return { busy: true, progress: null };
}

function paintTabBadges() {
  if (!tabsContainer) return;

  for (const btn of tabsContainer.querySelectorAll(':scope > [role="tab"][data-feature-id]')) {
    const id = btn.dataset.featureId;
    paintBadgeEl(btn.querySelector('.feature-tab-badge'), badges.get(id) || { busy: false, progress: null });
  }

  // Per-item badges inside More menu.
  if (moreMenu) {
    for (const option of getMoreOptions()) {
      const id = option.dataset.featureId;
      paintBadgeEl(
        option.querySelector('.feature-tab-badge'),
        badges.get(id) || { busy: false, progress: null },
      );
    }
  }

  // Rollup onto More button (also when the active more feature's own badge is shown).
  paintBadgeEl(moreButton?.querySelector('[data-more-badge]'), rollupMoreBadge());
}

/** Test helper — clear registry/badge state between unit tests. */
export function _resetFeaturesForTests() {
  teardownMoreListeners();
  registry.clear();
  badges.clear();
  activeFeatureId = null;
  tabsContainer = null;
  moreButton = null;
  moreMenu = null;
  moreOpen = false;
}
