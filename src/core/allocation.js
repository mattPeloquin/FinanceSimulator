// Per-year asset allocation schedules. The static mix is year 0; optional
// tiers are later target mixes. Between waypoints the engine glides each
// category weight linearly, then renormalizes so weights still sum to 100%.

/** Engine keys matching simulation.js / buildSimParams.allocation. */
export const ALLOCATION_ENGINE_KEYS = [
  'usLgGrowth',
  'usLgValue',
  'usSmMid',
  'exUs',
  'bond',
  'cash',
];

/** Scenario % field → engine decimal key (usLgGrowthAllocation → usLgGrowth). */
export function allocationKeyToEngine(scenarioKey) {
  return scenarioKey.replace(/Allocation$/, '');
}

/** Copy an allocation object (engine decimals). */
export function copyAllocation(allocation) {
  const out = {};
  for (const key of ALLOCATION_ENGINE_KEYS) {
    out[key] = allocation?.[key] || 0;
  }
  return out;
}

/** Convert a tier's scenario % fields into engine decimal weights. */
export function tierMixToDecimal(tier, allocationKeys) {
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

/** Linearly blend two mixes; each category is independent before renormalize. */
function lerpAllocation(a, b, t) {
  const out = {};
  for (const key of ALLOCATION_ENGINE_KEYS) {
    const left = a[key] || 0;
    const right = b[key] || 0;
    out[key] = left + (right - left) * t;
  }
  return out;
}

/** Force weights to sum to 1 so float drift / slight UI rounding cannot break the mix. */
export function renormalizeAllocation(allocation) {
  const out = copyAllocation(allocation);
  let sum = 0;
  for (const key of ALLOCATION_ENGINE_KEYS) sum += out[key];
  if (sum <= 0) {
    // Degenerate: fall back to equal weights so the sim still has a portfolio.
    const equal = 1 / ALLOCATION_ENGINE_KEYS.length;
    for (const key of ALLOCATION_ENGINE_KEYS) out[key] = equal;
    return out;
  }
  for (const key of ALLOCATION_ENGINE_KEYS) out[key] /= sum;
  return out;
}

/**
 * Expand allocation-over-time tiers into one mix per simulation year.
 *
 * @param {Array} tiers - scenario tiers (% fields + optional years on non-last)
 * @param {number} numYears - horizon length
 * @param {object} startAllocation - engine decimals for year 0 (static Asset Allocation)
 * @param {string[]} allocationKeys - ALLOCATION_KEYS from scenario.js
 */
export function buildAllocationOverTimeSeries(tiers, numYears, startAllocation, allocationKeys) {
  if (numYears <= 0) return [];

  const start = renormalizeAllocation(startAllocation);
  if (!Array.isArray(tiers) || tiers.length === 0) {
    return Array.from({ length: numYears }, () => copyAllocation(start));
  }

  // Waypoints: year-index → target mix. Year 0 is always the static start mix.
  // Intermediate tiers advance the cursor by their year span; the last tier
  // lands at the end of the horizon so the final glide covers remaining years.
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
    // Cursor already at/past the horizon: replace the last waypoint mix so the
    // end-of-horizon target is still the final tier.
    waypoints[waypoints.length - 1] = { year: endYear, mix: lastMix };
  }

  const series = new Array(numYears);
  for (let j = 0; j < numYears; j++) {
    // Find the segment that covers the start of year j.
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
