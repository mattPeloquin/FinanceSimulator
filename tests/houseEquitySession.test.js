import { describe, it, expect } from 'vitest';
import {
  defaultHouseEquityState,
  normalizeHouseEquityState,
} from '../src/features/house-equity/session.js';

describe('house equity session units', () => {
  it('defaults money in $000s and rates in percent', () => {
    const s = defaultHouseEquityState();
    expect(s.homeValue).toBe(800);
    expect(s.existingMortgageRate).toBe(4);
    expect(s.saleCommissionPct).toBe(5);
    expect(s.constantRealReturn).toBe(4);
    expect(s.helocLtv).toBe(75);
  });

  it('upgrades legacy decimal rates from early v1', () => {
    const out = normalizeHouseEquityState({
      homeValue: 800,
      existingMortgageRate: 0.04,
      saleCommissionPct: 0.05,
      helocLtv: 0.75,
      constantRealReturn: 0.04,
    });
    expect(out.existingMortgageRate).toBeCloseTo(4, 6);
    expect(out.saleCommissionPct).toBeCloseTo(5, 6);
    expect(out.helocLtv).toBeCloseTo(75, 6);
    expect(out.constantRealReturn).toBeCloseTo(4, 6);
  });
});
