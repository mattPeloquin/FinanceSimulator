// House Equity worker handler (master thread; no ParallelPool chunks).

import { runHouseEquityAnalysis } from '../../core/houseEquity.js';

/**
 * @param {{ pool: object, post: Function, postProgress: Function }} ctx
 * @param {object} data
 */
export async function handleHouseEquity(ctx, data) {
  const { post, postProgress } = ctx;
  const input = data?.input;
  if (!input || typeof input !== 'object') {
    post({ type: 'error', message: 'House Equity run is missing inputs.' });
    return;
  }

  postProgress('Starting House Equity Monte Carlo', 0.02);
  try {
    const result = runHouseEquityAnalysis(input, {
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
