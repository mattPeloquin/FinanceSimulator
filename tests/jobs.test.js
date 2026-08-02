// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  start,
  cancelAll,
  isBusy,
  _resetJobsForTests,
} from '../src/state/jobs.js';
import {
  registerFeature,
  setFeatureBadge,
  getFeatureBadge,
  _resetFeaturesForTests,
} from '../src/state/features.js';

function mockWorker() {
  const handlers = {};
  const worker = {
    onmessage: null,
    onerror: null,
    postMessage(data) {
      handlers.lastPosted = data;
    },
    terminate: vi.fn(),
    /** @param {object} msg */
    emit(msg) {
      this.onmessage?.({ data: msg });
    },
    emitError(message) {
      this.onerror?.({ message });
    },
  };
  return worker;
}

describe('job manager', () => {
  beforeEach(() => {
    _resetJobsForTests();
    _resetFeaturesForTests();
    registerFeature({ id: 'withdraw', title: 'Withdraw', rootId: 'feature-withdraw' });
    registerFeature({ id: 'sor-lab', title: 'SOR Lab', rootId: 'feature-sor-lab' });
    document.body.innerHTML = `
      <nav id="feature-tabs"></nav>
      <div id="feature-withdraw"></div>
      <div id="feature-sor-lab"></div>
    `;
  });

  it('tracks busy/progress badges and clears on done', () => {
    const worker = mockWorker();
    const onDone = vi.fn();
    const onProgress = vi.fn();
    const job = start('withdraw', {
      createWorker: () => worker,
      onProgress,
      onDone,
    });

    expect(isBusy('withdraw')).toBe(true);
    expect(getFeatureBadge('withdraw')).toEqual({ busy: true, progress: 0 });

    worker.emit({ type: 'progress', fraction: 0.42, stage: 'Running' });
    expect(onProgress).toHaveBeenCalledWith(0.42, 'Running');
    expect(getFeatureBadge('withdraw').progress).toBe(42);

    job.post({ type: 'withdraw', params: {} });
    worker.emit({ type: 'done', result: { ok: true } });
    expect(onDone).toHaveBeenCalledWith({ type: 'done', result: { ok: true } });
    expect(isBusy('withdraw')).toBe(false);
    expect(getFeatureBadge('withdraw')).toEqual({ busy: false, progress: null });
    expect(worker.terminate).toHaveBeenCalled();
  });

  it('isolates jobs per feature', () => {
    const planWorker = mockWorker();
    const labWorker = mockWorker();
    start('withdraw', { createWorker: () => planWorker });
    start('sor-lab', { createWorker: () => labWorker });
    expect(isBusy('withdraw')).toBe(true);
    expect(isBusy('sor-lab')).toBe(true);

    cancelAll('withdraw');
    expect(isBusy('withdraw')).toBe(false);
    expect(isBusy('sor-lab')).toBe(true);
    expect(planWorker.terminate).toHaveBeenCalled();
    expect(labWorker.terminate).not.toHaveBeenCalled();
  });

  it('cancel clears badge and skips late done', () => {
    const worker = mockWorker();
    const onDone = vi.fn();
    start('withdraw', { createWorker: () => worker, onDone });
    cancelAll('withdraw');
    expect(getFeatureBadge('withdraw').busy).toBe(false);
    worker.emit({ type: 'done', result: {} });
    expect(onDone).not.toHaveBeenCalled();
  });

  it('onError clears busy state', () => {
    const worker = mockWorker();
    const onError = vi.fn();
    start('withdraw', { createWorker: () => worker, onError });
    worker.emit({ type: 'error', message: 'boom' });
    expect(onError).toHaveBeenCalled();
    expect(isBusy('withdraw')).toBe(false);
    expect(getFeatureBadge('withdraw').busy).toBe(false);
  });

  it('replacing a job cancels the previous worker', () => {
    const first = mockWorker();
    const second = mockWorker();
    start('withdraw', { createWorker: () => first });
    start('withdraw', { createWorker: () => second });
    expect(first.terminate).toHaveBeenCalled();
    expect(isBusy('withdraw')).toBe(true);
    setFeatureBadge('withdraw', { busy: true, progress: 10 });
    expect(getFeatureBadge('withdraw').busy).toBe(true);
  });
});
