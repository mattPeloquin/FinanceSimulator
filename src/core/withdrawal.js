// Withdrawal strategy logic, extracted as pure functions so it can be unit-tested
// in isolation and reused by the simulation engine.

// Piecewise-linear interpolation of the extra withdrawal adjustment based on the
// real market return (%), using the low / expected / high anchor points.
export function getDynamicAdjustment(realReturnPercent, dynConfig) {
  if (realReturnPercent <= dynConfig.low.ret) return dynConfig.low.adj;
  if (realReturnPercent >= dynConfig.high.ret) return dynConfig.high.adj;

  if (realReturnPercent < dynConfig.med.ret) {
    const range = dynConfig.med.ret - dynConfig.low.ret;
    // Anchors at the same return would mean dividing by zero; use the medium
    // anchor's adjustment directly instead of producing NaN.
    if (range <= 0) return dynConfig.med.adj;
    const pct = (realReturnPercent - dynConfig.low.ret) / range;
    return dynConfig.low.adj + pct * (dynConfig.med.adj - dynConfig.low.adj);
  } else {
    const range = dynConfig.high.ret - dynConfig.med.ret;
    if (range <= 0) return dynConfig.med.adj;
    const pct = (realReturnPercent - dynConfig.med.ret) / range;
    return dynConfig.med.adj + pct * (dynConfig.high.adj - dynConfig.med.adj);
  }
}

// Resolve the final additional withdrawal adjustment for a given year, applying
// (1) the market-return curve and (2) the balance-based "no cut" rule.
// Max-boost drawdown (trimming a positive boost so year-end stays above a
// start-of-year floor) is applied later in the simulation once spending
// without the boost is known — see limitBoostForDrawdown.
export function resolveAdjustment(balance, realReturnPercent, dynConfig) {
  let adjAmount = getDynamicAdjustment(realReturnPercent, dynConfig);

  // "No cut while ahead": when the balance is above the no-cut threshold,
  // suppress any downward market adjustment — a bad-return year doesn't cut
  // spending if the portfolio is still comfortably above where it started.
  // Blank/zero threshold (null) disables the rule. Upward adjustments are
  // never touched; boosting on high balances is the ceiling bonus's job.
  if (dynConfig.noCutBal != null && balance > dynConfig.noCutBal && adjAmount < 0) {
    adjAmount = 0;
  }

  return adjAmount;
}

// Cap a positive market boost so that after that year's total spending
// (everything except glide), ending balance stays at or above:
//   startOfYear * (1 - drawdownPct)
// Negative drawdownPct means the year must still grow (e.g. -1% → finish at
// least 1% above start). Blank/null drawdownPct disables the rule. Only the
// boost is reduced — never the base plan. spendingWithoutBoostExGlide is the
// dollars that would leave the portfolio with boost = 0 (excl. glide).
export function limitBoostForDrawdown(
  curveBoost,
  startOfYearBalance,
  postGrowthBalance,
  drawdownPct,
  spendingWithoutBoostExGlide,
) {
  if (!(curveBoost > 0)) return curveBoost;
  if (drawdownPct == null || !Number.isFinite(drawdownPct)) return curveBoost;
  const minEndBalance = startOfYearBalance * (1 - drawdownPct);
  const maxWdExGlide = postGrowthBalance - minEndBalance;
  return Math.min(curveBoost, Math.max(0, maxWdExGlide - spendingWithoutBoostExGlide));
}

// Smooth balance-based spending scale (multiplier on the TOTAL withdrawal).
// Instead of a cliff at the floor/ceiling thresholds, spending ramps gradually:
//
//   - Between floor and ceiling the multiplier is exactly 1 (no effect).
//   - Below the floor it slides down linearly, reaching (1 - floorPenalty)
//     when the balance hits $0. E.g. floor $2M / penalty 50%: at $1M the
//     multiplier is 0.75, approaching 0.5 as the money runs out.
//   - Above the ceiling it climbs linearly and WITHOUT any cap, adding
//     ceilingBonus for every additional multiple of the ceiling. E.g. ceiling
//     $5M / bonus 50%: at $10M the multiplier is 1.5, at $15M it is 2.0.
//
// A floor of 0 disables the down-ramp; a ceiling of 0/Infinity disables the
// up-ramp. The result is clamped at 0 so spending can never flip into a deposit.
export function balanceScaleMultiplier(balance, portfolio) {
  const { floorBalance, floorPenalty, ceilingBalance, ceilingBonus } = portfolio;

  if (floorBalance > 0 && floorPenalty > 0 && balance < floorBalance) {
    const shortfallFraction = 1 - balance / floorBalance; // 0 at the floor, 1 at $0
    return Math.max(0, 1 - floorPenalty * shortfallFraction);
  }

  if (Number.isFinite(ceilingBalance) && ceilingBalance > 0 && ceilingBonus > 0 && balance > ceilingBalance) {
    const surplusMultiples = balance / ceilingBalance - 1; // 0 at the ceiling, 1 at 2x ceiling
    return 1 + ceilingBonus * surplusMultiples;
  }

  return 1;
}

// Glide-path spend-down: per-year required balances toward a target ending
// balance. required[j] is the balance needed just after year j's growth (i.e.
// right before that year's withdrawal) such that withdrawing the plan and
// growing at `glideRate` (real, decimal) each remaining year lands exactly on
// `glideTarget` after the final year's withdrawal. Matches the engine's
// grow-then-withdraw convention:
//
//   required[h-1] = plan[h-1] + target
//   required[j]   = plan[j] + required[j+1] / (1 + glideRate)
//
// Any balance above required[j] is surplus the glide lever may recycle into
// extra spending. Because required[] declines toward the target as the horizon
// shrinks, the lever engages hardest in the late years of comfortable paths —
// unlike a fixed ceiling threshold. Planned deposits (negative plan entries)
// reduce the required balance, since they fund the target themselves.
export function buildGlideRequiredBalances(plannedAmounts, glideTarget, glideRate = 0) {
  const n = plannedAmounts.length;
  const required = new Array(n);
  const growth = 1 + glideRate;
  // Required balance just after the following year's growth; for the last
  // year that is simply the target itself (final balance is measured right
  // after the last withdrawal, with no further growth).
  let next = glideTarget;
  for (let j = n - 1; j >= 0; j--) {
    required[j] = plannedAmounts[j] + (j === n - 1 ? next : next / growth);
    next = required[j];
  }
  return required;
}

// One year's glide-path spend-down amount. `surplus` is how far the
// pre-withdrawal balance sits above the year's required glide balance (minus
// any gift already paid); the lever recycles `glideFraction` of it as extra
// spending. Two caps apply:
//   1. Never spend more than the money actually left (`remainingBalance`).
//   2. Never let the glide spend itself push the remaining balance below the
//      glide target. The lever's job is to land ON the target, so when other
//      spending (minimum floors, gifts, boosts) has already pulled the balance
//      near it, glide stops short instead of spending past it. Bad markets can
//      still finish a run below the target — glide spending just can never be
//      the cause.
export function glideSpendAmount(surplus, remainingBalance, glideFraction, glideTarget) {
  if (!(surplus > 0)) return 0;
  const headroomAboveTarget = Math.max(0, remainingBalance - glideTarget);
  return Math.min(glideFraction * surplus, remainingBalance, headroomAboveTarget);
}

// Build a per-year minimum-withdrawal backstop from staged tiers ($000s in tiers).
// Intermediate tiers run for their year count; the final tier fills the horizon.
export function buildWithdrawalFloorSeries(tiers, numYears, toDollarsFn) {
  if (numYears <= 0) return [];
  const series = new Array(numYears).fill(0);
  if (!tiers || tiers.length === 0) return series;

  let yearIndex = 0;
  for (let i = 0; i < tiers.length - 1; i++) {
    const amount = toDollarsFn(tiers[i].amount);
    const span = Math.max(0, parseInt(tiers[i].years, 10) || 0);
    for (let k = 0; k < span && yearIndex < numYears; k++) {
      series[yearIndex++] = amount;
    }
  }

  const lastAmount = toDollarsFn(tiers[tiers.length - 1].amount);
  while (yearIndex < numYears) {
    series[yearIndex++] = lastAmount;
  }
  return series;
}

// Build a per-year minimum-withdrawal percentage series from staged tiers.
// Intermediate tiers run for their year count; the final tier fills the horizon.
export function buildWithdrawalFloorPctSeries(tiers, numYears) {
  if (numYears <= 0) return [];
  const series = new Array(numYears).fill(0);
  if (!tiers || tiers.length === 0) return series;

  let yearIndex = 0;
  for (let i = 0; i < tiers.length - 1; i++) {
    const pct = tiers[i].pct;
    const span = Math.max(0, parseInt(tiers[i].years, 10) || 0);
    for (let k = 0; k < span && yearIndex < numYears; k++) {
      series[yearIndex++] = pct;
    }
  }

  const lastPct = tiers[tiers.length - 1].pct;
  while (yearIndex < numYears) {
    series[yearIndex++] = lastPct;
  }
  return series;
}

// Build a per-year spending-over-time schedule from staged tiers.
// Each entry carries the annual real change rate (decimal) and an optional
// extra withdrawal (dollars). When extra ≠ 0, buildBaseWithdrawalSchedule
// applies the change % to that extra only; when extra is 0, it compounds the
// base. Intermediate tiers run for their year count; the final tier fills
// the horizon.
export function buildSpendingOverTimeSeries(tiers, numYears, toDollarsFn) {
  if (numYears <= 0) return [];
  const emptyEntry = { changeRate: 0, extra: 0 };
  const series = new Array(numYears).fill(null);
  if (!tiers || tiers.length === 0) {
    return series.map(() => ({ ...emptyEntry }));
  }

  let yearIndex = 0;
  for (let i = 0; i < tiers.length - 1; i++) {
    const changeRate = (tiers[i].changePct || 0) / 100;
    const extra = toDollarsFn(tiers[i].extra);
    const span = Math.max(0, parseInt(tiers[i].years, 10) || 0);
    for (let k = 0; k < span && yearIndex < numYears; k++) {
      series[yearIndex++] = { changeRate, extra };
    }
  }

  const last = tiers[tiers.length - 1];
  const lastChangeRate = (last.changePct || 0) / 100;
  const lastExtra = toDollarsFn(last.extra);
  while (yearIndex < numYears) {
    series[yearIndex++] = { changeRate: lastChangeRate, extra: lastExtra };
  }
  return series;
}

// Walk the spending-over-time series to produce each year's unadjusted plan
// withdrawal.
//
// Year 0 is always unscaled. For later years the annual real change % is
// applied to whichever piece is "active":
//   • extra ≠ 0 — the core base stays put; the % compounds the extra only
//     (go-go / front-load fade). A new extra amount resets that fade so each
//     staged bonus starts from its full value.
//   • extra = 0 — the % compounds the core base, same as a plain declining
//     (or rising) withdrawal schedule.
//
// Clamped to 0 when the base amount is non-negative.
export function buildBaseWithdrawalSchedule(base, spendingSeries, numYears) {
  if (numYears <= 0) return [];
  const series = spendingSeries || [];
  const amounts = new Array(numYears);
  // Separate growth trackers: the change % never moves both pieces at once.
  let baseGrowthFactor = 1;
  let extraGrowthFactor = 1;
  let previousExtra = null;

  for (let j = 0; j < numYears; j++) {
    const entry = series[j] ?? { changeRate: 0, extra: 0 };
    const extra = entry.extra || 0;
    const hasExtra = extra !== 0;

    // Starting a different extra amount (including 0 → bonus or bonus → other
    // bonus) begins a fresh fade/growth schedule for that extra.
    if (previousExtra !== null && extra !== previousExtra) {
      extraGrowthFactor = 1;
    }

    if (j > 0) {
      if (hasExtra) {
        // Percent change applies only to the extra; core spending is unchanged.
        extraGrowthFactor *= 1 + entry.changeRate;
      } else {
        // No extra this year: percent change compounds the core base.
        baseGrowthFactor *= 1 + entry.changeRate;
      }
    }

    let amount = hasExtra
      ? base * baseGrowthFactor + extra * extraGrowthFactor
      : base * baseGrowthFactor;
    if (base >= 0 && amount < 0) amount = 0;
    amounts[j] = amount;
    previousExtra = extra;
  }
  return amounts;
}

/** Optional % fields are blank when both trigger and target are null/undefined. */
export function giftingUsesPercentMode(gift) {
  if (!gift) return false;
  return gift.triggerPct != null || gift.targetPct != null;
}

// How much of the configured Gift to pay this year.
//
// Balance > is always a hard gate in both modes: if the post-withdrawal
// portfolio does not strictly exceed the tier's threshold, pay nothing.
//
// On top of that gate:
// 1. Legacy (both Trigger % and Target % blank): pay the full Gift.
// 2. Percent mode (either % filled): compare the post-withdrawal balance to
//    the funded need of remaining planned withdrawals (undiscounted, no
//    ending-balance cushion). Percents may be negative (below that need) or
//    positive (above it). Gift scales linearly from 0% at the trigger level
//    to 100% at the target level; above the target, pay the full Gift only —
//    never the surplus itself.
//
// `remainingPlanNeed` is the dollars still needed after this year's regular
// withdrawal to fund the rest of the plan (0 in the final year).
export function scaledGiftAmount(gift, balance, remainingPlanNeed = 0) {
  if (!gift || !(gift.amount > 0)) return 0;

  // Always require Balance > — even when trigger/target % scale the gift.
  const balanceThreshold = gift.balanceThreshold ?? 0;
  if (!(balance > balanceThreshold)) return 0;

  if (!giftingUsesPercentMode(gift)) {
    return gift.amount;
  }

  // No remaining plan left (last year, or only deposits ahead): any leftover
  // that cleared Balance > is above every finite % band, so pay the full gift.
  if (!(remainingPlanNeed > 0)) {
    return gift.amount;
  }

  // Blank trigger → start scaling at plan (0% above). Blank target → step
  // function at the trigger (0 below, full gift at/above).
  const triggerPct = gift.triggerPct != null ? gift.triggerPct : 0;
  const targetPct = gift.targetPct != null ? gift.targetPct : triggerPct;
  const triggerLevel = remainingPlanNeed * (1 + triggerPct / 100);
  const targetLevel = remainingPlanNeed * (1 + targetPct / 100);

  // Strictly below the trigger → no gift. At the trigger with a wider target
  // band the scale is 0; when trigger equals target (step), at/above pays full.
  if (balance < triggerLevel) return 0;
  if (balance >= targetLevel || !(targetLevel > triggerLevel)) {
    return gift.amount;
  }

  // Linear ramp: halfway between trigger and target → half the gift.
  const scale = (balance - triggerLevel) / (targetLevel - triggerLevel);
  return gift.amount * scale;
}

// Build a per-year gifting schedule from staged tiers ($000s in tiers).
// Each entry carries the gift amount, the legacy Balance > threshold, and
// optional trigger/target % fields (null = blank). Intermediate tiers run for
// their year count; the final tier fills the horizon.
export function buildGiftingSeries(tiers, numYears, toDollarsFn) {
  if (numYears <= 0) return [];
  const emptyEntry = {
    amount: 0,
    balanceThreshold: 0,
    triggerPct: null,
    targetPct: null,
  };
  const series = new Array(numYears).fill(null);
  if (!tiers || tiers.length === 0) {
    return series.map(() => ({ ...emptyEntry }));
  }

  const entryFromTier = (tier) => ({
    amount: toDollarsFn(tier.amount),
    balanceThreshold: toDollarsFn(tier.balance),
    triggerPct: tier.triggerPct != null && Number.isFinite(tier.triggerPct) ? tier.triggerPct : null,
    targetPct: tier.targetPct != null && Number.isFinite(tier.targetPct) ? tier.targetPct : null,
  });

  let yearIndex = 0;
  for (let i = 0; i < tiers.length - 1; i++) {
    const entry = entryFromTier(tiers[i]);
    const span = Math.max(0, parseInt(tiers[i].years, 10) || 0);
    for (let k = 0; k < span && yearIndex < numYears; k++) {
      series[yearIndex++] = { ...entry };
    }
  }

  const lastEntry = entryFromTier(tiers[tiers.length - 1]);
  while (yearIndex < numYears) {
    series[yearIndex++] = { ...lastEntry };
  }
  return series;
}

// Build a per-year major-events cashflow series from independent event rows.
// Each event carries a signed amount in $000s, a 1-based start year, and an
// optional consecutive year count (blank/null = one-time). Positive amounts
// are inflows (house sale, inheritance); negative amounts are extra payments
// on top of that year's spending plan. Overlapping events in the same year sum.
export function buildMajorEventsSeries(events, numYears, toDollarsFn) {
  const series = new Array(numYears).fill(0);
  if (numYears <= 0 || !events || events.length === 0) return series;

  for (const event of events) {
    const amount = toDollarsFn(event.amount);
    if (amount === 0) continue;

    const startIndex = Math.max(0, (event.startYear ?? 1) - 1);
    const span = event.years ?? 1;
    for (let k = 0; k < span; k++) {
      const j = startIndex + k;
      if (j < numYears) {
        series[j] += amount;
      }
    }
  }
  return series;
}

// Build per-year gift ceiling values for the schedule preview chart.
// Shows baseline + gift amount where the tier gift is positive; null otherwise.
export function buildGiftOverlaySeries(baselineAmounts, giftAmounts) {
  const baseline = baselineAmounts || [];
  const gifts = giftAmounts || [];
  const len = Math.max(baseline.length, gifts.length);
  const series = new Array(len).fill(null);
  for (let j = 0; j < len; j++) {
    const gift = gifts[j] ?? 0;
    if (gift > 0) {
      series[j] = Math.max(0, baseline[j] ?? 0) + gift;
    }
  }
  return series;
}

export function buildSpecificWithdrawalFloorSeries(pctTiers, specificAmountsDollars, numYears) {
  if (numYears <= 0) return [];
  const pctSeries = buildWithdrawalFloorPctSeries(pctTiers, numYears);
  const amounts = specificAmountsDollars || [];
  const series = new Array(numYears).fill(0);

  for (let j = 0; j < numYears; j++) {
    const listAmount = amounts[j] ?? 0;
    if (listAmount < 0) {
      series[j] = 0;
      continue;
    }
    const pct = pctSeries[j] ?? 0;
    series[j] = pct > 0 ? listAmount * (pct / 100) : 0;
  }
  return series;
}
