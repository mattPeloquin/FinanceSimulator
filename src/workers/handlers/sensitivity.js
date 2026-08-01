// SOR Lab: sweep design points with common random numbers, summarize each
// into a MetricBundle, assemble a visualization-agnostic LabSweepResult.

import {
  summarizeSweepPoint,
  assembleLabSweepResult,
} from '../../core/sensitivity.js';

/** Re-attach shared historical arrays stripped before transfer. */
function restoreSharedArrays(pointParams, baseParams) {
  return {
    ...pointParams,
    samples: baseParams.samples,
    scaledHistoricalShocks: baseParams.scaledHistoricalShocks,
    logNormal: {
      ...(pointParams.logNormal || {}),
      chol: baseParams.logNormal?.chol ?? null,
    },
  };
}

export async function handleSensitivity(ctx, data) {
  const { pool, post } = ctx;
  const {
    baseParams,
    designPoints,
    variableDefs,
    baselineRef,
    meta,
  } = data || {};

  const started = Date.now();
  const evaluated = [];
  const total = Array.isArray(designPoints) ? designPoints.length : 0;
  for (let i = 0; i < total; i++) {
    const point = designPoints[i];
    const pointParams = restoreSharedArrays(point.params, baseParams);
    const raw = await pool.run(pointParams);
    const bundle = summarizeSweepPoint(raw, pointParams);
    evaluated.push({
      kind: point.kind,
      variableId: point.variableId,
      value: point.value,
      bundle,
    });
    post({
      type: 'progress',
      stage: point.kind === 'baseline'
        ? 'Baseline'
        : `Sweeping ${point.variableId || 'variable'}`,
      fraction: (i + 1) / total,
    });
  }
  const result = assembleLabSweepResult({
    evaluated,
    variableDefs: variableDefs || [],
    baselineRef: baselineRef || null,
    meta: {
      ...(meta || {}),
      startedAt: meta?.startedAt ?? started,
      durationMs: Date.now() - started,
    },
  });
  post({ type: 'done', result });
}
