import { describe, it, expect, beforeEach } from 'vitest';
import {
  OUTCOME_LOWER_DEFAULT,
  OUTCOME_UPPER_DEFAULT,
  getOutcomeWindow,
  setOutcomeLowerPct,
  setOutcomeUpperPct,
  onOutcomeWindowChange,
  clampOutcomeLowerPct,
  clampOutcomeUpperPct,
} from '../src/ui/charts/outcomeWindow.js';

describe('outcomeWindow', () => {
  beforeEach(() => {
    // Reset to defaults between tests.
    setOutcomeLowerPct(OUTCOME_LOWER_DEFAULT);
    setOutcomeUpperPct(OUTCOME_UPPER_DEFAULT);
  });

  it('defaults to P5–P65', () => {
    expect(getOutcomeWindow()).toEqual({
      lowerPct: OUTCOME_LOWER_DEFAULT,
      upperPct: OUTCOME_UPPER_DEFAULT,
    });
  });

  it('clamps from/to to their allowed ranges in 5-point steps', () => {
    expect(clampOutcomeLowerPct(-5)).toBe(0);
    expect(clampOutcomeLowerPct(47)).toBe(45);
    expect(clampOutcomeLowerPct(12)).toBe(10);
    expect(clampOutcomeUpperPct(50)).toBe(55);
    expect(clampOutcomeUpperPct(103)).toBe(100);
    expect(clampOutcomeUpperPct(63)).toBe(65);
  });

  it('notifies listeners when either end changes', () => {
    const seen = [];
    const unsub = onOutcomeWindowChange((w) => seen.push({ ...w }));
    expect(setOutcomeLowerPct(20)).toBe(true);
    expect(setOutcomeUpperPct(80)).toBe(true);
    expect(setOutcomeLowerPct(20)).toBe(false);
    expect(seen).toEqual([
      { lowerPct: 20, upperPct: OUTCOME_UPPER_DEFAULT },
      { lowerPct: 20, upperPct: 80 },
    ]);
    unsub();
  });
});
