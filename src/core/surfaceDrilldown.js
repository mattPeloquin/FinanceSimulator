// Rank-window helpers for 3D surface drill-down (sample paths near a clicked rank).
import { regeneratePath } from './simulation.js';
import { mulberry32, deriveSeed } from './rng.js';

export const SURFACE_DRILLDOWN_SAMPLES = 200;

// Total-withdrawn rank for an overview column index (matches simulation.worker.js).
export function rankForOverviewColumn(col, meta) {
  const { p5Rank, p60Rank, surfaceSamples } = meta;
  const step = Math.max(1, Math.floor((p60Rank - p5Rank) / surfaceSamples));
  return Math.min(p5Rank + col * step, p60Rank);
}

// Grow [centerRank] outward until at least targetCount ranks exist or bounds are hit.
export function expandRankWindow(centerRank, n, targetCount = SURFACE_DRILLDOWN_SAMPLES) {
  let lo = centerRank;
  let hi = centerRank;
  while (hi - lo + 1 < targetCount && (lo > 0 || hi < n - 1)) {
    if (lo > 0) lo--;
    if (hi < n - 1 && hi - lo + 1 < targetCount) hi++;
  }
  return { lo, hi };
}

// Deterministic random rank picks; unique when the window is wide enough.
export function sampleRanks(lo, hi, count, seed) {
  const span = hi - lo + 1;
  const rng = mulberry32(seed >>> 0);
  if (span >= count) {
    const ranks = [];
    for (let i = 0; i < span; i++) ranks.push(lo + i);
    for (let i = span - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [ranks[i], ranks[j]] = [ranks[j], ranks[i]];
    }
    return ranks.slice(0, count).sort((a, b) => a - b);
  }
  const ranks = [];
  for (let i = 0; i < count; i++) ranks.push(lo + Math.floor(rng() * span));
  ranks.sort((a, b) => a - b);
  return ranks;
}

export function percentileLabelForRank(rank, n, decimals = 0) {
  const pct = (rank / n) * 100;
  if (decimals > 0) return 'P' + pct.toFixed(decimals);
  return 'P' + Math.round(pct);
}

export function buildDrilldownPaths(centerRank, meta, params, seed, count = SURFACE_DRILLDOWN_SAMPLES) {
  const { rankW, numSimulations: n } = meta;
  const { lo, hi } = expandRankWindow(centerRank, n, count);
  const sampleSeed = deriveSeed(seed >>> 0, centerRank);
  const ranks = sampleRanks(lo, hi, count, sampleSeed);
  const paths = ranks.map((rank) => {
    const simIndex = rankW[rank];
    const re = regeneratePath(params, seed, simIndex);
    return {
      balances: re.path.balances,
      returns: re.path.returns,
      withdrawals: re.path.withdrawals,
      unadjustedWithdrawals: re.path.unadjustedWithdrawals,
      totalWithdrawn: re.totalWithdrawn,
      avgReturn: re.avgReturn,
    };
  });
  return { paths, lo, hi, centerRank };
}
