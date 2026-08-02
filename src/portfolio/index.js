// Portfolio module public surface.
// Definition sites: registry.js + historicalData.js (+ preset JSON via helpers).
// Everyone else imports from here (or ./api.js / ./adapters.js).

export {
  SLEEVES,
  INFLATION,
  listSleeves,
  getSleeveMeta,
  historyKeysInOrder,
  engineKeys,
  logNormalEngineOrder,
  pctKeys,
  profileFieldKeys,
  segmentIdentifierPatterns,
  defaultAllocationPct,
  allocationKeyToEngine,
  sleeveColorMap,
} from './registry.js';

export {
  historicalData,
  minAvailableYear,
  maxAvailableYear,
  STYLE_INDEX_DATA_FROM_YEAR,
  clampYearToAvailableRange,
  normalizeYearRange,
} from './historicalData.js';

export * from './historyMath.js';
export * from './allocationMath.js';
export * from './slice.js';
export {
  sampleYearReturn,
  sampleRealPortfolioReturn,
  buildMarketParams,
  buildAllocationSeries,
  summarizePortfolio,
  formatInvestmentAccordionPill,
  allocationPresentation,
  labVariablesFromRegistry,
  themeAssetColor,
  assertHistoryAligned,
} from './api.js';
export {
  fromWithdrawScenario,
  toWithdrawPatch,
  applyToWithdrawScenario,
  buildWithdrawMarketBlock,
  allocationPresentationFromWithdraw,
  summarizeWithdrawScenario,
  defaultWithdrawPortfolioFields,
  sliceFromWithdrawScenario,
} from './adapters.js';
