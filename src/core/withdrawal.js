// Withdrawal strategy logic, extracted as pure functions so it can be unit-tested
// in isolation and reused by the simulation engine.

// Piecewise-linear interpolation of the extra withdrawal adjustment based on the
// nominal market return (%), using the low / expected / high anchor points.
export function getDynamicAdjustment(nominalReturnPercent, dynConfig) {
  if (nominalReturnPercent <= dynConfig.low.ret) return dynConfig.low.adj;
  if (nominalReturnPercent >= dynConfig.high.ret) return dynConfig.high.adj;

  if (nominalReturnPercent < dynConfig.med.ret) {
    const range = dynConfig.med.ret - dynConfig.low.ret;
    // Anchors at the same return would mean dividing by zero; use the medium
    // anchor's adjustment directly instead of producing NaN.
    if (range <= 0) return dynConfig.med.adj;
    const pct = (nominalReturnPercent - dynConfig.low.ret) / range;
    return dynConfig.low.adj + pct * (dynConfig.med.adj - dynConfig.low.adj);
  } else {
    const range = dynConfig.high.ret - dynConfig.med.ret;
    if (range <= 0) return dynConfig.med.adj;
    const pct = (nominalReturnPercent - dynConfig.med.ret) / range;
    return dynConfig.med.adj + pct * (dynConfig.high.adj - dynConfig.med.adj);
  }
}

// Resolve the final additional withdrawal adjustment for a given year, applying
// (1) the market-return curve and (2) balance-based floors.
export function resolveAdjustment(balance, nominalReturnPercent, dynConfig) {
  let adjAmount = getDynamicAdjustment(nominalReturnPercent, dynConfig);

  // Low balance always replaces the market amount. Expected/High balances only
  // raise the adjustment on bad market years — they never cap a good year.
  // Blank/zero override thresholds are disabled (bal is null).
  if (dynConfig.low.bal != null && balance < dynConfig.low.bal) {
    adjAmount = dynConfig.low.adj;
  } else if (dynConfig.high.bal != null && balance > dynConfig.high.bal) {
    adjAmount = Math.max(adjAmount, dynConfig.high.adj);
  } else if (dynConfig.med.bal != null && balance > dynConfig.med.bal) {
    adjAmount = Math.max(adjAmount, dynConfig.med.adj);
  }

  return adjAmount;
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
// Each entry carries the annual real change rate (decimal) and a flat extra
// withdrawal (dollars) added on top of the compounding base. Intermediate
// tiers run for their year count; the final tier fills the horizon.
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

// Walk the spending-over-time series to produce each year's unadjusted base
// withdrawal: year 0 is unscaled; each later year multiplies the running
// growth factor by (1 + that year's tier rate), then adds the tier's flat
// extra. Clamped to 0 when the base amount is non-negative.
export function buildBaseWithdrawalSchedule(base, spendingSeries, numYears) {
  if (numYears <= 0) return [];
  const series = spendingSeries || [];
  const amounts = new Array(numYears);
  let growthFactor = 1;

  for (let j = 0; j < numYears; j++) {
    const entry = series[j] ?? { changeRate: 0, extra: 0 };
    if (j > 0) {
      growthFactor *= 1 + entry.changeRate;
    }
    let amount = base * growthFactor + entry.extra;
    if (base >= 0 && amount < 0) amount = 0;
    amounts[j] = amount;
  }
  return amounts;
}

// Build a per-year gifting schedule from staged tiers ($000s in tiers).
// Each entry carries the gift amount and the balance threshold that must be
// exceeded (after growth and the regular withdrawal) before the gift is paid.
// Intermediate tiers run for their year count; the final tier fills the horizon.
export function buildGiftingSeries(tiers, numYears, toDollarsFn) {
  if (numYears <= 0) return [];
  const emptyEntry = { amount: 0, balanceThreshold: 0 };
  const series = new Array(numYears).fill(null);
  if (!tiers || tiers.length === 0) {
    return series.map(() => ({ ...emptyEntry }));
  }

  let yearIndex = 0;
  for (let i = 0; i < tiers.length - 1; i++) {
    const amount = toDollarsFn(tiers[i].amount);
    const balanceThreshold = toDollarsFn(tiers[i].balance);
    const span = Math.max(0, parseInt(tiers[i].years, 10) || 0);
    for (let k = 0; k < span && yearIndex < numYears; k++) {
      series[yearIndex++] = { amount, balanceThreshold };
    }
  }

  const last = tiers[tiers.length - 1];
  const lastAmount = toDollarsFn(last.amount);
  const lastBalance = toDollarsFn(last.balance);
  while (yearIndex < numYears) {
    series[yearIndex++] = { amount: lastAmount, balanceThreshold: lastBalance };
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
