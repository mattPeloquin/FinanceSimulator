import { describe, it, expect } from 'vitest';
import { resolveNumCores } from '../src/workers/parallelConfig.js';

describe('resolveNumCores', () => {
  it('uses 1 core for low', () => {
    expect(resolveNumCores('low', 8)).toBe(1);
  });

  it('uses half cores for med', () => {
    expect(resolveNumCores('med', 8)).toBe(4);
    expect(resolveNumCores('med', 3)).toBe(1);
  });

  it('uses all available cores for high', () => {
    expect(resolveNumCores('high', 8)).toBe(8);
  });

  it('defaults unknown values to all cores', () => {
    expect(resolveNumCores('unknown', 6)).toBe(6);
  });
});
