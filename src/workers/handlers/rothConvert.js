// Roth Convert worker handler (master thread; no ParallelPool chunks).

import { runRothConversionAnalysis } from '../../core/rothConversion.js';

/**
 * @param {{ pool: object, post: Function, postProgress: Function }} ctx
 * @param {object} data
 */
export async function handleRothConvert(ctx, data) {
  const { post, postProgress } = ctx;
  const input = data?.input;
  if (!input || typeof input !== 'object') {
    post({ type: 'error', message: 'Roth Convert run is missing inputs.' });
    return;
  }

  postProgress('Starting Roth Convert Monte Carlo', 0.02);
  try {
    const result = runRothConversionAnalysis(input, {
      onProgress: (fraction, stage) => {
        postProgress(stage || 'Running…', 0.05 + fraction * 0.9);
      },
    });
    postProgress('Done', 1);
    post({ type: 'done', result });
  } catch (err) {
    post({
      type: 'error',
      message: err && err.message ? err.message : String(err),
    });
  }
}
