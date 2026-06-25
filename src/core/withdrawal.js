// Withdrawal strategy logic, extracted as pure functions so it can be unit-tested
// in isolation and reused by the simulation engine.

// Piecewise-linear interpolation of the extra withdrawal adjustment based on the
// nominal market return (%), using the low / expected / high anchor points.
export function getDynamicAdjustment(nominalReturnPercent, dynConfig) {
  if (nominalReturnPercent <= dynConfig.low.ret) return dynConfig.low.adj;
  if (nominalReturnPercent >= dynConfig.high.ret) return dynConfig.high.adj;

  if (nominalReturnPercent < dynConfig.med.ret) {
    const range = dynConfig.med.ret - dynConfig.low.ret;
    const pct = (nominalReturnPercent - dynConfig.low.ret) / range;
    return dynConfig.low.adj + pct * (dynConfig.med.adj - dynConfig.low.adj);
  } else {
    const range = dynConfig.high.ret - dynConfig.med.ret;
    const pct = (nominalReturnPercent - dynConfig.med.ret) / range;
    return dynConfig.med.adj + pct * (dynConfig.high.adj - dynConfig.med.adj);
  }
}

// Resolve the final additional withdrawal adjustment for a given year, applying
// (1) the market-return curve, (2) absolute balance overrides, and
// (3) floor/ceiling guardrails. Mirrors the original engine's ordering exactly.
export function resolveAdjustment(balance, nominalReturnPercent, portfolio, dynConfig) {
  let adjAmount = getDynamicAdjustment(nominalReturnPercent, dynConfig);

  // Balance triggers override the annual market trigger.
  if (balance < dynConfig.low.bal) {
    adjAmount = dynConfig.low.adj;
  } else if (balance > dynConfig.high.bal) {
    adjAmount = Math.max(adjAmount, dynConfig.high.adj);
  } else if (balance > dynConfig.med.bal) {
    adjAmount = Math.max(adjAmount, dynConfig.med.adj);
  }

  // Guardrails apply only to the additional adjustment amount.
  if (balance < portfolio.floorBalance) {
    adjAmount -= Math.abs(adjAmount) * portfolio.floorPenalty;
  } else if (balance > portfolio.ceilingBalance) {
    adjAmount += Math.abs(adjAmount) * portfolio.ceilingBonus;
  }

  return adjAmount;
}
