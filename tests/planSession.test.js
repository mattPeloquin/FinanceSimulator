import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import {
  defaultPlanState,
  normalizePlanState,
  remapPlanSourceRenames,
  getPlanDependencies,
  applyPlanState,
  getPlanState,
  createPlanSourceRow,
  rebuildPlanResult,
  setResolvedSeries,
  getPlanCashflowSeries,
  clearResolvedSeries,
} from '../src/features/plan/session.js';
import { migratePlanState, PLAN_STATE_VERSION } from '../src/state/migrations.js';
import { buildCashflowSeries } from '../src/state/cashflowSeries.js';
import {
  FEATURE_ACCUMULATE,
  FEATURE_SS_TIMING,
  FEATURE_HOUSE_EQUITY,
} from '../src/state/storageKeys.js';
import { ensurePlanWithdrawSpending } from '../src/features/plan/sources.js';
import * as sessions from '../src/state/sessions.js';

describe('plan session', () => {
  beforeEach(async () => {
    await sessions._clearAllForTests?.();
    clearResolvedSeries();
    applyPlanState(defaultPlanState());
  });

  it('normalizes defaults and clamps the plan window', () => {
    const base = defaultPlanState();
    expect(base.version).toBe(PLAN_STATE_VERSION);
    expect(base.sources.length).toBeGreaterThanOrEqual(1);
    expect(base.sources[0].feature).toBe(FEATURE_ACCUMULATE);

    const out = normalizePlanState({
      planStartYear: 2030,
      planEndYear: 2020,
      birthYearA: '',
      birthYearB: 1962,
      refreshSims: 999,
      sources: [{ feature: FEATURE_SS_TIMING, sessionName: 'Mine', strategyId: 'both-70' }],
    });
    expect(out.planStartYear).toBe(2030);
    expect(out.planEndYear).toBe(2030);
    expect(out.birthYearA).toBeNull();
    expect(out.birthYearB).toBe(1962);
    expect(out.refreshSims).toBe(200);
    expect(out.sources[0].feature).toBe(FEATURE_SS_TIMING);
    expect(out.sources[0].sessionName).toBe('Mine');
  });

  it('migrates within the supported Plan version', () => {
    const state = { planStartYear: 2026, sources: [], view: 'netWorth' };
    const out = migratePlanState(state, PLAN_STATE_VERSION);
    expect(out.planStartYear).toBe(2026);
    expect(out).not.toBe(state);
    expect(() => migratePlanState(state, 0)).toThrow(/older/i);
  });

  it('defaults view and withdraw handoff fields on normalize', () => {
    const out = normalizePlanState({
      sources: [{ feature: FEATURE_ACCUMULATE }],
    });
    expect(out.view).toBe('netWorth');
    expect(out.sources[0].startsAfter).toBe('');
    expect(out.sources[0].handoffPercentile).toBe('p50');
  });

  it('keeps an explicit empty sources list (remove-all)', () => {
    const out = normalizePlanState({
      planStartYear: 2030,
      planEndYear: 2040,
      sources: [],
    });
    expect(out.sources).toEqual([]);
  });

  it('remaps source session names across features on import rename', () => {
    const state = normalizePlanState({
      sources: [
        createPlanSourceRow({
          feature: FEATURE_ACCUMULATE,
          sessionName: 'Old Acc',
        }),
        createPlanSourceRow({
          feature: FEATURE_HOUSE_EQUITY,
          sessionName: 'Old House',
        }),
      ],
    });
    const remapped = remapPlanSourceRenames(state, [
      { feature: FEATURE_ACCUMULATE, requestedName: 'Old Acc', name: 'Old Acc (1)' },
      { feature: FEATURE_SS_TIMING, requestedName: 'Old House', name: 'wrong' },
      { feature: FEATURE_HOUSE_EQUITY, requestedName: 'Old House', name: 'Old House (1)' },
    ]);
    expect(remapped.sources[0].sessionName).toBe('Old Acc (1)');
    expect(remapped.sources[1].sessionName).toBe('Old House (1)');
  });

  it('drops unknown / retired Plan source features on normalize', () => {
    const out = normalizePlanState({
      sources: [
        { feature: FEATURE_ACCUMULATE, sessionName: 'Keep' },
        { feature: 'roth-convert', sessionName: 'Gone' },
        { feature: 'not-a-feature', sessionName: 'Nope' },
      ],
    });
    expect(out.sources).toHaveLength(1);
    expect(out.sources[0].feature).toBe(FEATURE_ACCUMULATE);
    expect(out.sources[0].sessionName).toBe('Keep');
  });

  it('collects multi-feature dependencies from saved sessions', async () => {
    await sessions.save(FEATURE_ACCUMULATE, 'Acc A', { numYears: 10 }, 'note a');
    await sessions.save(FEATURE_SS_TIMING, 'SS B', { couple: true }, 'note b');

    applyPlanState({
      ...defaultPlanState(),
      sources: [
        createPlanSourceRow({ feature: FEATURE_ACCUMULATE, sessionName: 'Acc A' }),
        createPlanSourceRow({ feature: FEATURE_SS_TIMING, sessionName: 'SS B' }),
        createPlanSourceRow({ feature: FEATURE_ACCUMULATE, sessionName: 'Acc A' }),
        createPlanSourceRow({ feature: FEATURE_HOUSE_EQUITY, sessionName: '' }),
      ],
    });

    const deps = await getPlanDependencies();
    expect(deps).toHaveLength(2);
    expect(deps.map((d) => `${d.feature}:${d.name}`).sort()).toEqual([
      `${FEATURE_ACCUMULATE}:Acc A`,
      `${FEATURE_SS_TIMING}:SS B`,
    ]);
    expect(deps.find((d) => d.name === 'Acc A').state.numYears).toBe(10);
  });

  it('builds an aggregate cashflow series after resolve', () => {
    const year = new Date().getFullYear();
    applyPlanState({
      ...defaultPlanState(),
      planStartYear: year,
      planEndYear: year + 1,
    });
    const state = getPlanState();
    const src = state.sources[0];
    setResolvedSeries(src.id, buildCashflowSeries({
      sourceFeature: FEATURE_ACCUMULATE,
      startAge: 0,
      numYears: 2,
      annualByStrategy: { med: [-1000, -2000] },
    }));
    const result = rebuildPlanResult();
    expect(result.net).toEqual([-1000, -2000]);
    const series = getPlanCashflowSeries({ sessionName: 'Demo' });
    expect(series.sourceFeature).toBe('plan');
    expect(series.seriesByStrategy.net.annual).toEqual([-1000, -2000]);
    expect(series.sessionName).toBe('Demo');
  });
});

describe('ensurePlanWithdrawSpending', () => {
  it('fills 4% of start when Goal Seek left base withdrawal blank', () => {
    const { scenario, appliedDefaultSpend } = ensurePlanWithdrawSpending({
      startBalance: 1000,
      baseWithdrawal: 0,
      goalSeekMode: true,
      withdrawalStrategy: 'base',
    });
    expect(appliedDefaultSpend).toBe(true);
    expect(scenario.goalSeekMode).toBe(false);
    expect(scenario.baseWithdrawal).toBe(40);
    expect(scenario.withdrawalStrategy).toBe('base');
  });

  it('leaves an explicit base withdrawal alone', () => {
    const { scenario, appliedDefaultSpend } = ensurePlanWithdrawSpending({
      startBalance: 1000,
      baseWithdrawal: 55,
      goalSeekMode: false,
      withdrawalStrategy: 'base',
    });
    expect(appliedDefaultSpend).toBe(false);
    expect(scenario.baseWithdrawal).toBe(55);
  });
});
