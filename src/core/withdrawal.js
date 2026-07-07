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

// Convert Specific List percentage tiers into per-year dollar floors.
// Each year's floor is that year's list amount times the tier percentage.
// Deposits (negative list amounts) get no floor so they stay deposits.
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
