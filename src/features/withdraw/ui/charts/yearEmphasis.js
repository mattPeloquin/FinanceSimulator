// Early-year row emphasis shared by the withdrawal heatmap and 3D surface.
// At slider 100 the first year band is maxRatio× the last band
// (exponentially graded in between). Default mid-point (50) is roughly half that stretch.

export const EMPHASIS_MAX_RATIO = 5;
export const EMPHASIS_DEFAULT = 50;
// 3D surface uses a gentler ceiling (two notches below the heatmap max).
export const SURFACE_EMPHASIS_MAX_RATIO = 3;

// Returns cumulative bounds [0..1] for `numYears` bands (indices 0..numYears-1).
// emphasis 0 is a uniform grid; higher values stretch early bands.
export function heatmapRowLayout(numYears, emphasis, maxRatio = EMPHASIS_MAX_RATIO) {
  const e = Math.max(0, Math.min(100, emphasis || 0));
  const ratio = 1 + (e / 100) * (maxRatio - 1);
  const decay = numYears > 1 ? Math.log(ratio) / (numYears - 1) : 0;
  const bounds = new Float64Array(numYears + 1);
  let total = 0;
  for (let j = 0; j < numYears; j++) total += Math.exp(-decay * j);
  let acc = 0;
  for (let j = 0; j < numYears; j++) {
    acc += Math.exp(-decay * j) / total;
    bounds[j + 1] = acc;
  }
  bounds[numYears] = 1;
  return bounds;
}

// Map a display-Y data coordinate (0..numYears) back to a year index using
// the same cumulative layout that placed the bars.
export function yearAtDisplayCoord(displayCoord, layout, numYears) {
  if (!layout || numYears <= 0) return Math.round(displayCoord);
  const frac = Math.max(0, Math.min(1, displayCoord / numYears));
  const numRows = layout.length - 1;
  for (let y = 0; y < numRows; y++) {
    if (frac < layout[y + 1] || y === numRows - 1) return y;
  }
  return numRows - 1;
}
