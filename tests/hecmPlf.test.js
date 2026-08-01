import { describe, it, expect } from 'vitest';
import {
  HECM_MCA_LIMIT,
  HECM_INITIAL_MIP_RATE,
  lookupHecmPlf,
  roundHecmExpectedRate,
  sizeHecmProceeds,
} from '../src/data/hecmPlf.js';

describe('HUD PLF spot checks (ML 2017-12 / actuarial extracts)', () => {
  // FY2024/FY2025 MMI HECM actuarial Exhibit I-1
  const spots = [
    [65, 0.055, 0.403],
    [65, 0.07, 0.333],
    [65, 0.085, 0.276],
    [75, 0.055, 0.467],
    [75, 0.07, 0.4],
    [75, 0.085, 0.343],
    [85, 0.055, 0.57],
    [85, 0.07, 0.511],
    [85, 0.085, 0.459],
    // Published grid examples (age 62 @ 5.000%, and 5.875% column)
    [62, 0.05, 0.41],
    [62, 0.05875, 0.363],
    [75, 0.05875, 0.449],
  ];

  for (const [age, rate, plf] of spots) {
    it(`age ${age} @ ${(rate * 100).toFixed(3)}% → ${plf}`, () => {
      expect(lookupHecmPlf(age, rate)).toBeCloseTo(plf, 3);
    });
  }
});

describe('roundHecmExpectedRate', () => {
  it('rounds to nearest 0.125% and clamps', () => {
    expect(roundHecmExpectedRate(0.0551)).toBeCloseTo(0.055, 6);
    expect(roundHecmExpectedRate(0.058)).toBeCloseTo(0.0575, 6);
    expect(roundHecmExpectedRate(0.01)).toBeCloseTo(0.03, 6);
    expect(roundHecmExpectedRate(0.25)).toBeCloseTo(0.18875, 6);
  });
});

describe('sizeHecmProceeds golden fixtures', () => {
  // Arithmetic from published PLF + ML 2017-12 2% initial MIP (MCA basis).
  // Matches HUD calculator principal-limit math for gross PL; net is educational
  // (MIP deducted, not financed into the balance).
  it('sizes gross PL and net after MIP, fee, and lien', () => {
    // Age 75, 5.875%, home $500k → PLF 0.449 → PL $224,500; MIP $10,000
    const sized = sizeHecmProceeds({
      homeValue: 500_000,
      age: 75,
      expectedRate: 0.05875,
      mortgageBalance: 80_000,
      otherFeeAmount: 15_000,
    });
    expect(sized.mca).toBe(500_000);
    expect(sized.plf).toBeCloseTo(0.449, 3);
    expect(sized.principalLimit).toBeCloseTo(224_500, 0);
    expect(sized.initialMip).toBeCloseTo(10_000, 0);
    // 224500 - 10000 - 15000 - 80000 = 119500
    expect(sized.netAvailable).toBeCloseTo(119_500, 0);
  });

  it('caps MCA at the 2026 FHA limit', () => {
    const sized = sizeHecmProceeds({
      homeValue: 2_000_000,
      age: 65,
      expectedRate: 0.055,
    });
    expect(sized.mca).toBe(HECM_MCA_LIMIT);
    expect(sized.initialMip).toBeCloseTo(HECM_MCA_LIMIT * HECM_INITIAL_MIP_RATE, 0);
    expect(sized.principalLimit).toBeCloseTo(HECM_MCA_LIMIT * 0.403, 0);
  });

  it('floors net at zero when liens exceed the limit', () => {
    const sized = sizeHecmProceeds({
      homeValue: 300_000,
      age: 62,
      expectedRate: 0.07,
      mortgageBalance: 500_000,
    });
    expect(sized.netAvailable).toBe(0);
  });
});
