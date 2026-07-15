import { MONEY_SCALE } from '../state/scenario.js';
import { formatPct1 } from '../core/precision.js';

export const USD = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

/** Format a dollar amount as $000s for display (simulation values are in dollars). */
export function formatK(val) {
  if (val == null || Number.isNaN(val)) return '';
  const n = Math.round(val / MONEY_SCALE);
  if (n === 0) return '0';
  return n.toLocaleString('en-US');
}

export function formatPercent(val, digits = 1) {
  if (val == null || Number.isNaN(val)) return '';
  const pct = val * 100;
  // Whole percents (digits === 0): use for success rates — tenths imply false precision.
  if (digits === 0) return `${Math.round(pct)}%`;
  if (digits === 1) return `${formatPct1(pct)}%`;
  return pct.toFixed(digits) + '%';
}
