// Shared per-feature background job manager.
// Jobs survive feature tab switches; badges reflect busy/progress on the tab bar.

import { setFeatureBadge } from './features.js';

/**
 * @typedef {object} JobHandle
 * @property {string} feature
 * @property {(data: object, transfer?: Transferable[]) => void} post
 * @property {() => void} cancel
 */

/** @type {Map<string, { worker: Worker, onCleanup?: () => void, cancelled: boolean }>} */
const active = new Map();

function clearBadge(feature) {
  setFeatureBadge(feature, { busy: false, progress: null });
}

function cleanup(feature) {
  const entry = active.get(feature);
  if (!entry) return;
  active.delete(feature);
  try {
    entry.worker.terminate();
  } catch {
    /* already dead */
  }
  try {
    entry.onCleanup?.();
  } catch (err) {
    console.error(`job cleanup failed for ${feature}`, err);
  }
}

/**
 * Start a job for `feature`, cancelling any previous job for that feature.
 * @param {string} feature
 * @param {{
 *   createWorker: () => Worker,
 *   onProgress?: (fraction: number, stage?: string) => void,
 *   onDone?: (msg: object) => void,
 *   onError?: (err: Error) => void,
 *   onCleanup?: () => void,
 * }} options
 * @returns {JobHandle}
 */
export function start(feature, options) {
  if (!feature || typeof feature !== 'string') {
    throw new Error('jobs.start requires a feature id');
  }
  if (typeof options?.createWorker !== 'function') {
    throw new Error('jobs.start requires createWorker()');
  }

  cancelAll(feature);

  const worker = options.createWorker();
  const entry = {
    worker,
    onCleanup: typeof options.onCleanup === 'function' ? options.onCleanup : undefined,
    cancelled: false,
  };
  active.set(feature, entry);
  setFeatureBadge(feature, { busy: true, progress: 0 });

  worker.onmessage = (e) => {
    if (entry.cancelled || active.get(feature) !== entry) return;
    const msg = e.data;
    if (msg?.type === 'progress') {
      const fraction = Number(msg.fraction) || 0;
      setFeatureBadge(feature, {
        busy: true,
        progress: Math.round(fraction * 100),
      });
      options.onProgress?.(fraction, msg.stage);
    } else if (msg?.type === 'done') {
      clearBadge(feature);
      active.delete(feature);
      try {
        entry.onCleanup?.();
      } catch (err) {
        console.error(`job cleanup failed for ${feature}`, err);
      }
      try {
        worker.terminate();
      } catch {
        /* ignore */
      }
      options.onDone?.(msg);
    } else if (msg?.type === 'error') {
      clearBadge(feature);
      cleanup(feature);
      options.onError?.(new Error(msg.message || 'Worker error'));
    }
  };

  worker.onerror = (err) => {
    if (entry.cancelled || active.get(feature) !== entry) return;
    clearBadge(feature);
    cleanup(feature);
    options.onError?.(new Error(err?.message || 'Worker error'));
  };

  return {
    feature,
    post(data, transfer = []) {
      if (entry.cancelled || active.get(feature) !== entry) return;
      worker.postMessage(data, transfer);
    },
    cancel() {
      cancelAll(feature);
    },
  };
}

/** Cancel the active job for `feature`, if any. */
export function cancelAll(feature) {
  const entry = active.get(feature);
  if (!entry) {
    clearBadge(feature);
    return;
  }
  entry.cancelled = true;
  clearBadge(feature);
  cleanup(feature);
}

/** @param {string} feature */
export function isBusy(feature) {
  return active.has(feature);
}

/** Test helper — tear down all jobs. */
export function _resetJobsForTests() {
  for (const feature of [...active.keys()]) {
    cancelAll(feature);
  }
}
