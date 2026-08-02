// Compatibility re-export — canonical allocation math lives in src/portfolio/allocationMath.js
export {
  ALLOCATION_ENGINE_KEYS,
  allocationKeyToEngine,
  copyAllocation,
  tierMixToDecimal,
  renormalizeAllocation,
  buildAllocationOverTimeSeries,
} from '../portfolio/allocationMath.js';
