// Social Security timing worker handler (master thread; no ParallelPool chunks).
//
// Phases: deterministic strategies/grid/strip → bridge OC MC per named strategy
// with policy shocks on benefits.

import {
  runDeterministicSsAnalysis,
  buildBenefitCashflow,
  buildSsCashflowSeries,
  shockedLifetime,
} from '../../core/socialSecurity.js';
import {
  drawTaxRateShock,
  createBenefitCutSchedule,
} from '../../core/policyShocks.js';
import { runBridgeMonteCarlo } from '../../core/accumulation.js';

/**
 * @param {{ pool: object, post: Function, postProgress: Function }} ctx
 * @param {object} data
 */
export async function handleSsTiming(ctx, data) {
  const { post, postProgress } = ctx;
  const { deterministicInput, marketParams, bridge, policy, numSimulations } = data || {};

  if (!deterministicInput || typeof deterministicInput !== 'object') {
    post({ type: 'error', message: 'Social Security run is missing inputs.' });
    return;
  }

  postProgress('Deterministic claim strategies', 0.05);
  const deterministic = runDeterministicSsAnalysis(deterministicInput);

  const paths = Math.max(100, Math.min(5000, numSimulations || 500));
  const seed = (marketParams?.seed >>> 0) || 0;
  const primaryEnd = deterministic.endAges[deterministic.endAges.length - 2]
    || deterministic.endAges[deterministic.endAges.length - 1]
    || 90;

  // Bridge / OC MC for each named strategy (not the full claim grid — too heavy).
  const mcByStrategy = {};
  const strategies = deterministic.strategies;
  const includeMc = bridge?.enabled !== false && marketParams;

  if (includeMc && strategies.length) {
    for (let s = 0; s < strategies.length; s++) {
      const strategy = strategies[s];
      const fracBase = 0.15 + (s / strategies.length) * 0.7;
      postProgress(`MC opportunity cost: ${strategy.label}`, fracBase);

      const claimA = strategy.claimA;
      const claimB = strategy.claimB;
      // Bridge years = years from "now" (currentAge) until the household first claim.
      const currentAge = Number(bridge.currentAge) || 62;
      const firstClaim = claimB != null
        ? Math.min(claimA, claimB)
        : claimA;
      const bridgeYears = Math.max(0, firstClaim - currentAge);

      // Annual SS cashflow at the primary end age (pre-shock).
      const flow = buildBenefitCashflow(
        {
          ...deterministic.personA,
          claimAge: claimA,
          endAge: primaryEnd,
        },
        deterministic.personB
          ? {
            ...deterministic.personB,
            claimAge: claimB,
            endAge: primaryEnd,
          }
          : null,
      );

      // Policy-shocked lifetime distribution (CRN with market paths).
      const shocked = new Float64Array(paths);
      for (let i = 0; i < paths; i++) {
        const taxRate = drawTaxRateShock(seed, i, {
          baseRate: policy?.baseTaxRate ?? 0,
          noiseStd: policy?.taxNoiseStd ?? 0.03,
        });
        const cutSched = createBenefitCutSchedule(seed, i, policy?.benefitCut || { mode: 'none' });
        shocked[i] = shockedLifetime(flow.annual, taxRate, cutSched);
      }
      const shockedSorted = Float64Array.from(shocked);
      shockedSorted.sort();
      const at = (arr, p) => {
        if (!arr.length) return 0;
        const idx = Math.min(arr.length - 1, Math.max(0, Math.floor(p * (arr.length - 1))));
        return arr[idx];
      };

      let bridgeResult = null;
      if (bridgeYears > 0 && (Number(bridge.startBalance) || 0) > 0) {
        // Bridge spend defaults to the early-claim annual benefit (OC of waiting).
        const earlyAnnual = Number(bridge.annualSpend);
        const spend = Number.isFinite(earlyAnnual) && earlyAnnual > 0
          ? earlyAnnual
          : estimateEarlyAnnual(deterministic, currentAge);

        bridgeResult = runBridgeMonteCarlo(
          {
            ...marketParams,
            seed,
            numSimulations: paths,
            numYears: bridgeYears,
            startBalance: Number(bridge.startBalance) || 0,
            bridgeSpend: spend,
          },
          {
            onProgress: (f) =>
              postProgress(`MC opportunity cost: ${strategy.label}`, fracBase + f * 0.08),
          },
        );
      }

      mcByStrategy[strategy.id] = {
        lifetimeShocked: {
          p10: at(shockedSorted, 0.10),
          p50: at(shockedSorted, 0.50),
          p90: at(shockedSorted, 0.90),
        },
        bridge: bridgeResult,
        bridgeYears,
        primaryEnd,
        lifetimePreShock: flow.lifetime,
      };
    }
  }

  postProgress('Packaging results', 0.95);
  const startAge = Number(bridge?.currentAge)
    || Number(deterministicInput?.personA?.currentAge)
    || 62;
  const cashflowSeries = buildSsCashflowSeries(deterministic, {
    startAge,
    primaryEnd,
  });
  post({
    type: 'done',
    result: {
      deterministic,
      mcByStrategy,
      cashflowSeries,
      meta: {
        seed,
        numSimulations: paths,
        primaryEnd,
        includeMc: !!includeMc,
      },
    },
  });
}

function estimateEarlyAnnual(deterministic, currentAge) {
  // Use the "both early" / "early" strategy's first-year benefit as the default bridge spend.
  const early = deterministic.strategies.find((s) => s.id === 'both-early' || s.id === 'early');
  if (!early) return 0;
  const end = deterministic.endAges[0] || 80;
  const cf = early.byEndAge[end]?.cashflow;
  if (!cf?.annual?.length) return 0;
  // First positive annual amount after current age.
  for (let i = 0; i < cf.years.length; i++) {
    if (cf.years[i] >= currentAge && cf.annual[i] > 0) return cf.annual[i];
  }
  return cf.annual[0] || 0;
}
