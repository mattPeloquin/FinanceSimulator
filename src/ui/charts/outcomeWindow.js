// Shared Show from/to outcome-percentile window for the 3D surface and
// Withdrawal Heatmap. Both charts read/write here so the sliders move in tandem.

export const OUTCOME_LOWER_MIN = 0;
export const OUTCOME_LOWER_MAX = 45;
export const OUTCOME_UPPER_MIN = 55;
export const OUTCOME_UPPER_MAX = 100;
export const OUTCOME_PCT_STEP = 5;
export const OUTCOME_LOWER_DEFAULT = 5;
export const OUTCOME_UPPER_DEFAULT = 65;

let lowerPct = OUTCOME_LOWER_DEFAULT;
let upperPct = OUTCOME_UPPER_DEFAULT;
const listeners = new Set();

function snapStep(v, fallback) {
  const n = Number(v);
  const base = Number.isFinite(n) ? n : fallback;
  return Math.round(base / OUTCOME_PCT_STEP) * OUTCOME_PCT_STEP;
}

export function clampOutcomeLowerPct(v) {
  return Math.max(OUTCOME_LOWER_MIN, Math.min(OUTCOME_LOWER_MAX, snapStep(v, OUTCOME_LOWER_DEFAULT)));
}

export function clampOutcomeUpperPct(v) {
  return Math.max(OUTCOME_UPPER_MIN, Math.min(OUTCOME_UPPER_MAX, snapStep(v, OUTCOME_UPPER_DEFAULT)));
}

export function getOutcomeWindow() {
  return { lowerPct, upperPct };
}

function notify() {
  const snap = { lowerPct, upperPct };
  for (const fn of listeners) fn(snap);
}

/** @returns {boolean} true when the value changed */
export function setOutcomeLowerPct(v) {
  const next = clampOutcomeLowerPct(v);
  if (lowerPct === next) return false;
  lowerPct = next;
  notify();
  return true;
}

/** @returns {boolean} true when the value changed */
export function setOutcomeUpperPct(v) {
  const next = clampOutcomeUpperPct(v);
  if (upperPct === next) return false;
  upperPct = next;
  notify();
  return true;
}

export function onOutcomeWindowChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
