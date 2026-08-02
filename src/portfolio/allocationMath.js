// Per-year asset allocation schedules. Key lists come from the portfolio registry.

import { engineKeys, allocationKeyToEngine, pctKeys } from './registry.js';

/** @deprecated Prefer engineKeys() — compat for re-exports. */
export const ALLOCATION_ENGINE_KEYS = engineKeys();

export { allocationKeyToEngine };

export function copyAllocation(allocation) {
  const keys = engineKeys();
  const out = {};
  for (const key of keys) {
    out[key] = allocation?.[key] || 0;
  }
  return out;
}

export function tierMixToDecimal(tier, allocationKeys = pctKeys()) {
  const out = {};
  for (const scenarioKey of allocationKeys) {
    const engineKey = allocationKeyToEngine(scenarioKey);
    const pct = typeof tier?.[scenarioKey] === 'number'
      ? tier[scenarioKey]
      : parseFloat(tier?.[scenarioKey]);
    out[engineKey] = (Number.isFinite(pct) ? pct : 0) / 100;
  }
  return out;
}

function lerpAllocation(a, b, t) {
  const keys = engineKeys();
  const out = {};
  for (const key of keys) {
    const left = a[key] || 0;
    const right = b[key] || 0;
    out[key] = left + (right - left) * t;
  }
  return out;
}

export function renormalizeAllocation(allocation) {
  const keys = engineKeys();
  const out = copyAllocation(allocation);
  let sum = 0;
  for (const key of keys) sum += out[key];
  if (sum <= 0) {
    const equal = 1 / keys.length;
    for (const key of keys) out[key] = equal;
    return out;
  }
  for (const key of keys) out[key] /= sum;
  return out;
}

/**
 * Expand allocation-over-time tiers into one mix per simulation year.
 */
export function buildAllocationOverTimeSeries(tiers, numYears, startAllocation, allocationKeys = pctKeys()) {
  if (numYears <= 0) return [];

  const start = renormalizeAllocation(startAllocation);
  if (!Array.isArray(tiers) || tiers.length === 0) {
    return Array.from({ length: numYears }, () => copyAllocation(start));
  }

  const waypoints = [{ year: 0, mix: start }];
  let cursor = 0;
  for (let i = 0; i < tiers.length - 1; i++) {
    const span = Math.max(0, parseInt(tiers[i].years, 10) || 0);
    cursor += span;
    if (cursor > numYears) cursor = numYears;
    waypoints.push({
      year: cursor,
      mix: renormalizeAllocation(tierMixToDecimal(tiers[i], allocationKeys)),
    });
  }
  const lastMix = renormalizeAllocation(
    tierMixToDecimal(tiers[tiers.length - 1], allocationKeys),
  );
  const endYear = Math.max(cursor, numYears);
  if (waypoints[waypoints.length - 1].year < endYear) {
    waypoints.push({ year: endYear, mix: lastMix });
  } else {
    waypoints[waypoints.length - 1] = { year: endYear, mix: lastMix };
  }

  const series = new Array(numYears);
  for (let j = 0; j < numYears; j++) {
    let seg = 0;
    while (seg < waypoints.length - 2 && waypoints[seg + 1].year <= j) {
      seg += 1;
    }
    const left = waypoints[seg];
    const right = waypoints[Math.min(seg + 1, waypoints.length - 1)];
    let mix;
    if (right.year <= left.year) {
      mix = copyAllocation(left.mix);
    } else {
      const t = (j - left.year) / (right.year - left.year);
      mix = lerpAllocation(left.mix, right.mix, Math.min(1, Math.max(0, t)));
    }
    series[j] = renormalizeAllocation(mix);
  }
  return series;
}

/** Convert nested allocation % object into engine decimals. */
export function allocationPctToEngine(allocationPct) {
  return renormalizeAllocation(tierMixToDecimal(allocationPct, pctKeys()));
}
