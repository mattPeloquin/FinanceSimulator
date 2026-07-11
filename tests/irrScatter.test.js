import { describe, it, expect } from 'vitest';
import {
  buildIrrScatterDataProfile,
  computeIrrScatterExtents,
  chooseIrrScatterTooltipPosition,
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

function tipContains(pos, tipW, tipH, x, y, clear = 0) {
  return (
    pos.left < x + clear
    && pos.left + tipW > x - clear
    && pos.top < y + clear
    && pos.top + tipH > y - clear
  );
}

describe('chooseIrrScatterTooltipPosition', () => {
  const base = {
    tipW: 160,
    tipH: 80,
    canvasW: 800,
    canvasH: 400,
    pointX: 400,
    pointY: 200,
  };

  it('defaults to the north-east corner of the data point', () => {
    const pos = chooseIrrScatterTooltipPosition({
      ...base,
      cursorX: 390,
      cursorY: 210,
    });
    expect(pos.side).toBe('ne');
    expect(pos.left).toBeGreaterThan(base.pointX);
    expect(pos.top + base.tipH).toBeLessThanOrEqual(base.pointY);
  });

  it('keeps a sticky side while the cursor crosses successive nearby points', () => {
    const first = chooseIrrScatterTooltipPosition({
      ...base,
      pointX: 400,
      cursorX: 398,
      cursorY: 200,
    });
    expect(first.side).toBe('ne');

    // Cursor now sits to the right of the next point — without stickiness that
    // used to flip the tip to the west side and flash while sweeping.
    const second = chooseIrrScatterTooltipPosition({
      ...base,
      pointX: 420,
      cursorX: 425,
      cursorY: 200,
      stickySide: first.side,
    });
    expect(second.side).toBe('ne');
    expect(second.left).toBeGreaterThan(420);
  });

  it('never covers the pointer or the selected data point', () => {
    const cases = [
      { cursorX: 395, cursorY: 205 },
      { cursorX: 405, cursorY: 195 },
      { cursorX: 400, cursorY: 200 },
      { cursorX: 50, cursorY: 50 },
      { cursorX: 750, cursorY: 350 },
    ];
    for (const cursor of cases) {
      const pos = chooseIrrScatterTooltipPosition({ ...base, ...cursor });
      expect(tipContains(pos, base.tipW, base.tipH, cursor.cursorX, cursor.cursorY, 18)).toBe(false);
      expect(tipContains(pos, base.tipW, base.tipH, base.pointX, base.pointY, 5.5)).toBe(false);
    }
  });

  it('stays inside the canvas bounds', () => {
    const pos = chooseIrrScatterTooltipPosition({
      ...base,
      pointX: 20,
      pointY: 20,
      cursorX: 15,
      cursorY: 15,
    });
    expect(pos.left).toBeGreaterThanOrEqual(4);
    expect(pos.top).toBeGreaterThanOrEqual(4);
    expect(pos.left + base.tipW).toBeLessThanOrEqual(base.canvasW - 4);
    expect(pos.top + base.tipH).toBeLessThanOrEqual(base.canvasH - 4);
  });
});

describe('irrScatter zoom', () => {
  it('uses the default −4% to +8% window at slider center', () => {
    expect(irrScatterZoomScale(50)).toBe(1);
    const scatter = scatterFromPoints([
      { x: 0.02, y: 0.03 },
      { x: 0.04, y: 0.05 },
      { x: -0.02, y: -0.01 },
    ]);
    const profile = buildIrrScatterDataProfile(scatter);
    const extents = computeIrrScatterExtents(scatter, { zoomSlider: 50, dataProfile: profile });
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
    const defaultExtents = computeIrrScatterExtents(scatter, { zoomSlider: 50, dataProfile: profile });
    const zoomInExtents = computeIrrScatterExtents(scatter, { zoomSlider: 25, dataProfile: profile });
    const zoomOutExtents = computeIrrScatterExtents(scatter, { zoomSlider: 75, dataProfile: profile });
    const maxZoomOutExtents = computeIrrScatterExtents(scatter, { zoomSlider: 100, dataProfile: profile });
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
    const extents = computeIrrScatterExtents(scatter, { zoomSlider: 50, dataProfile: profile });
    expect(irrScatterVisibleCount(scatter, extents)).toBe(1);
  });
});
