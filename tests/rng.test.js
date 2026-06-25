import { describe, it, expect } from 'vitest';
import { mulberry32, deriveSeed, createRng } from '../src/core/rng.js';

describe('mulberry32', () => {
  it('is deterministic for a given seed', () => {
    const a = mulberry32(12345);
    const b = mulberry32(12345);
    for (let i = 0; i < 10; i++) expect(a()).toBe(b());
  });

  it('produces values in [0, 1)', () => {
    const r = mulberry32(7);
    for (let i = 0; i < 1000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('produces a roughly uniform mean', () => {
    const r = mulberry32(99);
    let sum = 0;
    const n = 100000;
    for (let i = 0; i < n; i++) sum += r();
    expect(sum / n).toBeCloseTo(0.5, 2);
  });
});

describe('deriveSeed', () => {
  it('is stable and distinct per index', () => {
    expect(deriveSeed(1, 0)).toBe(deriveSeed(1, 0));
    expect(deriveSeed(1, 0)).not.toBe(deriveSeed(1, 1));
    expect(deriveSeed(1, 5)).not.toBe(deriveSeed(2, 5));
  });
});

describe('createRng.normal', () => {
  it('approximates a standard normal distribution', () => {
    const rng = createRng(42);
    const n = 200000;
    let sum = 0;
    let sumSq = 0;
    for (let i = 0; i < n; i++) {
      const z = rng.normal();
      sum += z;
      sumSq += z * z;
    }
    const m = sum / n;
    const variance = sumSq / n - m * m;
    expect(m).toBeCloseTo(0, 1);
    expect(Math.sqrt(variance)).toBeCloseTo(1, 1);
  });
});

describe('createRng.logNormal', () => {
  it('has a sample mean close to the target arithmetic mean', () => {
    const rng = createRng(2024);
    const target = 0.08;
    const n = 300000;
    let sum = 0;
    for (let i = 0; i < n; i++) sum += rng.logNormal(target, 0.15);
    expect(sum / n).toBeCloseTo(target, 2);
  });
});
