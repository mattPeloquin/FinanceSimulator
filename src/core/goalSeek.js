// Goal Seek: given a target ending balance and a desired success percentage,
// search for the base withdrawal (and, optionally, a few other spending
// levers) that maximizes the median amount withdrawn across simulations while
// still hitting the target. Pure and DOM-free, like the rest of `core/`, so it
// can run inside the worker and be unit-tested directly.

import { runMonteCarlo } from './simulation.js';
import { goalSuccessRate, median } from './statistics.js';

const DEFAULT_SEARCH_NUM_SIMULATIONS = 2000;
const DEFAULT_ADJUSTMENT_GRID = { minPct: -50, maxPct: 50, stepPct: 5 };
const DEFAULT_BALANCE_MULTIPLES = [0, 0.5, 1, 1.5, 2];
const DEFAULT_PENALTY_BONUS_GRID = { minPct: 0, maxPct: 100, stepPct: 10 };
const BASE_BISECTION_MAX_ITERATIONS = 30;
const GOGO_MAX_UPPER_BOUND_DOUBLINGS = 10;

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

function roundToThousand(value) {
  return Math.round(value / DOLLAR_ROUNDING) * DOLLAR_ROUNDING;
}

// Rounds down: success rate only ever gets easier to hit as spending
// decreases, so flooring the bisected value can never push it back outside
// the feasible range the bisection already verified.
function roundDownToThousand(value) {
  return Math.floor(value / DOLLAR_ROUNDING) * DOLLAR_ROUNDING;
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

// ---- Candidate grid builders -------------------------------------------------

// Dollar adjustment candidates expressed as a % of the base withdrawal, so the
// grid automatically rescales with whatever base the search has found so far.
export function buildAdjustmentGrid(baseWithdrawal, { minPct, maxPct, stepPct } = DEFAULT_ADJUSTMENT_GRID) {
  const candidates = [];
  for (let pct = minPct; pct <= maxPct + 1e-9; pct += stepPct) {
    candidates.push(roundToThousand((baseWithdrawal * pct) / 100));
  }
  return candidates;
}

// Balance-style candidates as round multiples of the starting balance. A
// multiple of 0 maps to `offValue` — pass `null` for the dynLow/Med/HighBal
// override fields (blank = off), `0` for floorBalance, or `Infinity` for
// ceilingBalance, matching how each field represents "disabled".
export function buildBalanceGrid(startBalance, multiples = DEFAULT_BALANCE_MULTIPLES, offValue = null) {
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
    },
  };
}

function hasIncludedLevers(config) {
  return !!(config.includeGoGoYears || config.includeMarketAdjustments || config.includeBalanceOverrides);
}

function estimateEvalBudget(params, config) {
  const balanceGridLen = (config.balanceMultiples || DEFAULT_BALANCE_MULTIPLES).length;
  const penaltyBonusGridLen = gridLength(config.penaltyBonusGrid || DEFAULT_PENALTY_BONUS_GRID);
  const perRoundLeverCost =
    (config.includeGoGoYears ? Math.ceil(Math.log2(Math.max(params.numYears, 1) + 1)) + 1 : 0) +
    (config.includeMarketAdjustments
      ? 3 * gridLength(config.adjustmentGrid || DEFAULT_ADJUSTMENT_GRID) + 3 * balanceGridLen
      : 0) +
    (config.includeBalanceOverrides ? 2 * balanceGridLen + 2 * penaltyBonusGridLen : 0);

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
//   targetEndingBalance      dollars
//   desiredSuccessRate       fraction 0..1
//   includeGoGoYears           bool
//   includeMarketAdjustments   bool — covers dynLow/Med/HighAdj AND dynLow/Med/HighBal
//   includeBalanceOverrides    bool — covers floorBalance/ceilingBalance/floorPenalty/ceilingBonus
//   searchNumSimulations       optional override of the reduced sim count
//   adjustmentGrid             optional { minPct, maxPct, stepPct }
//   balanceMultiples           optional array of multiples
//   penaltyBonusGrid           optional { minPct, maxPct, stepPct }
export function runGoalSeek(params, config, { onProgress } = {}) {
  const notify = typeof onProgress === 'function' ? onProgress : () => {};
  const working = cloneParams(params);
  const searchNumSimulations = Math.min(
    params.numSimulations,
    config.searchNumSimulations || DEFAULT_SEARCH_NUM_SIMULATIONS,
  );

  let evalCount = 0;
  // Rough total, just for a smoothly-advancing progress bar (not exact).
  const estimatedEvalBudget = estimateEvalBudget(params, config);

  function evaluate(stage) {
    evalCount++;
    notify(stage, Math.min(evalCount / estimatedEvalBudget, 0.99));
    const searchParams = { ...working, numSimulations: searchNumSimulations };
    const result = runMonteCarlo(searchParams);
    const successRateAchieved = goalSuccessRate(
      result.finalBalance,
      result.depletionYear,
      params.numYears,
      config.targetEndingBalance,
    );
    return { successRateAchieved, medianTotalWithdrawn: median(result.totalWithdrawn) };
  }

  function meetsTarget(stage) {
    return evaluate(stage).successRateAchieved >= config.desiredSuccessRate;
  }

  // Neutralize every lever marked "include in search" before Phase 1 solves
  // the base withdrawal. Otherwise Phase 1 would calibrate the base tightly
  // around whatever those fields already contained, and Phase 2's search for
  // that same lever would just rediscover the boundary Phase 1 just used —
  // i.e. it would always "converge" back to the value that was already there.
  if (config.includeGoGoYears) {
    working.portfolio.goGoYears = 0;
  }
  if (config.includeMarketAdjustments) {
    working.dynConfig.low.adj = 0;
    working.dynConfig.med.adj = 0;
    working.dynConfig.high.adj = 0;
    working.dynConfig.low.bal = null;
    working.dynConfig.med.bal = null;
    working.dynConfig.high.bal = null;
  }
  if (config.includeBalanceOverrides) {
    working.portfolio.floorBalance = 0;
    working.portfolio.ceilingBalance = Infinity;
    working.portfolio.floorPenalty = 0;
    working.portfolio.ceilingBonus = 0;
  }

  // ---- Phase 1: bisect the base withdrawal -----------------------------------
  const feasibleAtZero = (() => {
    working.portfolio.base = 0;
    return meetsTarget('Checking feasibility');
  })();

  if (!feasibleAtZero) {
    return {
      params: { ...params },
      summary: {
        feasible: false,
        reason: 'Even a $0 base withdrawal cannot meet the desired success rate with this target ending balance. Lower the target, lower the desired success rate, or reduce the minimum withdrawal.',
        evaluationCount: evalCount,
      },
    };
  }

  const initialUpperBound = Math.max(params.portfolio.base * 4, (params.portfolio.start / Math.max(params.numYears, 1)) * 4, 1000);
  let hi = initialUpperBound;
  for (let i = 0; i < GOGO_MAX_UPPER_BOUND_DOUBLINGS; i++) {
    working.portfolio.base = hi;
    if (!meetsTarget('Bracketing base withdrawal')) break;
    hi *= 2;
  }

  const baseTolerance = Math.max(50, hi * 0.001);
  let solvedBase = roundDownToThousand(
    bisectMaxSatisfying(
      (x) => {
        working.portfolio.base = x;
        return meetsTarget('Tuning base withdrawal');
      },
      0,
      hi,
      { tolerance: baseTolerance },
    ),
  );
  working.portfolio.base = solvedBase;

  // ---- Rebisect the base withdrawal against whatever the levers currently
  // hold. Used both for the no-lever fast path (a single confirming pass,
  // same cost as before this feature existed) and once per round below. ----
  function rebisectBase(stageLabel) {
    const rebisectHi = Math.max(solvedBase * 2, initialUpperBound);
    return roundDownToThousand(
      bisectMaxSatisfying(
        (x) => {
          working.portfolio.base = x;
          return meetsTarget(stageLabel);
        },
        0,
        rebisectHi,
        { tolerance: baseTolerance },
      ),
    );
  }

  // One pass over every included lever, in a fixed order, holding the base
  // (whatever it currently is) fixed.
  function tuneLeversOnce() {
    if (config.includeGoGoYears) {
      const numYears = params.numYears;
      working.portfolio.goGoYears = bisectMaxSatisfyingInt(
        (y) => {
          working.portfolio.goGoYears = y;
          return meetsTarget('Tuning bonus years');
        },
        0,
        numYears,
      );
    }

    if (config.includeMarketAdjustments) {
      const adjustmentGrid = buildAdjustmentGrid(solvedBase, config.adjustmentGrid || DEFAULT_ADJUSTMENT_GRID);
      for (const field of ['low', 'med', 'high']) {
        working.dynConfig[field].adj = pickBestCandidate(
          adjustmentGrid,
          (value) => {
            working.dynConfig[field].adj = value;
            return evaluate('Tuning market adjustments');
          },
          config.desiredSuccessRate,
          working.dynConfig[field].adj,
        );
      }

      const balanceGrid = buildBalanceGrid(params.portfolio.start, config.balanceMultiples || DEFAULT_BALANCE_MULTIPLES, null);
      for (const field of ['low', 'med', 'high']) {
        working.dynConfig[field].bal = pickBestCandidate(
          balanceGrid,
          (value) => {
            working.dynConfig[field].bal = value;
            return evaluate('Tuning market balance overrides');
          },
          config.desiredSuccessRate,
          working.dynConfig[field].bal,
        );
      }
    }

    if (config.includeBalanceOverrides) {
      const floorGrid = buildBalanceGrid(params.portfolio.start, config.balanceMultiples || DEFAULT_BALANCE_MULTIPLES, 0);
      working.portfolio.floorBalance = pickBestCandidate(
        floorGrid,
        (value) => {
          working.portfolio.floorBalance = value;
          return evaluate('Tuning floor balance');
        },
        config.desiredSuccessRate,
        working.portfolio.floorBalance,
      );

      const ceilingGrid = buildBalanceGrid(params.portfolio.start, config.balanceMultiples || DEFAULT_BALANCE_MULTIPLES, Infinity);
      working.portfolio.ceilingBalance = pickBestCandidate(
        ceilingGrid,
        (value) => {
          working.portfolio.ceilingBalance = value;
          return evaluate('Tuning ceiling balance');
        },
        config.desiredSuccessRate,
        working.portfolio.ceilingBalance,
      );

      const penaltyBonusGrid = buildFractionGrid(config.penaltyBonusGrid || DEFAULT_PENALTY_BONUS_GRID);
      working.portfolio.floorPenalty = pickBestCandidate(
        penaltyBonusGrid,
        (value) => {
          working.portfolio.floorPenalty = value;
          return evaluate('Tuning max cut');
        },
        config.desiredSuccessRate,
        working.portfolio.floorPenalty,
      );

      working.portfolio.ceilingBonus = pickBestCandidate(
        penaltyBonusGrid,
        (value) => {
          working.portfolio.ceilingBonus = value;
          return evaluate('Tuning boost rate');
        },
        config.desiredSuccessRate,
        working.portfolio.ceilingBonus,
      );
    }
  }

  // Snapshot of every *included* lever's current value, used to detect when a
  // round made no difference so the loop can stop before hitting maxRounds.
  function captureLeverSnapshot() {
    const snapshot = {};
    if (config.includeGoGoYears) {
      snapshot.goGoYears = working.portfolio.goGoYears;
    }
    if (config.includeMarketAdjustments) {
      snapshot.dynLowAdj = working.dynConfig.low.adj;
      snapshot.dynMedAdj = working.dynConfig.med.adj;
      snapshot.dynHighAdj = working.dynConfig.high.adj;
      snapshot.dynLowBal = working.dynConfig.low.bal;
      snapshot.dynMedBal = working.dynConfig.med.bal;
      snapshot.dynHighBal = working.dynConfig.high.bal;
    }
    if (config.includeBalanceOverrides) {
      snapshot.floorBalance = working.portfolio.floorBalance;
      snapshot.ceilingBalance = working.portfolio.ceilingBalance;
      snapshot.floorPenalty = working.portfolio.floorPenalty;
      snapshot.ceilingBonus = working.portfolio.ceilingBonus;
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
    solvedBase = rebisectBase('Finalizing base withdrawal');
    working.portfolio.base = solvedBase;
  } else {
    const maxRounds = config.maxRounds || DEFAULT_MAX_ROUNDS;
    for (let round = 1; round <= maxRounds; round++) {
      const baseBeforeRound = solvedBase;
      const snapshotBefore = captureLeverSnapshot();

      tuneLeversOnce();
      solvedBase = rebisectBase('Finalizing base withdrawal');
      working.portfolio.base = solvedBase;
      roundsUsed = round;

      const baseChanged = Math.abs(solvedBase - baseBeforeRound) >= DOLLAR_ROUNDING;
      const leversChanged = !snapshotsEqual(snapshotBefore, captureLeverSnapshot());
      if (!baseChanged && !leversChanged) break;
    }
  }

  const finalBase = solvedBase;

  const finalMetrics = evaluate('Finalizing');
  notify('Confirming final plan', 1);

  const finalParams = { ...working, numSimulations: params.numSimulations };

  const summary = {
    feasible: true,
    baseWithdrawal: finalBase,
    roundsUsed,
    goGoYears: config.includeGoGoYears ? working.portfolio.goGoYears : undefined,
    marketAdjustments: config.includeMarketAdjustments
      ? { low: working.dynConfig.low.adj, med: working.dynConfig.med.adj, high: working.dynConfig.high.adj }
      : undefined,
    marketBalanceOverrides: config.includeMarketAdjustments
      ? { low: working.dynConfig.low.bal, med: working.dynConfig.med.bal, high: working.dynConfig.high.bal }
      : undefined,
    balanceAdjustment: config.includeBalanceOverrides
      ? {
          floorBalance: working.portfolio.floorBalance,
          ceilingBalance: Number.isFinite(working.portfolio.ceilingBalance) ? working.portfolio.ceilingBalance : null,
          floorPenalty: working.portfolio.floorPenalty,
          ceilingBonus: working.portfolio.ceilingBonus,
        }
      : undefined,
    achievedSuccessRate: finalMetrics.successRateAchieved,
    achievedMedianTotalWithdrawn: finalMetrics.medianTotalWithdrawn,
    evaluationCount: evalCount,
  };

  return { params: finalParams, summary };
}

function gridLength(gridConfig) {
  const { minPct, maxPct, stepPct } = gridConfig;
  return Math.floor((maxPct - minPct) / stepPct) + 1;
}

// Try every candidate for one field (holding everything else fixed via the
// closure in `applyAndEvaluate`), and keep whichever satisfies the success
// target with the highest median total withdrawn. Falls back to the field's
// current value if no candidate meets the target.
function pickBestCandidate(candidates, applyAndEvaluate, desiredSuccessRate, currentValue) {
  let best = currentValue;
  let bestMedian = -Infinity;
  let foundFeasible = false;
  for (const candidate of candidates) {
    const { successRateAchieved, medianTotalWithdrawn } = applyAndEvaluate(candidate);
    if (successRateAchieved >= desiredSuccessRate && medianTotalWithdrawn > bestMedian) {
      best = candidate;
      bestMedian = medianTotalWithdrawn;
      foundFeasible = true;
    }
  }
  return foundFeasible ? best : currentValue;
}
