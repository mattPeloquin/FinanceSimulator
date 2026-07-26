import { registerFeature } from '../../state/features.js';
import { FEATURE_SOR_LAB } from '../../state/storageKeys.js';
import {
  registerSessionAdapter,
  restoreSessionUi,
  snapshotSessionUi,
} from '../../ui/sessionChrome.js';

/** Minimal Lab workbench until Phase 4 owns real Lab state. */
const LAB_STUB_STATE = { version: 1 };

export function registerSorLab() {
  registerSessionAdapter(FEATURE_SOR_LAB, {
    getState: () => ({ ...LAB_STUB_STATE }),
    applyState: () => {},
  });

  registerFeature({
    id: FEATURE_SOR_LAB,
    title: 'SOR Lab',
    rootId: 'feature-sor-lab',
    init() {},
    onActivate() {
      void restoreSessionUi(FEATURE_SOR_LAB);
    },
    onDeactivate() {
      snapshotSessionUi(FEATURE_SOR_LAB);
    },
  });
}
