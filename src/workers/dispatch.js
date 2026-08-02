// Type → handler registry for the simulation worker.
// Imported by simulation.worker.js and by Vitest (no Worker runtime required).

import { ParallelPool } from './parallelPool.js';
import { handleConnect } from './handlers/connect.js';
import { handleChunk } from './handlers/chunk.js';
import { handleWithdrawRun } from './handlers/withdrawRun.js';
import { handleWithdrawGoalSeek } from './handlers/withdrawGoalSeek.js';
import { handleSensitivity } from './handlers/sensitivity.js';
import { handleAccumulate } from './handlers/accumulate.js';
import { handleSsTiming } from './handlers/ssTiming.js';
import { handleRothConvert } from './handlers/rothConvert.js';
import { handleHouseEquity } from './handlers/houseEquity.js';

/** Message types that do not need a ParallelPool. */
const NO_POOL_TYPES = new Set(['connect', 'chunk']);

export const HANDLERS = {
  connect: handleConnect,
  chunk: handleChunk,
  withdraw: handleWithdrawRun,
  withdrawGoalSeek: handleWithdrawGoalSeek,
  sensitivity: handleSensitivity,
  accumulate: handleAccumulate,
  ssTiming: handleSsTiming,
  rothConvert: handleRothConvert,
  houseEquity: handleHouseEquity,
};

/**
 * Route one inbound worker message.
 * @param {object} data - e.data from onmessage
 * @param {{ post: Function, createPool?: Function }} io
 *   `post(msg, transfer?)` posts to the main thread.
 *   `createPool` defaults to `new ParallelPool(...)` (injectable for tests).
 */
export async function dispatchWorkerMessage(data, io) {
  const payload = data || {};
  const { type } = payload;
  const handler = HANDLERS[type];
  const post = io.post;

  if (!handler) {
    post({
      type: 'error',
      message: `Unknown worker message type: ${type}`,
    });
    return;
  }

  if (NO_POOL_TYPES.has(type)) {
    await handler({ post }, payload);
    return;
  }

  const createPool = io.createPool
    || ((ports, cores) => new ParallelPool(ports, cores));
  const pool = createPool(payload.subWorkerPorts || [], payload.numCores || 1);
  try {
    await handler({
      pool,
      post,
      postProgress: (stage, fraction) =>
        post({ type: 'progress', stage, fraction }),
    }, payload);
  } catch (err) {
    post({ type: 'error', message: err && err.message ? err.message : String(err) });
  } finally {
    pool.terminate();
  }
}
