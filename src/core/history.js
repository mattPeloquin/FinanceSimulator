// Compatibility re-export — canonical history math lives in src/portfolio/historyMath.js
export {
  LOGNORMAL_ORDER,
  normalizeHistoricalYear,
  getSampleYears,
  computeProfiles,
  computeStandardizedYears,
  computeCorrelationMatrix,
  choleskyDecompose,
  correlationCholesky,
  profilesToScenarioFields,
  profilesToLogNormal,
  toRealReturnPct,
  averageRealReturn,
  sparklineRange,
  sparklineZeroTopPct,
  getMiniChartSeries,
} from '../portfolio/historyMath.js';
