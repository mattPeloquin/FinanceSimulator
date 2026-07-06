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
  if (digits === 1) return `${formatPct1(val * 100)}%`;
  return (val * 100).toFixed(digits) + '%';
}
