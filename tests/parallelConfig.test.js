import { describe, it, expect } from 'vitest';
import { resolveNumCores } from '../src/workers/parallelConfig.js';

describe('resolveNumCores', () => {
  it('uses 1 core for low', () => {
    expect(resolveNumCores('low', 8)).toBe(1);
  });

  it('uses 2 sub-workers for med, bounded by availability', () => {
    expect(resolveNumCores('med', 20)).toBe(2);
    expect(resolveNumCores('med', 8)).toBe(2);
    expect(resolveNumCores('med', 3)).toBe(2); // 3 total cores - 1 master = 2 sub-workers
    expect(resolveNumCores('med', 2)).toBe(1); // 2 total cores - 1 master = 1 sub-worker
  });

  it('uses up to 5 sub-workers for high', () => {
    expect(resolveNumCores('high', 16)).toBe(5);
    expect(resolveNumCores('high', 8)).toBe(5);
    expect(resolveNumCores('high', 6)).toBe(5); // 6 total - 1 master = 5
    expect(resolveNumCores('high', 4)).toBe(3); // 4 total - 1 master = 3
  });

  it('defaults unknown values to capped cores', () => {
    expect(resolveNumCores('unknown', 16)).toBe(5);
    expect(resolveNumCores('unknown', 6)).toBe(5);
  });
});
