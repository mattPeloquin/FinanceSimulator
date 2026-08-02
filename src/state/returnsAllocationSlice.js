// Compatibility re-export — canonical slice lives in src/portfolio/slice.js
export {
  ALLOCATION_PCT_KEYS,
  YEAR_RANGE,
  DIST_METHODS,
  canonicalizeDistMethod,
  defaultAllocationPct,
  defaultReturnsAllocationSlice,
  normalizeAllocationPct,
  normalizeReturnsAllocationSlice,
  isValidYearRange,
  buildSamplesAndProfiles,
  pickReturnsAllocationSlice,
  sliceFromWithdrawScenario,
} from '../portfolio/slice.js';
