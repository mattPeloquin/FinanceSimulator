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
import { FEATURE_WITHDRAW, FEATURE_SOR_LAB } from '../src/state/storageKeys.js';
import { SCHEMA_VERSION } from '../src/state/scenario.js';
import { LAB_STATE_VERSION } from '../src/state/migrations.js';

describe('sessions store (fs-sessions)', () => {
  beforeEach(async () => {
    _setOpenDbForTests(null);
    await _clearAllForTests();
  });

  it('namespaces sessions by feature', async () => {
    await save(FEATURE_WITHDRAW, 'Alpha', { startBalance: 1000 }, 'plan note');
    await save(FEATURE_SOR_LAB, 'Alpha', { version: 1 }, 'lab note');

    const planList = await list(FEATURE_WITHDRAW);
    const labList = await list(FEATURE_SOR_LAB);
    expect(planList).toHaveLength(1);
    expect(labList).toHaveLength(1);
    expect(planList[0].description).toBe('plan note');
    expect(labList[0].description).toBe('lab note');

    const plan = await load(FEATURE_WITHDRAW, 'Alpha');
    const lab = await load(FEATURE_SOR_LAB, 'Alpha');
    expect(plan.payload.startBalance).toBe(1000);
    expect(lab.payload.version).toBe(1);
  });

  it('stamps feature-specific stateVersion on save', async () => {
    expect(SCHEMA_VERSION).not.toBe(LAB_STATE_VERSION);
    await save(FEATURE_WITHDRAW, 'PlanVer', { startBalance: 1 });
    await save(FEATURE_SOR_LAB, 'LabVer', { version: LAB_STATE_VERSION });

    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('fs-sessions', 1);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    try {
      const store = db.transaction('sessions', 'readonly').objectStore('sessions');
      const planRec = await new Promise((resolve, reject) => {
        const req = store.get([FEATURE_WITHDRAW, 'PlanVer']);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      const labRec = await new Promise((resolve, reject) => {
        const req = store.get([FEATURE_SOR_LAB, 'LabVer']);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      expect(planRec.stateVersion).toBe(SCHEMA_VERSION);
      expect(labRec.stateVersion).toBe(LAB_STATE_VERSION);
      expect(planRec.schemaVersion).toBeUndefined();
      expect(labRec.schemaVersion).toBeUndefined();
    } finally {
      db.close();
    }
  });

  it('round-trips save/load/delete and lists newest first', async () => {
    await save(FEATURE_WITHDRAW, 'Old', { startBalance: 1 });
    await new Promise((r) => setTimeout(r, 5));
    await save(FEATURE_WITHDRAW, 'New', { startBalance: 2 });

    const listed = await list(FEATURE_WITHDRAW);
    expect(listed.map((s) => s.name)).toEqual(['New', 'Old']);
    expect(listed[0].updatedAt).toBeGreaterThanOrEqual(listed[1].updatedAt);

    await deleteSession(FEATURE_WITHDRAW, 'Old');
    expect(await load(FEATURE_WITHDRAW, 'Old')).toBeNull();
    expect((await list(FEATURE_WITHDRAW)).map((s) => s.name)).toEqual(['New']);
  });

  it('importWithRename auto-renames on collision', async () => {
    await save(FEATURE_WITHDRAW, 'My Plan', { startBalance: 10 });
    const name2 = await importWithRename(FEATURE_WITHDRAW, 'My Plan', { startBalance: 20 });
    const name3 = await importWithRename(FEATURE_WITHDRAW, 'My Plan', { startBalance: 30 });
    expect(name2).toBe('My Plan (2)');
    expect(name3).toBe('My Plan (3)');

    const original = await load(FEATURE_WITHDRAW, 'My Plan');
    expect(original.payload.startBalance).toBe(10);
    expect((await load(FEATURE_WITHDRAW, name2)).payload.startBalance).toBe(20);
  });

  it('migrates Withdraw payloads with stateVersion', async () => {
    await save(FEATURE_WITHDRAW, 'Legacy', { startBalance: 500 }, '', {});
    const loaded = await load(FEATURE_WITHDRAW, 'Legacy');
    expect(loaded.payload.startBalance).toBe(500);
    expect(SCHEMA_VERSION).toBeGreaterThan(0);
  });
});
