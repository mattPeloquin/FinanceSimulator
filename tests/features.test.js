// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  registerFeature,
  listFeatures,
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
      <div id="feature-other" class="hidden"></div>
    `;
  });

  afterEach(() => {
    localStorage.clear();
    _resetFeaturesForTests();
  });

  function registerPlanAndOther() {
    registerFeature({
      id: 'sor-plan',
      title: 'SOR Plan',
      rootId: 'feature-sor-plan',
    });
    registerFeature({
      id: 'other',
      title: 'Other',
      rootId: 'feature-other',
    });
  }

  it('registers features and lists them in order', () => {
    registerPlanAndOther();
    expect(listFeatures().map((f) => f.id)).toEqual(['sor-plan', 'other']);
    expect(getFeature('sor-plan').title).toBe('SOR Plan');
    expect(getFeature('missing')).toBeNull();
  });

  it('rejects invalid or duplicate ids', () => {
    expect(() => registerFeature({ id: 'Bad_Id', title: 'X', rootId: 'r' })).toThrow();
    registerFeature({ id: 'sor-plan', title: 'SOR Plan', rootId: 'feature-sor-plan' });
    expect(() =>
      registerFeature({ id: 'sor-plan', title: 'Again', rootId: 'feature-sor-plan' }),
    ).toThrow(/duplicate/);
  });

  it('mountFeatureTabs renders tabs and activates the persisted feature', () => {
    registerPlanAndOther();
    localStorage.setItem(APP_PREFS_KEY, JSON.stringify({ activeFeature: 'other' }));

    mountFeatureTabs(document.getElementById('feature-tabs'));

    const bar = document.getElementById('feature-tabs');
    expect(bar.classList.contains('feature-tab-bar')).toBe(true);
    const tabs = document.querySelectorAll('#feature-tabs [role="tab"]');
    expect(tabs).toHaveLength(2);
    expect(tabs[0].textContent).toContain('SOR Plan');
    expect(tabs[0].classList.contains('feature-tab')).toBe(true);
    expect(tabs[0].dataset.featureId).toBe('sor-plan');
    expect(tabs[1].getAttribute('aria-selected')).toBe('true');
    expect(getActiveFeature().id).toBe('other');
    expect(document.getElementById('feature-sor-plan').classList.contains('hidden')).toBe(true);
    expect(document.getElementById('feature-other').classList.contains('hidden')).toBe(false);
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

  it('setFeatureBadge updates the tab badge', () => {
    registerFeature({ id: 'sor-plan', title: 'SOR Plan', rootId: 'feature-sor-plan' });
    mountFeatureTabs(document.getElementById('feature-tabs'));

    setFeatureBadge('sor-plan', { busy: true, progress: 42 });
    expect(getFeatureBadge('sor-plan')).toEqual({ busy: true, progress: 42 });
    const badge = document.querySelector('#tab-sor-plan .feature-tab-badge');
    expect(badge.classList.contains('hidden')).toBe(false);
    expect(badge.textContent).toBe('42%');

    setFeatureBadge('sor-plan', { busy: false });
    expect(badge.classList.contains('hidden')).toBe(true);
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
      init: (ctx) => seen.push(['other', ctx.ok]),
    });
    await initFeatures({ ok: true });
    expect(seen).toEqual([
      ['sor-plan', true],
      ['other', true],
    ]);
  });
});
