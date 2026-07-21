// Charts for the Plan Snapshot report.
// Theme-aware on screen (light/dark); the report UI re-renders everything with
// a forced-light palette before printing so a dark-mode PDF never wastes ink.

import { Chart } from './chartSetup.js';
import { formatK, formatPercent } from '../format.js';
import { MONEY_SCALE, ALLOCATION_LABELS, ALLOCATION_CHART_KEYS } from '../../state/scenario.js';
import { smoothColumnSeries } from './withdrawalHeatmap.js';
import { themeHex, themeTokens } from '../theme.js';

// Resolve the report palette for a mode. Print always uses 'light'.
// Exported so report.js can build matching HTML legends (colored dots next
// to labels) for the charts below that no longer draw their own legend.
export function paletteFor(dark) {
  const mode = dark ? 'dark' : 'light';
  return {
    dark,
    ink: themeHex('chrome.text-heading', mode),
    body: themeHex('chrome.text-body', mode),
    muted: themeHex('chrome.text-muted', mode),
    grid: themeHex('chrome.border-default', mode),
    plan: dark ? '#94a3b8' : '#9ca3af',
    accent: themeHex('chrome.accent', mode),
    // Teal secondary accent (reuses the P60 percentile hue) — keeps the
    // report's "vs. classic 4%" comparisons visually distinct from the
    // primary indigo accent used everywhere else.
    accentAlt: themeHex('percentile.p60', mode),
    success: themeHex('status.success', mode),
    // Darker green for the "On track" verdict tone — the standard success
    // green reads a little bright/saturated for a pill + donut that share a
    // card with a subtle accent-subtle background, so the on-track state uses
    // this deeper green for the pill, the donut's success ring, and the
    // matching hero "not depleted" number.
    successDeep: dark ? '#16a34a' : '#15803d',
    danger: themeHex('status.danger', mode),
    warn: themeHex('status.warn', mode),
    fail: dark ? '#334155' : '#d1d5db',
    classic: dark ? '#fbbf24' : '#f59e0b',
  };
}

/** "On track" / "Monitor" / "At risk" verdict tone for a given success rate.
 * Only the pill uses the deeper on-track green; the donut ring and hero
 * "not depleted" number stay on the standard (bright) success green so the
 * pill and the number/donut remain visually distinct. */
function verdictTone(successRate, pal) {
  if (successRate >= 0.9) return { label: 'On track', color: pal.successDeep };
  if (successRate >= 0.7) return { label: 'Monitor', color: pal.warn };
  return { label: 'At risk', color: pal.danger };
}

function destroyChart(canvas) {
  const existing = Chart.getChart(canvas);
  if (existing) existing.destroy();
}

function dprFor() {
  return Math.max(window.devicePixelRatio || 1, 2);
}

function chartCommon() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    plugins: {
      legend: { display: false },
      tooltip: { enabled: false },
    },
  };
}

/**
 * Withdrawal probability cloud for the Plan Snapshot. Opacity encodes
 * density; hue is three vibrant categories by plan delta (orange cut /
 * blue near-plan / green boost). Near-plan width is the run's Plan Risk
 * Tolerance (shortfallTolerance) as a fraction of that year's planned
 * withdrawal — the same fraction used for the lifetime on-plan rate.
 */
export function drawWithdrawalBand(canvas, band, { dark = false, shortfallTolerance = 0.05 } = {}) {
  if (!canvas || !band) return;
  destroyChart(canvas);
  const pal = paletteFor(dark);

  const cssW = canvas.clientWidth || 680;
  const cssH = canvas.clientHeight || 230;
  const dpr = dprFor();
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  const pad = { left: 52, right: 12, top: 12, bottom: 30 };
  const plotW = cssW - pad.left - pad.right;
  const plotH = cssH - pad.top - pad.bottom;
  const n = band.years.length;
  if (n === 0 || plotW <= 0 || plotH <= 0) return;

  let yMax = 0;
  for (let i = 0; i < n; i++) {
    yMax = Math.max(yMax, band.high[i] || 0, band.plan[i] || 0, band.median[i] || 0, band.classic?.[i] || 0);
  }
  yMax = yMax * 1.05 || 1;

  const xAt = (i) => pad.left + ((i + 0.5) / n) * plotW;
  const yAt = (v) => pad.top + plotH * (1 - Math.max(0, v) / yMax);

  // Near-plan band width: same Plan Risk Tolerance fraction used for the
  // lifetime "on plan" success rate (actual >= plan × (1 − tolerance)).
  // Here it means a year's withdrawal within ±tolerance of that year's
  // planned amount paints blue; outside that band is cut (orange) or
  // boost (green). Clamped to the setting's 0–35% range.
  const tol = Math.min(
    0.35,
    Math.max(0, Number.isFinite(shortfallTolerance) ? shortfallTolerance : 0.05),
  );

  // Density fill. The band is painted as one continuous field rather than
  // per-year rectangles so the P-low / P-high silhouette reads as a smooth
  // curve instead of year-column stairsteps. Design:
  //   1. Per-year soft (KDE) histograms capture each year's distribution
  //      between its [lo, hi] window.
  //   2. The raster is upsampled horizontally (vss sub-samples per year) and
  //      the lo/hi envelope is smoothed across years (1-2-1 + linear interp,
  //      the heatmap's smoothColumnSeries) so neighboring years blend into a
  //      continuous band outline.
  //   3. A short alpha feather near the local [lo, hi] edges softens the
  //      boundary so density fades out instead of hard-cutting at the band.
  //   4. Opacity encodes density; hue is three vibrant categories by plan
  //      delta (orange cut / blue near-plan / green boost) — not the
  //      heatmap's continuous spectrum.
  const bins = 128;
  const vss = 4; // horizontal sub-samples per year for the upsampled raster
  const rasterW = Math.max(1, n * vss);
  const rasterHeight = Math.max(1, Math.ceil(plotH));
  // Feather width (px) over which density fades at the local lo/hi edges.
  // Wider than the original so the silhouette softens more visibly.
  const featherPx = 14;

  // Per-year normalized density columns: counts[k] / maxCount, indexed
  // [year][bin]. Kept around so the upsample pass can interpolate between
  // years without recomputing histograms.
  const yearDensity = new Array(n);
  for (let i = 0; i < n; i++) {
    const lo = band.low[i];
    const hi = band.high[i];
    const col = band.columns?.[i];
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || !col || col.length === 0) {
      yearDensity[i] = null;
      continue;
    }
    // Soft (KDE-style) histogram: each sample is smeared across neighboring
    // bins with a triangular kernel instead of landing in a single bin. With
    // modest simulation counts a hard 1-sample-per-bin histogram is mostly
    // empty, which renders as faint horizontal streaks; the kernel produces a
    // smooth density field directly so the cloud reads as a continuous field
    // with a bright probable core and feathered edges.
    const counts = new Float32Array(bins);
    const kernelRadius = 1.5; // bins
    let maxCount = 1;
    for (let k = 0; k < col.length; k++) {
      const v = col[k];
      if (v < lo || v > hi) continue;
      const t = hi > lo ? (v - lo) / (hi - lo) : 0.5;
      const center = t * bins; // float bin position
      const b0 = Math.floor(center - kernelRadius);
      const b1 = Math.ceil(center + kernelRadius);
      for (let bb = b0; bb <= b1; bb++) {
        if (bb < 0 || bb >= bins) continue;
        const dist = Math.abs(bb + 0.5 - center);
        const w = Math.max(0, 1 - dist / kernelRadius);
        counts[bb] += w;
        if (counts[bb] > maxCount) maxCount = counts[bb];
      }
    }
    const norm = new Float32Array(bins);
    for (let b = 0; b < bins; b++) norm[b] = counts[b] / maxCount;
    yearDensity[i] = { lo, hi, norm };
  }

  // Smoothed + upsampled lo/hi envelope (in dollars), one value per raster
  // column. smoothColumnSeries is NaN-aware so horizon edges stay hard.
  const loSeries = smoothColumnSeries(Float64Array.from(band.low), vss);
  const hiSeries = smoothColumnSeries(Float64Array.from(band.high), vss);

  const densityCanvas = document.createElement('canvas');
  densityCanvas.width = rasterW;
  densityCanvas.height = rasterHeight;
  const densityContext = densityCanvas.getContext('2d');
  const densityImage = densityContext.createImageData(rasterW, rasterHeight);

  for (let col = 0; col < rasterW; col++) {
    // Which year this raster column falls in (year-center coordinates).
    const pos = (col + 0.5) / vss - 0.5;
    let j0 = Math.floor(pos);
    let frac = pos - j0;
    if (j0 < 0) { j0 = 0; frac = 0; }
    if (j0 >= n - 1) { j0 = n - 1; frac = 0; }
    const j1 = Math.min(n - 1, j0 + 1);
    const a = yearDensity[j0];
    const b = yearDensity[j1];
    let lo = loSeries[col];
    let hi = hiSeries[col];
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || (!a && !b)) continue;
    // Clamp the envelope to contain the raw median. The 1-2-1 envelope
    // smoothing can pull the high edge below the raw median (or the low edge
    // above it) at narrow percentile windows, which would leave the median
    // line floating above the cloud with no fill behind it. The median line
    // is drawn as straight segments between year centers, i.e. the linear
    // interpolation of band.median — so clamping each raster column to that
    // same interpolated median guarantees the fill always backs the line.
    const medRaw = (band.median[j0] || 0) + ((band.median[j1] || 0) - (band.median[j0] || 0)) * frac;
    if (Number.isFinite(medRaw)) {
      if (lo > medRaw) lo = medRaw;
      if (hi < medRaw) hi = medRaw;
      if (lo > hi) { lo = hi = medRaw; }
    }
    const plan = (band.plan[j0] || 0) + ((band.plan[j1] || 0) - (band.plan[j0] || 0)) * frac;

    for (let row = 0; row < rasterHeight; row++) {
      // Shared image row -> dollars so every column aligns to the same y.
      const value = yMax * (1 - (row + 0.5) / rasterHeight);
      if (value < lo || value > hi) continue;

      // Density at this (year, value). Each year's histogram is normalized
      // to that year's RAW [lo,hi], so the bin must be looked up in each
      // neighbor's own raw frame — using the smoothed envelope here would
      // read the density at a different dollar value and paint it in the
      // wrong place (e.g. lower-value density appearing above the median
      // when smoothing inflates the high edge).
      const loR0 = band.low[j0], hiR0 = band.high[j0];
      const loR1 = band.low[j1], hiR1 = band.high[j1];
      const t0 = hiR0 > loR0 ? (value - loR0) / (hiR0 - loR0) : 0.5;
      const t1 = hiR1 > loR1 ? (value - loR1) / (hiR1 - loR1) : 0.5;
      const bin0 = Math.min(bins - 1, Math.max(0, Math.floor(t0 * bins)));
      const bin1 = Math.min(bins - 1, Math.max(0, Math.floor(t1 * bins)));
      let d = 0;
      if (a && b) d = a.norm[bin0] + (b.norm[bin1] - a.norm[bin0]) * frac;
      else if (a) d = a.norm[bin0];
      else if (b) d = b.norm[bin1];
      if (d <= 0) continue;

      // Edge feather: smoothstep fade near the local lo/hi so the silhouette
      // softens instead of hard-cutting at the band boundary.
      const distLo = value - lo;
      const distHi = hi - value;
      const smoothstep = (x) => {
        const t = Math.min(1, Math.max(0, x));
        return t * t * (3 - 2 * t);
      };
      const edgeF = Math.min(smoothstep(distLo / featherPx), smoothstep(distHi / featherPx));

      // Two independent channels:
      //   opacity = density (how likely this withdrawal level is)
      //   hue     = plan delta as three vibrant categories (cut / near /
      //             boost), not the heatmap's continuous spectrum — so
      //             failed vs near-plan vs surplus reads at a glance.
      // Mild gamma keeps denser regions clearly more opaque without a
      // "hot ridge" that washes the rest of the cloud out.
      const dWeight = Math.pow(d, 0.85);

      // Vibrant categorical colors. Near-plan width is the run's Plan Risk
      // Tolerance as a fraction of that year's planned withdrawal (same
      // fraction as the lifetime on-plan check). Soft blend across that
      // band; poles stay full orange / green.
      const orange = dark ? [251, 146, 60] : [249, 115, 22];
      const blue = dark ? [96, 165, 250] : [59, 130, 246];
      const green = dark ? [74, 222, 128] : [34, 197, 94];
      const nearDollars = plan > 0 ? plan * tol : 0;
      const delta = value - plan;
      const lerpRgb = (a, b, t) => [
        Math.round(a[0] + (b[0] - a[0]) * t),
        Math.round(a[1] + (b[1] - a[1]) * t),
        Math.round(a[2] + (b[2] - a[2]) * t),
      ];
      let rgb;
      if (nearDollars <= 0) {
        rgb = delta < 0 ? orange : delta > 0 ? green : blue;
      } else if (delta <= -nearDollars) {
        rgb = orange;
      } else if (delta >= nearDollars) {
        rgb = green;
      } else if (delta < 0) {
        rgb = lerpRgb(orange, blue, smoothstep((delta + nearDollars) / nearDollars));
      } else {
        rgb = lerpRgb(blue, green, smoothstep(delta / nearDollars));
      }
      const [r, g, bl] = rgb;
      const pixel = (row * rasterW + col) * 4;
      densityImage.data[pixel] = r;
      densityImage.data[pixel + 1] = g;
      densityImage.data[pixel + 2] = bl;
      // Opacity encodes density only. Floor high enough that the whole
      // cloud is readable on the dark report background; denser bins go
      // toward full alpha so "more likely" areas clearly stand out.
      densityImage.data[pixel + 3] = Math.round((95 + 160 * dWeight) * edgeF);
    }
  }
  densityContext.putImageData(densityImage, 0, 0);
  // Blur the composited density when drawing it into the plot. With modest
  // simulation counts the per-year histogram is sparse (most bins empty), so
  // the raw raster can read as faint horizontal streaks rather than a smooth
  // field. A light blur merges those streaks into a continuous cloud, then
  // we reset the filter so the overlay strokes/axes below stay crisp.
  ctx.imageSmoothingEnabled = true;
  ctx.save();
  ctx.filter = 'blur(3px)';
  ctx.drawImage(densityCanvas, pad.left, pad.top, plotW, plotH);
  ctx.restore();

  // Depleted ($0) simulations: the density field above is clipped to the
  // [lo, hi] percentile window, so once the pLow percentile rises above zero
  // the depleted sims fall out of view and the red "depleted" legend swatch
  // has nothing backing it. Paint them explicitly as a red strip at the
  // bottom of each year, height proportional to that year's depletion share
  // (computed in the model from raw values, so deposit years are not mistaken
  // for depletion). Capped so a bad year never fills the whole plot.
  const colW = plotW / n;
  const maxStripH = plotH * 0.22;
  ctx.save();
  for (let i = 0; i < n; i++) {
    const frac = band.depletedFraction?.[i] || 0;
    if (frac <= 0) continue;
    const stripH = Math.max(2, frac * maxStripH);
    const x = xAt(i) - colW / 2;
    // Solid bottom edge (matches the heatmap's bright depletion red) fading
    // upward so the strip reads as density, not a flat bar.
    const grad = ctx.createLinearGradient(0, pad.top + plotH - stripH, 0, pad.top + plotH);
    grad.addColorStop(0, 'rgba(220, 38, 38, 0.15)');
    grad.addColorStop(1, 'rgba(220, 38, 38, 0.9)');
    ctx.fillStyle = grad;
    ctx.fillRect(x, pad.top + plotH - stripH, colW, stripH);
  }
  ctx.restore();

  const strokePath = (series) => {
    ctx.beginPath();
    let started = false;
    for (let i = 0; i < n; i++) {
      const v = series[i];
      if (!Number.isFinite(v)) continue;
      const x = xAt(i);
      const y = yAt(v);
      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
  };

  // Median + plan overlays. The smoothed density fill already traces the
  // P-low / P-high envelope, so explicit band-edge whiskers are not drawn —
  // they competed with the fill and read as noise on the silhouette.

  // Median withdrawal line in green (status.success) — a secondary reference
  // path through the density field. Thinner and lower-alpha than the plan line
  // so the planned schedule reads as the hero of this chart.
  ctx.globalAlpha = 0.7;
  ctx.strokeStyle = pal.success;
  ctx.lineWidth = 1.25;
  ctx.setLineDash([3, 3]);
  strokePath(band.median);
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;

  // Planned schedule — the hero line. Dashed blue, same weight as the median
  // so the two reference paths read as a matched pair layered over the density
  // field the band is anchored to (cut < plan < boost). A darker, more saturated
  // blue from the same hue family as the density cloud so the line and the
  // cloud read as one series (line = dark blue, cloud = light blue).
  ctx.strokeStyle = dark ? '#3b82f6' : '#1d4ed8';
  ctx.lineWidth = 1.25;
  ctx.setLineDash([4, 3]);
  strokePath(band.plan);
  ctx.setLineDash([]);

  // Classic 4% rule: a light dotted reference line (flat start × 4% every year).
  // Same solid teal (accentAlt) as the "4% rule" bar in the comparison mini
  // charts so the two visuals read as the same series.
  if (band.classic) {
    ctx.strokeStyle = pal.accentAlt;
    ctx.lineWidth = 1;
    ctx.setLineDash([1, 3]);
    strokePath(band.classic);
    ctx.setLineDash([]);
  }

  // Axes + ticks
  ctx.strokeStyle = pal.grid;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(pad.left, pad.top);
  ctx.lineTo(pad.left, pad.top + plotH);
  ctx.lineTo(pad.left + plotW, pad.top + plotH);
  ctx.stroke();

  ctx.fillStyle = pal.muted;
  ctx.font = 'bold 11px system-ui, sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  const ticks = 4;
  for (let t = 0; t <= ticks; t++) {
    const v = (yMax * t) / ticks;
    ctx.fillText(formatK(v) || '0', pad.left - 4, yAt(v));
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const xStep = Math.max(1, Math.floor(n / 6));
  for (let i = 0; i < n; i += xStep) {
    ctx.fillText(String(band.years[i]), xAt(i), pad.top + plotH + 6);
  }
  ctx.font = 'bold 10px system-ui, sans-serif';
  ctx.fillText('Year', pad.left + plotW / 2, cssH - 12);
}

export function drawBalanceFan(canvas, fan, { dark = false } = {}) {
  if (!canvas || !fan) return;
  destroyChart(canvas);
  const pal = paletteFor(dark);
  const labels = fan.years.map((y) => String(y));

  const sanitize = (arr) => arr.map((v) => {
    if (!Number.isFinite(v) || v < 0) return null;
    return v;
  });

  const fanStroke = dark ? 'rgba(129, 140, 248, 0.4)' : 'rgba(79, 70, 229, 0.35)';
  const fanFill = dark ? 'rgba(129, 140, 248, 0.15)' : 'rgba(79, 70, 229, 0.10)';

  new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: fan.highLabel,
          data: sanitize(fan.high),
          borderColor: fanStroke,
          backgroundColor: fanFill,
          fill: '+1',
          pointRadius: 0,
          borderWidth: 1,
          tension: 0.2,
        },
        {
          label: fan.lowLabel,
          data: sanitize(fan.low),
          borderColor: fanStroke,
          backgroundColor: fanFill,
          fill: false,
          pointRadius: 0,
          borderWidth: 1,
          tension: 0.2,
        },
        {
          label: 'Median',
          data: sanitize(fan.median),
          borderColor: pal.ink,
          backgroundColor: 'transparent',
          fill: false,
          pointRadius: 0,
          borderWidth: 2,
          tension: 0.2,
        },
      ],
    },
    options: {
      ...chartCommon(),
      scales: {
        x: {
          ticks: { maxTicksLimit: 8, color: pal.muted, font: { size: 10 } },
          grid: { color: pal.grid },
        },
        y: {
          beginAtZero: true,
          min: 0,
          ticks: {
            color: pal.muted,
            font: { size: 10 },
            callback: (v) => formatK(v) || '',
          },
          grid: { color: pal.grid },
        },
      },
    },
  });
}

/**
 * Concentric outcome gauges. The outer ring shows simulations that avoided
 * depletion; the inner ring shows simulations that also stayed on plan.
 * Keeping both rates in one compact chart makes the right-side bento column
 * readable without duplicating the verdict prose.
 */
export function drawSuccessDonut(canvas, { successRate, onPlanRate }, { dark = false } = {}) {
  if (!canvas) return;
  destroyChart(canvas);
  const pal = paletteFor(dark);
  const success = Math.min(1, Math.max(0, successRate ?? 0));
  const onPlan = Math.min(1, Math.max(0, onPlanRate ?? 0));

  // No center text: the hero stat card already shows the big "not depleted"
  // number, so repeating it inside the donut would be a third copy. The two
  // rings carry both rates on their own.

  // The "remainder" fill (depleted share / off-plan share) uses the verdict
  // pill's tone color, so the donut's dark segment visually echoes the
  // On track / Monitor / At risk pill next to it instead of a flat grey.
  const toneColor = verdictTone(success, pal).color;

  new Chart(canvas, {
    type: 'doughnut',
    data: {
      datasets: [
        {
          data: [success, 1 - success],
          backgroundColor: [pal.success, toneColor],
          borderWidth: 0,
          weight: 1,
        },
        {
          data: [onPlan, 1 - onPlan],
          backgroundColor: [pal.accent, toneColor],
          borderWidth: 0,
          weight: 1,
        },
      ],
    },
    options: {
      ...chartCommon(),
      cutout: '52%',
      // No legend: the two big numbers next to the donut are colored to match
      // each ring, so the labels would only repeat "87% / 71%" a third time.
      plugins: {
        ...chartCommon().plugins,
        legend: { display: false },
      },
    },
  });
}

/**
 * Hero verdict stats — two big numbers given equal weight: "not depleted"
 * (successRate) and "on plan" (onPlanRate), plus an On track / Monitor /
 * At risk pill driven by the success rate. The detailed rates also live in
 * the donut, so this is the single large-format presentation of both.
 *
 * @param {{number: HTMLElement, onPlanNumber: HTMLElement, onPlanLabel?: HTMLElement, pill: HTMLElement}} els
 */
export function renderSuccessHero(els, { successRate, onPlanRate, shortfallTolerance }, { dark = false } = {}) {
  if (!els) return;
  const pal = paletteFor(dark);
  const success = Math.min(1, Math.max(0, successRate ?? 0));
  const onPlan = Math.min(1, Math.max(0, onPlanRate ?? 0));
  const tone = verdictTone(success, pal);

  if (els.number) {
    els.number.textContent = formatPercent(success, 0) || '—';
    // Match the donut's outer ring (not depleted = success/green) so the big
    // number and the ring read as one figure. Kept bright (standard success
    // green) even when on-track so the number/donut stay visually distinct
    // from the darker on-track pill.
    els.number.style.color = pal.success;
  }
  if (els.onPlanNumber) {
    els.onPlanNumber.textContent = formatPercent(onPlan, 0) || '—';
    // Match the donut's inner ring (on plan = accent/purple).
    els.onPlanNumber.style.color = pal.accent;
  }
  // Same wording as the main results "Success Rate (within X% of plan)" card —
  // Plan Risk Tolerance is the shortfall fraction baked into the on-plan rate.
  if (els.onPlanLabel) {
    const tol = Number.isFinite(shortfallTolerance) ? shortfallTolerance : 0.05;
    const tolerancePct = Math.round(Math.min(0.35, Math.max(0, tol)) * 100);
    els.onPlanLabel.textContent = `within ${tolerancePct}% of plan`;
  }

  if (els.pill) {
    els.pill.textContent = tone.label;
    els.pill.style.color = tone.color;
    els.pill.style.borderColor = tone.color;
  }
}

export function drawFourPctMetric(canvas, metric, fourPct, { dark = false } = {}) {
  if (!canvas) return;
  destroyChart(canvas);
  if (!fourPct) {
    canvas.style.display = 'none';
    return;
  }
  canvas.style.display = '';
  const pal = paletteFor(dark);

  // Each metric gets its own honest scale: 'spend' is median spend in $k,
  // 'survival' is survival in %. The old drawFourPctBars forced both onto one
  // shared axis, which misrepresented whichever metric was smaller.
  let userVal;
  let classicVal;
  if (metric === 'spend') {
    userVal = (fourPct.userPrimary ?? fourPct.userSpend) / MONEY_SCALE;
    classicVal = (fourPct.classicPrimary ?? fourPct.classicSpend) / MONEY_SCALE;
  } else {
    userVal = (fourPct.userSurvival ?? 0) * 100;
    classicVal = (fourPct.classicSurvival ?? 0) * 100;
  }

  new Chart(canvas, {
    type: 'bar',
    data: {
      labels: ['Your plan', '4% rule'],
      datasets: [
        {
          data: [userVal, classicVal],
          backgroundColor: [pal.accent, pal.accentAlt],
          borderWidth: 0,
          borderRadius: 4,
          borderSkipped: false,
          barPercentage: 0.7,
          categoryPercentage: 0.8,
        },
      ],
    },
    options: {
      ...chartCommon(),
      indexAxis: 'y',
      scales: {
        x: {
          beginAtZero: true,
          ticks: { color: pal.muted, font: { size: 9 }, maxTicksLimit: 4 },
          grid: { color: pal.grid },
        },
        y: {
          // autoSkip off so both category labels ("Your plan" + "4% rule") always
          // render next to their bars, even on the short 0.7in mini chart.
          // "Your plan" stays bold; "4% rule" is unbolded (weight 400) per request.
          ticks: {
            color: pal.ink,
            font: (ctx) => ({ size: 9, weight: ctx.tick && ctx.tick.index === 0 ? '600' : '400' }),
            autoSkip: false,
          },
          grid: { display: false },
        },
      },
    },
  });
}

export function drawDepletionStrip(canvas, depletion, { dark = false } = {}) {
  if (!canvas || !depletion) return;
  destroyChart(canvas);
  const pal = paletteFor(dark);
  const labels = depletion.counts.map((_, i) => String(i + 1));
  new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        data: depletion.counts,
        backgroundColor: pal.danger,
        borderWidth: 0,
        borderRadius: 3,
        borderSkipped: false,
      }],
    },
    options: {
      ...chartCommon(),
      scales: {
        x: {
          title: { display: true, text: 'Year', color: pal.muted, font: { size: 10 } },
          ticks: { maxTicksLimit: 8, color: pal.muted, font: { size: 9 } },
          grid: { display: false },
        },
        y: {
          beginAtZero: true,
          ticks: { color: pal.muted, font: { size: 9 }, precision: 0 },
          grid: { color: pal.grid },
        },
      },
    },
  });
}

export function drawAllocationDonut(canvas, allocation, { dark = false } = {}) {
  if (!canvas || !allocation?.sleeves) return;
  destroyChart(canvas);
  const pal = paletteFor(dark);
  const sleeves = allocation.sleeves.filter((s) => s.pct > 0);
  if (sleeves.length === 0) return;

  const centerText = {
    id: 'reportAllocationCenter',
    afterDraw(chart) {
      const { ctx, chartArea } = chart;
      if (!chartArea) return;
      const cx = (chartArea.left + chartArea.right) / 2;
      const cy = (chartArea.top + chartArea.bottom) / 2;
      ctx.save();
      ctx.fillStyle = pal.ink;
      ctx.font = 'bold 13px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${allocation.stocksPct ?? Math.round(sleeves.reduce((s, x) => s + x.pct, 0))}%`, cx, cy - 4);
      ctx.font = '7px system-ui, sans-serif';
      ctx.fillStyle = pal.muted;
      ctx.fillText('stocks', cx, cy + 8);
      ctx.restore();
    },
  };

  new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: sleeves.map((s) => ALLOCATION_LABELS[s.key] || s.key),
      datasets: [{
        data: sleeves.map((s) => s.pct),
        // Same asset colors as the allocation preview / sparklines.
        backgroundColor: sleeves.map(
          (s) => themeTokens.chartAssets[ALLOCATION_CHART_KEYS[s.key]] || pal.muted,
        ),
        borderWidth: 2,
        borderColor: pal.dark ? '#0f172a' : '#ffffff',
      }],
    },
    options: {
      ...chartCommon(),
      cutout: '62%',
    },
    plugins: [centerText],
  });
}

/** Legend swatches to pair with drawAllocationDonut. */
export function allocationLegendItems(allocation, dark) {
  const pal = paletteFor(dark);
  const sleeves = allocation?.sleeves?.filter((s) => s.pct > 0) || [];
  return sleeves.map((s) => ({
    label: `${ALLOCATION_LABELS[s.key] || s.key} ${Math.round(s.pct)}%`,
    color: themeTokens.chartAssets[ALLOCATION_CHART_KEYS[s.key]] || pal.muted,
  }));
}
