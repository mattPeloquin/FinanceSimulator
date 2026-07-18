// Charts for the Plan Snapshot report.
// Theme-aware on screen (light/dark); the report UI re-renders everything with
// a forced-light palette before printing so a dark-mode PDF never wastes ink.

import { Chart } from './chartSetup.js';
import { formatK, formatPercent } from '../format.js';
import { MONEY_SCALE, ALLOCATION_LABELS, ALLOCATION_CHART_KEYS } from '../../state/scenario.js';
import { niceBalanceLogFloor } from './timeline.js';
import { cellRgb, belowArmEnd } from './withdrawalHeatmap.js';
import { themeHex, themeTokens } from '../theme.js';

// Resolve the report palette for a mode. Print always uses 'light'.
function paletteFor(dark) {
  const mode = dark ? 'dark' : 'light';
  return {
    dark,
    ink: themeHex('chrome.text-heading', mode),
    body: themeHex('chrome.text-body', mode),
    muted: themeHex('chrome.text-muted', mode),
    grid: themeHex('chrome.border-default', mode),
    plan: dark ? '#94a3b8' : '#9ca3af',
    accent: themeHex('chrome.accent', mode),
    success: themeHex('status.success', mode),
    danger: themeHex('status.danger', mode),
    fail: dark ? '#334155' : '#d1d5db',
    classic: dark ? '#fbbf24' : '#f59e0b',
  };
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
 * Heat-colored withdrawal band. Colors match the Withdrawal Heatmap's
 * plan-anchored diverging spectrum: burnt orange = below plan (cut),
 * indigo-gray = on plan, teal = above plan (boost), bright red = depleted ($0).
 * Opacity encodes density — how many simulations spend at that level that year.
 */
export function drawWithdrawalBand(canvas, band, { dark = false } = {}) {
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

  const pad = { left: 48, right: 12, top: 10, bottom: 28 };
  const plotW = cssW - pad.left - pad.right;
  const plotH = cssH - pad.top - pad.bottom;
  const n = band.years.length;
  if (n === 0 || plotW <= 0 || plotH <= 0) return;

  let yMax = 0;
  for (let i = 0; i < n; i++) {
    yMax = Math.max(yMax, band.high[i] || 0, band.plan[i] || 0, band.median[i] || 0);
  }
  yMax = yMax * 1.05 || 1;

  const xAt = (i) => pad.left + ((i + 0.5) / n) * plotW;
  const yAt = (v) => pad.top + plotH * (1 - Math.max(0, v) / yMax);

  // Asymmetric diverging domain vs plan, matching the heatmap's convention:
  // lo = deepest cut below plan (stored positive), hi = biggest boost above.
  let deepestCut = 0;
  let biggestBoost = 0;
  for (let i = 0; i < n; i++) {
    const plan = band.plan[i] || 0;
    if (Number.isFinite(band.low[i])) deepestCut = Math.max(deepestCut, plan - band.low[i]);
    if (Number.isFinite(band.high[i])) biggestBoost = Math.max(biggestBoost, band.high[i] - plan);
  }
  const domain = { lo: Math.max(1, deepestCut), hi: Math.max(1, biggestBoost) };
  // Guard against degenerate all-on-plan data (belowArmEnd needs a usable arm).
  if (belowArmEnd(domain) <= 0) domain.lo = 1;

  // Density fill: per-year vertical bins between low and high, each bin colored
  // by its dollar level vs plan (heatmap diverging scale) with alpha = density.
  const bins = 64;
  for (let i = 0; i < n; i++) {
    const lo = band.low[i];
    const hi = band.high[i];
    const col = band.columns?.[i];
    const plan = band.plan[i] || 0;
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || !col || col.length === 0) continue;

    const counts = new Uint16Array(bins);
    let maxCount = 1;
    for (let k = 0; k < col.length; k++) {
      const v = col[k];
      if (v < lo || v > hi) continue;
      const t = hi > lo ? (v - lo) / (hi - lo) : 0.5;
      const b = Math.min(bins - 1, Math.max(0, Math.floor(t * bins)));
      counts[b]++;
      if (counts[b] > maxCount) maxCount = counts[b];
    }

    const colImg = ctx.createImageData(1, bins);
    for (let b = 0; b < bins; b++) {
      if (counts[b] === 0) continue;
      // Bin midpoint in dollars → heatmap cell color anchored on this year's plan.
      const binValue = hi > lo ? lo + ((b + 0.5) / bins) * (hi - lo) : lo;
      const [r, g, bl] = cellRgb(binValue < 1 ? 0 : binValue, binValue - plan, domain, dark);
      // ImageData row 0 is the top of the column; bin 0 is the LOW dollar end.
      const row = bins - 1 - b;
      const pix = row * 4;
      colImg.data[pix] = r;
      colImg.data[pix + 1] = g;
      colImg.data[pix + 2] = bl;
      colImg.data[pix + 3] = Math.round(70 + 185 * (counts[b] / maxCount));
    }

    const off = document.createElement('canvas');
    off.width = 1;
    off.height = bins;
    off.getContext('2d').putImageData(colImg, 0, 0);
    const x0 = pad.left + (i / n) * plotW;
    const x1 = pad.left + ((i + 1) / n) * plotW;
    const yHi = yAt(hi);
    const yLo = yAt(lo);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(off, x0, yHi, x1 - x0, Math.max(1, yLo - yHi));
  }

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

  // Band edge whiskers (subtle), then median + plan overlays.
  ctx.globalAlpha = 0.45;
  ctx.strokeStyle = pal.muted;
  ctx.lineWidth = 1;
  strokePath(band.low);
  strokePath(band.high);
  ctx.globalAlpha = 1;

  ctx.strokeStyle = pal.ink;
  ctx.lineWidth = 2;
  strokePath(band.median);

  ctx.strokeStyle = pal.plan;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 3]);
  strokePath(band.plan);
  ctx.setLineDash([]);

  // Axes + ticks
  ctx.strokeStyle = pal.grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad.left, pad.top);
  ctx.lineTo(pad.left, pad.top + plotH);
  ctx.lineTo(pad.left + plotW, pad.top + plotH);
  ctx.stroke();

  ctx.fillStyle = pal.muted;
  ctx.font = '10px system-ui, sans-serif';
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
  ctx.fillText('Year', pad.left + plotW / 2, cssH - 12);
}

export function drawBalanceFan(canvas, fan, { dark = false } = {}) {
  if (!canvas || !fan) return;
  destroyChart(canvas);
  const pal = paletteFor(dark);
  const labels = fan.years.map((y) => String(y));
  const startBal = fan.median.find((v) => Number.isFinite(v) && v > 0) || 100000;
  const logFloor = niceBalanceLogFloor(startBal);

  const sanitize = (arr) => arr.map((v) => {
    if (!Number.isFinite(v) || v <= 0) return null;
    return Math.max(v, logFloor);
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
          ticks: { maxTicksLimit: 8, color: pal.muted, font: { size: 9 } },
          grid: { color: pal.grid },
        },
        y: {
          type: 'logarithmic',
          min: logFloor,
          ticks: {
            color: pal.muted,
            font: { size: 9 },
            callback: (v) => formatK(v) || '',
          },
          grid: { color: pal.grid },
        },
      },
    },
  });
}

export function drawSuccessDonut(canvas, { successRate, onPlanRate }, { dark = false } = {}) {
  if (!canvas) return;
  destroyChart(canvas);
  const pal = paletteFor(dark);
  const success = Math.min(1, Math.max(0, successRate ?? 0));
  const onPlan = Math.min(1, Math.max(0, onPlanRate ?? 0));

  const centerText = {
    id: 'reportSuccessCenter',
    afterDraw(chart) {
      const { ctx, chartArea } = chart;
      if (!chartArea) return;
      const cx = (chartArea.left + chartArea.right) / 2;
      const cy = (chartArea.top + chartArea.bottom) / 2;
      ctx.save();
      ctx.fillStyle = pal.ink;
      ctx.font = 'bold 14px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(formatPercent(success, 0) || '—', cx, cy - 6);
      ctx.font = '9px system-ui, sans-serif';
      ctx.fillStyle = pal.muted;
      ctx.fillText('not depleted', cx, cy + 10);
      ctx.restore();
    },
  };

  new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: ['Not depleted', 'Depleted', 'On plan', 'Below plan'],
      datasets: [
        {
          data: [success, 1 - success],
          backgroundColor: [pal.success, pal.fail],
          borderWidth: 0,
          weight: 1,
        },
        {
          data: [onPlan, 1 - onPlan],
          backgroundColor: [pal.accent, pal.fail],
          borderWidth: 0,
          weight: 0.7,
        },
      ],
    },
    options: {
      ...chartCommon(),
      cutout: '55%',
      plugins: {
        ...chartCommon().plugins,
        legend: {
          display: true,
          position: 'right',
          labels: {
            boxWidth: 8,
            font: { size: 9 },
            color: pal.muted,
            generateLabels() {
              return [
                { text: `Not depleted ${formatPercent(success, 0)}`, fillStyle: pal.success, strokeStyle: pal.success, index: 0, datasetIndex: 0 },
                { text: `On plan ${formatPercent(onPlan, 0)}`, fillStyle: pal.accent, strokeStyle: pal.accent, index: 0, datasetIndex: 1 },
              ];
            },
          },
        },
      },
    },
    plugins: [centerText],
  });
}

export function drawFourPctBars(canvas, fourPct, { dark = false } = {}) {
  if (!canvas) return;
  destroyChart(canvas);
  if (!fourPct) {
    canvas.style.display = 'none';
    return;
  }
  canvas.style.display = '';
  const pal = paletteFor(dark);

  const userSpendK = (fourPct.userPrimary ?? fourPct.userSpend) / MONEY_SCALE;
  const classicSpendK = (fourPct.classicPrimary ?? fourPct.classicSpend) / MONEY_SCALE;
  const userSurv = (fourPct.userSurvival ?? 0) * 100;
  const classicSurv = (fourPct.classicSurvival ?? 0) * 100;

  new Chart(canvas, {
    type: 'bar',
    data: {
      labels: ['Median spend ($k)', 'Survival %'],
      datasets: [
        {
          label: 'Your plan',
          data: [userSpendK, userSurv],
          backgroundColor: pal.accent,
          borderWidth: 0,
        },
        {
          label: 'Classic 4%',
          data: [classicSpendK, classicSurv],
          backgroundColor: pal.classic,
          borderWidth: 0,
        },
      ],
    },
    options: {
      ...chartCommon(),
      indexAxis: 'y',
      plugins: {
        ...chartCommon().plugins,
        legend: {
          display: true,
          position: 'bottom',
          labels: { boxWidth: 8, font: { size: 9 }, color: pal.muted },
        },
        title: {
          display: true,
          text: 'Vs classic 4% rule',
          color: pal.muted,
          font: { size: 9, weight: 'normal' },
          padding: { bottom: 2 },
        },
      },
      scales: {
        x: {
          beginAtZero: true,
          ticks: { color: pal.muted, font: { size: 8 } },
          grid: { color: pal.grid },
        },
        y: {
          ticks: { color: pal.ink, font: { size: 9 } },
          grid: { display: false },
        },
      },
    },
  });
}

export function drawSequenceBullet(canvas, { requiredIrr, medianIrr }, { dark = false } = {}) {
  if (!canvas) return;
  destroyChart(canvas);
  const pal = paletteFor(dark);

  const cssW = canvas.clientWidth || 280;
  const cssH = canvas.clientHeight || 40;
  const dpr = dprFor();
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  ctx.clearRect(0, 0, cssW, cssH);
  ctx.fillStyle = pal.muted;
  ctx.font = '9px system-ui, sans-serif';
  ctx.textBaseline = 'top';
  ctx.fillText('Sequence risk (IRR)', 0, 2);

  if (medianIrr == null || Number.isNaN(medianIrr)) {
    ctx.fillText('IRR unavailable', 0, 18);
    return;
  }

  const req = requiredIrr == null || Number.isNaN(requiredIrr) ? null : requiredIrr;
  const max = Math.max(medianIrr, req ?? 0, 0.01) * 1.2;
  const trackY = 22;
  const trackH = 8;
  const trackX = 4;
  const trackW = cssW - 8;

  ctx.fillStyle = pal.fail;
  ctx.fillRect(trackX, trackY, trackW, trackH);

  const medianX = trackX + (Math.max(0, medianIrr) / max) * trackW;
  ctx.fillStyle = pal.accent;
  ctx.fillRect(trackX, trackY, Math.max(0, medianX - trackX), trackH);

  if (req != null) {
    const reqX = trackX + (Math.max(0, req) / max) * trackW;
    ctx.strokeStyle = pal.ink;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(reqX, trackY - 3);
    ctx.lineTo(reqX, trackY + trackH + 3);
    ctx.stroke();
  }

  ctx.fillStyle = pal.muted;
  ctx.font = '8px system-ui, sans-serif';
  ctx.textBaseline = 'top';
  const medLabel = `median ${formatPercent(medianIrr, 1)}`;
  const reqLabel = req != null ? ` · required ${formatPercent(req, 1)}` : '';
  ctx.fillText(medLabel + reqLabel, 0, trackY + trackH + 4);
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
      }],
    },
    options: {
      ...chartCommon(),
      scales: {
        x: {
          title: { display: true, text: 'Year', color: pal.muted, font: { size: 9 } },
          ticks: { maxTicksLimit: 8, color: pal.muted, font: { size: 8 } },
          grid: { display: false },
        },
        y: {
          beginAtZero: true,
          ticks: { color: pal.muted, font: { size: 8 }, precision: 0 },
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
        borderWidth: 0,
      }],
    },
    options: {
      ...chartCommon(),
      cutout: '45%',
      plugins: {
        ...chartCommon().plugins,
        legend: {
          display: true,
          position: 'bottom',
          labels: { boxWidth: 6, font: { size: 8 }, color: pal.muted, padding: 4 },
        },
      },
    },
  });
}
