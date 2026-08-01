// Multi-variable response curve: metric vs normalized distance from baseline.
// Consumes a buildCurveModel() result — never touches LabSweepResult directly.

import { Chart } from '../../../../ui/charts/chartSetup.js';
import {
  getChartTheme,
  applySampleRunDomTooltipStyle,
} from '../../../../ui/charts/chartTheme.js';
import { formatK, formatPercent } from '../../../../ui/format.js';
import { readoutAt } from '../curveModel.js';

function destroyChart(canvas) {
  const existing = Chart.getChart(canvas);
  if (existing) existing.destroy();
}

function formatMetric(value, metric) {
  if (value == null || !Number.isFinite(value)) return '—';
  if (!metric) return String(Math.round(value * 100) / 100);
  if (metric.unit === 'fraction') return formatPercent(value, 1);
  if (metric.unit === 'dollars') return formatK(value);
  if (metric.unit === 'years') return value.toFixed(1);
  return String(Math.round(value * 100) / 100);
}

function formatParam(value, unit) {
  if (value == null || !Number.isFinite(value)) return '—';
  if (unit === '$000s') return Number(value).toLocaleString('en-US');
  if (unit === '%' || unit === 'pp') return `${Math.round(value * 10) / 10}`;
  if (unit === '×') return `${Math.round(value * 100) / 100}×`;
  if (unit === 'years') return String(Math.round(value));
  return String(Math.round(value * 100) / 100);
}

function withAlpha(color, alpha) {
  if (!color) return `rgba(99, 102, 241, ${alpha})`;
  if (color.startsWith('rgba')) {
    return color.replace(/rgba\(([^)]+),\s*[\d.]+\)/, `rgba($1, ${alpha})`);
  }
  if (color.startsWith('rgb(')) {
    return color.replace('rgb(', 'rgba(').replace(')', `, ${alpha})`);
  }
  const h = color.replace('#', '');
  if (h.length !== 6) return color;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function hexLine(color, alpha = 1) {
  return withAlpha(color, alpha);
}

/**
 * Build Chart.js datasets for one curve model.
 * @param {object} model — from buildCurveModel
 * @param {object} theme
 */
function buildDatasets(model, theme) {
  const datasets = [];
  const isRate = model.metric?.kind === 'rate';

  for (const curve of model.curves) {
    const dim = curve.focused ? 1 : 0.4;
    const bandAlpha = curve.focused ? 0.18 : 0.08;
    const lineWidth = curve.focused ? 2.5 : 1.5;

    if (isRate && curve.se) {
      datasets.push({
        label: `${curve.label} SE hi`,
        data: curve.se.high,
        borderColor: 'transparent',
        backgroundColor: withAlpha(curve.color, bandAlpha),
        pointRadius: 0,
        fill: '+1',
        tension: 0.2,
        order: 10,
        _curveId: curve.id,
        _role: 'se',
      });
      datasets.push({
        label: `${curve.label} SE lo`,
        data: curve.se.low,
        borderColor: 'transparent',
        backgroundColor: withAlpha(curve.color, bandAlpha),
        pointRadius: 0,
        fill: false,
        tension: 0.2,
        order: 10,
        _curveId: curve.id,
        _role: 'se',
      });
    } else if (!isRate && curve.band) {
      // Always-on low-alpha band for every selected curve.
      datasets.push({
        label: `${curve.label} band hi`,
        data: curve.band.high,
        borderColor: 'transparent',
        backgroundColor: withAlpha(curve.color, bandAlpha),
        pointRadius: 0,
        fill: '+1',
        tension: 0.2,
        order: 10,
        _curveId: curve.id,
        _role: 'band',
      });
      datasets.push({
        label: `${curve.label} band lo`,
        data: curve.band.low,
        borderColor: 'transparent',
        backgroundColor: withAlpha(curve.color, bandAlpha),
        pointRadius: 0,
        fill: false,
        tension: 0.2,
        order: 10,
        _curveId: curve.id,
        _role: 'band',
      });
    }

    // Nested fan only on the focused per-path curve (replaces / sits under median).
    if (curve.fan?.length) {
      const alphas = [0.06, 0.1, 0.16];
      curve.fan.forEach((layer, idx) => {
        datasets.push({
          label: `${curve.label} P${layer.high}`,
          data: layer.highPoints,
          borderColor: 'transparent',
          backgroundColor: withAlpha(curve.color, alphas[idx] ?? 0.1),
          pointRadius: 0,
          fill: '+1',
          tension: 0.2,
          order: 8,
          _curveId: curve.id,
          _role: 'fan',
        });
        datasets.push({
          label: `${curve.label} P${layer.low}`,
          data: layer.lowPoints,
          borderColor: 'transparent',
          backgroundColor: withAlpha(curve.color, alphas[idx] ?? 0.1),
          pointRadius: 0,
          fill: false,
          tension: 0.2,
          order: 8,
          _curveId: curve.id,
          _role: 'fan',
        });
      });
    }

    if (curve.mean) {
      datasets.push({
        label: `${curve.label} mean`,
        data: curve.mean,
        borderColor: hexLine(curve.color, dim * 0.7),
        backgroundColor: 'transparent',
        borderDash: [4, 3],
        pointRadius: 0,
        tension: 0.2,
        fill: false,
        borderWidth: 1.25,
        order: 2,
        _curveId: curve.id,
        _role: 'mean',
      });
    }

    datasets.push({
      label: curve.label,
      data: curve.points,
      borderColor: hexLine(curve.color, dim),
      backgroundColor: hexLine(curve.color, dim),
      pointRadius: curve.focused ? 3 : 2,
      tension: 0.2,
      fill: false,
      borderWidth: lineWidth,
      order: 1,
      _curveId: curve.id,
      _role: 'median',
    });
  }

  // Threshold crossing markers as a scatter-like line with only those points.
  if (model.threshold != null) {
    const dots = [];
    for (const c of model.curves) {
      for (const cross of c.crossings || []) {
        dots.push({ x: cross.t, y: cross.y });
      }
    }
    if (dots.length) {
      datasets.push({
        label: 'Threshold crossings',
        data: dots,
        showLine: false,
        pointRadius: 5,
        pointBackgroundColor: theme.eventMarker,
        pointBorderColor: theme.axisName,
        pointBorderWidth: 1,
        order: 0,
        _role: 'crossing',
      });
    }
  }

  // Turning-point markers for non-monotonic curves.
  const turns = [];
  for (const c of model.curves) {
    if (c.monotonic?.monotonic === false && c.monotonic.turningIndex != null) {
      const pt = c.points[c.monotonic.turningIndex];
      if (pt) turns.push({ ...pt, _curveId: c.id });
    }
  }
  if (turns.length) {
    datasets.push({
      label: 'Turning points',
      data: turns,
      showLine: false,
      pointRadius: 4,
      pointStyle: 'triangle',
      pointBackgroundColor: theme.floorLine,
      order: 0,
      _role: 'turn',
    });
  }

  return datasets;
}

/**
 * Draw the multi-variable response curve.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {object} model — from buildCurveModel
 * @param {object} [opts]
 * @param {HTMLElement} [opts.readoutEl]
 * @param {(variableId: string) => void} [opts.onFocus]
 */
export function drawResponseCurve(canvas, model, { readoutEl, onFocus } = {}) {
  if (!canvas) return;
  destroyChart(canvas);
  if (!model?.curves?.length || !model.metric) {
    if (readoutEl) readoutEl.classList.add('hidden');
    return;
  }

  const theme = getChartTheme();
  const datasets = buildDatasets(model, theme);

  const annotationPlugin = {
    id: 'sorLabCurveAnnotations',
    beforeDatasetsDraw(chart) {
      const { ctx, scales: { y }, chartArea } = chart;
      ctx.save();

      // Noise-floor shading (horizontal band around baseline metric).
      if (model.noiseBand) {
        const y0 = y.getPixelForValue(model.noiseBand.high);
        const y1 = y.getPixelForValue(model.noiseBand.low);
        ctx.fillStyle = withAlpha(theme.axisTick, 0.08);
        ctx.fillRect(chartArea.left, Math.min(y0, y1), chartArea.right - chartArea.left, Math.abs(y1 - y0));
      }

      // Threshold horizontal line.
      if (model.threshold != null && Number.isFinite(model.threshold)) {
        const ty = y.getPixelForValue(model.threshold);
        ctx.strokeStyle = theme.eventMarker;
        ctx.lineWidth = 1;
        ctx.setLineDash([5, 4]);
        ctx.beginPath();
        ctx.moveTo(chartArea.left, ty);
        ctx.lineTo(chartArea.right, ty);
        ctx.stroke();
      }

      ctx.restore();
    },
    afterDatasetsDraw(chart) {
      const { ctx, scales: { x }, chartArea } = chart;
      ctx.save();

      // Baseline at t = 0 with metric label.
      const zeroX = x.getPixelForValue(0);
      ctx.strokeStyle = theme.zeroLine;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(zeroX, chartArea.top);
      ctx.lineTo(zeroX, chartArea.bottom);
      ctx.stroke();

      if (model.baselineMetric != null) {
        ctx.setLineDash([]);
        ctx.fillStyle = theme.axisTitle;
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';
        const label = `Baseline ${formatMetric(model.baselineMetric, model.metric)}`;
        ctx.fillText(label, zeroX + 4, chartArea.top + 12);
      }

      ctx.restore();
    },
  };

  let lastFocusId = model.curves.find((c) => c.focused)?.id || null;

  const chart = new Chart(canvas, {
    type: 'line',
    data: { datasets },
    plugins: [annotationPlugin],
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      parsing: false,
      interaction: { mode: 'nearest', axis: 'x', intersect: false },
      onHover(evt, elements) {
        // Soft visual focus without rebuilding: thicken the nearest median line.
        let nextFocus = lastFocusId;
        for (const el of elements) {
          const ds = chart.data.datasets[el.datasetIndex];
          if (ds?._role === 'median' && ds._curveId) {
            nextFocus = ds._curveId;
            break;
          }
        }
        if (nextFocus && nextFocus !== lastFocusId) {
          lastFocusId = nextFocus;
          for (const ds of chart.data.datasets) {
            if (ds._role !== 'median' || !ds._curveId) continue;
            const focused = ds._curveId === nextFocus;
            ds.borderWidth = focused ? 2.5 : 1.5;
            ds.pointRadius = focused ? 3 : 2;
            const base = model.curves.find((c) => c.id === ds._curveId)?.color;
            if (base) {
              ds.borderColor = hexLine(base, focused ? 1 : 0.4);
              ds.backgroundColor = hexLine(base, focused ? 1 : 0.4);
            }
          }
          chart.update('none');
          onFocus?.(nextFocus);
        }

        if (readoutEl) {
          const xScale = chart.scales.x;
          const px = evt.x ?? evt.native?.offsetX;
          if (px == null || !xScale) {
            readoutEl.classList.add('hidden');
            return;
          }
          const t = xScale.getValueForPixel(px);
          const rows = readoutAt(model, t);
          if (!rows.length) {
            readoutEl.classList.add('hidden');
            return;
          }
          const title = `At ${(t * 100).toFixed(0)}% of range`;
          readoutEl.innerHTML = [
            `<div class="font-semibold mb-1">${title}</div>`,
            ...rows.map((r) => {
              const param = formatParam(r.native, r.unit);
              const met = formatMetric(r.metricValue, model.metric);
              const weight = r.id === nextFocus ? 'font-semibold' : '';
              return `<div class="${weight}" style="color:${r.color}">${r.label}: ${param} → ${met}</div>`;
            }),
          ].join('');
          applySampleRunDomTooltipStyle(readoutEl);
          readoutEl.classList.remove('hidden');
          const area = chart.chartArea;
          const tipW = readoutEl.offsetWidth || 160;
          const tipH = readoutEl.offsetHeight || 80;
          let left = px + 12;
          let top = (evt.y ?? evt.native?.offsetY ?? 0) - tipH / 2;
          if (left + tipW > area.right) left = px - tipW - 12;
          if (top < area.top) top = area.top;
          if (top + tipH > area.bottom) top = area.bottom - tipH;
          readoutEl.style.left = `${left}px`;
          readoutEl.style.top = `${top}px`;
        }
      },
      plugins: {
        legend: { display: false },
        tooltip: { enabled: false },
      },
      scales: {
        x: {
          type: 'linear',
          min: -1,
          max: 1,
          ticks: {
            color: theme.axisTick,
            font: { size: 10 },
            callback(v) {
              return `${Math.round(v * 100)}%`;
            },
          },
          grid: { color: theme.gridLine },
          title: {
            display: true,
            text: 'Distance from baseline (share of each variable’s swept range)',
            color: theme.axisTitle,
            font: { size: 11 },
          },
        },
        y: {
          ticks: {
            color: theme.axisTick,
            font: { size: 10 },
            callback(v) {
              return formatMetric(v, model.metric);
            },
          },
          grid: { color: theme.gridLine },
          title: {
            display: true,
            text: model.metric.label,
            color: theme.axisTitle,
            font: { size: 11 },
          },
        },
      },
    },
  });

  // Hide readout when pointer leaves the canvas.
  canvas.addEventListener('mouseleave', () => {
    readoutEl?.classList.add('hidden');
  });

  return chart;
}
