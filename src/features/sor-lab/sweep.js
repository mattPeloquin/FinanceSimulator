// Build Lab sensitivity design points from a Plan scenario + Lab config.
// Pure enough to unit-test; DOM-free except that callers supply samples.

import { buildSimParams } from '../../state/scenario.js';
import { getSampleYears } from '../../core/history.js';
import { ensureScenarioProfiles } from '../../core/scenarioProfiles.js';
import { resolveLabVariables } from './variables.js';

export { ensureScenarioProfiles };

export const DEFAULT_SWEEP_POINTS = 7;
export const DEFAULT_PATHS_PER_POINT = 2000;

/** Shared heavy arrays stripped from each point and restored in the worker. */
export const SHARED_PARAM_KEYS = ['samples', 'scaledHistoricalShocks'];

/** Evenly spaced design values across [low, high], length = sweepPoints. */
export function linspace(low, high, count) {
  const n = Math.max(2, Math.floor(count));
  if (n === 1 || low === high) return [low];
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = low + ((high - low) * i) / (n - 1);
  }
  return out;
}

/**
 * Strip bulky identical arrays from a params object for transfer. The worker
 * splices them back from baseParams.
 */
export function stripSharedArrays(params) {
  const stripped = { ...params };
  stripped.samples = null;
  stripped.scaledHistoricalShocks = null;
  if (stripped.logNormal) {
    stripped.logNormal = { ...stripped.logNormal, chol: null };
  }
  return stripped;
}

export function restoreSharedArrays(pointParams, baseParams) {
  return {
    ...pointParams,
    samples: baseParams.samples,
    scaledHistoricalShocks: baseParams.scaledHistoricalShocks,
    logNormal: {
      ...(pointParams.logNormal || {}),
      chol: baseParams.logNormal?.chol ?? null,
    },
  };
}

/**
 * Build the full set of design points for a Lab run.
 *
 * @param {object} scenario — Withdraw scenario payload
 * @param {object} config
 * @param {number} config.seed — pinned CRN seed for every point
 * @param {number} [config.sweepPoints]
 * @param {number} [config.pathsPerPoint]
 * @param {Record<string, object>} [config.envelopeOverrides]
 * @param {{ feature: string, name: string }} config.baselineRef
 */
export function buildSweepJob(scenario, config) {
  const sweepPoints = config.sweepPoints || DEFAULT_SWEEP_POINTS;
  const pathsPerPoint = config.pathsPerPoint || DEFAULT_PATHS_PER_POINT;
  const seed = (config.seed >>> 0);
  const prepared = ensureScenarioProfiles(scenario);
  const { live } = resolveLabVariables(prepared, config.envelopeOverrides || {});

  const startYear = Number(prepared.startYear);
  const endYear = Number(prepared.endYear);
  const years = getSampleYears(startYear, endYear);
  if (years.length === 0) {
    throw new Error('No historical years available for the Plan scenario range.');
  }
  const samples = { startYear, endYear, years };

  // Baseline params — also the carrier for shared heavy arrays.
  const baselineScenario = {
    ...prepared,
    numSimulations: pathsPerPoint,
    randomSeed: String(seed),
  };
  const baseParams = buildSimParams(baselineScenario, samples);
  baseParams.seed = seed;
  baseParams.numSimulations = pathsPerPoint;

  /** @type {object[]} */
  const designPoints = [];
  designPoints.push({
    kind: 'baseline',
    variableId: null,
    value: null,
    params: stripSharedArrays(baseParams),
  });

  /** Metadata for assembleLabSweepResult (live + sentinels only). */
  const variableDefs = [];

  for (const entry of live) {
    variableDefs.push({
      id: entry.id,
      label: entry.label,
      group: entry.group,
      category: entry.category,
      unit: entry.unit,
      baselineValue: entry.baselineValue,
      envelope: { ...entry.envelope },
      crnSafe: entry.crnSafe,
      isSentinel: entry.isSentinel,
      gatedOff: false,
    });

    const values = linspace(entry.envelope.low, entry.envelope.high, sweepPoints);
    for (const value of values) {
      // Skip exact baseline — shared baseline evaluation covers it.
      if (entry.baselineValue != null && Math.abs(value - entry.baselineValue) < 1e-12) {
        continue;
      }
      const perturbed = entry.apply(prepared, value);
      const pointScenario = {
        ...perturbed,
        numSimulations: pathsPerPoint,
        randomSeed: String(seed),
      };
      const params = buildSimParams(pointScenario, samples);
      params.seed = seed;
      params.numSimulations = pathsPerPoint;
      designPoints.push({
        kind: entry.isSentinel ? 'sentinel' : 'variable',
        variableId: entry.id,
        value,
        params: stripSharedArrays(params),
      });
    }
  }

  return {
    baseParams,
    designPoints,
    variableDefs,
    meta: {
      seed,
      pathsPerPoint,
      sweepPoints,
      baselineRef: config.baselineRef || null,
      liveVariableCount: live.filter((v) => !v.isSentinel).length,
      designPointCount: designPoints.length,
    },
  };
}

/**
 * Cheap pre-run cost estimate (no buildSimParams). Counts live variables and
 * design points the same way buildSweepJob would.
 */
export function estimateSweepCost(scenario, config) {
  const sweepPoints = config.sweepPoints || DEFAULT_SWEEP_POINTS;
  const pathsPerPoint = config.pathsPerPoint || DEFAULT_PATHS_PER_POINT;
  const prepared = ensureScenarioProfiles(scenario);
  const { live } = resolveLabVariables(prepared, config.envelopeOverrides || {});
  let designPointCount = 1; // shared baseline
  for (const entry of live) {
    const values = linspace(entry.envelope.low, entry.envelope.high, sweepPoints);
    for (const value of values) {
      if (entry.baselineValue != null && Math.abs(value - entry.baselineValue) < 1e-12) {
        continue;
      }
      designPointCount++;
    }
  }
  return {
    liveVariables: live.filter((v) => !v.isSentinel).length,
    designPoints: designPointCount,
    pathsPerPoint,
    totalPaths: designPointCount * pathsPerPoint,
  };
}
