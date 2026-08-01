// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  registerFeature,
  listFeatures,
  listFeaturesByPlacement,
  getFeature,
  getActiveFeature,
  setActiveFeature,
  setFeatureBadge,
  getFeatureBadge,
  mountFeatureTabs,
  initFeatures,
  _resetFeaturesForTests,
} from '../src/state/features.js';
import { APP_PREFS_KEY } from '../src/state/storageKeys.js';

describe('feature registry', () => {
  beforeEach(() => {
    localStorage.clear();
    _resetFeaturesForTests();
    document.body.innerHTML = `
      <nav id="feature-tabs"></nav>
      <div id="feature-sor-plan"></div>
      <div id="feature-accumulation" class="hidden"></div>
      <div id="feature-other" class="hidden"></div>
    `;
  });

  afterEach(() => {
    localStorage.clear();
    _resetFeaturesForTests();
  });

  function registerPlanAccumAndMore() {
    registerFeature({
      id: 'sor-plan',
      title: 'SOR Plan',
      rootId: 'feature-sor-plan',
      placement: 'primary',
    });
    registerFeature({
      id: 'accumulation',
      title: 'Accumulation',
      rootId: 'feature-accumulation',
      placement: 'primary',
    });
    registerFeature({
      id: 'other',
      title: 'Other',
      rootId: 'feature-other',
      placement: 'more',
    });
  }

  it('registers features and lists them in order', () => {
    registerPlanAccumAndMore();
    expect(listFeatures().map((f) => f.id)).toEqual(['sor-plan', 'accumulation', 'other']);
    expect(getFeature('sor-plan').title).toBe('SOR Plan');
    expect(getFeature('missing')).toBeNull();
  });

  it('defaults placement to primary and accepts more', () => {
    registerFeature({ id: 'sor-plan', title: 'SOR Plan', rootId: 'feature-sor-plan' });
    registerFeature({
      id: 'other',
      title: 'Other',
      rootId: 'feature-other',
      placement: 'more',
    });
    expect(getFeature('sor-plan').placement).toBe('primary');
    expect(getFeature('other').placement).toBe('more');
    expect(listFeaturesByPlacement('primary').map((f) => f.id)).toEqual(['sor-plan']);
    expect(listFeaturesByPlacement('more').map((f) => f.id)).toEqual(['other']);
  });

  it('rejects invalid or duplicate ids', () => {
    expect(() => registerFeature({ id: 'Bad_Id', title: 'X', rootId: 'r' })).toThrow();
    registerFeature({ id: 'sor-plan', title: 'SOR Plan', rootId: 'feature-sor-plan' });
    expect(() =>
      registerFeature({ id: 'sor-plan', title: 'Again', rootId: 'feature-sor-plan' }),
    ).toThrow(/duplicate/);
  });

  it('mountFeatureTabs renders primary tabs + More and activates the persisted feature', () => {
    registerPlanAccumAndMore();
    localStorage.setItem(APP_PREFS_KEY, JSON.stringify({ activeFeature: 'other' }));

    mountFeatureTabs(document.getElementById('feature-tabs'));

    const bar = document.getElementById('feature-tabs');
    expect(bar.classList.contains('feature-tab-bar')).toBe(true);
    const tabs = document.querySelectorAll('#feature-tabs [role="tab"]');
    // Plan, Accumulation, More button
    expect(tabs).toHaveLength(3);
    expect(tabs[0].textContent).toContain('SOR Plan');
    expect(tabs[0].classList.contains('feature-tab')).toBe(true);
    expect(tabs[0].dataset.featureId).toBe('sor-plan');
    expect(tabs[1].dataset.featureId).toBe('accumulation');
    expect(document.getElementById('feature-more-button')).toBeTruthy();
    expect(document.getElementById('feature-more-button').getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(document.getElementById('feature-more-button').textContent).toContain('Other');
    expect(getActiveFeature().id).toBe('other');
    expect(document.getElementById('feature-sor-plan').classList.contains('hidden')).toBe(true);
    expect(document.getElementById('feature-other').classList.contains('hidden')).toBe(false);
  });

  it('always renders More even when no more features are registered', () => {
    registerFeature({ id: 'sor-plan', title: 'SOR Plan', rootId: 'feature-sor-plan' });
    mountFeatureTabs(document.getElementById('feature-tabs'));
    expect(document.getElementById('feature-more-button')).toBeTruthy();
    expect(document.getElementById('feature-more-menu').textContent).toContain(
      'No additional features yet',
    );
  });

  it('More menu opens, selects a feature, Escape returns focus', () => {
    registerPlanAccumAndMore();
    mountFeatureTabs(document.getElementById('feature-tabs'));

    const moreBtn = document.getElementById('feature-more-button');
    const menu = document.getElementById('feature-more-menu');
    expect(menu.classList.contains('hidden')).toBe(true);

    moreBtn.click();
    expect(moreBtn.getAttribute('aria-expanded')).toBe('true');
    expect(menu.classList.contains('hidden')).toBe(false);

    document.getElementById('more-item-other').click();
    expect(getActiveFeature().id).toBe('other');
    expect(menu.classList.contains('hidden')).toBe(true);
    expect(moreBtn.textContent).toContain('Other');
    expect(document.activeElement).toBe(moreBtn);

    moreBtn.click();
    expect(menu.classList.contains('hidden')).toBe(false);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(menu.classList.contains('hidden')).toBe(true);
    expect(document.activeElement).toBe(moreBtn);
  });

  it('setActiveFeature persists and toggles roots / hooks', () => {
    const calls = { planOn: 0, planOff: 0, otherOn: 0, otherOff: 0 };
    registerFeature({
      id: 'sor-plan',
      title: 'SOR Plan',
      rootId: 'feature-sor-plan',
      onActivate: () => {
        calls.planOn += 1;
      },
      onDeactivate: () => {
        calls.planOff += 1;
      },
    });
    registerFeature({
      id: 'other',
      title: 'Other',
      rootId: 'feature-other',
      placement: 'more',
      onActivate: () => {
        calls.otherOn += 1;
      },
      onDeactivate: () => {
        calls.otherOff += 1;
      },
    });

    mountFeatureTabs(document.getElementById('feature-tabs'));
    expect(getActiveFeature().id).toBe('sor-plan');
    expect(calls.planOn).toBe(1);

    setActiveFeature('other');
    expect(getActiveFeature().id).toBe('other');
    expect(calls.planOff).toBe(1);
    expect(calls.otherOn).toBe(1);
    expect(JSON.parse(localStorage.getItem(APP_PREFS_KEY)).activeFeature).toBe('other');
  });

  it('setFeatureBadge updates primary tab badge and rolls up onto More', () => {
    registerPlanAccumAndMore();
    mountFeatureTabs(document.getElementById('feature-tabs'));

    setFeatureBadge('sor-plan', { busy: true, progress: 42 });
    expect(getFeatureBadge('sor-plan')).toEqual({ busy: true, progress: 42 });
    const planBadge = document.querySelector('#tab-sor-plan .feature-tab-badge');
    expect(planBadge.classList.contains('hidden')).toBe(false);
    expect(planBadge.textContent).toBe('42%');

    setFeatureBadge('sor-plan', { busy: false });
    expect(planBadge.classList.contains('hidden')).toBe(true);

    setFeatureBadge('other', { busy: true, progress: 17 });
    const moreBadge = document.querySelector('#feature-more-button [data-more-badge]');
    expect(moreBadge.classList.contains('hidden')).toBe(false);
    expect(moreBadge.textContent).toBe('17%');
    const itemBadge = document.querySelector('#more-item-other .feature-tab-badge');
    expect(itemBadge.classList.contains('hidden')).toBe(false);
    expect(itemBadge.textContent).toBe('17%');

    setFeatureBadge('other', { busy: false });
    expect(moreBadge.classList.contains('hidden')).toBe(true);
  });

  it('initFeatures calls each feature init once', async () => {
    const seen = [];
    registerFeature({
      id: 'sor-plan',
      title: 'SOR Plan',
      rootId: 'feature-sor-plan',
      init: (ctx) => seen.push(['sor-plan', ctx.ok]),
    });
    registerFeature({
      id: 'other',
      title: 'Other',
      rootId: 'feature-other',
      placement: 'more',
      init: (ctx) => seen.push(['other', ctx.ok]),
    });
    await initFeatures({ ok: true });
    expect(seen).toEqual([
      ['sor-plan', true],
      ['other', true],
    ]);
  });
});
