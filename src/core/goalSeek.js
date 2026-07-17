// Goal Seek: given a target ending balance and a desired success percentage,
// search for the base withdrawal (and, optionally, a few other spending
// levers) that maximizes the headline planned schedule while still hitting
// the target. Desired Success % gates survive + ending balance; Risk Tolerance
// anchors spending at P(100 − Desired Success %) to about (1 − RT) × plan.
// Ranking is by planned dollars (not bonus-inflated actuals), then closer RT
// tail, then spend-down toward the Target Ending Balance. Pure and DOM-free,
// like the rest of `core/`, so it can run inside the worker and be
// unit-tested directly.

import {
  legacyGoalSuccessRate,
  withdrawalPlanRatioPercentile,
  spendingTailRate,
  median,
  isMedianYearlyMetric,
  isMeanYearlyMetric,
  perRunWithdrawalMetric,
} from './statistics.js';
import { buildBaseWithdrawalSchedule } from './withdrawal.js';

const DEFAULT_SEARCH_NUM_SIMULATIONS = 1000;
// Low cuts exclude 0% so Goal Seek always applies at least a mild downside
// adjustment (same "never stay at off" pattern as balance cut/boost and glide).
const DEFAULT_MARKET_DOWN_ADJ_GRID = { minPct: -50, maxPct: -5, stepPct: 5 };
// The upside grid reaches further than the downside one so the search can burn
// surplus down toward the target aggressively (+100% of base, coarser steps to
// keep the candidate count — and thus the search budget — in check). Starts at
// +10% (the step size) so High never stays at $0 either. There is no Expected
// (med) grid: at the expected return the plan is on plan, so the Expected
// adjustment is never searched — it stays at whatever the user typed (normally
// 0) and only anchors the Low/High grids.
const DEFAULT_MARKET_UP_ADJ_GRID = { minPct: 10, maxPct: 100, stepPct: 10 };
const DEFAULT_FLOOR_MULTIPLES = [0, 0.1, 0.2, 0.3, 0.4, 0.5];
// Used by the exported buildFractionGrid()'s own default (unit-tested directly).
const DEFAULT_PENALTY_BONUS_GRID = { minPct: 5, maxPct: 65, stepPct: 10 };
// Coarser than DEFAULT_PENALTY_BONUS_GRID: ceiling pairs tune balance threshold
// AND boost rate together (see buildPairGrid). Reaches to +300% because the
// ramp only adds the full bonus per whole multiple ABOVE the ceiling — at 1.5x
// the ceiling a 300% bonus is still only a 2.5x spending scale.
const DEFAULT_CEILING_BONUS_GRID = { minPct: 25, maxPct: 150, stepPct: 25 };
// Fixed full-depth floor max-cut grid. Risk Tolerance scales this through the
// first 0–20% envelope (see riskEnvelopeScale) instead of capping maxPct at RT.
const DEFAULT_FLOOR_PENALTY_GRID = { minPct: 0, maxPct: 50, stepPct: 10 };
const FLOOR_PENALTY_STEP_PCT = 10;
const BASE_BISECTION_MAX_ITERATIONS = 30;
// Risk Tolerance's first 0–20% linearly opens market / balance / glide search
// depth up to each lever's full max. Above 20%, grids stay full; RT only
// continues to widen the lifetime shortfall bar and legacy discount.
const RISK_ENVELOPE = 0.20;

// Bonus-amount candidates, as fractions of the currently-solved base withdrawal.
// Using a finer, lower grid prevents the final bonus from heavily cannibalizing
// the base and appearing as an unexpectedly high percentage in the final result.
const DEFAULT_GOGO_BONUS_FRACTIONS = [0.05, 0.1, 0.15, 0.2, 0.25, 0.3];

// Glide-path spend-down candidates: the share of each year's surplus above the
// glide path recycled into extra spending. Starts at 10% so the search always
// applies some surplus pressure. Finer at the low end — moderate fractions
// usually win because a full recycle leaves runs sitting knife-edge on the
// target, where the strict end >= target check fails them.
const DEFAULT_GLIDE_FRACTIONS = [0.1, 0.2, 0.4, 0.6];

// Each candidate scored via the re-solve scorer costs one inner bisection
// (this many predicate evaluations at reduced fidelity) plus one confirming
// evaluation at full search fidelity.
const RESOLVE_INNER_MAX_ITERATIONS = 10;
const RESOLVE_INNER_NUM_SIMULATIONS = 1000;

// Solving the base withdrawal first uses up the entire "risk budget" before
// any lever is considered, so a single lever-tuning pass often finds every
// lever stuck at neutral (there's no room left to add anything). Alternating
// between re-bisecting the base and re-tuning the levers a few times lets a
// later round reclaim slack an earlier round didn't have visibility into.
const DEFAULT_MAX_ROUNDS = 3;

// Currency fields are edited in $000s, so every dollar amount Goal Seek
// produces is snapped to the nearest $1,000 — otherwise the form would show
// fractional thousands (e.g. "84.532") instead of a clean whole number.
const DOLLAR_ROUNDING = 1000;
const DEFAULT_SHORTFALL_TOLERANCE = 0.2;
// After bisection floors the base to $1,000, walk upward a few steps while the
// split gate still passes — takes the high end of the Monte Carlo noise band
// instead of stopping on the conservative floor.
const MAX_BASE_NUDGE_STEPS = 20;

function roundToThousand(value) {
  return Math.round(value / DOLLAR_ROUNDING) * DOLLAR_ROUNDING;
}

// Linear 0→1 scale over the first RISK_ENVELOPE of shortfall tolerance.
// At 0% RT → 0 (mildest non-zero grids only); at ≥20% → 1 (full grids).
export function riskEnvelopeScale(shortfallTolerance = DEFAULT_SHORTFALL_TOLERANCE) {
  const tolerance = Number.isFinite(shortfallTolerance) ? shortfallTolerance : DEFAULT_SHORTFALL_TOLERANCE;
  return Math.min(Math.max(tolerance, 0) / RISK_ENVELOPE, 1);
}

function envelopeScaleFromConfig(config) {
  return riskEnvelopeScale(config.shortfallTolerance ?? DEFAULT_SHORTFALL_TOLERANCE);
}

// Scale a %-of-base or %-rate grid's deep end by `scale`, keeping step size and
// the mild end. At scale 0, collapses to the mildest non-zero candidate.
// - Down grids (maxPct < 0): scales minPct (deepest cut) toward 0.
// - Up grids (minPct > 0): scales maxPct (deepest boost) toward 0.
// - 0…positive rate grids: scales maxPct; when the scaled max sits below the
//   step, that scaled max becomes the sole candidate (never 0%).
export function scalePctGridByEnvelope(gridConfig, scale) {
  const { minPct, maxPct, stepPct } = gridConfig;
  const s = Math.min(Math.max(scale, 0), 1);

  if (maxPct < 0) {
    // Market Low: mildest is maxPct (e.g. -5), deepest is minPct (e.g. -50).
    if (s <= 0) return { minPct: maxPct, maxPct, stepPct };
    let scaledMin = s * minPct;
    if (scaledMin > maxPct) scaledMin = maxPct;
    return { minPct: scaledMin, maxPct, stepPct };
  }

  if (minPct > 0) {
    // Market High / positive-only: mildest is minPct, deepest is maxPct.
    if (s <= 0) return { minPct, maxPct: minPct, stepPct };
    let scaledMax = s * maxPct;
    if (scaledMax < minPct) scaledMax = minPct;
    return { minPct, maxPct: scaledMax, stepPct };
  }

  // Balance cut/boost style: 0…positive maxPct.
  if (s <= 0) {
    const mild = Math.max(stepPct, minPct > 0 ? minPct : stepPct);
    return { minPct: mild, maxPct: mild, stepPct };
  }
  let scaledMax = s * maxPct;
  if (scaledMax > 0 && scaledMax < stepPct) {
    return { minPct: 0, maxPct: scaledMax, stepPct };
  }
  return { minPct, maxPct: scaledMax, stepPct };
}

export function resolveMarketDownAdjGrid(config) {
  return scalePctGridByEnvelope(
    config.marketDownAdjGrid || DEFAULT_MARKET_DOWN_ADJ_GRID,
    envelopeScaleFromConfig(config),
  );
}

export function resolveMarketUpAdjGrid(config) {
  return scalePctGridByEnvelope(
    config.marketUpAdjGrid || DEFAULT_MARKET_UP_ADJ_GRID,
    envelopeScaleFromConfig(config),
  );
}

export function resolveFloorPenaltyGrid(config) {
  return scalePctGridByEnvelope(
    config.floorPenaltyGrid || DEFAULT_FLOOR_PENALTY_GRID,
    envelopeScaleFromConfig(config),
  );
}

export function resolveCeilingBonusGrid(config) {
  return scalePctGridByEnvelope(
    config.ceilingBonusGrid || DEFAULT_CEILING_BONUS_GRID,
    envelopeScaleFromConfig(config),
  );
}

// Glide surplus fractions capped at scale × full-grid max; always keep at least
// the mildest non-zero entry when the lever is searched.
export function resolveGlideFractions(config) {
  const full = config.glideFractions || DEFAULT_GLIDE_FRACTIONS;
  const mildest = full[0];
  const scale = envelopeScaleFromConfig(config);
  if (scale <= 0) return [mildest];
  const maxAllowed = scale * Math.max(...full);
  const filtered = full.filter((fraction) => fraction <= maxAllowed + 1e-12);
  if (filtered.length === 0) return [mildest];
  if (filtered[0] !== mildest && !filtered.includes(mildest)) {
    return [mildest, ...filtered];
  }
  return filtered;
}

// Target Ending Balance discounted by Risk Tolerance so legacy slack can fund
// higher spending (success gate + glide stop), not just be forgiven after the fact.
export function discountedTargetEndingBalance(config) {
  const shortfallTolerance = config.shortfallTolerance ?? DEFAULT_SHORTFALL_TOLERANCE;
  return (config.targetEndingBalance ?? 0) * (1 - shortfallTolerance);
}

// Rounds down: success rate only ever gets easier to hit as spending
// decreases, so flooring the bisected value can never push it back outside
// the feasible range the bisection already verified.
function roundDownToThousand(value) {
  return Math.floor(value / DOLLAR_ROUNDING) * DOLLAR_ROUNDING;
}

// Unadjusted per-year withdrawal plan (base × compounding tiers + extras),
// or the fixed per-year specific-list amounts when that strategy is in use.
// The minimum-withdrawal floor limits cuts at run time; it is not part of plan.
// Deterministic — mirrors simulatePath's unadjustedTarget logic without
// running a simulation.
export function plannedYearlySchedule(portfolio, numYears) {
  const isSpecific = portfolio.strategy === 'specific';
  const baseSchedule = isSpecific
    ? null
    : buildBaseWithdrawalSchedule(portfolio.base, portfolio.spendingOverTimeSeries, numYears);

  const yearlyAmounts = new Array(numYears);
  for (let j = 0; j < numYears; j++) {
    let unadjustedTarget;
    if (isSpecific) {
      // Each year's amount is typed in directly and never scaled — it's
      // the plan as-is, before any market/balance adjustment is layered on.
      unadjustedTarget = portfolio.specificWithdrawals?.[j] ?? 0;
    } else {
      unadjustedTarget = baseSchedule[j];
    }
    yearlyAmounts[j] = unadjustedTarget;
  }
  return yearlyAmounts;
}

// Sum of the unadjusted withdrawal schedule — the lifetime plan benchmark.
export function plannedScheduleTotal(portfolio, numYears) {
  let total = 0;
  for (const amount of plannedYearlySchedule(portfolio, numYears)) total += amount;
  return total;
}

// Median of the unadjusted per-year withdrawal schedule — the plan benchmark
// when scoring runs by median yearly spending instead of lifetime total.
export function plannedScheduleMedianYearly(portfolio, numYears) {
  return median(plannedYearlySchedule(portfolio, numYears));
}

// Mean of the unadjusted per-year withdrawal schedule (total ÷ years) — the
// plan benchmark when scoring runs by mean yearly spending.
export function plannedScheduleMeanYearly(portfolio, numYears) {
  return numYears > 0 ? plannedScheduleTotal(portfolio, numYears) / numYears : 0;
}

// Planned benchmark for one horizon length under the chosen withdrawal metric.
export function plannedScheduleBenchmark(portfolio, numYears, metric) {
  if (isMedianYearlyMetric(metric)) return plannedScheduleMedianYearly(portfolio, numYears);
  if (isMeanYearlyMetric(metric)) return plannedScheduleMeanYearly(portfolio, numYears);
  return plannedScheduleTotal(portfolio, numYears);
}

// Find Best Plan's primary ranking score: the headline planned schedule
// (base × spending tiers / specific list), not Monte Carlo actuals that
// include gifts, ceiling boosts, market highs, or glide surplus.
// When earlyWindow > 0 (Spending Over Time is in the search), score the
// average planned dollars per year in that front-loaded span so the search
// still prefers aggressive early-tier extras over an equal lifetime total.
export function plannedPrimaryObjective(portfolio, numYears, metric, earlyWindow = 0) {
  if (earlyWindow > 0) {
    const schedule = plannedYearlySchedule(portfolio, numYears);
    const span = Math.min(earlyWindow, schedule.length);
    if (span <= 0) return 0;
    let total = 0;
    for (let j = 0; j < span; j++) total += schedule[j];
    return total / span;
  }
  return plannedScheduleBenchmark(portfolio, numYears, metric);
}

// How far above the Target Ending Balance the typical run finishes.
// Lower is better for spend-down: idle legacy above the target could have
// funded a higher plan (or more surplus recycling) instead.
export function medianExcessEndingBalance(finalBalance, effectiveTarget = 0) {
  const n = finalBalance?.length ?? 0;
  if (n === 0) return 0;
  const target = Number.isFinite(effectiveTarget) ? effectiveTarget : 0;
  const excess = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    excess[i] = Math.max(0, finalBalance[i] - target);
  }
  return median(excess);
}

// Lexicographic candidate ranking for Find Best Plan:
// 1) higher planned primary wins
// 2) if planned is within $1,000, lower median excess ending balance (spend-down
//    / glide) — before RT-tail closeness, so surplus recycling is not punished
//    for raising actuals once the RT floor already clears feasibility
// 3) lower RT-tail excess (prefer P(fail) actual/plan closer to (1 − RT))
// 4) higher success rate (pinBase infeasible fallback)
export function isBetterGoalSeekScore(a, b) {
  const plannedA = a.plannedPrimary ?? 0;
  const plannedB = b.plannedPrimary ?? 0;
  if (plannedA > plannedB + DOLLAR_ROUNDING) return true;
  if (plannedA < plannedB - DOLLAR_ROUNDING) return false;

  const excessA = a.medianExcessEnding ?? Infinity;
  const excessB = b.medianExcessEnding ?? Infinity;
  if (excessA < excessB) return true;
  if (excessA > excessB) return false;

  const tailA = a.tailRatioExcess ?? Infinity;
  const tailB = b.tailRatioExcess ?? Infinity;
  if (tailA < tailB) return true;
  if (tailA > tailB) return false;

  return (a.successRate ?? 0) > (b.successRate ?? 0);
}

// Build a per-run planned benchmark array, memoizing by horizon length so
// variable-horizon Monte Carlo runs only compute each distinct schedule once.
export function buildPerRunPlanBenchmarks(portfolio, horizonYearsArray, metric) {
  const n = horizonYearsArray.length;
  const benchmarks = new Float64Array(n);
  const cache = new Map();
  for (let i = 0; i < n; i++) {
    const h = horizonYearsArray[i];
    if (!cache.has(h)) {
      cache.set(h, plannedScheduleBenchmark(portfolio, h, metric));
    }
    benchmarks[i] = cache.get(h);
  }
  return benchmarks;
}

// Highest per-year minimum-withdrawal backstop in the staged tier series.
// Goal Seek must not search for a base below this — the floor always applies.
export function highestMinimumWithdrawal(portfolio) {
  const series = portfolio.withdrawalFloorSeries;
  if (!series || series.length === 0) return 0;
  let max = 0;
  for (let i = 0; i < series.length; i++) {
    if (series[i] > max) max = series[i];
  }
  return max;
}

// ---- Generic numeric search primitives -------------------------------------

// Find the largest x in [lo, hi] for which `predicate(x)` holds, assuming
// predicate is monotonically true-then-false across the range (predicate(lo)
// must be true). Stops once the bracket is narrower than `tolerance`.
export function bisectMaxSatisfying(predicate, lo, hi, { tolerance = 1, maxIterations = BASE_BISECTION_MAX_ITERATIONS } = {}) {
  let a = lo;
  let b = hi;
  for (let i = 0; i < maxIterations && b - a > tolerance; i++) {
    const mid = (a + b) / 2;
    if (predicate(mid)) a = mid; else b = mid;
  }
  return a;
}

// Integer variant: find the largest integer in [lo, hi] for which `predicate`
// holds. predicate(lo) must be true.
export function bisectMaxSatisfyingInt(predicate, lo, hi) {
  let a = Math.round(lo);
  let b = Math.round(hi);
  while (a < b) {
    const mid = Math.ceil((a + b) / 2);
    if (predicate(mid)) a = mid; else b = mid - 1;
  }
  return a;
}

// Async variant of bisectMaxSatisfying for predicates that await simulation runs.
export async function bisectMaxSatisfyingAsync(predicate, lo, hi, { tolerance = 1, maxIterations = BASE_BISECTION_MAX_ITERATIONS } = {}) {
  let a = lo;
  let b = hi;
  for (let i = 0; i < maxIterations && b - a > tolerance; i++) {
    const mid = (a + b) / 2;
    if (await predicate(mid)) a = mid; else b = mid;
  }
  return a;
}

// ---- Candidate grid builders -------------------------------------------------

// Dollar adjustment candidates expressed as a % of the base withdrawal, so the
// grid automatically rescales with whatever base the search has found so far.
// Zero is never a candidate: an explicit 0% step is skipped, and small bases
// that round a non-zero % to $0 are pinned to ±$1,000 so the search cannot
// treat "no adjustment" as a legal answer.
export function buildAdjustmentGrid(baseWithdrawal, { minPct, maxPct, stepPct } = DEFAULT_MARKET_DOWN_ADJ_GRID) {
  const candidates = [];
  const seen = new Set();
  for (let pct = minPct; pct <= maxPct + 1e-9; pct += stepPct) {
    let value = roundToThousand((baseWithdrawal * pct) / 100);
    if (value === 0) {
      if (pct === 0) continue;
      value = pct < 0 ? -DOLLAR_ROUNDING : DOLLAR_ROUNDING;
    }
    if (seen.has(value)) continue;
    seen.add(value);
    candidates.push(value);
  }
  if (candidates.length === 0) {
    if (maxPct < 0) return [-DOLLAR_ROUNDING];
    if (minPct > 0) return [DOLLAR_ROUNDING];
  }
  return candidates;
}

// Mildest (closest-to-zero) Low cut on the downside grid — the least negative
// dollar amount Goal Seek is allowed to leave Low at.
export function mildestMarketDownAdj(baseWithdrawal, gridConfig = DEFAULT_MARKET_DOWN_ADJ_GRID) {
  const negatives = buildAdjustmentGrid(baseWithdrawal, gridConfig).filter((value) => value < 0);
  return negatives.length > 0 ? Math.max(...negatives) : -DOLLAR_ROUNDING;
}

// Mildest High boost on the upside grid — the smallest positive dollar amount
// Goal Seek is allowed to leave High at.
export function mildestMarketUpAdj(baseWithdrawal, gridConfig = DEFAULT_MARKET_UP_ADJ_GRID) {
  const positives = buildAdjustmentGrid(baseWithdrawal, gridConfig).filter((value) => value > 0);
  return positives.length > 0 ? Math.min(...positives) : DOLLAR_ROUNDING;
}

// Keep only candidates at or above the fixed Expected adjustment so Goal Seek
// never proposes a High adjustment below Expected. If the grid has no point
// at/above the floor (custom grids that barely overlap), pin to the floor so
// ordering still holds.
export function filterAdjustmentCandidatesAtOrAbove(candidates, minAdj) {
  const filtered = candidates.filter((value) => value >= minAdj);
  if (filtered.length === 0) return [roundToThousand(minAdj)];
  return filtered;
}

// Mirror image for the Low band: candidates at or below the fixed Expected
// adjustment, pinned to it when the grid doesn't reach that low.
export function filterAdjustmentCandidatesAtOrBelow(candidates, maxAdj) {
  const filtered = candidates.filter((value) => value <= maxAdj);
  if (filtered.length === 0) return [roundToThousand(maxAdj)];
  return filtered;
}

// After the tuned bands settle, nudge Low down / High up if needed so the
// three dollar adjustments always read low ≤ expected ≤ high. The Expected
// adjustment is the user's fixed anchor and is never moved.
export function enforceAscendingMarketAdjustments(dynConfig) {
  dynConfig.low.adj = Math.min(dynConfig.low.adj, dynConfig.med.adj);
  dynConfig.high.adj = Math.max(dynConfig.high.adj, dynConfig.med.adj);
}

// Force Low/High away from $0 after ascending enforcement (or on early
// write-back), using the mildest non-zero points on each side's search grid
// (scaled by the Risk Tolerance 0–20% envelope).
export function clampMarketAdjustments(config, dynConfig, baseWithdrawal) {
  const maxLow = mildestMarketDownAdj(baseWithdrawal, resolveMarketDownAdjGrid(config));
  const minHigh = mildestMarketUpAdj(baseWithdrawal, resolveMarketUpAdjGrid(config));
  // Low must be at least as negative as the mildest grid cut, and still ≤ Expected.
  dynConfig.low.adj = Math.min(dynConfig.low.adj, maxLow, dynConfig.med.adj);
  // High must be at least the mildest grid boost, and still ≥ Expected.
  dynConfig.high.adj = Math.max(dynConfig.high.adj, minHigh, dynConfig.med.adj);
}

// Balance-style candidates as round multiples of the starting balance. A
// multiple of 0 maps to `offValue` — pass `null` for the dynLow/Med/HighBal
// override fields (blank = off), `0` for floorBalance, or `Infinity` for
// ceilingBalance, matching how each field represents "disabled".
export function buildBalanceGrid(startBalance, multiples = DEFAULT_FLOOR_MULTIPLES, offValue = null) {
  return multiples.map((m) => (m > 0 ? roundToThousand(startBalance * m) : offValue));
}

// Percentage-point grid (e.g. Max Cut / Boost Rate), returned as 0-1 fractions
// ready to drop straight into engine params.
export function buildFractionGrid({ minPct, maxPct, stepPct } = DEFAULT_PENALTY_BONUS_GRID) {
  const candidates = [];
  for (let pct = minPct; pct <= maxPct + 1e-9; pct += stepPct) {
    candidates.push(pct / 100);
  }
  return candidates;
}

// Goal Seek balance-adjustment search excludes 0% cut/boost. When the scaled
// envelope max sits below the grid step, that max becomes the sole candidate;
// at envelope scale 0 the smallest step is still used.
function buildBalanceAdjustmentFractionGrid({ minPct = 0, maxPct = 0, stepPct = FLOOR_PENALTY_STEP_PCT } = {}) {
  if (maxPct <= 0) {
    return [stepPct / 100];
  }
  const effectiveMin = maxPct < stepPct ? maxPct : Math.max(stepPct, minPct);
  return buildFractionGrid({ minPct: effectiveMin, maxPct, stepPct });
}

function minBalanceAdjustmentFraction(gridConfig) {
  return buildBalanceAdjustmentFractionGrid(gridConfig)[0];
}

function minGlideFraction(config) {
  return resolveGlideFractions(config)[0];
}

function isFloorThresholdActive(portfolio) {
  return Number.isFinite(portfolio.floorBalance) && portfolio.floorBalance > 0;
}

function isCeilingThresholdActive(portfolio) {
  return Number.isFinite(portfolio.ceilingBalance) && portfolio.ceilingBalance > 0;
}

// Only clamp rates whose matching Floor/Ceiling threshold is active — off
// thresholds are left alone so Include-in-search never invents guardrails.
function clampBalanceAdjustmentRates(config, portfolio) {
  if (isFloorThresholdActive(portfolio)) {
    portfolio.floorPenalty = Math.max(
      portfolio.floorPenalty,
      minBalanceAdjustmentFraction(resolveFloorPenaltyGrid(config)),
    );
  }
  if (isCeilingThresholdActive(portfolio)) {
    portfolio.ceilingBonus = Math.max(
      portfolio.ceilingBonus,
      minBalanceAdjustmentFraction(resolveCeilingBonusGrid(config)),
    );
  }
}

function clampGlideFraction(config, portfolio) {
  portfolio.glideFraction = Math.max(portfolio.glideFraction, minGlideFraction(config));
}

// Bonus-amount candidates as round dollars, expressed as a fraction of the
// currently-solved base withdrawal so the grid rescales with the plan.
export function buildBonusGrid(baseWithdrawal, fractions = DEFAULT_GOGO_BONUS_FRACTIONS) {
  return fractions.map((f) => roundToThousand(baseWithdrawal * f));
}

// Cartesian product of two coupled grids (e.g. floor balance x max cut, where
// each is a no-op without the other). `isPrimaryOff(primary)` collapses the
// secondary dimension to a single "off" candidate whenever the primary value
// disables the pair, avoiding redundant identical evaluations.
export function buildPairGrid(primaryGrid, secondaryGrid, isPrimaryOff) {
  const pairs = [];
  const seen = new Set();
  for (const primary of primaryGrid) {
    const secondaries = isPrimaryOff(primary) ? [secondaryGrid[0]] : secondaryGrid;
    for (const secondary of secondaries) {
      const key = `${primary}|${secondary}`;
      if (seen.has(key)) continue;
      seen.add(key);
      pairs.push([primary, secondary]);
    }
  }
  return pairs;
}

// ---- Param cloning (never mutate the caller's params) -----------------------

function cloneParams(params) {
  return {
    ...params,
    portfolio: { ...params.portfolio },
    dynConfig: {
      enabled: params.dynConfig.enabled,
      low: { ...params.dynConfig.low },
      med: { ...params.dynConfig.med },
      high: { ...params.dynConfig.high },
      // Optional calibration knobs (blank = off) — not Goal Seek levers.
      noCutBal: params.dynConfig.noCutBal ?? null,
      maxBoostDrawdownPct: params.dynConfig.maxBoostDrawdownPct ?? null,
    },
  };
}

function hasIncludedLevers(config) {
  return !!(
    config.includeSpendingOverTime
    || config.includeMarketAdjustments
    || config.includeBalanceOverrides
    || config.includeGlidePath
  );
}

// Cost (in evaluations) of scoring one candidate via the re-solve scorer: an
// inner bisection of the base at reduced fidelity, plus one confirming
// evaluation at full search fidelity. Pinned-base mode skips the inner bisection.
const PER_CANDIDATE_COST = RESOLVE_INNER_MAX_ITERATIONS + 1;
const PINNED_PER_CANDIDATE_COST = 1;

function perCandidateCost(config) {
  return config.pinBaseWithdrawal ? PINNED_PER_CANDIDATE_COST : PER_CANDIDATE_COST;
}

function estimateEvalBudget(params, config) {
  const marketDownAdjLen = gridLength(resolveMarketDownAdjGrid(config));
  const marketUpAdjLen = gridLength(resolveMarketUpAdjGrid(config));
  const floorPenaltyGridLen = buildBalanceAdjustmentFractionGrid(resolveFloorPenaltyGrid(config)).length;
  const ceilingBonusGridLen = buildBalanceAdjustmentFractionGrid(resolveCeilingBonusGrid(config)).length;
  const bonusGridLen = (config.goGoBonusFractions || DEFAULT_GOGO_BONUS_FRACTIONS).length;
  const glideFractionsLen = resolveGlideFractions(config).length;
  const candidateCost = perCandidateCost(config);

  const perRoundLeverCost =
    (config.includeSpendingOverTime ? bonusGridLen * candidateCost : 0) +
    (config.includeMarketAdjustments
      ? (marketDownAdjLen + marketUpAdjLen) * candidateCost
      : 0) +
    (config.includeBalanceOverrides
      ? (floorPenaltyGridLen + ceilingBonusGridLen) * candidateCost
      : 0) +
    (config.includeGlidePath ? glideFractionsLen * candidateCost : 0);

  if (config.pinBaseWithdrawal) {
    if (!hasIncludedLevers(config)) return 1;
    const maxRounds = config.maxRounds || DEFAULT_MAX_ROUNDS;
    return maxRounds * perRoundLeverCost + 1;
  }

  // Fast path (no levers): initial anchor bisection + one confirming
  // re-bisection, same cost as before this feature existed.
  if (!hasIncludedLevers(config)) {
    return BASE_BISECTION_MAX_ITERATIONS + BASE_BISECTION_MAX_ITERATIONS;
  }

  const maxRounds = config.maxRounds || DEFAULT_MAX_ROUNDS;
  return BASE_BISECTION_MAX_ITERATIONS + maxRounds * (perRoundLeverCost + BASE_BISECTION_MAX_ITERATIONS);
}

// ---- The search orchestrator -------------------------------------------------

// `config` shape (see state/scenario.js buildGoalSeekConfig):
//   targetEndingBalance      dollars — success/glide use RT-discounted value
//   desiredSuccessRate       fraction 0..1
//   shortfallTolerance       fraction 0..1 — max lifetime spending shortfall vs plan;
//                            also scales market/balance/glide depth over the first
//                            0–20% and discounts targetEndingBalance
//   pinBaseWithdrawal          bool — keep params.portfolio.base fixed; search levers only
//   includeSpendingOverTime      bool — covers first-tier extra withdrawal
//   includeMarketAdjustments   bool — covers dynLow/HighAdj only;
//                              dynMedAdj is never searched (fixed as typed);
//                              dynNoCutBal / maxBoostDrawdownPct stay as typed
//                              (optional calibration, blank = off)
//   includeBalanceOverrides    bool — keeps Floor/Ceiling dollars fixed (Easy Mode
//                              or user-typed); tunes floorPenalty/ceilingBonus only
//                              when the matching threshold is active
//   includeGlidePath           bool — covers glideFraction; the glide target is
//                              pinned to the RT-discounted targetEndingBalance and
//                              glideRate stays as typed
//   glideFractions             optional array of surplus-recycle fractions (0..1)
//   searchNumSimulations       optional override of the reduced sim count
//   marketDownAdjGrid          optional { minPct, maxPct, stepPct } for dynLowAdj
//   marketUpAdjGrid            optional { minPct, maxPct, stepPct } for dynHighAdj
//   floorPenaltyGrid           optional { minPct, maxPct, stepPct } — full max before envelope scale
//   ceilingBonusGrid           optional { minPct, maxPct, stepPct }
export async function runGoalSeek(params, config, simulateAsync, { onProgress } = {}) {
  const notify = typeof onProgress === 'function' ? onProgress : () => {};
  const pinBase = !!config.pinBaseWithdrawal;
  const working = cloneParams(params);
  const searchNumSimulations = Math.min(
    params.numSimulations,
    config.searchNumSimulations || DEFAULT_SEARCH_NUM_SIMULATIONS,
  );
  const resolveNumSimulations = Math.min(searchNumSimulations, RESOLVE_INNER_NUM_SIMULATIONS);

  let evalCount = 0;
  // Rough total, just for a smoothly-advancing progress bar (not exact).
  const estimatedEvalBudget = estimateEvalBudget(params, config);

  // While Spending Over Time is included in the search, the planned primary
  // scores average planned dollars PER YEAR in the first tier's span (not the
  // lifetime plan total) — that still favors front-loading without ranking on
  // bonus-inflated Monte Carlo actuals.
  function spendingBonusSpan() {
    if (!config.includeSpendingOverTime) return 0;
    return config.spendingFirstTierYears ?? 0;
  }

  function applySpendingBonus(value) {
    const series = working.portfolio.spendingOverTimeSeries;
    if (!series || series.length === 0) return;
    const span = spendingBonusSpan() || series.length;
    for (let j = 0; j < span && j < series.length; j++) {
      series[j] = { ...series[j], extra: value };
    }
  }

  function readSpendingBonus() {
    const series = working.portfolio.spendingOverTimeSeries;
    if (!series || series.length === 0) return 0;
    return series[0]?.extra ?? 0;
  }

  function currentEarlyWindow() {
    return spendingBonusSpan();
  }

  async function evaluateWith(numSimulations, stage) {
    evalCount++;
    notify(stage, Math.min(evalCount / estimatedEvalBudget, 0.99));
    const window = currentEarlyWindow();
    const searchParams = { ...working, numSimulations, earlyYearsWindow: window };
    const result = await simulateAsync(searchParams);
    const endpointYears = params.numYears;
    const plannedTotal = plannedScheduleTotal(working.portfolio, endpointYears);
    const plannedMedianAtEndpoint = plannedScheduleMedianYearly(working.portfolio, endpointYears);
    // Rank by the headline planned schedule (deterministic), not median actual
    // withdrawals — actuals include gifts/boosts/glide that would otherwise
    // reward a low base plan padded by upside levers.
    const objectiveValue = plannedPrimaryObjective(
      working.portfolio,
      endpointYears,
      config.withdrawalMetric,
      window,
    );
    const perRunBenchmarks = buildPerRunPlanBenchmarks(
      working.portfolio,
      result.horizonYears,
      config.withdrawalMetric,
    );
    const actualWithdrawn = perRunWithdrawalMetric(result, config.withdrawalMetric);
    const shortfallTolerance = config.shortfallTolerance ?? DEFAULT_SHORTFALL_TOLERANCE;
    // Discount Target Ending Balance by Risk Tolerance so legacy slack can fund
    // higher spending. Legacy success uses this discounted gate whenever a
    // target is set (not only when Glide is searched); Glide's stop is pinned
    // to the same number so the discounted slice is actually spendable.
    const effectiveTargetEndingBalance = discountedTargetEndingBalance(config);
    // Split gate: Desired Success % = survive + ending only; Risk Tolerance
    // floors actual/plan at P(100 − Desired Success %), not as a joint per-run
    // requirement (which left the RT band unused when depletion bound first).
    const legacyRate = legacyGoalSuccessRate(
      result.finalBalance,
      result.depletionYear,
      result.horizonYears,
      effectiveTargetEndingBalance,
    );
    const desiredSuccessRate = config.desiredSuccessRate;
    const failPct = Math.min(Math.max(1 - desiredSuccessRate, 0), 1);
    const tailRatio = withdrawalPlanRatioPercentile(
      actualWithdrawn,
      perRunBenchmarks,
      failPct,
    );
    const onPlanRate = spendingTailRate(
      actualWithdrawn,
      perRunBenchmarks,
      shortfallTolerance,
    );
    // Single comparable rate for summaries / pinBase climb: the tighter of
    // the two separate bars (each must clear Desired Success % for feasibility).
    const successRateAchieved = onPlanRate == null
      ? legacyRate
      : Math.min(legacyRate, onPlanRate);
    const rtFloor = 1 - shortfallTolerance;
    const tailRatioExcess = tailRatio == null
      ? 0
      : Math.max(0, tailRatio - rtFloor);
    return {
      successRateAchieved,
      legacyRate,
      onPlanRate,
      tailRatio,
      tailRatioExcess,
      meetsSplitGate: legacyRate >= desiredSuccessRate
        && (tailRatio == null || tailRatio >= rtFloor),
      medianTotalWithdrawn: median(result.totalWithdrawn),
      medianYearlyWithdrawn: median(result.medianYearlyWithdrawal),
      objectiveValue,
      medianExcessEnding: medianExcessEndingBalance(
        result.finalBalance,
        effectiveTargetEndingBalance,
      ),
      plannedTotal,
      plannedMedianAtEndpoint,
    };
  }

  async function evaluate(stage) {
    return evaluateWith(searchNumSimulations, stage);
  }

  async function meetsTarget(stage) {
    return (await evaluate(stage)).meetsSplitGate;
  }

  // Neutralize every lever marked "include in search" before Phase 1 solves
  // the base withdrawal. Otherwise Phase 1 would calibrate the base tightly
  // around whatever those fields already contained, and Phase 2's search for
  // that same lever would just rediscover the boundary Phase 1 just used —
  // i.e. it would always "converge" back to the value that was already there.
  if (config.includeSpendingOverTime) {
    applySpendingBonus(0);
  }
  if (config.includeMarketAdjustments) {
    // The Expected (med) adjustment is the user's fixed on-plan anchor and is
    // never searched; Low/High reset to the closest neutral values that keep
    // the low ≤ expected ≤ high ordering around it. Optional calibration
    // knobs (noCutBal, maxBoostDrawdownPct) stay as typed — blank = off.
    working.dynConfig.low.adj = Math.min(0, working.dynConfig.med.adj);
    working.dynConfig.high.adj = Math.max(0, working.dynConfig.med.adj);
  }
  if (config.includeBalanceOverrides) {
    // Floor/Ceiling dollars stay as provided (Easy Mode or user). Only the
    // cut/boost rates for active thresholds are reset to the mildest grid min
    // before Phase 1 / tuning rounds.
    if (isFloorThresholdActive(working.portfolio)) {
      working.portfolio.floorPenalty = minBalanceAdjustmentFraction(resolveFloorPenaltyGrid(config));
    }
    if (isCeilingThresholdActive(working.portfolio)) {
      working.portfolio.ceilingBonus = minBalanceAdjustmentFraction(resolveCeilingBonusGrid(config));
    }
  }
  if (config.includeGlidePath) {
    // Glide target is the Risk-Tolerance-discounted Goal Seek target so legacy
    // slack is spendable; only the recycle fraction is tuned later. Phase 1
    // (feasibility + base bisection) runs with glide OFF — success is judged
    // at the P5/P10 tail, and an active glide lever compresses the median
    // toward the target and can falsely fail the initial check before the
    // search even starts. Tuning rounds re-introduce glide candidates and let
    // the sequences decide.
    working.portfolio.glideTarget = discountedTargetEndingBalance(config);
    working.portfolio.glideFraction = 0;
  }

  if (pinBase && !hasIncludedLevers(config)) {
    return {
      params: { ...params },
      summary: {
        feasible: false,
        reason: 'Pinning the base withdrawal requires including at least one lever in the search.',
        evaluationCount: evalCount,
      },
    };
  }

  let initialUpperBound = 0;
  let baseTolerance = 50;
  let solvedBase = working.portfolio.base;
  const baseLowerBound = roundDownToThousand(highestMinimumWithdrawal(working.portfolio));

  if (!pinBase) {
  // ---- Phase 1: bisect the base withdrawal -----------------------------------
  working.portfolio.base = baseLowerBound;
  const feasibleAtMinBase = await meetsTarget('Checking feasibility');

  if (!feasibleAtMinBase) {
    // Still write back the neutralized lever state so the form does not keep
    // showing a previous run's adjustments after this early exit. Optional
    // calibration knobs (noCutBal, maxBoostDrawdownPct) and Floor/Ceiling
    // dollars are never rewritten.
    if (config.includeMarketAdjustments) {
      clampMarketAdjustments(config, working.dynConfig, baseLowerBound);
    }
    if (config.includeBalanceOverrides) {
      clampBalanceAdjustmentRates(config, working.portfolio);
    }
    if (config.includeGlidePath) {
      clampGlideFraction(config, working.portfolio);
    }
    return {
      params: { ...working, numSimulations: params.numSimulations },
      summary: {
        feasible: false,
        baseWithdrawal: baseLowerBound,
        marketAdjustments: config.includeMarketAdjustments
          ? { low: working.dynConfig.low.adj, med: working.dynConfig.med.adj, high: working.dynConfig.high.adj }
          : undefined,
        balanceAdjustment: config.includeBalanceOverrides
          ? {
              floorBalance: working.portfolio.floorBalance,
              ceilingBalance: Number.isFinite(working.portfolio.ceilingBalance)
                ? working.portfolio.ceilingBalance
                : null,
              floorPenalty: working.portfolio.floorPenalty,
              ceilingBonus: working.portfolio.ceilingBonus,
            }
          : undefined,
        glideSpendDown: config.includeGlidePath
          ? {
              target: working.portfolio.glideTarget,
              fraction: working.portfolio.glideFraction,
              rate: working.portfolio.glideRate ?? 0,
            }
          : undefined,
        reason: baseLowerBound > 0
          ? 'Even a base withdrawal at the highest minimum-withdrawal tier cannot meet the desired success rate with this target ending balance. Lower the target, lower the desired success rate, or reduce the minimum withdrawal.'
          : 'Even a $0 base withdrawal cannot meet the desired success rate with this target ending balance. Lower the target, lower the desired success rate, or reduce the minimum withdrawal.',
        evaluationCount: evalCount,
      },
    };
  }

  initialUpperBound = Math.max(params.portfolio.base * 4, (params.portfolio.start / Math.max(params.numYears, 1)) * 4, 1000);
  let hi = initialUpperBound;
  const GOGO_MAX_UPPER_BOUND_DOUBLINGS = 10;
  for (let i = 0; i < GOGO_MAX_UPPER_BOUND_DOUBLINGS; i++) {
    working.portfolio.base = hi;
    if (!(await meetsTarget('Bracketing base withdrawal'))) break;
    hi *= 2;
  }

  baseTolerance = Math.max(50, hi * 0.001);
  solvedBase = roundDownToThousand(
    await bisectMaxSatisfyingAsync(
      async (x) => {
        working.portfolio.base = x;
        return meetsTarget('Tuning base withdrawal');
      },
      baseLowerBound,
      hi,
      { tolerance: baseTolerance },
    ),
  );
  working.portfolio.base = solvedBase;
  } else {
    working.portfolio.base = params.portfolio.base;
    solvedBase = params.portfolio.base;
  }

  // ---- Rebisect the base withdrawal against whatever the levers currently
  // hold, at full search fidelity. Used both for the no-lever fast path (a
  // single confirming pass, same cost as before this feature existed) and
  // once per round below. ----
  async function rebisectBase(stageLabel) {
    if (pinBase) return solvedBase;
    const rebisectHi = Math.max(solvedBase * 2, initialUpperBound);
    return roundDownToThousand(
      await bisectMaxSatisfyingAsync(
        async (x) => {
          working.portfolio.base = x;
          return meetsTarget(stageLabel);
        },
        baseLowerBound,
        rebisectHi,
        { tolerance: baseTolerance },
      ),
    );
  }

  // Cheap inner bisection of the base at reduced fidelity — used to re-solve
  // the base for EVERY lever candidate, not just once per round. Without
  // this, a candidate that costs some base headroom (e.g. a spending cut
  // below a guardrail) always looks strictly worse than doing nothing, since
  // its entire payoff — a higher feasible base — would otherwise be invisible
  // until the next round's full rebisection.
  async function innerResolveBase(stageLabel) {
    if (pinBase) return solvedBase;
    const innerHi = Math.max(solvedBase * 2, initialUpperBound);
    return roundDownToThousand(
      await bisectMaxSatisfyingAsync(
        async (x) => {
          working.portfolio.base = x;
          return (await evaluateWith(resolveNumSimulations, stageLabel)).meetsSplitGate;
        },
        baseLowerBound,
        innerHi,
        { tolerance: baseTolerance, maxIterations: RESOLVE_INNER_MAX_ITERATIONS },
      ),
    );
  }

  // Score whatever lever values are currently applied to `working`: re-solve
  // the base against them, then confirm at full search fidelity.
  async function scoreCurrentLeversWithResolve(stageLabel) {
    const resolvedBase = await innerResolveBase(stageLabel);
    working.portfolio.base = resolvedBase;
    const metrics = await evaluate(stageLabel);
    return { resolvedBase, ...metrics };
  }

  // Try every single-field candidate, re-solving the base for each one, and
  // keep whichever satisfies the split success gate with the best planned /
  // RT-tail / spend-down score. Applies the winner (or the current value, if
  // none qualified) to `working` before returning, including the base it was
  // solved against.
  async function pickBestCandidateWithResolve(candidates, applyCandidate, stageLabel, currentValue) {
    let best = currentValue;
    let bestScore = null;
    let bestBase = solvedBase;
    let foundTarget = false;
    for (const candidate of candidates) {
      applyCandidate(candidate);
      const {
        resolvedBase,
        successRateAchieved,
        meetsSplitGate,
        objectiveValue,
        medianExcessEnding,
        tailRatioExcess,
      } = await scoreCurrentLeversWithResolve(stageLabel);
      const score = {
        plannedPrimary: objectiveValue,
        tailRatioExcess,
        medianExcessEnding,
        successRate: successRateAchieved,
      };
      if (meetsSplitGate) {
        if (!foundTarget || isBetterGoalSeekScore(score, bestScore)) {
          foundTarget = true;
          best = candidate;
          bestScore = score;
          bestBase = resolvedBase;
        }
      } else if (pinBase && !foundTarget) {
        // Infeasible pinned-base path: climb success rate first, then the
        // same planned / RT-tail / spend-down ranking among equal rates.
        if (
          !bestScore
          || successRateAchieved > bestScore.successRate
          || (successRateAchieved === bestScore.successRate && isBetterGoalSeekScore(score, bestScore))
        ) {
          best = candidate;
          bestScore = score;
          bestBase = resolvedBase;
        }
      }
    }
    if (pinBase) {
      applyCandidate(best);
      // Ensure we don't accidentally overwrite the pinned base (e.g. if the initial target wasn't found)
      working.portfolio.base = solvedBase;
      return best;
    }
    applyCandidate(foundTarget ? best : currentValue);
    working.portfolio.base = foundTarget ? bestBase : solvedBase;
    solvedBase = working.portfolio.base;
    return foundTarget ? best : currentValue;
  }

  // Same as above, but for a pair of jointly-coupled fields (e.g. floor
  // balance + max cut, which are each a no-op without the other).
  // eslint-disable-next-line no-unused-vars -- not called by any current stage; kept for future paired-lever searches
  async function pickBestPairWithResolve(pairs, applyPair, stageLabel, currentPair) {
    let best = currentPair;
    let bestScore = null;
    let bestBase = solvedBase;
    let foundTarget = false;
    for (const pair of pairs) {
      applyPair(pair[0], pair[1]);
      const {
        resolvedBase,
        successRateAchieved,
        meetsSplitGate,
        objectiveValue,
        medianExcessEnding,
        tailRatioExcess,
      } = await scoreCurrentLeversWithResolve(stageLabel);
      const score = {
        plannedPrimary: objectiveValue,
        tailRatioExcess,
        medianExcessEnding,
        successRate: successRateAchieved,
      };
      if (meetsSplitGate) {
        if (!foundTarget || isBetterGoalSeekScore(score, bestScore)) {
          foundTarget = true;
          best = pair;
          bestScore = score;
          bestBase = resolvedBase;
        }
      } else if (pinBase && !foundTarget) {
        if (
          !bestScore
          || successRateAchieved > bestScore.successRate
          || (successRateAchieved === bestScore.successRate && isBetterGoalSeekScore(score, bestScore))
        ) {
          best = pair;
          bestScore = score;
          bestBase = resolvedBase;
        }
      }
    }
    if (pinBase) {
      applyPair(best[0], best[1]);
      // Ensure we don't accidentally overwrite the pinned base
      working.portfolio.base = solvedBase;
      return best;
    }
    const winner = foundTarget ? best : currentPair;
    applyPair(winner[0], winner[1]);
    working.portfolio.base = foundTarget ? bestBase : solvedBase;
    solvedBase = working.portfolio.base;
    return winner;
  }

  // One pass over every included lever, in a fixed order, re-solving the base
  // after every single candidate so protective/aggressive settings are scored
  // by what they actually buy, not by how they look with the base left fixed.
  async function tuneLeversOnce() {
    if (config.includeSpendingOverTime) {
      const bonusGrid = buildBonusGrid(solvedBase, config.goGoBonusFractions);
      await pickBestCandidateWithResolve(
        bonusGrid,
        (value) => {
          applySpendingBonus(value);
        },
        'Tuning spending-over-time extra',
        readSpendingBonus(),
      );
    }

    if (config.includeMarketAdjustments) {
      // The Expected (med) adjustment is fixed at whatever the user typed
      // (normally 0 — at the expected return the plan is on plan). Only Low
      // and High are tuned, each restricted to its side of the Expected
      // anchor so the search never invents an inverted Low/Expected/High
      // dollar ladder (users can still type one by hand).
      const medAdj = working.dynConfig.med.adj;
      const downGridConfig = resolveMarketDownAdjGrid(config);
      const upGridConfig = resolveMarketUpAdjGrid(config);
      const mildLow = mildestMarketDownAdj(solvedBase, downGridConfig);
      const mildHigh = mildestMarketUpAdj(solvedBase, upGridConfig);

      const lowGrid = filterAdjustmentCandidatesAtOrBelow(
        buildAdjustmentGrid(solvedBase, downGridConfig),
        medAdj,
      );
      working.dynConfig.low.adj = await pickBestCandidateWithResolve(
        lowGrid,
        (value) => {
          working.dynConfig.low.adj = value;
        },
        'Tuning market adjustments',
        // Prefer the mildest non-zero cut over Phase-1's neutralized $0 so a
        // "keep current" fallback cannot reintroduce zero.
        Math.min(working.dynConfig.low.adj || mildLow, mildLow, medAdj),
      );

      const highGrid = filterAdjustmentCandidatesAtOrAbove(
        buildAdjustmentGrid(solvedBase, upGridConfig),
        medAdj,
      );
      working.dynConfig.high.adj = await pickBestCandidateWithResolve(
        highGrid,
        (value) => {
          working.dynConfig.high.adj = value;
        },
        'Tuning market adjustments',
        // If a prior round left this band below the anchor, start from the
        // stronger of the anchor and the mildest non-zero boost.
        Math.max(working.dynConfig.high.adj || mildHigh, mildHigh, medAdj),
      );
      enforceAscendingMarketAdjustments(working.dynConfig);
      clampMarketAdjustments(config, working.dynConfig, solvedBase);
    }

    if (config.includeBalanceOverrides) {
      // Thresholds stay fixed; search only the rate for each active band.
      if (isFloorThresholdActive(working.portfolio)) {
        const penaltyGrid = buildBalanceAdjustmentFractionGrid(resolveFloorPenaltyGrid(config));
        await pickBestCandidateWithResolve(
          penaltyGrid,
          (value) => {
            working.portfolio.floorPenalty = value;
          },
          'Tuning floor max cut',
          working.portfolio.floorPenalty,
        );
      }

      if (isCeilingThresholdActive(working.portfolio)) {
        const bonusRateGrid = buildBalanceAdjustmentFractionGrid(resolveCeilingBonusGrid(config));
        await pickBestCandidateWithResolve(
          bonusRateGrid,
          (value) => {
            working.portfolio.ceilingBonus = value;
          },
          'Tuning ceiling boost rate',
          working.portfolio.ceilingBonus,
        );
      }

      clampBalanceAdjustmentRates(config, working.portfolio);
    }

    // Tuned last: the glide fraction recycles whatever surplus the levers
    // above leave behind, so it should react to their settled values. Depth
    // scales with the Risk Tolerance 0–20% envelope.
    if (config.includeGlidePath) {
      const glideGrid = resolveGlideFractions(config);
      await pickBestCandidateWithResolve(
        glideGrid,
        (value) => {
          working.portfolio.glideFraction = value;
        },
        'Tuning glide-path spend-down',
        working.portfolio.glideFraction,
      );
    }
  }

  // Snapshot of every *included* lever's current value, used to detect when a
  // round made no difference so the loop can stop before hitting maxRounds.
  function captureLeverSnapshot() {
    const snapshot = {};
    if (config.includeSpendingOverTime) {
      snapshot.spendingOverTimeBonus = readSpendingBonus();
    }
    if (config.includeMarketAdjustments) {
      snapshot.dynLowAdj = working.dynConfig.low.adj;
      snapshot.dynHighAdj = working.dynConfig.high.adj;
    }
    if (config.includeBalanceOverrides) {
      snapshot.floorBalance = working.portfolio.floorBalance;
      snapshot.ceilingBalance = working.portfolio.ceilingBalance;
      snapshot.floorPenalty = working.portfolio.floorPenalty;
      snapshot.ceilingBonus = working.portfolio.ceilingBonus;
    }
    if (config.includeGlidePath) {
      snapshot.glideFraction = working.portfolio.glideFraction;
    }
    return snapshot;
  }

  function snapshotsEqual(a, b) {
    return Object.keys(a).every((key) => a[key] === b[key]);
  }

  let roundsUsed = 0;

  if (!hasIncludedLevers(config)) {
    // No optional levers selected: nothing to tune, just confirm the base
    // withdrawal once more (matches the cost/behavior of a plain base search).
    if (!pinBase) {
      solvedBase = await rebisectBase('Finalizing base withdrawal');
      working.portfolio.base = solvedBase;
    }
  } else {
    const maxRounds = config.maxRounds || DEFAULT_MAX_ROUNDS;
    for (let round = 1; round <= maxRounds; round++) {
      const baseBeforeRound = solvedBase;
      const snapshotBefore = captureLeverSnapshot();

      await tuneLeversOnce();
      if (!pinBase) {
        solvedBase = await rebisectBase('Finalizing base withdrawal');
        working.portfolio.base = solvedBase;
      }
      roundsUsed = round;

      const baseChanged = !pinBase && Math.abs(solvedBase - baseBeforeRound) >= DOLLAR_ROUNDING;
      const leversChanged = !snapshotsEqual(snapshotBefore, captureLeverSnapshot());
      if (!baseChanged && !leversChanged) break;
    }
  }

  let finalBase = solvedBase;

  if (config.includeBalanceOverrides) {
    clampBalanceAdjustmentRates(config, working.portfolio);
  }
  if (config.includeGlidePath) {
    clampGlideFraction(config, working.portfolio);
  }
  if (config.includeMarketAdjustments) {
    enforceAscendingMarketAdjustments(working.dynConfig);
    clampMarketAdjustments(config, working.dynConfig, finalBase);
  }

  let finalMetrics = await evaluate('Finalizing');

  // Upward nudge: bisection + $1k floor sits on the low side of MC noise.
  // Step the base up $1k at a time while the split gate still holds; keep the
  // last passing value. Pinned / Specific List bases are not moved.
  if (!pinBase && finalMetrics.meetsSplitGate) {
    for (let step = 0; step < MAX_BASE_NUDGE_STEPS; step++) {
      const candidateBase = finalBase + DOLLAR_ROUNDING;
      working.portfolio.base = candidateBase;
      if (config.includeMarketAdjustments) {
        clampMarketAdjustments(config, working.dynConfig, candidateBase);
      }
      const nudgedMetrics = await evaluate('Nudging base upward');
      if (!nudgedMetrics.meetsSplitGate) {
        working.portfolio.base = finalBase;
        if (config.includeMarketAdjustments) {
          clampMarketAdjustments(config, working.dynConfig, finalBase);
        }
        break;
      }
      finalBase = candidateBase;
      solvedBase = candidateBase;
      finalMetrics = nudgedMetrics;
    }
  }

  notify('Confirming final plan', 1);

  const shortfallTolerance = config.shortfallTolerance ?? DEFAULT_SHORTFALL_TOLERANCE;
  const plannedTotal = plannedScheduleTotal(working.portfolio, params.numYears);

  if (pinBase && !finalMetrics.meetsSplitGate) {
    const isSpecific = params.portfolio.strategy === 'specific';
    const reason = isSpecific
      ? 'Your Specific List of withdrawals cannot meet the desired success rate even with the best lever settings. Try lowering the amounts in your list, the target ending balance, or the desired success rate, or raising the risk tolerance.'
      : `Your pinned base withdrawal of $${Math.round(finalBase / DOLLAR_ROUNDING).toLocaleString('en-US')}k cannot meet the desired success rate even with the best lever settings. Try lowering the base, the target ending balance, or the desired success rate, or raising the risk tolerance.`;

    if (config.includeMarketAdjustments) {
      clampMarketAdjustments(config, working.dynConfig, finalBase);
    }

    return {
      params: { ...working, numSimulations: params.numSimulations },
      summary: {
        feasible: false,
        pinnedBase: true,
        baseWithdrawal: finalBase,
        spendingOverTimeBonus: config.includeSpendingOverTime ? readSpendingBonus() : undefined,
        marketAdjustments: config.includeMarketAdjustments
          ? { low: working.dynConfig.low.adj, med: working.dynConfig.med.adj, high: working.dynConfig.high.adj }
          : undefined,
        balanceAdjustment: config.includeBalanceOverrides
          ? {
              floorBalance: working.portfolio.floorBalance,
              ceilingBalance: Number.isFinite(working.portfolio.ceilingBalance)
                ? working.portfolio.ceilingBalance
                : null,
              floorPenalty: working.portfolio.floorPenalty,
              ceilingBonus: working.portfolio.ceilingBonus,
            }
          : undefined,
        glideSpendDown: config.includeGlidePath
          ? {
              target: working.portfolio.glideTarget,
              fraction: working.portfolio.glideFraction,
              rate: working.portfolio.glideRate ?? 0,
            }
          : undefined,
        shortfallTolerance,
        plannedScheduleTotal: plannedTotal,
        achievedSuccessRate: finalMetrics.successRateAchieved,
        achievedTailRatio: finalMetrics.tailRatio,
        achievedMedianTotalWithdrawn: finalMetrics.medianTotalWithdrawn,
        achievedMedianYearlyWithdrawn: finalMetrics.medianYearlyWithdrawn,
        achievedObjectiveValue: finalMetrics.objectiveValue,
        reason,
        evaluationCount: evalCount,
      },
    };
  }

  const finalParams = { ...working, numSimulations: params.numSimulations };
  const earlyYearsWindow = currentEarlyWindow();

  const summary = {
    feasible: true,
    baseWithdrawal: finalBase,
    pinnedBase: pinBase || undefined,
    roundsUsed,
    spendingOverTimeBonus: config.includeSpendingOverTime ? readSpendingBonus() : undefined,
    marketAdjustments: config.includeMarketAdjustments
      ? { low: working.dynConfig.low.adj, med: working.dynConfig.med.adj, high: working.dynConfig.high.adj }
      : undefined,
    balanceAdjustment: config.includeBalanceOverrides
      ? {
          floorBalance: working.portfolio.floorBalance,
          ceilingBalance: Number.isFinite(working.portfolio.ceilingBalance) ? working.portfolio.ceilingBalance : null,
          floorPenalty: working.portfolio.floorPenalty,
          ceilingBonus: working.portfolio.ceilingBonus,
        }
      : undefined,
    glideSpendDown: config.includeGlidePath
      ? {
          target: working.portfolio.glideTarget,
          fraction: working.portfolio.glideFraction,
          rate: working.portfolio.glideRate ?? 0,
        }
      : undefined,
    shortfallTolerance,
    plannedScheduleTotal: plannedTotal,
    achievedSuccessRate: finalMetrics.successRateAchieved,
    achievedTailRatio: finalMetrics.tailRatio,
    achievedMedianTotalWithdrawn: finalMetrics.medianTotalWithdrawn,
    achievedMedianYearlyWithdrawn: finalMetrics.medianYearlyWithdrawn,
    achievedObjectiveValue: finalMetrics.objectiveValue,
    // Only set when the search scored the early-tier planned average rather
    // than the lifetime planned benchmark (see currentEarlyWindow above).
    earlyYearsWindow: earlyYearsWindow > 0 ? earlyYearsWindow : undefined,
    evaluationCount: evalCount,
  };

  return { params: finalParams, summary };
}

function gridLength(gridConfig) {
  const { minPct, maxPct, stepPct } = gridConfig;
  return Math.floor((maxPct - minPct) / stepPct) + 1;
}
