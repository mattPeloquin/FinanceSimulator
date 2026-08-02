// Plan Goal Seek: search → confirm → classic 4% comparison.

import { runGoalSeek } from '../../core/goalSeek.js';
import { packageWithFourPercentComparison } from './withdrawRun.js';

export async function handleWithdrawGoalSeek(ctx, data) {
  const { pool, post } = ctx;
  const { params, goalSeekConfig } = data;
  const simulateAsync = (simParams) => pool.run(simParams);

  const { params: finalParams, summary } = await runGoalSeek(params, goalSeekConfig, simulateAsync, {
    onProgress: (stage, fraction) => post({ type: 'progress', stage, fraction }),
  });

  // Confirmation + classic comparison share the final progress window:
  // 0–50% confirming the found plan, 50–100% classic 4% benchmark.
  const confirmation = await pool.run(finalParams, {
    onProgress: (fraction) =>
      post({
        type: 'progress',
        stage: 'Confirming final plan',
        fraction: fraction * 0.5,
      }),
  });
  // Blue below-plan tags / on-plan success % use Easy Mode → Plan Risk
  // Tolerance (on sim params), not Find Best Plan's search Risk Tolerance.
  const shortfallTolerance = finalParams.shortfallTolerance ?? params.shortfallTolerance ?? 0.05;
  const { userResult, classicResult, fourPercentComparison } =
    await packageWithFourPercentComparison(pool, finalParams, confirmation, {
      shortfallTolerance,
      post,
    });
  post({
    type: 'done',
    result: userResult,
    classicResult,
    fourPercentComparison,
    goalSeekSummary: summary,
    finalParams,
  });
}
