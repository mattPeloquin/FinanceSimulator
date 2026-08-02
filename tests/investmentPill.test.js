import { describe, it, expect } from 'vitest';
import {
  formatInvestmentAccordionPill,
  defaultPortfolio,
} from '../src/portfolio/api.js';

describe('formatInvestmentAccordionPill', () => {
  it('matches Withdraw closed-state shape: alloc / method · years', () => {
    const pill = formatInvestmentAccordionPill(defaultPortfolio({
      startYear: 1970,
      endYear: 2020,
      distMethod: 'lognormal',
    }));
    // Default registry mix is 75/25 stocks/bond-cash.
    expect(pill).toBe('75/25\nLog-normal · 1970–2020');
  });
});
