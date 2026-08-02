import { describe, it, expect } from 'vitest';
import {
  resolveSourceStartYear,
  alignSeriesToCalendar,
  buildLifetimePlan,
  buildPlanCashflowSeries,
  externalFlowsForWindow,
  flowsForEngineWindow,
  flowsToAccumulateEvents,
  flowsToWithdrawMajorEventsSeries,
  withdrawBlocksExternalInjection,
  composeNetWorth,
  resolveWithdrawStartAfterAccumulate,
  alignBalanceSeriesToPlanYears,
} from '../src/core/lifetimePlan.js';
import { buildCashflowSeries } from '../src/state/cashflowSeries.js';
import { buildWithdrawCashflowSeries } from '../src/core/withdrawal.js';

describe('resolveSourceStartYear', () => {
  it('anchors startAge 0 to planStartYear (Accumulate-style)', () => {
    expect(resolveSourceStartYear({
      startAge: 0,
      planStartYear: 2026,
      birthYearA: 1960,
    })).toBe(2026);
  });

  it('aligns age-based series via birthYear + startAge', () => {
    expect(resolveSourceStartYear({
      startAge: 65,
      planStartYear: 2026,
      birthYearA: 1960,
    })).toBe(2025);
  });

  it('applies offsetYears after auto-alignment', () => {
    expect(resolveSourceStartYear({
      startAge: 65,
      planStartYear: 2026,
      birthYearA: 1960,
      offsetYears: 2,
    })).toBe(2027);
    expect(resolveSourceStartYear({
      startAge: 0,
      planStartYear: 2026,
      offsetYears: -1,
    })).toBe(2025);
  });

  it('falls back to planStartYear when birth year is missing for age series', () => {
    expect(resolveSourceStartYear({
      startAge: 65,
      planStartYear: 2026,
      birthYearA: null,
    })).toBe(2026);
  });
});

describe('alignSeriesToCalendar', () => {
  const series = buildCashflowSeries({
    sourceFeature: 'ss-timing',
    startAge: 65,
    numYears: 5,
    annualByStrategy: { early: [100, 200, 300, 400, 500] },
  });

  it('places amounts on calendar years and clips to the window', () => {
    // sourceStartYear 2025 → years 2025..2029; window 2026..2028 keeps middle three
    const map = alignSeriesToCalendar(series, 'early', {
      planStartYear: 2026,
      planEndYear: 2028,
      sourceStartYear: 2025,
    });
    expect([...map.entries()].sort((a, b) => a[0] - b[0])).toEqual([
      [2026, 200],
      [2027, 300],
      [2028, 400],
    ]);
  });

  it('returns empty map for unknown strategy or inverted window', () => {
    expect(alignSeriesToCalendar(series, 'missing', {
      planStartYear: 2026,
      planEndYear: 2030,
      sourceStartYear: 2025,
    }).size).toBe(0);
    expect(alignSeriesToCalendar(series, 'early', {
      planStartYear: 2030,
      planEndYear: 2020,
      sourceStartYear: 2025,
    }).size).toBe(0);
  });
});

describe('buildLifetimePlan', () => {
  it('sums mixed-sign sources into net and cumulative', () => {
    const accumulate = buildCashflowSeries({
      sourceFeature: 'accumulate',
      startAge: 0,
      numYears: 3,
      annualByStrategy: { med: [-10_000, -10_000, -10_000] },
    });
    const ss = buildCashflowSeries({
      sourceFeature: 'ss-timing',
      startAge: 66,
      numYears: 4,
      annualByStrategy: { early: [20_000, 20_000, 20_000, 20_000] },
    });

    // plan 2026..2028; accumulate starts 2026; SS birth 1960 → 2026
    const plan = buildLifetimePlan({
      planStartYear: 2026,
      planEndYear: 2028,
      birthYearA: 1960,
      sources: [
        {
          id: 'a1',
          feature: 'accumulate',
          label: 'Savings',
          strategyId: 'med',
          series: accumulate,
          enabled: true,
        },
        {
          id: 's1',
          feature: 'ss-timing',
          label: 'SS',
          strategyId: 'early',
          series: ss,
          enabled: true,
        },
      ],
    });

    expect(plan.years).toEqual([2026, 2027, 2028]);
    expect(plan.net).toEqual([10_000, 10_000, 10_000]);
    expect(plan.cumulative).toEqual([10_000, 20_000, 30_000]);
    expect(plan.totals.net).toBe(30_000);
    expect(plan.totals.bySource.a1).toBe(-30_000);
    expect(plan.totals.bySource.s1).toBe(60_000);
  });

  it('respects offsetYears and skips disabled / short / long series correctly', () => {
    const short = buildCashflowSeries({
      sourceFeature: 'ss-timing',
      startAge: 60,
      numYears: 2,
      annualByStrategy: { early: [-1000, -1000] },
    });
    const long = buildCashflowSeries({
      sourceFeature: 'house-equity',
      startAge: 65,
      numYears: 10,
      annualByStrategy: { heloc: Array.from({ length: 10 }, () => 500) },
    });

    const plan = buildLifetimePlan({
      planStartYear: 2025,
      planEndYear: 2027,
      birthYearA: 1960,
      sources: [
        {
          id: 's1',
          feature: 'ss-timing',
          strategyId: 'early',
          // birth+60=2020; offset +5 → 2025
          offsetYears: 5,
          series: short,
          enabled: true,
        },
        {
          id: 'h1',
          feature: 'house-equity',
          strategyId: 'heloc',
          series: long,
          enabled: false,
        },
      ],
    });

    expect(plan.sourceMeta.map((s) => s.id)).toEqual(['s1']);
    expect(plan.net).toEqual([-1000, -1000, 0]);
    expect(plan.bySource.h1).toBeUndefined();
  });

  it('builds a plan cashflow series with a single net strategy', () => {
    const plan = buildLifetimePlan({
      planStartYear: 2026,
      planEndYear: 2027,
      sources: [{
        id: 'a1',
        feature: 'accumulate',
        strategyId: 'med',
        series: buildCashflowSeries({
          sourceFeature: 'accumulate',
          startAge: 0,
          numYears: 2,
          annualByStrategy: { med: [-5, -5] },
        }),
      }],
    });
    const series = buildPlanCashflowSeries(plan, { sessionName: 'Demo' });
    expect(series.sourceFeature).toBe('plan');
    expect(series.startAge).toBe(0);
    expect(series.sessionName).toBe('Demo');
    expect(series.seriesByStrategy.net.annual).toEqual([-5, -5]);
  });
});

describe('externalFlowsForWindow + injection mapping', () => {
  it('sums only SS / House Equity (skips accumulate and Roth)', () => {
    const sources = [
      {
        id: 'a1',
        feature: 'accumulate',
        strategyId: 'med',
        enabled: true,
        series: buildCashflowSeries({
          sourceFeature: 'accumulate',
          startAge: 0,
          numYears: 2,
          annualByStrategy: { med: [-50_000, -50_000] },
        }),
      },
      {
        id: 's1',
        feature: 'ss-timing',
        strategyId: 'early',
        enabled: true,
        series: buildCashflowSeries({
          sourceFeature: 'ss-timing',
          startAge: 0,
          numYears: 2,
          annualByStrategy: { early: [20_000, 22_000] },
        }),
      },
      {
        id: 'h1',
        feature: 'house-equity',
        strategyId: 'heloc',
        enabled: true,
        series: buildCashflowSeries({
          sourceFeature: 'house-equity',
          startAge: 0,
          numYears: 2,
          annualByStrategy: { heloc: [-5_000, 0] },
        }),
      },
      {
        // Retired Plan source — must not inject even if still present in fixtures.
        id: 'r1',
        feature: 'roth-convert',
        strategyId: 'fill-22',
        enabled: true,
        series: buildCashflowSeries({
          sourceFeature: 'roth-convert',
          startAge: 0,
          numYears: 2,
          annualByStrategy: { 'fill-22': [-99_000, -99_000] },
        }),
      },
    ];
    const { flows, byYear } = externalFlowsForWindow({
      sources,
      planStartYear: 2026,
      planEndYear: 2027,
    });
    expect(flows).toEqual([15_000, 22_000]);
    expect(byYear.get(2026)).toBe(15_000);

    expect(flowsForEngineWindow(byYear, 2026, 3)).toEqual([15_000, 22_000, 0]);
    expect(flowsToAccumulateEvents([15_000, 0, -2000])).toEqual([
      { amount: 15, startYear: 1, years: 1 },
      { amount: -2, startYear: 3, years: 1 },
    ]);
    expect(flowsToWithdrawMajorEventsSeries([15_000, 22_000], 4))
      .toEqual([15_000, 22_000, 0, 0]);
  });

  it('detects specific-withdrawal strategy as blocking injection', () => {
    expect(withdrawBlocksExternalInjection({ withdrawalStrategy: 'guardrail' })).toBe(false);
    expect(withdrawBlocksExternalInjection({ withdrawalStrategy: 'specific' })).toBe(true);
  });
});

describe('composeNetWorth', () => {
  it('stitches accumulate cone onto withdraw fan and adds home equity', () => {
    // Accumulate 2020..2022 (3 years) → cone length 4 (start + 3 ends)
    const cone = [
      { p10: 100, p50: 100, p90: 100 }, // start 2020
      { p10: 110, p50: 120, p90: 130 }, // end 2020
      { p10: 120, p50: 140, p90: 160 }, // end 2021
      { p10: 130, p50: 160, p90: 190 }, // end 2022
    ];
    // Withdraw starts 2023; fan index 0 = end 2023
    const withdraw = {
      startYear: 2023,
      low: [90, 80],
      median: [150, 140],
      high: [200, 180],
    };
    // HE residual length 4 for start 2020: [start, eoy0, eoy1, eoy2]
    const homeEquity = {
      startYear: 2020,
      residual: [50, 55, 60, 65],
    };

    const nw = composeNetWorth({
      planYears: [2020, 2021, 2022, 2023, 2024],
      accumulate: { startYear: 2020, cone },
      withdraw,
      homeEquity,
    });

    // End of 2020 = cone[1] + residual[1]
    expect(nw.portfolio.median[0]).toBe(120);
    expect(nw.homeEquity[0]).toBe(55);
    expect(nw.netWorth.median[0]).toBe(175);
    // End of 2022 = cone[3] + residual[3]
    expect(nw.portfolio.median[2]).toBe(160);
    expect(nw.netWorth.median[2]).toBe(225);
    // Withdraw years
    expect(nw.portfolio.median[3]).toBe(150);
    expect(nw.portfolio.median[4]).toBe(140);
    // HE beyond its series → 0
    expect(nw.homeEquity[3]).toBe(0);
    expect(nw.netWorth.median[3]).toBe(150);
  });

  it('holds accumulate ending flat across gap years', () => {
    const cone = [
      { p10: 10, p50: 10, p90: 10 },
      { p10: 20, p50: 30, p90: 40 },
    ];
    const nw = composeNetWorth({
      planYears: [2020, 2021, 2022],
      accumulate: { startYear: 2020, cone },
      withdraw: { startYear: 2023, low: [1], median: [1], high: [1] },
    });
    expect(nw.portfolio.median).toEqual([30, 30, 30]);
  });

  it('aligns residual series and resolves withdraw start after accumulate', () => {
    expect(alignBalanceSeriesToPlanYears([10, 11, 12], 2020, [2020, 2021]))
      .toEqual([11, 12]);
    expect(resolveWithdrawStartAfterAccumulate({
      accumulateStartYear: 2020,
      accumulateNumYears: 5,
      gapYears: 2,
    })).toBe(2027);
  });
});

describe('buildWithdrawCashflowSeries', () => {
  it('negates median heatmap withdrawals as p50 strategy', () => {
    const numYears = 3;
    const span = 3;
    // Ranks 0,1,2 with values increasing — median of [10,20,30] = 20
    const sourceValues = new Float32Array(span * numYears);
    for (let row = 0; row < span; row++) {
      for (let y = 0; y < numYears; y++) {
        sourceValues[row * numYears + y] = (row + 1) * 10;
      }
    }
    const series = buildWithdrawCashflowSeries({
      withdrawalHeatmap: {
        numYears,
        sourceSpan: span,
        sourceValues,
      },
    }, { sessionName: 'W' });
    expect(series.sourceFeature).toBe('withdraw');
    expect(series.seriesByStrategy.p50.annual).toEqual([-20, -20, -20]);
    expect(series.sessionName).toBe('W');
  });

  it('infers sourceSpan from flat buffer length when omitted', () => {
    const numYears = 2;
    const span = 3;
    const sourceValues = new Float32Array(span * numYears);
    for (let row = 0; row < span; row++) {
      for (let y = 0; y < numYears; y++) {
        sourceValues[row * numYears + y] = (row + 1) * 100;
      }
    }
    const series = buildWithdrawCashflowSeries({
      withdrawalHeatmap: { numYears, sourceValues },
    });
    // Median of [100,200,300] = 200
    expect(series.seriesByStrategy.p50.annual).toEqual([-200, -200]);
  });
});
