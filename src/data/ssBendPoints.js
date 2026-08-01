// Illustrative Social Security bend points for the educational PIA helper.
// Labeled as illustrative — not auto-updated current law.
//
// Units: annual taxable earnings thresholds in today's (real) dollars for the
// simplified AIME → PIA formula used by src/core/socialSecurity.js.

/** @type {{ label: string, year: number, bend1: number, bend2: number }} */
export const ILLUSTRATIVE_BEND_POINTS = {
  label: 'Illustrative 2025-style bend points (educational)',
  year: 2025,
  // Approximate annualized bend points (monthly × 12) in real dollars.
  bend1: 1176 * 12,
  bend2: 7087 * 12,
};
