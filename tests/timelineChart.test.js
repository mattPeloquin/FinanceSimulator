import { describe, it, expect } from 'vitest';
import { niceBalanceLogFloor } from '../src/ui/charts/timeline.js';

describe('niceBalanceLogFloor', () => {
  it('returns the hard minimum for missing or tiny starts', () => {
    expect(niceBalanceLogFloor(0)).toBe(1000);
    expect(niceBalanceLogFloor(-1)).toBe(1000);
    expect(niceBalanceLogFloor(5_000)).toBe(1000);
    expect(niceBalanceLogFloor(10_000)).toBe(1000);
  });

  it('snaps near start÷10 down to a 1–2–2.5–5 nice value', () => {
    expect(niceBalanceLogFloor(1_000_000)).toBe(100_000);
    expect(niceBalanceLogFloor(2_000_000)).toBe(200_000);
    expect(niceBalanceLogFloor(1_500_000)).toBe(100_000);
    expect(niceBalanceLogFloor(800_000)).toBe(50_000);
    expect(niceBalanceLogFloor(250_000)).toBe(25_000);
    expect(niceBalanceLogFloor(50_000)).toBe(5_000);
    expect(niceBalanceLogFloor(35_000)).toBe(2_500);
  });

  it('never exceeds start÷10', () => {
    for (const start of [25_000, 75_000, 110_000, 333_000, 1_234_567]) {
      expect(niceBalanceLogFloor(start)).toBeLessThanOrEqual(start / 10 + 1e-9);
    }
  });
});
