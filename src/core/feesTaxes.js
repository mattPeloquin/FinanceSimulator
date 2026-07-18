// Rough advisor-fee and withdrawal-tax helpers. Not tax law — sensitivity knobs.
// Rates are fractions (0.15 = 15%). Tax dollars = rate × net band; gross = net + tax.

export const ZERO_WITHDRAWAL_TAX = Object.freeze({
  taxRate: 0,
  applyToGifts: true,
  // Progressive brackets: [{ threshold /* dollars */, rate /* fraction */ }, ...]
  // sorted ascending; empty = flat taxRate on all net spending.
  spendBrackets: Object.freeze([]),
});

function clampRate(rate) {
  if (!Number.isFinite(rate) || rate <= 0) return 0;
  // Keep gross finite: tax cannot consume the entire net slice.
  return Math.min(rate, 0.99);
}

/**
 * Progressive bands for a year: base rate on [0, firstThreshold), then each
 * bracket rate on [threshold_i, threshold_{i+1}) with the last open-ended.
 */
function buildBands(yearTax) {
  const baseRate = clampRate(yearTax?.taxRate);
  const brackets = Array.isArray(yearTax?.spendBrackets) ? yearTax.spendBrackets : [];
  const cleaned = brackets
    .map((b) => ({
      threshold: Number(b?.threshold),
      rate: clampRate(b?.rate),
    }))
    .filter((b) => Number.isFinite(b.threshold) && b.threshold > 0)
    .sort((a, b) => a.threshold - b.threshold);

  if (cleaned.length === 0) {
    return [{ lo: 0, hi: Infinity, rate: baseRate }];
  }

  const bands = [{ lo: 0, hi: cleaned[0].threshold, rate: baseRate }];
  for (let i = 0; i < cleaned.length; i++) {
    const lo = cleaned[i].threshold;
    const hi = i + 1 < cleaned.length ? cleaned[i + 1].threshold : Infinity;
    bands.push({ lo, hi, rate: cleaned[i].rate });
  }
  return bands;
}

/**
 * Tax on a net spending slice under a progressive schedule, given how much
 * taxable net has already been counted this year.
 *
 * Marginal bands (not a cliff on the whole amount): base taxRate below the
 * first bracket threshold; each spend bracket applies only above its threshold.
 */
export function taxOnNetSlice(netSlice, priorTaxableNet, yearTax = ZERO_WITHDRAWAL_TAX) {
  const net = Math.max(0, Number(netSlice) || 0);
  if (net <= 0) return 0;

  const prior = Math.max(0, Number(priorTaxableNet) || 0);
  const lo = prior;
  const hi = prior + net;
  let tax = 0;
  for (const band of buildBands(yearTax)) {
    // Overlap of [lo, hi) with [band.lo, band.hi).
    const overlap = Math.max(0, Math.min(hi, band.hi) - Math.max(lo, band.lo));
    if (overlap > 0) tax += overlap * band.rate;
  }
  return tax;
}

/** Gross portfolio outflow needed to deliver `netSlice` after withdrawal tax. */
export function grossUpNet(netSlice, priorTaxableNet, yearTax = ZERO_WITHDRAWAL_TAX) {
  const net = Number(netSlice) || 0;
  if (net <= 0) {
    return { net: Math.min(0, net), tax: 0, gross: net };
  }
  const tax = taxOnNetSlice(net, priorTaxableNet, yearTax);
  return { net, tax, gross: net + tax };
}

/**
 * Expand staged withdrawal-tax tiers into a per-year series.
 * Intermediate tiers run for their year count; the last fills the horizon.
 * Empty tiers → zero tax every year.
 *
 * Tier fields (UI / scenario): taxPct, years?, applyToGifts,
 * spendBrackets?: [{ above ($000s), taxPct }].
 * `toDollarsFn` converts `above` thousands → dollars.
 */
export function buildWithdrawalTaxSeries(tiers, numYears, toDollarsFn = (k) => k * 1000) {
  if (numYears <= 0) return [];

  const series = new Array(numYears);
  for (let i = 0; i < numYears; i++) {
    series[i] = { ...ZERO_WITHDRAWAL_TAX, spendBrackets: [] };
  }

  if (!tiers || tiers.length === 0) return series;

  let yearIndex = 0;
  for (let i = 0; i < tiers.length - 1; i++) {
    const span = Math.max(0, parseInt(tiers[i].years, 10) || 0);
    const yearTax = tierToYearTax(tiers[i], toDollarsFn);
    for (let k = 0; k < span && yearIndex < numYears; k++) {
      series[yearIndex++] = yearTax;
    }
  }

  const last = tierToYearTax(tiers[tiers.length - 1], toDollarsFn);
  while (yearIndex < numYears) {
    series[yearIndex++] = last;
  }
  return series;
}

function tierToYearTax(tier, toDollarsFn) {
  const taxPct = Number(tier?.taxPct);
  const rawBrackets = Array.isArray(tier?.spendBrackets) ? tier.spendBrackets : [];
  const spendBrackets = [];
  for (const b of rawBrackets) {
    const above = b?.above;
    if (above == null || above === '') continue;
    const dollars = toDollarsFn(above);
    if (!(Number.isFinite(dollars) && dollars > 0)) continue;
    const pct = Number(b?.taxPct);
    spendBrackets.push({
      threshold: dollars,
      rate: Number.isFinite(pct) ? pct / 100 : 0,
    });
  }
  spendBrackets.sort((a, b) => a.threshold - b.threshold);

  return {
    taxRate: Number.isFinite(taxPct) ? taxPct / 100 : 0,
    applyToGifts: tier?.applyToGifts !== false,
    spendBrackets,
  };
}

/** True when any year has a positive tax rate (flat or any spend bracket). */
export function withdrawalTaxSeriesActive(series) {
  if (!series || series.length === 0) return false;
  return series.some(
    (y) => (y?.taxRate > 0)
      || (Array.isArray(y?.spendBrackets) && y.spendBrackets.some((b) => b?.rate > 0)),
  );
}

/**
 * Gross-up each non-negative plan dollar for glide funding / remaining-need.
 * Negative plan entries (deposits) pass through unchanged.
 */
export function grossUpPlanSchedule(netPlan, taxSeries) {
  if (!netPlan || netPlan.length === 0) return netPlan || [];
  return netPlan.map((net, j) => {
    if (!(net > 0)) return net;
    const yearTax = taxSeries?.[j] ?? ZERO_WITHDRAWAL_TAX;
    return grossUpNet(net, 0, yearTax).gross;
  });
}
