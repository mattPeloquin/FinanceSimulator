// Thumbnail snapshots for collapsed results chart accordions.
// Captures a PNG from each chart after a successful draw so the <summary>
// can preview the chart while the section is closed. Uses the current
// light/dark theme fill — never a forced print/light palette.

import { Chart } from './chartSetup.js';

const CHART_THUMB_IDS = {
  'details-surface-chart': 'surfaceChartThumb',
  'details-withdrawal-heatmap': 'withdrawalHeatmapThumb',
  'details-irr-scatter': 'irrScatterThumb',
  'details-average-timelines': 'averageTimelinesThumb',
  'details-return-distribution': 'returnDistributionThumb',
  'details-plan-report': 'planReportThumb',
  // Parent of nested timeline charts — must open for layout when capturing thumbs.
  'details-simulation-outcomes': null,
};

/** Default / scatter zoom. Surface & heatmap use a tighter crop. */
const THUMB_ZOOM = 1.7;
const THUMB_ZOOM_TIGHT = 2.6;
const THUMB_W = 144;
const THUMB_H = 64;

/** When true, accordion toggle handlers must not write to sor:ui-accordions. */
export let suppressAccordionPersist = false;

/**
 * Temporarily open any closed chart details so canvases get a real layout,
 * run `fn`, then restore prior open state without persisting the flash.
 */
export async function withChartDetailsLaidOut(fn) {
  const detailsList = Object.keys(CHART_THUMB_IDS)
    .map((id) => document.getElementById(id))
    .filter(Boolean);
  const prior = detailsList.map((el) => el.open);
  const needOpen = detailsList.some((el, i) => !prior[i]);
  if (needOpen) {
    suppressAccordionPersist = true;
    detailsList.forEach((el) => {
      el.open = true;
    });
    // Two frames: one for details to apply layout, one for paint geometry.
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  }
  try {
    return await fn();
  } finally {
    if (needOpen) {
      detailsList.forEach((el, i) => {
        el.open = prior[i];
      });
      suppressAccordionPersist = false;
    }
  }
}

function setThumb(imgId, dataUrl) {
  const img = document.getElementById(imgId);
  if (!img || !dataUrl) return;
  img.src = dataUrl;
  img.hidden = false;
}

function pageFillStyle() {
  const page = getComputedStyle(document.documentElement).getPropertyValue('--theme-page').trim();
  return page ? `rgb(${page})` : '#ffffff';
}

/**
 * Draw a zoomed center crop of `source` into `ctx` covering the full dest rect.
 * zoom > 1 crops into the middle of the source (optical zoom-in). zoom = 1 is full frame.
 */
function drawZoomed(ctx, source, dx, dy, dw, dh, zoom = THUMB_ZOOM) {
  const sw = source.width || source.naturalWidth;
  const sh = source.height || source.naturalHeight;
  if (!sw || !sh) return;
  const z = Math.max(1, zoom);
  const cropW = sw / z;
  const cropH = sh / z;
  const sx = (sw - cropW) / 2;
  const sy = (sh - cropH) / 2;
  ctx.drawImage(source, sx, sy, cropW, cropH, dx, dy, dw, dh);
}

/**
 * Fit the full source into the dest rect with letterbox padding (optical zoom-out).
 * `fit` is the fraction of the dest used by content (rest is page-color margin).
 */
function drawFitted(ctx, source, dx, dy, dw, dh, fit = 0.72) {
  const sw = source.width || source.naturalWidth;
  const sh = source.height || source.naturalHeight;
  if (!sw || !sh) return;
  const f = Math.min(1, Math.max(0.2, fit));
  const maxW = dw * f;
  const maxH = dh * f;
  const scale = Math.min(maxW / sw, maxH / sh);
  const tw = sw * scale;
  const th = sh * scale;
  const tx = dx + (dw - tw) / 2;
  const ty = dy + (dh - th) / 2;
  ctx.drawImage(source, 0, 0, sw, sh, tx, ty, tw, th);
}

/** Resolve a drawable canvas, resizing Chart.js instances that painted at 0×0. */
function resolveSourceCanvas(canvas) {
  if (!canvas) return null;
  const chart = Chart.getChart(canvas);
  if (chart) {
    chart.resize();
    return chart.canvas || canvas;
  }
  return canvas;
}

/** Downscale a source canvas into a thumb PNG. */
function captureCanvasThumb(
  sourceCanvas,
  imgId,
  { zoom = THUMB_ZOOM, fit = null, cssW = THUMB_W, cssH = THUMB_H } = {},
) {
  const source = resolveSourceCanvas(sourceCanvas);
  if (!source || source.width < 2 || source.height < 2) return;
  const out = document.createElement('canvas');
  out.width = cssW;
  out.height = cssH;
  const ctx = out.getContext('2d');
  if (!ctx) return;
  ctx.fillStyle = pageFillStyle();
  ctx.fillRect(0, 0, cssW, cssH);
  if (fit != null) {
    drawFitted(ctx, source, 0, 0, cssW, cssH, fit);
  } else {
    drawZoomed(ctx, source, 0, 0, cssW, cssH, zoom);
  }
  setThumb(imgId, out.toDataURL('image/png'));
}

export function captureHeatmapThumb() {
  captureCanvasThumb(
    document.getElementById('withdrawalHeatmapCanvas'),
    'withdrawalHeatmapThumb',
    { zoom: THUMB_ZOOM_TIGHT },
  );
}

export function captureIrrScatterThumb() {
  captureCanvasThumb(document.getElementById('irrScatterCanvas'), 'irrScatterThumb');
}

/** Combined Average Timelines preview (balance chart, no zoom crop). */
export function captureTimelinesThumb() {
  captureCanvasThumb(
    document.getElementById('balanceChart'),
    'averageTimelinesThumb',
    { zoom: 1 },
  );
}

export function captureDistributionThumb() {
  captureCanvasThumb(
    document.getElementById('resultsChart'),
    'returnDistributionThumb',
    { zoom: 1.35 },
  );
}

/** Plan Snapshot hero band — zoomed out with letterbox so the full page reads. */
export function captureReportThumb() {
  captureCanvasThumb(
    document.getElementById('reportBandCanvas'),
    'planReportThumb',
    { fit: 0.72 },
  );
}
export async function captureSurfaceThumb() {
  const { getSurfaceChartDataURL } = await import('./surface3d.js');
  const dataUrl = getSurfaceChartDataURL({
    pixelRatio: 1,
    backgroundColor: pageFillStyle(),
  });
  if (!dataUrl) return;
  await new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const out = document.createElement('canvas');
      out.width = THUMB_W;
      out.height = THUMB_H;
      const ctx = out.getContext('2d');
      if (ctx) {
        ctx.fillStyle = pageFillStyle();
        ctx.fillRect(0, 0, THUMB_W, THUMB_H);
        drawZoomed(ctx, img, 0, 0, THUMB_W, THUMB_H, THUMB_ZOOM_TIGHT);
        setThumb('surfaceChartThumb', out.toDataURL('image/png'));
      }
      resolve();
    };
    img.onerror = () => resolve();
    img.src = dataUrl;
  });
}

/** Resize/redraw hooks when a chart accordion is opened by the user. */
export function onChartDetailsOpened(detailsId) {
  if (detailsId === 'details-surface-chart') {
    import('./surface3d.js').then(({ resizeSurfaceChart }) => resizeSurfaceChart());
  }
}
