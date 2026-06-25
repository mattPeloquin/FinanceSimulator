export const USD = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

export function formatK(val) {
  if (val === 0) return '$0k';
  return '$' + Math.round(val / 1000).toLocaleString('en-US') + 'k';
}

export function formatPercent(val, digits = 2) {
  return (val * 100).toFixed(digits) + '%';
}
