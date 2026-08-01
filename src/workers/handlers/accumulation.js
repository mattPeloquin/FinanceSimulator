// Accumulation feature worker handler.
//
// Runs on the master worker thread (Plan's ParallelPool chunk shape is
// withdrawal-oriented). Market paths use CRN via deriveSeed inside
// runAccumulationMonteCarlo. Phases: Med cone → Low/High savings → weight
// region + tornado.

import {
  SAVINGS_SCALES,
  DEFAULT_WEIGHT_GRID_STEP,
  DEFAULT_WEIGHT_GRID_CEILING,
  runAccumulationMonteCarlo,
  summarizeAccumulationPaths,
  summarizeAccumulationSweepPoint,
  buildWeightGrid,
  buildWeightTornadoPoints,
  renormalizeAllocation,
} from '../../core/accumulation.js';

function runScale(params, factor, onProgress) {
  const raw = runAccumulationMonteCarlo(
    { ...params, amountScale: factor },
    { onProgress },
  );
  return {
    factor,
    summary: summarizeAccumulationPaths(raw),
    sweep: summarizeAccumulationSweepPoint(raw),
  };
}

/**
 * @param {{ pool: object, post: Function, postProgress: Function }} ctx
 * @param {object} data
 */
export async function handleAccumulation(ctx, data) {
  const { post, postProgress } = ctx;
  const {
    params,
    sweepPaths,
    weightGridStep = DEFAULT_WEIGHT_GRID_STEP,
    weightGridCeiling = DEFAULT_WEIGHT_GRID_CEILING,
    includeWeightExplore = true,
  } = data || {};

  if (!params || typeof params !== 'object') {
    post({ type: 'error', message: 'Accumulation run is missing params.' });
    return;
  }

  const pathsForSweep = Math.max(
    100,
    sweepPaths || Math.min(500, params.numSimulations || 500),
  );

  // Phase A — Med (1.0×) primary uncertainty cone
  postProgress('Growing Med savings paths', 0.02);
  const med = runScale(params, 1.0, (f) => postProgress('Growing Med savings paths', 0.02 + f * 0.38));

  // Phase B — Low / High savings intensity (same CRN seed space as Med)
  const savingsImpact = { med };
  for (const scale of SAVINGS_SCALES) {
    if (scale.id === 'med') continue;
    const base = scale.id === 'low' ? 0.42 : 0.58;
    postProgress(`Growing ${scale.label} savings paths`, base);
    const result = runScale(
      { ...params, numSimulations: pathsForSweep },
      scale.factor,
      (f) => postProgress(`Growing ${scale.label} savings paths`, base + f * 0.12),
    );
    savingsImpact[scale.id] = result;
  }

  let region = [];
  let tornado = [];

  if (includeWeightExplore !== false) {
    const baselineAlloc = renormalizeAllocation(params.allocation);
    const grid = buildWeightGrid(weightGridStep, weightGridCeiling);
    const gridParams = { ...params, numSimulations: pathsForSweep };
    const totalGrid = grid.length;
    postProgress('Mapping risk/return region', 0.72);
    for (let i = 0; i < totalGrid; i++) {
      const mix = grid[i];
      const raw = runAccumulationMonteCarlo({
        ...gridParams,
        allocation: mix,
        allocationOverTimeTiers: [], // static mix points for the cloud
        amountScale: 1,
      });
      const sweep = summarizeAccumulationSweepPoint(raw);
      region.push({
        allocation: mix,
        endingMedian: sweep.endingBalance.median,
        endingMean: sweep.endingBalance.mean,
        endingStdDev: sweep.endingBalance.stdDev,
      });
      if (i % 4 === 0 || i === totalGrid - 1) {
        postProgress('Mapping risk/return region', 0.72 + (i + 1) / totalGrid * 0.14);
      }
    }

    const tornadoPoints = buildWeightTornadoPoints(baselineAlloc, weightGridStep / 2);
    const baselineMedian = med.sweep.endingBalance.median;
    postProgress('Weight tornado', 0.88);
    for (let i = 0; i < tornadoPoints.length; i++) {
      const point = tornadoPoints[i];
      const raw = runAccumulationMonteCarlo({
        ...gridParams,
        allocation: point.allocation,
        allocationOverTimeTiers: [],
        amountScale: 1,
      });
      const sweep = summarizeAccumulationSweepPoint(raw);
      tornado.push({
        variableId: point.variableId,
        direction: point.direction,
        value: point.value,
        endingMedian: sweep.endingBalance.median,
        impact: sweep.endingBalance.median - baselineMedian,
      });
      postProgress('Weight tornado', 0.88 + (i + 1) / tornadoPoints.length * 0.1);
    }
  }

  postProgress('Packaging results', 0.99);
  post({
    type: 'done',
    result: {
      med: med.summary,
      savingsImpact: {
        low: savingsImpact.low?.summary || null,
        med: med.summary,
        high: savingsImpact.high?.summary || null,
        factors: SAVINGS_SCALES.map((s) => ({ id: s.id, label: s.label, factor: s.factor })),
      },
      region,
      tornado,
      meta: {
        seed: params.seed,
        numYears: params.numYears,
        numSimulations: params.numSimulations,
        sweepPaths: pathsForSweep,
        weightGridStep,
        weightGridCeiling,
        regionPoints: region.length,
      },
    },
  });
}
