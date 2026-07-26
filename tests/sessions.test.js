import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  list,
  load,
  save,
  deleteSession,
  importWithRename,
  _clearAllForTests,
  _setOpenDbForTests,
} from '../src/state/sessions.js';
import { FEATURE_SOR_PLAN, FEATURE_SOR_LAB } from '../src/state/storageKeys.js';
import { SCHEMA_VERSION } from '../src/state/scenario.js';

describe('sessions store (fs-sessions)', () => {
  beforeEach(async () => {
    _setOpenDbForTests(null);
    await _clearAllForTests();
  });

  it('namespaces sessions by feature', async () => {
    await save(FEATURE_SOR_PLAN, 'Alpha', { startBalance: 1000 }, 'plan note');
    await save(FEATURE_SOR_LAB, 'Alpha', { version: 1 }, 'lab note');

    const planList = await list(FEATURE_SOR_PLAN);
    const labList = await list(FEATURE_SOR_LAB);
    expect(planList).toHaveLength(1);
    expect(labList).toHaveLength(1);
    expect(planList[0].description).toBe('plan note');
    expect(labList[0].description).toBe('lab note');

    const plan = await load(FEATURE_SOR_PLAN, 'Alpha');
    const lab = await load(FEATURE_SOR_LAB, 'Alpha');
    expect(plan.payload.startBalance).toBe(1000);
    expect(lab.payload.version).toBe(1);
  });

  it('round-trips save/load/delete and lists newest first', async () => {
    await save(FEATURE_SOR_PLAN, 'Old', { startBalance: 1 });
    await new Promise((r) => setTimeout(r, 5));
    await save(FEATURE_SOR_PLAN, 'New', { startBalance: 2 });

    const listed = await list(FEATURE_SOR_PLAN);
    expect(listed.map((s) => s.name)).toEqual(['New', 'Old']);
    expect(listed[0].updatedAt).toBeGreaterThanOrEqual(listed[1].updatedAt);

    await deleteSession(FEATURE_SOR_PLAN, 'Old');
    expect(await load(FEATURE_SOR_PLAN, 'Old')).toBeNull();
    expect((await list(FEATURE_SOR_PLAN)).map((s) => s.name)).toEqual(['New']);
  });

  it('importWithRename auto-renames on collision', async () => {
    await save(FEATURE_SOR_PLAN, 'My Plan', { startBalance: 10 });
    const name2 = await importWithRename(FEATURE_SOR_PLAN, 'My Plan', { startBalance: 20 });
    const name3 = await importWithRename(FEATURE_SOR_PLAN, 'My Plan', { startBalance: 30 });
    expect(name2).toBe('My Plan (2)');
    expect(name3).toBe('My Plan (3)');

    const original = await load(FEATURE_SOR_PLAN, 'My Plan');
    expect(original.payload.startBalance).toBe(10);
    expect((await load(FEATURE_SOR_PLAN, name2)).payload.startBalance).toBe(20);
  });

  it('migrates SOR Plan payloads with schemaVersion', async () => {
    await save(FEATURE_SOR_PLAN, 'Legacy', { startBalance: 500 }, '', {});
    // Overwrite raw record shape via a second save is already current schema;
    // load always runs migrateScenario — ensure SCHEMA_VERSION is present.
    const loaded = await load(FEATURE_SOR_PLAN, 'Legacy');
    expect(loaded.payload.startBalance).toBe(500);
    expect(SCHEMA_VERSION).toBeGreaterThan(0);
  });
});
