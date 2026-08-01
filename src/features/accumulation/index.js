// Accumulation — primary-tab stub for Phase 0a nav.
// Full feature (projector, sleeves, charts) lands in Phase 1 of the
// four-feature roadmap; this registration only reserves the primary slot
// formerly held by SOR Lab.

import { registerFeature } from '../../state/features.js';
import { FEATURE_ACCUMULATION } from '../../state/storageKeys.js';

export function registerAccumulation() {
  registerFeature({
    id: FEATURE_ACCUMULATION,
    title: 'Accumulation',
    rootId: 'feature-accumulation',
    placement: 'primary',
  });
}
