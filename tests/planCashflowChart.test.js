import { describe, it, expect } from 'vitest';
import { cashflowAxisBounds } from '../src/features/plan/ui/charts/stack.js';

describe('cashflowAxisBounds', () => {
  it('includes negative outflows below zero', () => {
    const bounds = cashflowAxisBounds({
      sourceMeta: [{ id: 'a' }, { id: 's' }],
      bySource: {
        a: [-20_000, -20_000, 0],
        s: [0, 10_000, 10_000],
      },
      net: [-20_000, -10_000, 10_000],
    });
    expect(bounds.min).toBeLessThan(0);
    expect(bounds.max).toBeGreaterThan(0);
    expect(bounds.min).toBeLessThanOrEqual(-20_000);
  });

  it('keeps a small positive headroom when all values are zero', () => {
    const bounds = cashflowAxisBounds({
      sourceMeta: [{ id: 'a' }],
      bySource: { a: [0, 0] },
      net: [0, 0],
    });
    expect(bounds.min).toBe(0);
    expect(bounds.max).toBeGreaterThan(0);
  });

  it('keeps headroom above zero for outflow-only series', () => {
    const bounds = cashflowAxisBounds({
      sourceMeta: [{ id: 'a' }],
      bySource: { a: [-15_000, -16_000] },
      net: [-15_000, -16_000],
    });
    expect(bounds.min).toBeLessThan(-15_000);
    expect(bounds.max).toBeGreaterThan(0);
  });
});
