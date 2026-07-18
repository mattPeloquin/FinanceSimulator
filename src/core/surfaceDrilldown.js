// Rank-window helpers for 3D surface overview sampling and drill-down.
import { regeneratePath } from './simulation.js';
import { mulberry32, deriveSeed } from './rng.js';
import { percentileIndex } from './statistics.js';

export const SURFACE_DRILLDOWN_SAMPLES = 200;
export const SURFACE_OVERVIEW_SAMPLES = 200;

// Evenly spaced rank for an overview column within [loRank, hiRank].
// Defaults to meta.p5Rank / meta.p65Rank when lo/hi are omitted (packaged overview window).
export function rankForOverviewColumn(col, meta, loRank, hiRank) {
  const lo = loRank ?? meta.p5Rank;
  const hi = hiRank ?? meta.p65Rank;
  const samples = meta.surfaceSamples ?? SURFACE_OVERVIEW_SAMPLES;
  const step = Math.max(1, Math.floor((hi - lo) / samples));
  return Math.min(lo + col * step, hi);
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

function pathEntryFromRegen(re) {
  return {
    balances: re.path.balances,
    returns: re.path.returns,
    withdrawals: re.path.withdrawals,
    unadjustedWithdrawals: re.path.unadjustedWithdrawals,
    withdrawalBreakdown: re.path.withdrawalBreakdown,
    totalWithdrawn: re.totalWithdrawn,
    medianYearlyWithdrawal: re.medianYearlyWithdrawal,
    avgReturn: re.avgReturn,
    irr: re.irr,
    horizonYears: re.horizonYears,
  };
}

// Sample ~200 paths evenly across [loRank, hiRank] for the 3D overview.
export function sampleOverviewPaths(loRank, hiRank, meta, params, seed, count = SURFACE_OVERVIEW_SAMPLES) {
  const { rankW } = meta;
  const samples = meta.surfaceSamples ?? count;
  const step = Math.max(1, Math.floor((hiRank - loRank) / samples));
  const paths = [];
  for (let i = 0; i < samples; i++) {
    const rankIndex = Math.min(loRank + i * step, hiRank);
    const simIndex = rankW[rankIndex];
    const re = regeneratePath(params, seed, simIndex);
    paths.push(pathEntryFromRegen(re));
  }
  return paths;
}

export function buildDrilldownPaths(centerRank, meta, params, seed, count = SURFACE_DRILLDOWN_SAMPLES) {
  const { rankW, numSimulations: n } = meta;
  const { lo, hi } = expandRankWindow(centerRank, n, count);
  const sampleSeed = deriveSeed(seed >>> 0, centerRank);
  const ranks = sampleRanks(lo, hi, count, sampleSeed);
  const paths = ranks.map((rank) => {
    const simIndex = rankW[rank];
    const re = regeneratePath(params, seed, simIndex);
    return pathEntryFromRegen(re);
  });
  return { paths, lo, hi, centerRank };
}

// Resolve percentile slider values to rank indices using the same formula as packaging.
// P100 maps to the last valid rank (n − 1); percentileIndex(n, 1) would be n.
export function ranksForPercentileWindow(n, lowerPct, upperPct) {
  if (!(n > 0)) return { loRank: 0, hiRank: 0 };
  const clampRank = (pct) => Math.min(n - 1, Math.max(0, percentileIndex(n, pct / 100)));
  const loRank = clampRank(lowerPct);
  const hiRank = Math.max(loRank, clampRank(upperPct));
  return { loRank, hiRank };
}
