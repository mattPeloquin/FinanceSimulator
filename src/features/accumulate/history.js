// Feature-owned history wiring for Accumulate — uses shared returns slice.

import {
  YEAR_RANGE,
  buildSamplesAndProfiles,
  pickReturnsAllocationSlice,
} from '../../state/returnsAllocationSlice.js';
import { getAccumulateState, patchAccumulateState } from './session.js';

export { YEAR_RANGE };

/** Refresh log-normal profile fields from the selected year range. */
export function applyAccumulateHistoryProfiles({ force = false } = {}) {
  const state = getAccumulateState();
  if (state.profiles && !force) return state.profiles;

  const slice = pickReturnsAllocationSlice(state);
  const { profiles } = buildSamplesAndProfiles(slice, { forceProfiles: true });
  if (!profiles) return null;
  patchAccumulateState({ profiles });
  return profiles;
}
