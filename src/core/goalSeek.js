// Goal Seek: given a target ending balance and a desired success percentage,
// search for the base withdrawal (and, optionally, a few other spending
// levers) that maximizes withdrawals while still hitting the target. Pure
// and DOM-free, like the rest of `core/`, so it can run inside the worker
// and be unit-tested directly.

import { goalSuccessRate, median } from './statistics.js';

const DEFAULT_SEARCH_NUM_SIMULATIONS = 1000;
const DEFAULT_ADJUSTMENT_GRID = { minPct: -50, maxPct: 50, stepPct: 5 };
const DEFAULT_BALANCE_MULTIPLES = [0, 0.1, 0.2, 0.3, 0.4, 0.5];
// Used by the exported buildFractionGrid()'s own default (unit-tested directly) —
// keep this fine-grained; the coarser PAIR grid below is what the search actually
// uses internally, since joint pairs already multiply out two dimensions.
const DEFAULT_PENALTY_BONUS_GRID = { minPct: 0, maxPct: 100, stepPct: 10 };
// Coarser than DEFAULT_PENALTY_BONUS_GRID: the floor/ceiling search tunes balance
// threshold AND cut/boost rate together (see buildPairGrid), so a finer grid here
// would multiply out too many candidate evaluations.
const DEFAULT_PAIR_FRACTION_GRID = { minPct: 0, maxPct: 100, stepPct: 20 };
const BASE_BISECTION_MAX_ITERATIONS = 30;

// Bonus-amount candidates, as fractions of the currently-solved base withdrawal.
// Using a finer, lower grid prevents the final bonus from heavily cannibalizing
// the base and appearing as an unexpectedly high percentage in the final result.
const DEFAULT_GOGO_BONUS_FRACTIONS = [0.05, 0.1, 0.15, 0.2, 0.25, 0.3];

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

function roundToThousand(value) {
  return Math.round(value / DOLLAR_ROUNDING) * DOLLAR_ROUNDING;
}

// Rounds down: success rate only ever gets easier to hit as spending
// decreases, so flooring the bisected value can never push it back outside
// the feasible range the bisection already verified.
function roundDownToThousand(value) {
  return Math.floor(value / DOLLAR_ROUNDING) * DOLLAR_ROUNDING;
}

// Sum the unadjusted withdrawal schedule (base × age factor + bonus, with
// minimum-withdrawal floors), or the fixed per-year specific-list amounts
// when that strategy is in use. Deterministic — mirrors simulatePath's
// unadjustedTarget logic without running a simulation.
export function plannedScheduleTotal(portfolio, numYears) {
  const isSpecific = portfolio.strategy === 'specific';
  let total = 0;
  for (let j = 0; j < numYears; j++) {
    let unadjustedTarget;
    if (isSpecific) {
      // Each year's amount is typed in directly and never scaled — it's
      // the plan as-is, before any market/balance adjustment is layered on.
      unadjustedTarget = portfolio.specificWithdrawals?.[j] ?? 0;
    } else {
      const baseVal = portfolio.base;
      const ageFactor = (1 + (portfolio.spendChangeRate || 0)) ** j;
      unadjustedTarget = portfolio.base * ageFactor;
      if (j < (portfolio.goGoYears || 0)) {
        unadjustedTarget += portfolio.goGoBonus || 0;
      }
      if (baseVal >= 0 && unadjustedTarget < 0) {
        unadjustedTarget = 0;
      }
    }
    const yearFloor = portfolio.withdrawalFloorSeries?.[j] ?? 0;
    if (unadjustedTarget >= 0 && yearFloor > 0) {
      unadjustedTarget = Math.max(unadjustedTarget, yearFloor);
    }
    total += unadjustedTarget;
  }
  return total;
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
    },
  };
}

function hasIncludedLevers(config) {
  return !!(config.includeGoGoYears || config.includeMarketAdjustments || config.includeBalanceOverrides);
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
  const balanceGridLen = (config.balanceMultiples || DEFAULT_BALANCE_MULTIPLES).length;
  const pairFractionGridLen = gridLength(config.penaltyBonusGrid || DEFAULT_PAIR_FRACTION_GRID);
  const adjustmentGridLen = gridLength(config.adjustmentGrid || DEFAULT_ADJUSTMENT_GRID);
  const bonusGridLen = (config.goGoBonusFractions || DEFAULT_GOGO_BONUS_FRACTIONS).length;
  const candidateCost = perCandidateCost(config);

  const perRoundLeverCost =
    (config.includeGoGoYears ? bonusGridLen * candidateCost : 0) +
    (config.includeMarketAdjustments
      ? (3 * adjustmentGridLen + 3 * balanceGridLen) * candidateCost
      : 0) +
    (config.includeBalanceOverrides
      ? 2 * balanceGridLen * pairFractionGridLen * candidateCost
      : 0);

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
//   targetEndingBalance      dollars
//   desiredSuccessRate       fraction 0..1
//   shortfallTolerance       fraction 0..1 — max lifetime spending shortfall vs plan
//   pinBaseWithdrawal          bool — keep params.portfolio.base fixed; search levers only
//   includeGoGoYears           bool — covers goGoBonus
//   includeMarketAdjustments   bool — covers dynLow/Med/HighAdj AND dynLow/Med/HighBal
//   includeBalanceOverrides    bool — covers floorBalance/ceilingBalance/floorPenalty/ceilingBonus
//   searchNumSimulations       optional override of the reduced sim count
//   adjustmentGrid             optional { minPct, maxPct, stepPct }
//   balanceMultiples           optional array of multiples
//   penaltyBonusGrid           optional { minPct, maxPct, stepPct }
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

  // While Bonus Years is included in the search, the plan is scored by how
  // much can be spent PER YEAR during those bonus years (not the lifetime
  // total) — that's what makes the search actually front-load spending
  // instead of staying indifferent between an early dollar and a late one.
  // Outside that lever, or once it's resolved back to 0 bonus years, the
  // objective falls back to the familiar median lifetime total.
  function currentEarlyWindow() {
    return config.includeGoGoYears ? working.portfolio.goGoYears : 0;
  }

  function computeObjective(result, window) {
    if (window > 0) {
      return median(result.earlyWithdrawn) / window;
    }
    return median(result.totalWithdrawn);
  }

  async function evaluateWith(numSimulations, stage) {
    evalCount++;
    notify(stage, Math.min(evalCount / estimatedEvalBudget, 0.99));
    const window = currentEarlyWindow();
    const searchParams = { ...working, numSimulations, earlyYearsWindow: window };
    const result = await simulateAsync(searchParams);
    const plannedTotal = plannedScheduleTotal(working.portfolio, params.numYears);
    const shortfallTolerance = config.shortfallTolerance ?? DEFAULT_SHORTFALL_TOLERANCE;
    const successRateAchieved = goalSuccessRate(
      result.finalBalance,
      result.depletionYear,
      params.numYears,
      config.targetEndingBalance,
      result.totalWithdrawn,
      plannedTotal,
      shortfallTolerance,
    );
    return {
      successRateAchieved,
      medianTotalWithdrawn: median(result.totalWithdrawn),
      objectiveValue: computeObjective(result, window),
    };
  }

  async function evaluate(stage) {
    return evaluateWith(searchNumSimulations, stage);
  }

  async function meetsTarget(stage) {
    return (await evaluate(stage)).successRateAchieved >= config.desiredSuccessRate;
  }

  // Neutralize every lever marked "include in search" before Phase 1 solves
  // the base withdrawal. Otherwise Phase 1 would calibrate the base tightly
  // around whatever those fields already contained, and Phase 2's search for
  // that same lever would just rediscover the boundary Phase 1 just used —
  // i.e. it would always "converge" back to the value that was already there.
  if (config.includeGoGoYears) {
    working.portfolio.goGoBonus = 0;
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
    return {
      params: { ...params },
      summary: {
        feasible: false,
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
          return (await evaluateWith(resolveNumSimulations, stageLabel)).successRateAchieved >= config.desiredSuccessRate;
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
  // keep whichever satisfies the success target with the highest objective
  // value. Applies the winner (or the current value, if none qualified) to
  // `working` before returning, including the base it was solved against.
  async function pickBestCandidateWithResolve(candidates, applyCandidate, stageLabel, currentValue) {
    let best = currentValue;
    let bestObjective = -Infinity;
    let bestSuccessRate = -Infinity;
    let bestBase = solvedBase;
    let foundTarget = false;
    for (const candidate of candidates) {
      applyCandidate(candidate);
      const { resolvedBase, successRateAchieved, objectiveValue } = await scoreCurrentLeversWithResolve(stageLabel);
      if (successRateAchieved >= config.desiredSuccessRate) {
        if (!foundTarget || objectiveValue > bestObjective) {
          foundTarget = true;
          best = candidate;
          bestObjective = objectiveValue;
          bestBase = resolvedBase;
        }
      } else if (pinBase && !foundTarget) {
        if (
          successRateAchieved > bestSuccessRate
          || (successRateAchieved === bestSuccessRate && objectiveValue > bestObjective)
        ) {
          best = candidate;
          bestSuccessRate = successRateAchieved;
          bestObjective = objectiveValue;
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
  async function pickBestPairWithResolve(pairs, applyPair, stageLabel, currentPair) {
    let best = currentPair;
    let bestObjective = -Infinity;
    let bestSuccessRate = -Infinity;
    let bestBase = solvedBase;
    let foundTarget = false;
    for (const pair of pairs) {
      applyPair(pair[0], pair[1]);
      const { resolvedBase, successRateAchieved, objectiveValue } = await scoreCurrentLeversWithResolve(stageLabel);
      if (successRateAchieved >= config.desiredSuccessRate) {
        if (!foundTarget || objectiveValue > bestObjective) {
          foundTarget = true;
          best = pair;
          bestObjective = objectiveValue;
          bestBase = resolvedBase;
        }
      } else if (pinBase && !foundTarget) {
        if (
          successRateAchieved > bestSuccessRate
          || (successRateAchieved === bestSuccessRate && objectiveValue > bestObjective)
        ) {
          best = pair;
          bestSuccessRate = successRateAchieved;
          bestObjective = objectiveValue;
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
    if (config.includeGoGoYears) {
      const bonusGrid = buildBonusGrid(solvedBase, config.goGoBonusFractions);
      working.portfolio.goGoBonus = await pickBestCandidateWithResolve(
        bonusGrid,
        (value) => {
          working.portfolio.goGoBonus = value;
        },
        'Tuning early-years bonus',
        working.portfolio.goGoBonus,
      );
    }

    if (config.includeMarketAdjustments) {
      const adjustmentGrid = buildAdjustmentGrid(solvedBase, config.adjustmentGrid || DEFAULT_ADJUSTMENT_GRID);
      for (const field of ['low', 'med', 'high']) {
        working.dynConfig[field].adj = await pickBestCandidateWithResolve(
          adjustmentGrid,
          (value) => {
            working.dynConfig[field].adj = value;
          },
          'Tuning market adjustments',
          working.dynConfig[field].adj,
        );
      }

      const balanceGrid = buildBalanceGrid(params.portfolio.start, config.balanceMultiples || DEFAULT_BALANCE_MULTIPLES, null);
      for (const field of ['low', 'med', 'high']) {
        working.dynConfig[field].bal = await pickBestCandidateWithResolve(
          balanceGrid,
          (value) => {
            working.dynConfig[field].bal = value;
          },
          'Tuning market balance overrides',
          working.dynConfig[field].bal,
        );
      }
    }

    if (config.includeBalanceOverrides) {
      const floorGrid = buildBalanceGrid(params.portfolio.start, config.balanceMultiples || DEFAULT_BALANCE_MULTIPLES, 0);
      const penaltyGrid = buildFractionGrid(config.penaltyBonusGrid || DEFAULT_PAIR_FRACTION_GRID);
      const floorPairs = buildPairGrid(floorGrid, penaltyGrid, (floor) => floor === 0);
      const validFloorPairs = floorPairs.filter(
        ([floor]) =>
          floor === 0
          || !Number.isFinite(working.portfolio.ceilingBalance)
          || floor < working.portfolio.ceilingBalance,
      );
      await pickBestPairWithResolve(
        validFloorPairs,
        (floor, penalty) => {
          working.portfolio.floorBalance = floor;
          working.portfolio.floorPenalty = penalty;
        },
        'Tuning floor balance & max cut',
        [working.portfolio.floorBalance, working.portfolio.floorPenalty],
      );

      const ceilingGrid = buildBalanceGrid(params.portfolio.start, config.balanceMultiples || DEFAULT_BALANCE_MULTIPLES, Infinity);
      const bonusRateGrid = buildFractionGrid(config.penaltyBonusGrid || DEFAULT_PAIR_FRACTION_GRID);
      const ceilingPairs = buildPairGrid(ceilingGrid, bonusRateGrid, (ceiling) => !Number.isFinite(ceiling));
      const validCeilingPairs = ceilingPairs.filter(
        ([ceiling]) =>
          !Number.isFinite(ceiling)
          || working.portfolio.floorBalance === 0
          || ceiling > working.portfolio.floorBalance,
      );
      await pickBestPairWithResolve(
        validCeilingPairs,
        (ceiling, bonus) => {
          working.portfolio.ceilingBalance = ceiling;
          working.portfolio.ceilingBonus = bonus;
        },
        'Tuning ceiling balance & boost rate',
        [working.portfolio.ceilingBalance, working.portfolio.ceilingBonus],
      );
    }
  }

  // Snapshot of every *included* lever's current value, used to detect when a
  // round made no difference so the loop can stop before hitting maxRounds.
  function captureLeverSnapshot() {
    const snapshot = {};
    if (config.includeGoGoYears) {
      snapshot.goGoBonus = working.portfolio.goGoBonus;
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

  const finalBase = solvedBase;

  const finalMetrics = await evaluate('Finalizing');
  notify('Confirming final plan', 1);

  const shortfallTolerance = config.shortfallTolerance ?? DEFAULT_SHORTFALL_TOLERANCE;
  const plannedTotal = plannedScheduleTotal(working.portfolio, params.numYears);

  if (pinBase && finalMetrics.successRateAchieved < config.desiredSuccessRate) {
    const baseK = Math.round(finalBase / DOLLAR_ROUNDING);
    return {
      params: { ...params },
      summary: {
        feasible: false,
        pinnedBase: true,
        baseWithdrawal: finalBase,
        achievedSuccessRate: finalMetrics.successRateAchieved,
        reason: `Your pinned base withdrawal of $${baseK.toLocaleString('en-US')}k cannot meet the desired success rate even with the best lever settings. Try lowering the base, the target ending balance, or the desired success rate, or raising the risk tolerance.`,
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
    goGoBonus: config.includeGoGoYears ? working.portfolio.goGoBonus : undefined,
    spendChangeRate: working.portfolio.spendChangeRate,
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
    shortfallTolerance,
    plannedScheduleTotal: plannedTotal,
    achievedSuccessRate: finalMetrics.successRateAchieved,
    achievedMedianTotalWithdrawn: finalMetrics.medianTotalWithdrawn,
    achievedObjectiveValue: finalMetrics.objectiveValue,
    // Only set when the search actively optimized for the bonus-years window
    // rather than the lifetime total (see currentEarlyWindow above).
    earlyYearsWindow: earlyYearsWindow > 0 ? earlyYearsWindow : undefined,
    evaluationCount: evalCount,
  };

  return { params: finalParams, summary };
}

function gridLength(gridConfig) {
  const { minPct, maxPct, stepPct } = gridConfig;
  return Math.floor((maxPct - minPct) / stepPct) + 1;
}
