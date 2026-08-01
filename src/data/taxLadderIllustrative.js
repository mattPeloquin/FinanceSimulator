// Illustrative federal-style ordinary-income rate ladder for Roth Convert.
//
// NOT authoritative tax advice and NOT kept in sync with IRS publications.
// Values approximate recent married-filing-jointly brackets so the ladder
// ships prefilled and editable. Users should replace ceilings/rates with
// their own planning assumptions.
//
// Each tier: taxable income up to `ceiling` (inclusive upper edge of the band)
// is taxed at `rate` (decimal). The final tier uses Infinity as ceiling.
//
// Ceilings are stored in real dollars, rounded to the nearest $1,000 (app
// $000s convention). The UI edits them in thousands.

/** @typedef {{ ceiling: number, rate: number, label?: string }} TaxLadderTier */

const THOUSANDS = 1000;

/** Round a dollar ceiling to the nearest $1,000 (Infinity passes through). */
export function roundLadderCeilingDollars(ceiling) {
  if (!Number.isFinite(Number(ceiling))) return Infinity;
  return Math.max(0, Math.round(Number(ceiling) / THOUSANDS) * THOUSANDS);
}

/**
 * Default illustrative MFJ-style ladder (real / today's dollars, $000s-rounded).
 * @returns {TaxLadderTier[]}
 */
export function defaultIllustrativeTaxLadder() {
  return [
    { ceiling: 24000, rate: 0.10, label: '10%' },
    { ceiling: 97000, rate: 0.12, label: '12%' },
    { ceiling: 207000, rate: 0.22, label: '22%' },
    { ceiling: 395000, rate: 0.24, label: '24%' },
    { ceiling: 501000, rate: 0.32, label: '32%' },
    { ceiling: 752000, rate: 0.35, label: '35%' },
    { ceiling: Infinity, rate: 0.37, label: '37%' },
  ];
}

/**
 * Normalize / sanitize a user-edited ladder. Sorts by ceiling ascending and
 * rounds finite ceilings to the nearest $1,000.
 * @param {TaxLadderTier[]|null|undefined} raw
 * @returns {TaxLadderTier[]}
 */
export function normalizeTaxLadder(raw) {
  const fallback = defaultIllustrativeTaxLadder();
  if (!Array.isArray(raw) || raw.length === 0) return fallback.map((t) => ({ ...t }));

  const tiers = raw
    .map((t) => ({
      ceiling: t?.ceiling == null || t.ceiling === '' || !Number.isFinite(Number(t.ceiling))
        ? Infinity
        : roundLadderCeilingDollars(t.ceiling),
      rate: Math.max(0, Math.min(0.6, Number(t.rate) || 0)),
      label: t?.label != null ? String(t.label) : undefined,
    }))
    .sort((a, b) => a.ceiling - b.ceiling);

  // Ensure a top open-ended tier so taxOnIncome never falls off the end.
  if (!Number.isFinite(tiers[tiers.length - 1].ceiling)) {
    tiers[tiers.length - 1].ceiling = Infinity;
  } else {
    tiers.push({ ceiling: Infinity, rate: tiers[tiers.length - 1].rate, label: 'top' });
  }
  return tiers;
}
