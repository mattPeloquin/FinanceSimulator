import { describe, it, expect } from 'vitest';
import {
  densityAlpha,
  normalizeDensityCounts,
  DENSITY_ALPHA_FLOOR,
  DENSITY_ALPHA_SPAN,
  DENSITY_ALPHA_GAMMA,
} from '../src/ui/charts/reportCharts.js';

describe('densityAlpha', () => {
  it('returns 0 for non-positive density', () => {
    expect(densityAlpha(0)).toBe(0);
    expect(densityAlpha(-1)).toBe(0);
  });

  it('maps peak density near full opacity', () => {
    expect(densityAlpha(1)).toBe(DENSITY_ALPHA_FLOOR + DENSITY_ALPHA_SPAN);
  });

  it('keeps a modest floor for sparse mass so the cloud stays visible', () => {
    const sparse = densityAlpha(0.05);
    expect(sparse).toBeGreaterThanOrEqual(DENSITY_ALPHA_FLOOR);
    expect(sparse).toBeLessThan(DENSITY_ALPHA_FLOOR + 20);
  });

  it('uses gamma > 1 so mid density sits well below the peak (contrast)', () => {
    const mid = densityAlpha(0.5);
    const peak = densityAlpha(1);
    // With gamma 1.6, 0.5^1.6 ≈ 0.33 of the span — not near the peak.
    const expectedMid = Math.round(DENSITY_ALPHA_FLOOR + DENSITY_ALPHA_SPAN * 0.5 ** DENSITY_ALPHA_GAMMA);
    expect(mid).toBe(expectedMid);
    expect(peak - mid).toBeGreaterThan(100);
  });

  it('is steeper than the old floor+soft-gamma curve at mid density', () => {
    // Old: 95 + 160 * d^0.85 → at d=0.5 ≈ 182. New mid should be lower.
    const oldMid = Math.round(95 + 160 * 0.5 ** 0.85);
    expect(densityAlpha(0.5)).toBeLessThan(oldMid - 40);
  });
});

describe('normalizeDensityCounts', () => {
  it('returns zeros for an empty / all-zero histogram', () => {
    expect(Array.from(normalizeDensityCounts(new Float32Array(8)))).toEqual([
      0, 0, 0, 0, 0, 0, 0, 0,
    ]);
  });

  it('scales so the P95 positive bin is 1 and a lone spike clamps above that', () => {
    // 19 bins at 10, one spike at 100. P95 of the 20 positive values is the
    // last of the "10"s region before the spike → scale ≈ 10, spike → 1.
    const counts = new Float32Array(20);
    for (let i = 0; i < 19; i++) counts[i] = 10;
    counts[19] = 100;
    const norm = normalizeDensityCounts(counts, 0.95);
    expect(norm[0]).toBeCloseTo(1, 5);
    expect(norm[19]).toBe(1); // clamped
  });

  it('does not let a minority cut spike wash out broader surplus mass', () => {
    // Spike 80 in one bin; twenty bins at 20 (surplus cloud). Under max-norm
    // the cloud would be 0.25; under P95 it should stay near 1.
    const counts = new Float32Array(32);
    counts[2] = 80;
    for (let i = 10; i < 30; i++) counts[i] = 20;
    const byMax = 20 / 80;
    const norm = normalizeDensityCounts(counts, 0.95);
    expect(norm[2]).toBe(1);
    expect(norm[15]).toBeGreaterThan(byMax + 0.4);
    expect(norm[15]).toBeCloseTo(1, 5);
  });

  it('matches max-norm when every positive bin is equal', () => {
    const counts = Float32Array.from([0, 5, 5, 5, 0]);
    const norm = normalizeDensityCounts(counts, 0.95);
    expect(norm[1]).toBe(1);
    expect(norm[2]).toBe(1);
    expect(norm[0]).toBe(0);
  });
});
