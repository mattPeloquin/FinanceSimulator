// Per-feature wiring for Lifetime Plan source rows.
// This is the only Plan module that knows worker types / payload builders /
// strategy catalogs of producer features.

import { SAVINGS_SCALES, buildAccumulationCashflowSeries } from '../../core/accumulation.js';
import { STRATEGY_IDS as HE_STRATEGY_IDS, STRATEGY_LABELS as HE_STRATEGY_LABELS } from '../../core/houseEquity.js';
import { buildWithdrawCashflowSeries } from '../../core/withdrawal.js';
import { ensureScenarioProfiles } from '../../core/scenarioProfiles.js';
import { buildSimParams, MONEY_SCALE } from '../../state/scenario.js';
import { buildSamplesAndProfiles } from '../../portfolio/slice.js';
import { fromWithdrawScenario } from '../../portfolio/adapters.js';
import {
  FEATURE_ACCUMULATE,
  FEATURE_SS_TIMING,
  FEATURE_HOUSE_EQUITY,
  FEATURE_WITHDRAW,
} from '../../state/storageKeys.js';
import { buildAccumulateParams } from '../accumulate/params.js';
import { buildHouseEquityWorkerPayload } from '../house-equity/params.js';
import { buildSsTimingWorkerPayload } from '../ss-timing/params.js';
import { balanceFanSeries } from '../../core/reportModel.js';

/**
 * @typedef {{ id: string, label: string }} StrategyOption
 * @typedef {object} PlanSourceDescriptor
 * @property {string} feature
 * @property {string} title
 * @property {'external'|'accumulate'|'withdraw'} phase
 * @property {string|null} workerType - null when pure (no worker)
 * @property {(state: object, opts?: object) => Promise<object>|object} [buildPayload]
 * @property {(state: object, opts?: object) => object|null} [pureSeries]
 * @property {(msg: object, opts?: object) => object|null} [extractSeries]
 * @property {(msg: object, opts?: object) => object|null} [extractArtifacts]
 * @property {() => StrategyOption[]} strategyOptions
 * @property {string} defaultStrategyId
 */

/**
 * Build samples for a Withdraw scenario without touching the Withdraw DOM.
 * @param {object} scenario
 */
function samplesForWithdrawScenario(scenario) {
  // Fill flat equityMean/… fields when a saved session omitted them.
  const prepared = ensureScenarioProfiles(scenario);
  const portfolio = fromWithdrawScenario(prepared);
  const { samples } = buildSamplesAndProfiles(portfolio, {
    forceProfiles: !portfolio.profiles,
  });
  return { scenario: prepared, samples };
}

/**
 * Withdrawals *are* household spending on the Plan cashflow chart. The live
 * Withdraw form defaults to Goal Seek on with a blank base amount — that would
 * produce a silent $0 spend path. For the Plan run only, fill a classic 4% of
 * start (in $000s) when no positive withdrawal amount is present.
 *
 * Does not mutate the Withdraw DOM / saved session.
 *
 * @param {object} scenario - Withdraw scenario ($000s currency fields)
 * @returns {{ scenario: object, appliedDefaultSpend: boolean }}
 */
export function ensurePlanWithdrawSpending(scenario) {
  const startK = Number(scenario?.startBalance) || 0;
  if (!(startK > 0)) {
    return { scenario, appliedDefaultSpend: false };
  }

  const strategy = String(scenario?.withdrawalStrategy || 'base');
  if (strategy === 'specific') {
    const list = String(scenario?.specificWithdrawals || '').trim();
    if (list) return { scenario, appliedDefaultSpend: false };
  } else {
    const baseK = Number(scenario?.baseWithdrawal) || 0;
    if (baseK > 0) return { scenario, appliedDefaultSpend: false };
    // Spending-over-time "extra" can carry the annual draw when base is 0.
    const tiers = scenario?.spendingOverTimeTiers;
    const tier0Extra = Array.isArray(tiers) && tiers[0]
      ? Number(tiers[0].extra) || 0
      : 0;
    if (tier0Extra > 0) return { scenario, appliedDefaultSpend: false };
  }

  // One-decimal $000s (e.g. start 818 → 32.7).
  const defaultBaseK = Math.round(startK * 0.04 * 10) / 10;
  return {
    scenario: {
      ...scenario,
      goalSeekMode: false,
      withdrawalStrategy: 'base',
      baseWithdrawal: defaultBaseK,
    },
    appliedDefaultSpend: true,
  };
}

/** @type {PlanSourceDescriptor[]} */
const DESCRIPTORS = [
  {
    feature: FEATURE_ACCUMULATE,
    title: 'Accumulate',
    phase: 'accumulate',
    workerType: 'accumulate',
    async buildPayload(state, opts = {}) {
      const refreshSims = opts.refreshSims || state.numSimulations || 200;
      const capped = {
        ...state,
        numSimulations: Math.min(Number(state.numSimulations) || refreshSims, refreshSims),
      };
      const params = await buildAccumulateParams(capped, { seed: opts.seed });
      // Append Plan-injected external flows as synthetic events ($000s).
      if (Array.isArray(opts.extraEvents) && opts.extraEvents.length) {
        params.events = [...(params.events || []), ...opts.extraEvents];
      }
      return {
        type: 'accumulate',
        params,
        // Skip weight explore / tornado — Plan only needs the savings cone.
        includeWeightExplore: false,
        sweepPaths: Math.min(params.numSimulations || refreshSims, refreshSims),
        numCores: 1,
        subWorkerPorts: [],
      };
    },
    pureSeries(state, opts = {}) {
      // Still available for cashflow-only fallback.
      return buildAccumulationCashflowSeries(state, {
        sessionName: opts.sessionName ?? null,
      });
    },
    extractSeries(msg, opts = {}) {
      // Prefer config-derived series (includes all savings scales) over worker.
      if (opts.state) {
        return buildAccumulationCashflowSeries(opts.state, {
          sessionName: opts.sessionName ?? null,
        });
      }
      return null;
    },
    extractArtifacts(msg, opts = {}) {
      const result = msg?.result;
      if (!result) return null;
      const strategyId = opts.strategyId || 'med';
      const summary = result.savingsImpact?.[strategyId]
        || (strategyId === 'med' ? result.med : null)
        || result.med;
      if (!summary?.cone) return null;
      return {
        kind: 'accumulate',
        cone: summary.cone,
        ending: summary.ending || null,
        numYears: result.meta?.numYears ?? Math.max(0, (summary.cone.length || 1) - 1),
      };
    },
    strategyOptions() {
      return SAVINGS_SCALES.map((s) => ({ id: s.id, label: s.label }));
    },
    defaultStrategyId: 'med',
  },
  {
    feature: FEATURE_WITHDRAW,
    title: 'Withdraw',
    phase: 'withdraw',
    workerType: 'withdraw',
    async buildPayload(state, opts = {}) {
      const refreshSims = opts.refreshSims || state.numSimulations || 200;
      let scenario = {
        ...state,
        numSimulations: Math.min(Number(state.numSimulations) || refreshSims, refreshSims),
      };
      // Handoff from Accumulate: override start balance ($000s) when provided.
      if (Number.isFinite(Number(opts.startBalanceDollars))) {
        scenario = {
          ...scenario,
          startBalance: Number(opts.startBalanceDollars) / MONEY_SCALE,
        };
      }
      // Withdrawals are the spending cashflow — ensure a positive annual draw.
      const spend = ensurePlanWithdrawSpending(scenario);
      scenario = spend.scenario;

      const { scenario: prepared, samples } = samplesForWithdrawScenario(scenario);
      if (!samples?.years?.length && prepared.distMethod !== 'lognormal') {
        throw new Error('Historical sample is empty for this Withdraw session year range.');
      }
      const params = buildSimParams(prepared, samples);
      params.numSimulations = Math.min(params.numSimulations || refreshSims, refreshSims);

      // Inject external cashflows as majorEventsSeries (dollars), unless blocked.
      if (Array.isArray(opts.majorEventsSeries)) {
        if (!params.portfolio) params.portfolio = {};
        params.portfolio.majorEventsSeries = opts.majorEventsSeries;
      }

      return {
        type: 'withdraw',
        params,
        numCores: 1,
        subWorkerPorts: [],
        // Carry for run.js warning checks.
        _planMeta: {
          withdrawalStrategy: prepared.withdrawalStrategy,
          appliedDefaultSpend: spend.appliedDefaultSpend,
          blockedInjection: String(prepared.withdrawalStrategy) === 'specific'
            && Array.isArray(opts.majorEventsSeries)
            && opts.majorEventsSeries.some((v) => v !== 0),
        },
      };
    },
    extractSeries(msg, opts = {}) {
      return buildWithdrawCashflowSeries(msg?.result, {
        sessionName: opts.sessionName ?? null,
      });
    },
    extractArtifacts(msg) {
      const result = msg?.result;
      if (!result?.balancePercentiles) return null;
      const fan = balanceFanSeries(result.balancePercentiles, 10, 90);
      return {
        kind: 'withdraw',
        fan: {
          low: fan.low,
          median: fan.median,
          high: fan.high,
        },
        numYears: result.balancePercentiles.numYears
          || fan.median?.length
          || 0,
      };
    },
    strategyOptions() {
      return [{ id: 'p50', label: 'Median path' }];
    },
    defaultStrategyId: 'p50',
  },
  {
    feature: FEATURE_SS_TIMING,
    title: 'Social Security',
    phase: 'external',
    workerType: 'ssTiming',
    async buildPayload(state, opts = {}) {
      return buildSsTimingWorkerPayload(state, opts);
    },
    strategyOptions() {
      // Couple + single named strategies; after a run the picker refreshes from series keys.
      return [
        { id: 'early', label: 'Claim at 62' },
        { id: 'fra', label: 'Claim at FRA' },
        { id: 'delay70', label: 'Claim at 70' },
        { id: 'both-early', label: 'Both at 62' },
        { id: 'both-fra', label: 'Both at FRA' },
        { id: 'both-70', label: 'Both at 70' },
        { id: 'split', label: 'Split (higher earner @ 70)' },
      ];
    },
    defaultStrategyId: 'both-70',
  },
  {
    feature: FEATURE_HOUSE_EQUITY,
    title: 'House Equity',
    phase: 'external',
    workerType: 'houseEquity',
    async buildPayload(state, opts = {}) {
      return buildHouseEquityWorkerPayload(state, opts);
    },
    extractArtifacts(msg, opts = {}) {
      const result = msg?.result;
      const strategyId = opts.strategyId;
      const medianPath = result?.byStrategy?.[strategyId]?.medianPath;
      if (!medianPath?.residualEquityReal) return null;
      return {
        kind: 'homeEquity',
        residualEquityReal: medianPath.residualEquityReal.slice(),
        // Ignore portfolioReal — Plan portfolio comes from Accumulate/Withdraw only.
      };
    },
    strategyOptions() {
      return HE_STRATEGY_IDS.map((id) => ({
        id,
        label: HE_STRATEGY_LABELS[id] || id,
      }));
    },
    defaultStrategyId: 'simplifiedRm',
  },
];

/** @type {Map<string, PlanSourceDescriptor>} */
const BY_FEATURE = new Map(DESCRIPTORS.map((d) => [d.feature, d]));

/** Feature ids Plan can attach as cashflow sources. */
export function listPlanSourceFeatures() {
  return DESCRIPTORS.map((d) => ({ feature: d.feature, title: d.title }));
}

/** @param {string} feature */
export function getPlanSourceDescriptor(feature) {
  return BY_FEATURE.get(feature) || null;
}

/**
 * Strategy options for a feature. When `series` is provided, prefer its keys
 * (preserving known labels, falling back to the raw id).
 * @param {string} feature
 * @param {object|null} [series]
 * @returns {StrategyOption[]}
 */
export function strategyOptionsFor(feature, series = null) {
  const desc = getPlanSourceDescriptor(feature);
  const defaults = desc ? desc.strategyOptions() : [];
  if (!series?.seriesByStrategy || typeof series.seriesByStrategy !== 'object') {
    return defaults;
  }
  const labelById = new Map(defaults.map((o) => [o.id, o.label]));
  return Object.keys(series.seriesByStrategy).map((id) => ({
    id,
    label: labelById.get(id) || id,
  }));
}

/** @param {string} feature */
export function defaultStrategyIdFor(feature) {
  return getPlanSourceDescriptor(feature)?.defaultStrategyId || '';
}
