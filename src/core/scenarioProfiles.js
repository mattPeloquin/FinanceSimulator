// Shared helper: ensure a flat Withdraw-style scenario has log-normal /
// scaled-historical profile fields filled from its historical year window.
// Used by SOR Lab and Lifetime Plan — must not live under a feature folder.

import { listSleeves } from '../portfolio/registry.js';
import {
  getSampleYears,
  computeProfiles,
  profilesToScenarioFields,
} from './history.js';

/**
 * Ensure log-normal / scaled-historical profile fields are filled from the
 * scenario's historical window when missing (saved Plans usually have them).
 *
 * @param {object} scenario - flat Withdraw-style scenario
 * @returns {object} cloned scenario (or original when already complete)
 */
export function ensureScenarioProfiles(scenario) {
  const out = structuredClone(scenario);
  const firstMean = listSleeves()[0]?.meanKey;
  const needsProfiles = firstMean == null || out[firstMean] == null || out[firstMean] === '';
  if (!needsProfiles) return out;
  const startYear = Number(out.startYear);
  const endYear = Number(out.endYear);
  if (!Number.isFinite(startYear) || !Number.isFinite(endYear) || startYear > endYear) {
    return out;
  }
  const years = getSampleYears(startYear, endYear);
  if (years.length === 0) return out;
  Object.assign(out, profilesToScenarioFields(computeProfiles(years)));
  return out;
}
