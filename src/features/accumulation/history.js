// Feature-owned history wiring for Accumulation (does not import Plan's history.js).

import {
  getSampleYears,
  computeProfiles,
  profilesToScenarioFields,
} from '../../core/history.js';
import { minAvailableYear, maxAvailableYear } from '../../data/historicalData.js';
import { getAccumulationState, patchAccumulationState } from './session.js';

export const YEAR_RANGE = { minYear: minAvailableYear, maxYear: maxAvailableYear };

/** Refresh log-normal profile fields from the selected year range. */
export function applyAccumulationHistoryProfiles({ force = false } = {}) {
  const state = getAccumulationState();
  if (state.profiles && !force) return state.profiles;

  const startYear = state.startYear;
  const endYear = state.endYear;
  if (
    !Number.isFinite(startYear)
    || !Number.isFinite(endYear)
    || startYear > endYear
    || startYear < YEAR_RANGE.minYear
    || endYear > YEAR_RANGE.maxYear
  ) {
    return null;
  }
  const years = getSampleYears(startYear, endYear);
  if (!years.length) return null;
  const profiles = profilesToScenarioFields(computeProfiles(years));
  patchAccumulationState({ profiles });
  return profiles;
}
