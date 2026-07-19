import { describe, it, expect } from 'vitest';
import {
  formatInvestmentSectionState,
  formatWithdrawalSectionState,
  formatOutcomesSectionState,
  plannedYearlyAmountsIncludingGifts,
  countActiveWithdrawalAdjustments,
} from '../src/ui/sectionSummaries.js';

describe('formatInvestmentSectionState', () => {
  it('puts allocation and method on separate lines with year range', () => {
    const text = formatInvestmentSectionState({
      presetActive: false,
      usLgGrowthAllocation: 40,
      usLgValueAllocation: 20,
      usSmMidAllocation: 10,
      exUsAllocation: 5,
      bondAllocation: 20,
      cashAllocation: 5,
      distMethod: 'lognormal',
      startYear: 1970,
      endYear: 2020,
    });
    expect(text).toBe('75% stocks / 25% bonds/cash\nLog-normal · 1970–2020');
  });

  it('ignores Easy Mode label and shows allocation, method, and years', () => {
    const text = formatInvestmentSectionState({
      presetActive: true,
      presetLevel: 2,
      usLgGrowthAllocation: 40,
      usLgValueAllocation: 20,
      usSmMidAllocation: 10,
      exUsAllocation: 5,
      bondAllocation: 20,
      cashAllocation: 5,
      distMethod: 'resampling',
      startYear: 1960,
      endYear: 2025,
    });
    expect(text).toBe('75% stocks / 25% bonds/cash\nHistorical resampling · 1960–2025');
  });
});

describe('formatWithdrawalSectionState', () => {
  it('lists plan range then active adjustment section count', () => {
    const text = formatWithdrawalSectionState({
      withdrawalStrategy: 'base',
      baseWithdrawal: 48,
      numYears: 10,
      spendingOverTimeTiers: [{ changePct: 0, extra: 0 }],
      giftingTiers: [],
      enableDynamicAdjustments: true,
      floorBalance: 200,
    });
    expect(text).toBe('Plan $48k/yr\n2 adjustments active');
  });

  it('lists min–max plan and counts spending + gifting sections', () => {
    const text = formatWithdrawalSectionState({
      withdrawalStrategy: 'base',
      baseWithdrawal: 40,
      numYears: 10,
      spendingOverTimeTiers: [{ changePct: -10, extra: 0, years: 5 }, { changePct: 0, extra: 0 }],
      giftingTiers: [{ amount: 20, balance: 0, years: 2 }],
      enableDynamicAdjustments: false,
    });
    const [planLine, adjLine] = text.split('\n');
    expect(planLine).toMatch(/^Plan \$/);
    expect(planLine).toContain('–');
    expect(adjLine).toBe('2 adjustments active');
  });
});

describe('countActiveWithdrawalAdjustments', () => {
  it('counts each in-use withdrawal section once', () => {
    // Market + Balance (floor+ceiling = 1) + Min withdrawal + Glide = 4
    expect(countActiveWithdrawalAdjustments({
      withdrawalStrategy: 'base',
      spendingOverTimeTiers: [{ changePct: 0, extra: 0 }],
      majorEvents: [],
      giftingTiers: [],
      enableDynamicAdjustments: true,
      floorBalance: 100,
      ceilingBalance: 500,
      withdrawalFloors: [{ amount: 20 }],
      glideTarget: 50,
      glideFraction: 10,
    })).toBe(4);
  });

  it('counts major events and spending when configured', () => {
    expect(countActiveWithdrawalAdjustments({
      withdrawalStrategy: 'base',
      spendingOverTimeTiers: [{ changePct: 0, extra: 10 }],
      majorEvents: [{ amount: -50, startYear: 1 }],
      giftingTiers: [],
      enableDynamicAdjustments: false,
    })).toBe(2);
  });
});

describe('formatOutcomesSectionState', () => {
  it('lists total and mean ranges across P10–P60', () => {
    expect(formatOutcomesSectionState({
      totalMin: 800_000,
      totalMax: 1_200_000,
      meanMin: 30_000,
      meanMax: 45_000,
    })).toBe('Total $800k–$1,200k\nMean $30k–$45k/yr');
  });
});

describe('plannedYearlyAmountsIncludingGifts', () => {
  it('adds gift amounts on top of the base schedule', () => {
    const yearly = plannedYearlyAmountsIncludingGifts({
      withdrawalStrategy: 'base',
      baseWithdrawal: 40,
      numYears: 4,
      spendingOverTimeTiers: [{ changePct: 0, extra: 0 }],
      giftingTiers: [{ amount: 10, balance: 0, years: 2 }, { amount: 0, balance: 0 }],
    });
    expect(yearly).toHaveLength(4);
    expect(yearly[0]).toBe(50_000);
    expect(yearly[1]).toBe(50_000);
    expect(yearly[2]).toBe(40_000);
    expect(yearly[3]).toBe(40_000);
  });
});
