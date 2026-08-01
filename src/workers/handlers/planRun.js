// Plan Monte Carlo run + classic 4% comparison packaging.

import { buildRunResult } from '../../core/resultPackaging.js';
import {
  buildClassicFourPercentParams,
  buildFourPercentComparison,
} from '../../core/fourPercentComparison.js';

/** After the user's run, re-simulate a flat real 4% rule on the same paths. */
export async function packageWithFourPercentComparison(pool, params, userRaw, {
  shortfallTolerance,
  userProgressScale = 0.5,
  post = (m) => self.postMessage(m),
} = {}) {
  const userResult = shortfallTolerance == null
    ? buildRunResult(params, userRaw)
    : buildRunResult(params, userRaw, { shortfallTolerance });

  const classicParams = buildClassicFourPercentParams(params);
  const classicRaw = await pool.run(classicParams, {
    onProgress: (fraction) =>
      post({
        type: 'progress',
        stage: 'Comparing to the classic 4% rule',
        // First half of the bar was the user plan; map this pass into the second half.
        fraction: userProgressScale + fraction * (1 - userProgressScale),
      }),
  });
  const classicResult = shortfallTolerance == null
    ? buildRunResult(classicParams, classicRaw)
    : buildRunResult(classicParams, classicRaw, { shortfallTolerance });
  const fourPercentComparison = buildFourPercentComparison(userResult, classicResult, params);
  return { userResult, classicResult, fourPercentComparison };
}

export async function handlePlanRun(ctx, data) {
  const { pool, post } = ctx;
  const { params } = data;
  const userRaw = await pool.run(params, {
    onProgress: (fraction) =>
      post({
        type: 'progress',
        stage: 'Running your plan',
        // Reserve the second half of the bar for the classic 4% comparison.
        fraction: fraction * 0.5,
      }),
  });
  const { userResult, classicResult, fourPercentComparison } =
    await packageWithFourPercentComparison(pool, params, userRaw, { post });
  post({
    type: 'done',
    result: userResult,
    classicResult,
    fourPercentComparison,
  });
}
