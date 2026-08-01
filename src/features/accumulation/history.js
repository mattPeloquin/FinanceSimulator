// Feature-owned history wiring for Accumulation — uses shared returns slice.

import {
  YEAR_RANGE,
  buildSamplesAndProfiles,
  pickReturnsAllocationSlice,
} from '../../state/returnsAllocationSlice.js';
import { getAccumulationState, patchAccumulationState } from './session.js';

export { YEAR_RANGE };

/** Refresh log-normal profile fields from the selected year range. */
export function applyAccumulationHistoryProfiles({ force = false } = {}) {
  const state = getAccumulationState();
  if (state.profiles && !force) return state.profiles;

  const slice = pickReturnsAllocationSlice(state);
  const { profiles } = buildSamplesAndProfiles(slice, { forceProfiles: true });
  if (!profiles) return null;
  patchAccumulationState({ profiles });
  return profiles;
}
