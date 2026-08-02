import { describe, it, expect } from 'vitest';
import {
  defaultHouseEquityState,
  normalizeHouseEquityState,
} from '../src/features/house-equity/session.js';
import { listSleeves } from '../src/portfolio/registry.js';

describe('house equity session units', () => {
  it('defaults money in $000s and rates in percent, with a local portfolio', () => {
    const s = defaultHouseEquityState();
    expect(s.homeValue).toBe(800);
    expect(s.existingMortgageRate).toBe(4);
    expect(s.saleCommissionPct).toBe(5);
    expect(s.portfolioSource).toBe('local');
    expect(s.portfolio).toBeTruthy();
    expect(s.portfolio.allocation).toBeTruthy();
    expect(listSleeves().every((sleeve) => sleeve.pctKey in s.portfolio.allocation)).toBe(true);
    expect(s.helocLtv).toBe(75);
  });

  it('upgrades legacy decimal rates from early v1 and seeds portfolio', () => {
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
    expect(out.portfolio).toBeTruthy();
    expect(out.constantRealReturn).toBeUndefined();
  });
});
