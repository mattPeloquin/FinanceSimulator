// Shared sample-run / timeline tooltip lines for withdrawals vs the original plan.
import { formatK } from '../format.js';

export function formatWithdrawnLine(wd, unadj) {
  if (wd < 0) return `Deposit: ${formatK(-wd)}`;
  const delta = wd - unadj;
  const deltaStr = delta === 0 ? '' : ` (Delta: ${delta > 0 ? '+' : ''}${formatK(delta)})`;
  return `Withdrawn: ${formatK(wd)}${deltaStr}`;
}

// One-line attribution of non-zero components vs the original plan.
export function formatWithdrawalBreakdownLine(breakdown) {
  if (!breakdown || breakdown.actual < 0) return null;
  const parts = [`Plan ${formatK(breakdown.plan)}`];
  const components = [
    ['Adj', breakdown.dynamicAdj],
    ['Scale', breakdown.scaleDelta],
    ['Gift', breakdown.gift],
    ['Glide', breakdown.glideExtra],
    ['Floor', breakdown.floorLift],
    ['Event', breakdown.majorEventOutflow],
    ['Tax', breakdown.tax],
  ];
  for (const [label, amount] of components) {
    if (Math.abs(amount) > 1e-6) {
      parts.push(`${label} ${amount > 0 ? '+' : ''}${formatK(amount)}`);
    }
  }
  if (breakdown.balanceShortfall > 1e-6) {
    parts.push(`Cap −${formatK(breakdown.balanceShortfall)}`);
  }
  return parts.length > 1 ? parts.join(' · ') : null;
}
