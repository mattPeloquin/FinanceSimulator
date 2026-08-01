// Compact RMD factor tables for Roth Convert (educational / illustrative).
//
// Uniform Lifetime (IRS Table III style) — used for most owner RMDs.
// Sole-spouse joint factors — simplified Table II style when the spouse is
// sole beneficiary and more than 10 years younger.
//
// These are planning approximations, not a compliance calculator.

/** Uniform Lifetime divisor by attained age in the distribution year. */
export const UNIFORM_LIFETIME_BY_AGE = Object.freeze({
  72: 27.4,
  73: 26.5,
  74: 25.5,
  75: 24.6,
  76: 23.7,
  77: 22.9,
  78: 22.0,
  79: 21.1,
  80: 20.2,
  81: 19.4,
  82: 18.5,
  83: 17.7,
  84: 16.8,
  85: 16.0,
  86: 15.2,
  87: 14.4,
  88: 13.7,
  89: 12.9,
  90: 12.2,
  91: 11.5,
  92: 10.8,
  93: 10.1,
  94: 9.5,
  95: 8.9,
  96: 8.4,
  97: 7.8,
  98: 7.3,
  99: 6.8,
  100: 6.4,
  101: 6.0,
  102: 5.6,
  103: 5.2,
  104: 4.9,
  105: 4.6,
  106: 4.3,
  107: 4.1,
  108: 3.9,
  109: 3.7,
  110: 3.5,
  111: 3.4,
  112: 3.3,
  113: 3.1,
  114: 3.0,
  115: 2.9,
  116: 2.8,
  117: 2.7,
  118: 2.5,
  119: 2.3,
  120: 2.0,
});

/**
 * Simplified joint-life divisors keyed by owner age, for a spouse ~15 years younger.
 * Used only when spouse-as-sole-beneficiary is enabled (educational stand-in for Table II).
 */
export const SOLE_SPOUSE_FACTOR_BY_OWNER_AGE = Object.freeze({
  72: 35.1,
  73: 34.2,
  74: 33.3,
  75: 32.3,
  76: 31.4,
  77: 30.5,
  78: 29.5,
  79: 28.6,
  80: 27.6,
  81: 26.7,
  82: 25.8,
  83: 24.8,
  84: 23.9,
  85: 23.0,
  86: 22.1,
  87: 21.2,
  88: 20.3,
  89: 19.5,
  90: 18.6,
  91: 17.8,
  92: 17.0,
  93: 16.2,
  94: 15.5,
  95: 14.7,
  96: 14.0,
  97: 13.3,
  98: 12.6,
  99: 12.0,
  100: 11.4,
  105: 8.9,
  110: 6.9,
  115: 5.3,
  120: 4.0,
});

/**
 * Look up an RMD divisor for the owner's age.
 * @param {number} ownerAge
 * @param {{ spouseSoleBeneficiary?: boolean }} [opts]
 * @returns {number} divisor (≥ 1)
 */
export function rmdDivisor(ownerAge, opts = {}) {
  const age = Math.max(72, Math.min(120, Math.floor(Number(ownerAge) || 72)));
  const table = opts.spouseSoleBeneficiary
    ? SOLE_SPOUSE_FACTOR_BY_OWNER_AGE
    : UNIFORM_LIFETIME_BY_AGE;

  if (table[age] != null) return table[age];

  // Nearest lower age key when the sole-spouse table skips years.
  let best = null;
  for (const key of Object.keys(table)) {
    const a = Number(key);
    if (a <= age && (best == null || a > best)) best = a;
  }
  if (best != null) return table[best];
  return UNIFORM_LIFETIME_BY_AGE[Math.min(120, age)] || 27.4;
}
