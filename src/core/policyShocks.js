// Policy shock generators for Social Security (and later Roth) Monte Carlo.
//
// Seeded via deriveSeed so shocks stay CRN-compatible with market draws.
// Written here with SS as the first consumer; Roth will reuse in Phase 3.
//
// Shocks modeled:
//   1. Effective tax-rate noise around a user base rate (benefit taxation proxy)
//   2. Benefit-cut scenarios — discrete cut at a calendar year, or phased

import { createRng, deriveSeed } from './rng.js';

/**
 * Draw an effective tax rate for one path: baseRate ± noise, clamped to [0, 1).
 * @param {number} baseSeed
 * @param {number} pathIndex
 * @param {{ baseRate: number, noiseStd?: number }} opts - rates as decimals (0.15 = 15%)
 */
export function drawTaxRateShock(baseSeed, pathIndex, { baseRate = 0, noiseStd = 0.05 } = {}) {
  const rng = createRng(deriveSeed(baseSeed >>> 0, pathIndex * 2 + 1));
  const z = rng.normal();
  const rate = (Number(baseRate) || 0) + z * (Number(noiseStd) || 0);
  return Math.max(0, Math.min(0.6, rate));
}

/**
 * Benefit multiplier schedule for a path.
 *
 * Modes:
 *   - none: always 1
 *   - discrete: drops to (1 - cutFraction) starting at cutYearIndex (0-based year of cashflow)
 *   - phased: linearly phases cutFraction over phaseYears starting at cutYearIndex
 *
 * @returns {(yearIndex: number) => number} multiplier in (0, 1]
 */
export function createBenefitCutSchedule(baseSeed, pathIndex, opts = {}) {
  const mode = opts.mode || 'none';
  if (mode === 'none') {
    return () => 1;
  }

  const cutFraction = Math.max(0, Math.min(0.5, Number(opts.cutFraction) || 0.2));
  const cutYearIndex = Math.max(0, parseInt(opts.cutYearIndex, 10) || 10);
  const phaseYears = Math.max(1, parseInt(opts.phaseYears, 10) || 5);

  // Optional path-level jitter on cut timing (±2 years) for MC diversity.
  const rng = createRng(deriveSeed(baseSeed >>> 0, pathIndex * 2 + 3));
  const jitter = opts.jitterYears
    ? Math.round((rng.uniform() * 2 - 1) * Number(opts.jitterYears))
    : 0;
  const start = Math.max(0, cutYearIndex + jitter);

  if (mode === 'discrete') {
    return (yearIndex) => (yearIndex >= start ? 1 - cutFraction : 1);
  }

  // phased
  return (yearIndex) => {
    if (yearIndex < start) return 1;
    const t = Math.min(1, (yearIndex - start + 1) / phaseYears);
    return 1 - cutFraction * t;
  };
}

/**
 * Apply tax + benefit-cut shocks to a nominal (pre-shock) annual benefit series.
 * Returns after-tax annual benefits.
 *
 * @param {number[]} annualBenefits - real $/year pre-tax benefits
 * @param {number} taxRate - effective rate decimal
 * @param {(yearIndex: number) => number} benefitMultiplier
 */
export function applyPolicyShocksToBenefits(annualBenefits, taxRate, benefitMultiplier) {
  const afterTaxKeep = 1 - Math.max(0, Math.min(1, taxRate));
  return annualBenefits.map((amt, i) => {
    const cut = benefitMultiplier(i);
    return Math.max(0, amt) * cut * afterTaxKeep;
  });
}
