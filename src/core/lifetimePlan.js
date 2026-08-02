// Lifetime Plan aggregator — align per-feature cashflow series onto calendar years
// and sum them into a household net cashflow view.
//
// Source series use year indices 0..N-1 with a startAge (see cashflowSeries.js).
// Plan owns the calendar window (planStartYear..planEndYear) and birth years so
// age-based series can be placed on the same axis as plan-year series (startAge 0).

import { buildCashflowSeries } from '../state/cashflowSeries.js';

/**
 * @typedef {object} PlanAlignedSource
 * @property {string} id - stable row id in Plan state
 * @property {string} feature - source feature id
 * @property {string} [label] - display label
 * @property {string} strategyId - key into series.seriesByStrategy
 * @property {number} [offsetYears] - manual shift applied after auto-alignment
 * @property {object} series - CashflowSeries blob
 * @property {boolean} [enabled]
 */

/**
 * Resolve the calendar year of series index 0 for one source.
 *
 * Rules:
 * - startAge === 0 means "starts now" (Accumulate) → planStartYear
 * - startAge > 0 means calendar age → birthYear + startAge
 * - offsetYears then shifts the resolved start (user override)
 *
 * @param {object} opts
 * @param {number} opts.startAge
 * @param {number} opts.planStartYear
 * @param {number|null|undefined} opts.birthYearA
 * @param {number|null|undefined} [opts.birthYearB] - reserved; person A is the household anchor
 * @param {number} [opts.offsetYears=0]
 * @returns {number} calendar year for series index 0
 */
export function resolveSourceStartYear({
  startAge,
  planStartYear,
  birthYearA,
  birthYearB: _birthYearB,
  offsetYears = 0,
} = {}) {
  void _birthYearB;
  const planStart = Math.round(Number(planStartYear)) || new Date().getFullYear();
  const age = Number(startAge);
  const offset = Math.round(Number(offsetYears)) || 0;

  let baseYear;
  if (!Number.isFinite(age) || age === 0) {
    // Plan-year series: year 0 is "now" relative to the Plan window.
    baseYear = planStart;
  } else if (birthYearA == null || birthYearA === '') {
    // Fall back to plan start when birth year is missing so charts still render.
    baseYear = planStart;
  } else {
    // Age-based series: calendar year when the person reaches startAge.
    const birth = Math.round(Number(birthYearA));
    if (!Number.isFinite(birth) || birth < 1800) {
      baseYear = planStart;
    } else {
      baseYear = birth + age;
    }
  }
  return baseYear + offset;
}

/**
 * Place one strategy's annual amounts onto a calendar-year axis.
 * Years outside [planStartYear, planEndYear] are dropped (contribute nothing).
 *
 * @param {object} series - CashflowSeries
 * @param {string} strategyId
 * @param {object} opts
 * @param {number} opts.planStartYear
 * @param {number} opts.planEndYear
 * @param {number} opts.sourceStartYear - calendar year of series index 0
 * @returns {Map<number, number>} calendarYear → signed real dollars
 */
export function alignSeriesToCalendar(series, strategyId, {
  planStartYear,
  planEndYear,
  sourceStartYear,
} = {}) {
  /** @type {Map<number, number>} */
  const byYear = new Map();
  const start = Math.round(Number(planStartYear));
  const end = Math.round(Number(planEndYear));
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return byYear;

  const annual = series?.seriesByStrategy?.[strategyId]?.annual;
  if (!Array.isArray(annual)) return byYear;

  const baseCalendarYear = Math.round(Number(sourceStartYear));
  if (!Number.isFinite(baseCalendarYear)) return byYear;

  for (let index = 0; index < annual.length; index++) {
    const calendarYear = baseCalendarYear + index;
    if (calendarYear < start || calendarYear > end) continue;
    const amount = Number(annual[index]);
    if (!Number.isFinite(amount)) continue;
    byYear.set(calendarYear, (byYear.get(calendarYear) || 0) + amount);
  }
  return byYear;
}

/**
 * Build the household lifetime plan view from resolved source series.
 *
 * For each calendar year in the plan window:
 * - sum every enabled source's aligned amount → net
 * - walk a running cumulative total of net
 *
 * @param {object} opts
 * @param {PlanAlignedSource[]} opts.sources
 * @param {number} opts.planStartYear
 * @param {number} opts.planEndYear
 * @param {number|null} [opts.birthYearA]
 * @param {number|null} [opts.birthYearB]
 * @returns {{
 *   years: number[],
 *   rows: Array<{ year: number, bySource: Record<string, number>, net: number, cumulative: number }>,
 *   net: number[],
 *   cumulative: number[],
 *   bySource: Record<string, number[]>,
 *   sourceMeta: Array<{ id: string, feature: string, label: string, strategyId: string, startYear: number }>,
 *   totals: { net: number, bySource: Record<string, number> },
 * }}
 */
export function buildLifetimePlan({
  sources = [],
  planStartYear,
  planEndYear,
  birthYearA = null,
  birthYearB = null,
} = {}) {
  const start = Math.round(Number(planStartYear)) || new Date().getFullYear();
  const endRaw = Math.round(Number(planEndYear));
  const end = Number.isFinite(endRaw) && endRaw >= start ? endRaw : start;
  const numYears = end - start + 1;
  const years = Array.from({ length: numYears }, (_, i) => start + i);

  /** @type {Array<{ id: string, feature: string, label: string, strategyId: string, startYear: number, enabled: boolean, amounts: Map<number, number> }>} */
  const resolved = [];

  for (const src of sources || []) {
    if (!src || src.enabled === false) continue;
    const series = src.series;
    if (!series || typeof series !== 'object') continue;
    const strategyId = String(src.strategyId || '');
    if (!strategyId || !series.seriesByStrategy?.[strategyId]) continue;

    const sourceStartYear = resolveSourceStartYear({
      startAge: series.startAge,
      planStartYear: start,
      birthYearA,
      birthYearB,
      offsetYears: src.offsetYears || 0,
    });

    const amounts = alignSeriesToCalendar(series, strategyId, {
      planStartYear: start,
      planEndYear: end,
      sourceStartYear,
    });

    resolved.push({
      id: String(src.id),
      feature: String(src.feature || series.sourceFeature || ''),
      label: String(src.label || src.feature || src.id),
      strategyId,
      startYear: sourceStartYear,
      enabled: true,
      amounts,
    });
  }

  /** @type {Record<string, number[]>} */
  const bySource = {};
  for (const src of resolved) {
    bySource[src.id] = years.map((year) => src.amounts.get(year) || 0);
  }

  const net = new Array(numYears).fill(0);
  const cumulative = new Array(numYears).fill(0);
  /** @type {Record<string, number>} */
  const totalBySource = {};
  let running = 0;
  let totalNet = 0;

  const rows = years.map((year, i) => {
    /** @type {Record<string, number>} */
    const yearBySource = {};
    let yearNet = 0;
    for (const src of resolved) {
      const amount = src.amounts.get(year) || 0;
      yearBySource[src.id] = amount;
      yearNet += amount;
      totalBySource[src.id] = (totalBySource[src.id] || 0) + amount;
    }
    net[i] = yearNet;
    running += yearNet;
    cumulative[i] = running;
    totalNet += yearNet;
    return {
      year,
      bySource: yearBySource,
      net: yearNet,
      cumulative: running,
    };
  });

  return {
    years,
    rows,
    net,
    cumulative,
    bySource,
    sourceMeta: resolved.map((s) => ({
      id: s.id,
      feature: s.feature,
      label: s.label,
      strategyId: s.strategyId,
      startYear: s.startYear,
    })),
    totals: {
      net: totalNet,
      bySource: totalBySource,
    },
  };
}

/**
 * Export the Plan aggregate as a CashflowSeries (single `net` strategy).
 * Year indices are relative to planStartYear (startAge 0).
 *
 * @param {object} planResult - return value of buildLifetimePlan
 * @param {object} [opts]
 * @param {string|null} [opts.sessionName]
 * @returns {import('../state/cashflowSeries.js').CashflowSeries}
 */
export function buildPlanCashflowSeries(planResult, opts = {}) {
  const years = planResult?.years || [];
  const net = planResult?.net || [];
  return buildCashflowSeries({
    sourceFeature: 'plan',
    startAge: 0,
    sessionName: opts.sessionName ?? null,
    numYears: years.length,
    annualByStrategy: { net },
  });
}

/**
 * Features whose cashflows inject into portfolio sims (not portfolio themselves).
 * Accumulate / Withdraw are the portfolio engines; their own series are excluded.
 */
export const EXTERNAL_INJECT_FEATURES = Object.freeze([
  'ss-timing',
  'house-equity',
]);

/**
 * Sum enabled external (non-portfolio) source cashflows onto the plan calendar.
 *
 * @param {object} opts
 * @param {PlanAlignedSource[]} opts.sources - already-resolved sources (with series)
 * @param {number} opts.planStartYear
 * @param {number} opts.planEndYear
 * @param {number|null} [opts.birthYearA]
 * @param {number|null} [opts.birthYearB]
 * @param {string[]} [opts.features] - which features to include (default EXTERNAL_INJECT)
 * @returns {{ years: number[], flows: number[], byYear: Map<number, number> }}
 */
export function externalFlowsForWindow({
  sources = [],
  planStartYear,
  planEndYear,
  birthYearA = null,
  birthYearB = null,
  features = EXTERNAL_INJECT_FEATURES,
} = {}) {
  const allowed = new Set(features || EXTERNAL_INJECT_FEATURES);
  const filtered = (sources || []).filter(
    (s) => s && s.enabled !== false && allowed.has(String(s.feature)),
  );
  const plan = buildLifetimePlan({
    sources: filtered,
    planStartYear,
    planEndYear,
    birthYearA,
    birthYearB,
  });
  /** @type {Map<number, number>} */
  const byYear = new Map();
  for (let i = 0; i < plan.years.length; i++) {
    byYear.set(plan.years[i], plan.net[i] || 0);
  }
  return { years: plan.years, flows: plan.net, byYear };
}

/**
 * Slice calendar-year flows into a contiguous window starting at `windowStartYear`
 * for `numYears` engine years (index 0 = windowStartYear).
 *
 * @param {Map<number, number>|Record<number, number>} byYear
 * @param {number} windowStartYear
 * @param {number} numYears
 * @returns {number[]} dollars per engine year
 */
export function flowsForEngineWindow(byYear, windowStartYear, numYears) {
  const n = Math.max(0, numYears | 0);
  const start = Math.round(Number(windowStartYear));
  const out = new Array(n).fill(0);
  if (!Number.isFinite(start) || n === 0) return out;
  const get = byYear instanceof Map
    ? (y) => byYear.get(y) || 0
    : (y) => Number(byYear?.[y]) || 0;
  for (let i = 0; i < n; i++) {
    out[i] = get(start + i);
  }
  return out;
}

/**
 * Map dollar flows → Accumulate synthetic one-year events ($000s units).
 * `buildEventSeries` multiplies amount by 1000, so we divide here.
 *
 * @param {number[]} flowsDollars - per engine year
 * @returns {Array<{ amount: number, startYear: number, years: number }>}
 */
export function flowsToAccumulateEvents(flowsDollars) {
  const events = [];
  const arr = Array.isArray(flowsDollars) ? flowsDollars : [];
  for (let i = 0; i < arr.length; i++) {
    const dollars = Number(arr[i]) || 0;
    if (dollars === 0) continue;
    events.push({
      amount: dollars / 1000,
      startYear: i + 1,
      years: 1,
    });
  }
  return events;
}

/**
 * Copy dollar flows into a Withdraw majorEventsSeries-length array.
 * Caller overwrites `params.portfolio.majorEventsSeries` after buildSimParams.
 *
 * @param {number[]} flowsDollars
 * @param {number} numYears - engine maxYears
 * @returns {number[]}
 */
export function flowsToWithdrawMajorEventsSeries(flowsDollars, numYears) {
  const n = Math.max(0, numYears | 0);
  const out = new Array(n).fill(0);
  const arr = Array.isArray(flowsDollars) ? flowsDollars : [];
  for (let i = 0; i < n; i++) {
    out[i] = Number(arr[i]) || 0;
  }
  return out;
}

/**
 * True when a Withdraw scenario cannot accept major-event injection.
 * @param {object} scenario
 */
export function withdrawBlocksExternalInjection(scenario) {
  return String(scenario?.withdrawalStrategy || '') === 'specific';
}

/**
 * Align a length-(numYears+1) residual-equity series onto the plan calendar.
 * Index 0 = start of sourceStartYear; index k = end of (sourceStartYear + k - 1)
 * for k≥1 — same convention as Accumulate cone / HE residualEquityReal.
 *
 * For each calendar year Y in the plan window we take the **end-of-year**
 * value: series[Y - sourceStartYear + 1].
 *
 * @param {number[]} residualSeries
 * @param {number} sourceStartYear
 * @param {number[]} planYears
 * @returns {number[]}
 */
export function alignBalanceSeriesToPlanYears(residualSeries, sourceStartYear, planYears) {
  const years = Array.isArray(planYears) ? planYears : [];
  const series = Array.isArray(residualSeries) ? residualSeries : [];
  const base = Math.round(Number(sourceStartYear));
  return years.map((year) => {
    if (!Number.isFinite(base)) return 0;
    // End-of-year index for calendar `year`.
    const idx = (year - base) + 1;
    if (idx < 0 || idx >= series.length) return 0;
    const v = Number(series[idx]);
    return Number.isFinite(v) ? v : 0;
  });
}

/**
 * Compose household net worth = portfolio + home equity (median residual).
 *
 * Portfolio stitching:
 * - Accumulate cone: index 0 = start balance; index k = end of year k.
 *   End-of-year for calendar year Y = cone[Y - accumStart + 1].
 * - Withdraw fan: index 0 = end of withdraw year 1.
 *   End-of-year for calendar year Y = fan[Y - withdrawStart].
 * - Gap years (between accumulate end and withdraw start): hold last
 *   accumulate ending balance flat (real dollars; no growth modeled).
 *
 * Home equity (median residualEquityReal only) is added to all three bands so
 * the band width reflects portfolio uncertainty alone.
 *
 * Explicitly ignores House Equity portfolioReal and Roth netWorthByYear.
 *
 * @param {object} opts
 * @param {number[]} opts.planYears
 * @param {{ startYear: number, cone: Array<{ p10: number, p50: number, p90: number }> }|null} [opts.accumulate]
 * @param {{ startYear: number, low: number[], median: number[], high: number[] }|null} [opts.withdraw]
 * @param {{ startYear: number, residual: number[] }|null} [opts.homeEquity]
 * @returns {{
 *   years: number[],
 *   portfolio: { low: number[], median: number[], high: number[] },
 *   homeEquity: number[],
 *   netWorth: { low: number[], median: number[], high: number[] },
 * }}
 */
export function composeNetWorth({
  planYears = [],
  accumulate = null,
  withdraw = null,
  homeEquity = null,
} = {}) {
  const years = Array.isArray(planYears) ? planYears.slice() : [];
  const n = years.length;
  const portfolioLow = new Array(n).fill(NaN);
  const portfolioMed = new Array(n).fill(NaN);
  const portfolioHigh = new Array(n).fill(NaN);

  const accumStart = accumulate ? Math.round(Number(accumulate.startYear)) : null;
  const cone = accumulate?.cone || null;
  const withdrawStart = withdraw ? Math.round(Number(withdraw.startYear)) : null;
  const wLow = withdraw?.low || null;
  const wMed = withdraw?.median || null;
  const wHigh = withdraw?.high || null;

  // Last accumulate end-of-year balance (for gap fill).
  let lastAccumLow = NaN;
  let lastAccumMed = NaN;
  let lastAccumHigh = NaN;
  if (cone?.length) {
    const last = cone[cone.length - 1];
    lastAccumLow = Number(last?.p10);
    lastAccumMed = Number(last?.p50);
    lastAccumHigh = Number(last?.p90);
  }

  for (let i = 0; i < n; i++) {
    const year = years[i];
    let low = NaN;
    let med = NaN;
    let high = NaN;

    // Prefer Withdraw when its window covers this year.
    if (
      withdrawStart != null
      && Number.isFinite(withdrawStart)
      && year >= withdrawStart
      && wMed
    ) {
      const wi = year - withdrawStart;
      if (wi >= 0 && wi < wMed.length) {
        low = Number(wLow?.[wi]);
        med = Number(wMed[wi]);
        high = Number(wHigh?.[wi]);
      }
    } else if (
      accumStart != null
      && Number.isFinite(accumStart)
      && cone?.length
    ) {
      // End-of-year index into cone (cone[0] = start).
      const ci = (year - accumStart) + 1;
      if (ci >= 1 && ci < cone.length) {
        low = Number(cone[ci]?.p10);
        med = Number(cone[ci]?.p50);
        high = Number(cone[ci]?.p90);
      } else if (
        // Gap: after accumulate horizon, before withdraw (or no withdraw).
        ci >= cone.length
        && (withdrawStart == null || year < withdrawStart)
      ) {
        low = lastAccumLow;
        med = lastAccumMed;
        high = lastAccumHigh;
      }
    }

    portfolioLow[i] = Number.isFinite(low) ? low : NaN;
    portfolioMed[i] = Number.isFinite(med) ? med : NaN;
    portfolioHigh[i] = Number.isFinite(high) ? high : NaN;
  }

  const home = homeEquity
    ? alignBalanceSeriesToPlanYears(
      homeEquity.residual,
      homeEquity.startYear,
      years,
    )
    : new Array(n).fill(0);

  const nwLow = new Array(n);
  const nwMed = new Array(n);
  const nwHigh = new Array(n);
  for (let i = 0; i < n; i++) {
    const he = home[i] || 0;
    nwLow[i] = Number.isFinite(portfolioLow[i]) ? portfolioLow[i] + he : NaN;
    nwMed[i] = Number.isFinite(portfolioMed[i]) ? portfolioMed[i] + he : NaN;
    nwHigh[i] = Number.isFinite(portfolioHigh[i]) ? portfolioHigh[i] + he : NaN;
  }

  return {
    years,
    portfolio: { low: portfolioLow, median: portfolioMed, high: portfolioHigh },
    homeEquity: home,
    netWorth: { low: nwLow, median: nwMed, high: nwHigh },
  };
}

/**
 * Resolve Withdraw calendar start when linked to an Accumulate source.
 *
 * @param {object} opts
 * @param {number} opts.accumulateStartYear
 * @param {number} opts.accumulateNumYears
 * @param {number} [opts.gapYears=0]
 * @returns {number} calendar year of Withdraw series index 0
 */
export function resolveWithdrawStartAfterAccumulate({
  accumulateStartYear,
  accumulateNumYears,
  gapYears = 0,
} = {}) {
  const start = Math.round(Number(accumulateStartYear));
  const n = Math.max(0, Math.round(Number(accumulateNumYears)) || 0);
  const gap = Math.max(0, Math.round(Number(gapYears)) || 0);
  if (!Number.isFinite(start)) return NaN;
  // Accumulate covers start .. start+n-1; Withdraw begins the next calendar year
  // after the last accumulate year, plus any gap.
  return start + n + gap;
}
