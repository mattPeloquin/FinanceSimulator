// Compatibility shim — rich portfolio panel lives in src/portfolio/ui/panel.js.
// Prefer mountPortfolioPanel for new mounts.

import { listSleeves } from '../../portfolio/registry.js';

export { mountPortfolioPanel as createReturnsAllocationUi, YEAR_RANGE } from '../../portfolio/ui/panel.js';
export { pctKeys as ALLOCATION_PCT_KEYS } from '../../portfolio/registry.js';

export const ALLOC_LABELS = Object.fromEntries(
  listSleeves().map((s) => [s.pctKey, s.label]),
);
