// Shared one-decimal (0.1%) rounding for return assumptions, history, and display.

export function roundPct1(value) {
  const n = typeof value === 'number' ? value : parseFloat(value);
  if (Number.isNaN(n)) return 0;
  return Number(n.toFixed(1));
}

/** Format a percent value already in percent units (e.g. 10.5 → "10.5", 10 → "10"). */
export function formatPct1(value) {
  return roundPct1(value).toFixed(1).replace(/\.0$/, '');
}
