import { describe, it, expect } from 'vitest';
import {
  buildIrrScatterDataProfile,
  computeIrrScatterExtents,
  irrScatterVisibleCount,
  irrScatterZoomScale,
} from '../src/ui/charts/irrScatter.js';

function scatterFromPoints(points, requiredIrr = null) {
  const n = points.length;
  const avgReturn = new Float64Array(n);
  const irr = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    avgReturn[i] = points[i].x;
    irr[i] = points[i].y;
  }
  return { avgReturn, irr, requiredIrr };
}

describe('irrScatter zoom', () => {
  it('uses the default −4% to +8% window at slider center', () => {
    expect(irrScatterZoomScale(50)).toBe(1);
    const scatter = scatterFromPoints([
      { x: 0.02, y: 0.03 },
      { x: 0.04, y: 0.05 },
      { x: -0.02, y: -0.01 },
    ]);
    const profile = buildIrrScatterDataProfile(scatter);
    const extents = computeIrrScatterExtents(scatter, { zoomSlider: 50, band: null, dataProfile: profile });
    expect(extents.xMin).toBeCloseTo(-0.04);
    expect(extents.xMax).toBeCloseTo(0.08);
    expect(extents.yMin).toBeCloseTo(-0.04);
    expect(extents.yMax).toBeCloseTo(0.08);
  });

  it('zooms in toward the left end and out toward the right end', () => {
    const scatter = scatterFromPoints([
      { x: -0.02, y: -0.01 },
      { x: 0.02, y: 0.03 },
      { x: 0.06, y: 0.07 },
    ]);
    const profile = buildIrrScatterDataProfile(scatter);
    const defaultExtents = computeIrrScatterExtents(scatter, { zoomSlider: 50, band: null, dataProfile: profile });
    const zoomInExtents = computeIrrScatterExtents(scatter, { zoomSlider: 25, band: null, dataProfile: profile });
    const zoomOutExtents = computeIrrScatterExtents(scatter, { zoomSlider: 75, band: null, dataProfile: profile });
    const maxZoomOutExtents = computeIrrScatterExtents(scatter, { zoomSlider: 100, band: null, dataProfile: profile });
    const defaultSpan = defaultExtents.xMax - defaultExtents.xMin;
    expect(zoomInExtents.xMax - zoomInExtents.xMin).toBeLessThan(defaultSpan);
    expect(maxZoomOutExtents.xMax - maxZoomOutExtents.xMin).toBeGreaterThanOrEqual(
      zoomOutExtents.xMax - zoomOutExtents.xMin,
    );
  });

  it('eases zoom-in sensitivity near the left end with a square-root curve', () => {
    expect(irrScatterZoomScale(0)).toBe(4);
    expect(irrScatterZoomScale(100)).toBeCloseTo(0.25);
    const nearMaxZoom = irrScatterZoomScale(5);
    const quarterZoom = irrScatterZoomScale(25);
    expect(4 - nearMaxZoom).toBeLessThan(quarterZoom - 1);
  });

  it('reports how many paths the default window captures', () => {
    const scatter = scatterFromPoints([
      { x: 0.02, y: 0.03 },
      { x: 0.09, y: 0.03 },
      { x: 0.02, y: -0.05 },
    ]);
    const profile = buildIrrScatterDataProfile(scatter);
    expect(profile.finite).toBe(3);
    expect(profile.defaultVisiblePct).toBeCloseTo(33.333, 1);
    const extents = computeIrrScatterExtents(scatter, { zoomSlider: 50, band: null, dataProfile: profile });
    expect(irrScatterVisibleCount(scatter, extents)).toBe(1);
  });
});
