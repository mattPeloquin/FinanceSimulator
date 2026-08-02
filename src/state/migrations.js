// Per-feature state migration — the only home for migrate* implementations
// and the version registry used by sessions / export / share links.
//
// Envelope, IndexedDB, and dependency snapshots carry `stateVersion` (not
// Plan's old `schemaVersion`). Future features add migrate* here and register
// at module load or via registerFeatureMigrator; persistence stays branch-free.

import { SCHEMA_VERSION, SCHEMA_VERSION_MIN } from './scenario.js';
import {
  FEATURE_WITHDRAW,
  FEATURE_SOR_LAB,
  FEATURE_ACCUMULATE,
  FEATURE_SS_TIMING,
  FEATURE_ROTH_CONVERT,
  FEATURE_HOUSE_EQUITY,
  FEATURE_PLAN,
} from './storageKeys.js';

/** Lab session / envelope state version (also mirrored inside Lab config as `version`). */
export const LAB_STATE_VERSION = 1;
export const LAB_STATE_VERSION_MIN = 1;

/** Accumulate session / envelope state version. */
export const ACCUMULATE_STATE_VERSION = 2;
export const ACCUMULATE_STATE_VERSION_MIN = 1;

/** Social Security timing session / envelope state version. */
export const SS_TIMING_STATE_VERSION = 2;
export const SS_TIMING_STATE_VERSION_MIN = 1;

/** Roth Convert session / envelope state version. */
export const ROTH_CONVERT_STATE_VERSION = 2;
export const ROTH_CONVERT_STATE_VERSION_MIN = 1;

/** House Equity session / envelope state version. */
export const HOUSE_EQUITY_STATE_VERSION = 2;
export const HOUSE_EQUITY_STATE_VERSION_MIN = 1;

/** Lifetime Plan session / envelope state version. */
export const PLAN_STATE_VERSION = 3;
export const PLAN_STATE_VERSION_MIN = 1;

/**
 * @typedef {object} FeatureMigrator
 * @property {string} id
 * @property {number} stateVersion
 * @property {(state: object, fromVersion: number) => object} migrate
 */

/** @type {Map<string, FeatureMigrator>} */
const migrators = new Map();

/**
 * Register (or replace) a feature's current stateVersion and migrate hook.
 * @param {FeatureMigrator} entry
 */
export function registerFeatureMigrator(entry) {
  if (!entry || typeof entry !== 'object') {
    throw new Error('registerFeatureMigrator requires a migrator descriptor');
  }
  const { id, stateVersion, migrate } = entry;
  if (!id || typeof id !== 'string') {
    throw new Error('registerFeatureMigrator: invalid id');
  }
  if (typeof stateVersion !== 'number' || !Number.isFinite(stateVersion)) {
    throw new Error(`registerFeatureMigrator: feature "${id}" needs a numeric stateVersion`);
  }
  if (typeof migrate !== 'function') {
    throw new Error(`registerFeatureMigrator: feature "${id}" needs a migrate function`);
  }
  migrators.set(id, { id, stateVersion, migrate });
}

/** @param {string} featureId */
export function getFeatureStateVersion(featureId) {
  const entry = migrators.get(featureId);
  if (!entry) {
    throw new Error(`No state migrator registered for feature "${featureId}".`);
  }
  return entry.stateVersion;
}

/**
 * Migrate feature state from `fromVersion` to the registered current version.
 * @param {string} featureId
 * @param {object} state
 * @param {number} fromVersion
 */
export function migrateFeatureState(featureId, state, fromVersion) {
  const entry = migrators.get(featureId);
  if (!entry) {
    throw new Error(`No state migrator registered for feature "${featureId}".`);
  }
  if (typeof fromVersion !== 'number' || !Number.isFinite(fromVersion)) {
    throw new Error(
      `Feature "${featureId}" state version is missing or invalid.`,
    );
  }
  return entry.migrate(state, fromVersion);
}

/**
 * Upgrade Withdraw scenarios within the versions this build supports.
 * Historical migrations below SCHEMA_VERSION_MIN were removed for production;
 * add forward steps here when bumping SCHEMA_VERSION (e.g. `if (schemaVersion < 14)`).
 */
export function migrateScenario(scenario, schemaVersion) {
  if (scenario == null || typeof scenario !== 'object' || Array.isArray(scenario)) {
    throw new Error('Scenario data is missing or invalid.');
  }
  if (typeof schemaVersion !== 'number' || !Number.isFinite(schemaVersion)) {
    throw new Error('Scenario schema version is missing or invalid.');
  }
  if (schemaVersion < SCHEMA_VERSION_MIN) {
    throw new Error(
      `This scenario uses schema version ${schemaVersion}, which is older than this app supports (${SCHEMA_VERSION_MIN}).`,
    );
  }
  if (schemaVersion > SCHEMA_VERSION) {
    throw new Error(
      `This scenario uses schema version ${schemaVersion}, which is newer than this app supports (${SCHEMA_VERSION}).`,
    );
  }

  const migrated = { ...scenario };

  // Forward migrations go here when SCHEMA_VERSION increases:
  // if (schemaVersion < 14) { ... }

  return migrated;
}

/**
 * Upgrade SOR Lab session state within supported versions.
 * Field shaping / defaults still run in the Lab feature's normalizeLabState.
 */
export function migrateLabState(state, fromVersion) {
  if (state == null || typeof state !== 'object' || Array.isArray(state)) {
    throw new Error('Lab state is missing or invalid.');
  }
  if (typeof fromVersion !== 'number' || !Number.isFinite(fromVersion)) {
    throw new Error('Lab state version is missing or invalid.');
  }
  if (fromVersion < LAB_STATE_VERSION_MIN) {
    throw new Error(
      `This Lab session uses state version ${fromVersion}, which is older than this app supports (${LAB_STATE_VERSION_MIN}).`,
    );
  }
  if (fromVersion > LAB_STATE_VERSION) {
    throw new Error(
      `This Lab session uses state version ${fromVersion}, which is newer than this app supports (${LAB_STATE_VERSION}).`,
    );
  }

  const migrated = { ...state };

  // Forward migrations go here when LAB_STATE_VERSION increases:
  // if (fromVersion < 2) { ... }

  return migrated;
}

/**
 * Upgrade Accumulate session state within supported versions.
 * Field shaping still runs in the feature's normalizeAccumulateState.
 */
export function migrateAccumulateState(state, fromVersion) {
  if (state == null || typeof state !== 'object' || Array.isArray(state)) {
    throw new Error('Accumulate state is missing or invalid.');
  }
  if (typeof fromVersion !== 'number' || !Number.isFinite(fromVersion)) {
    throw new Error('Accumulate state version is missing or invalid.');
  }
  if (fromVersion < ACCUMULATE_STATE_VERSION_MIN) {
    throw new Error(
      `This Accumulate session uses state version ${fromVersion}, which is older than this app supports (${ACCUMULATE_STATE_VERSION_MIN}).`,
    );
  }
  if (fromVersion > ACCUMULATE_STATE_VERSION) {
    throw new Error(
      `This Accumulate session uses state version ${fromVersion}, which is newer than this app supports (${ACCUMULATE_STATE_VERSION}).`,
    );
  }

  const migrated = { ...state };

  // v2: optional soft-link to a Withdraw / Plan session (local portfolio remains default).
  if (fromVersion < 2) {
    if (!migrated.portfolioSource) {
      migrated.portfolioSource = migrated.scenarioRef?.name ? 'link' : 'local';
    }
  }

  return migrated;
}

// Built-in features register at module load so sessions/persistence work in
// unit tests without booting the full UI.
registerFeatureMigrator({
  id: FEATURE_WITHDRAW,
  stateVersion: SCHEMA_VERSION,
  migrate: migrateScenario,
});
registerFeatureMigrator({
  id: FEATURE_SOR_LAB,
  stateVersion: LAB_STATE_VERSION,
  migrate: migrateLabState,
});
registerFeatureMigrator({
  id: FEATURE_ACCUMULATE,
  stateVersion: ACCUMULATE_STATE_VERSION,
  migrate: migrateAccumulateState,
});

/**
 * Upgrade SS Timing session state within supported versions.
 */
export function migrateSsTimingState(state, fromVersion) {
  if (state == null || typeof state !== 'object' || Array.isArray(state)) {
    throw new Error('Social Security state is missing or invalid.');
  }
  if (typeof fromVersion !== 'number' || !Number.isFinite(fromVersion)) {
    throw new Error('Social Security state version is missing or invalid.');
  }
  if (fromVersion < SS_TIMING_STATE_VERSION_MIN) {
    throw new Error(
      `This Social Security session uses state version ${fromVersion}, which is older than this app supports (${SS_TIMING_STATE_VERSION_MIN}).`,
    );
  }
  if (fromVersion > SS_TIMING_STATE_VERSION) {
    throw new Error(
      `This Social Security session uses state version ${fromVersion}, which is newer than this app supports (${SS_TIMING_STATE_VERSION}).`,
    );
  }
  const next = { ...state };
  if (fromVersion < 2) {
    if (!next.portfolioSource) {
      next.portfolioSource = next.scenarioRef?.name ? 'link' : 'local';
    }
  }
  return next;
}

registerFeatureMigrator({
  id: FEATURE_SS_TIMING,
  stateVersion: SS_TIMING_STATE_VERSION,
  migrate: migrateSsTimingState,
});

/**
 * Upgrade Roth Convert session state within supported versions.
 */
export function migrateRothConvertState(state, fromVersion) {
  if (state == null || typeof state !== 'object' || Array.isArray(state)) {
    throw new Error('Roth Convert state is missing or invalid.');
  }
  if (typeof fromVersion !== 'number' || !Number.isFinite(fromVersion)) {
    throw new Error('Roth Convert state version is missing or invalid.');
  }
  if (fromVersion < ROTH_CONVERT_STATE_VERSION_MIN) {
    throw new Error(
      `This Roth Convert session uses state version ${fromVersion}, which is older than this app supports (${ROTH_CONVERT_STATE_VERSION_MIN}).`,
    );
  }
  if (fromVersion > ROTH_CONVERT_STATE_VERSION) {
    throw new Error(
      `This Roth Convert session uses state version ${fromVersion}, which is newer than this app supports (${ROTH_CONVERT_STATE_VERSION}).`,
    );
  }
  const next = { ...state };
  // v2: nest a local portfolio; drop constant-return fields (MC SOR only).
  if (fromVersion < 2) {
    if (!next.portfolio) {
      // Lazy import avoided — migrators stay sync; seed happens in session normalize.
      next.portfolio = null;
    }
    delete next.constantRealReturn;
    if (!next.scenarioRef?.name && !next.portfolioSource) {
      next.portfolioSource = next.scenarioRef?.name ? 'link' : 'local';
    }
  }
  return next;
}

registerFeatureMigrator({
  id: FEATURE_ROTH_CONVERT,
  stateVersion: ROTH_CONVERT_STATE_VERSION,
  migrate: migrateRothConvertState,
});

/**
 * Upgrade House Equity session state within supported versions.
 */
export function migrateHouseEquityState(state, fromVersion) {
  if (state == null || typeof state !== 'object' || Array.isArray(state)) {
    throw new Error('House Equity state is missing or invalid.');
  }
  if (typeof fromVersion !== 'number' || !Number.isFinite(fromVersion)) {
    throw new Error('House Equity state version is missing or invalid.');
  }
  if (fromVersion < HOUSE_EQUITY_STATE_VERSION_MIN) {
    throw new Error(
      `This House Equity session uses state version ${fromVersion}, which is older than this app supports (${HOUSE_EQUITY_STATE_VERSION_MIN}).`,
    );
  }
  if (fromVersion > HOUSE_EQUITY_STATE_VERSION) {
    throw new Error(
      `This House Equity session uses state version ${fromVersion}, which is newer than this app supports (${HOUSE_EQUITY_STATE_VERSION}).`,
    );
  }
  const next = { ...state };
  if (fromVersion < 2) {
    if (!next.portfolio) next.portfolio = null;
    delete next.constantRealReturn;
    if (!next.portfolioSource) {
      next.portfolioSource = next.scenarioRef?.name ? 'link' : 'local';
    }
  }
  return next;
}

registerFeatureMigrator({
  id: FEATURE_HOUSE_EQUITY,
  stateVersion: HOUSE_EQUITY_STATE_VERSION,
  migrate: migrateHouseEquityState,
});

/**
 * Upgrade Plan session state within supported versions.
 * Field shaping / defaults still run in the Plan feature's normalizePlanState.
 */
export function migratePlanState(state, fromVersion) {
  if (state == null || typeof state !== 'object' || Array.isArray(state)) {
    throw new Error('Plan state is missing or invalid.');
  }
  if (typeof fromVersion !== 'number' || !Number.isFinite(fromVersion)) {
    throw new Error('Plan state version is missing or invalid.');
  }
  if (fromVersion < PLAN_STATE_VERSION_MIN) {
    throw new Error(
      `This Plan session uses state version ${fromVersion}, which is older than this app supports (${PLAN_STATE_VERSION_MIN}).`,
    );
  }
  if (fromVersion > PLAN_STATE_VERSION) {
    throw new Error(
      `This Plan session uses state version ${fromVersion}, which is newer than this app supports (${PLAN_STATE_VERSION}).`,
    );
  }

  const migrated = { ...state };

  // v1 → v2: net-worth view + Accumulate→Withdraw handoff fields on source rows.
  if (fromVersion < 2) {
    if (migrated.view == null) migrated.view = 'netWorth';
    if (Array.isArray(migrated.sources)) {
      migrated.sources = migrated.sources.map((src) => {
        if (!src || typeof src !== 'object') return src;
        return {
          ...src,
          startsAfter: src.startsAfter == null ? '' : String(src.startsAfter),
          gapYears: Math.max(0, Math.round(Number(src.gapYears)) || 0),
          handoffPercentile: ['p10', 'p50', 'p90'].includes(src.handoffPercentile)
            ? src.handoffPercentile
            : 'p50',
        };
      });
    }
  }

  // v2 → v3: Roth Convert is no longer a Lifetime Plan source (orthogonal tax overlay).
  if (fromVersion < 3) {
    if (Array.isArray(migrated.sources)) {
      migrated.sources = migrated.sources.filter(
        (src) => src && src.feature !== 'roth-convert',
      );
    }
  }

  return migrated;
}

registerFeatureMigrator({
  id: FEATURE_PLAN,
  stateVersion: PLAN_STATE_VERSION,
  migrate: migratePlanState,
});
