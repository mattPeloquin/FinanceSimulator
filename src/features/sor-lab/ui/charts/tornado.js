// Horizontal tornado chart for SOR Lab. Two-tone floating bars (low-end vs
// high-end of each variable's swept range) with optional spine / SE whiskers.

import { Chart } from '../../../../ui/charts/chartSetup.js';
import { getChartTheme, chartJsTooltip } from '../../../../ui/charts/chartTheme.js';
import { formatK, formatPercent } from '../../../../ui/format.js';

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

function orderedSeg(a, b) {
  return a <= b ? [a, b] : [b, a];
}

/**
 * Pure geometry for one tornado row. Segments are deltas from baseline;
 * each always includes 0 for rate / median styles (standard tornado read).
 *
 * @returns {{ lowSeg: [number, number], highSeg: [number, number], spine: [number, number] | null, caps: boolean, belowNoise: boolean }}
 */
export function buildTornadoGeometry(row, metric, barStyle = 'band') {
  const belowNoise = !!row.belowNoise;
  const useBand = barStyle === 'band' && metric?.kind === 'perPath';

  if (metric?.kind === 'rate') {
    const base = row.baselineValue ?? 0;
    const loDelta = (row.lowValue ?? base) - base;
    const hiDelta = (row.highValue ?? base) - base;
    const se = row.se || 0;
    const spanLo = Math.min(loDelta, hiDelta);
    const spanHi = Math.max(loDelta, hiDelta);
    return {
      lowSeg: orderedSeg(0, loDelta),
      highSeg: orderedSeg(0, hiDelta),
      spine: [spanLo - se, spanHi + se],
      caps: true,
      belowNoise,
    };
  }

  const baseMid = row.baselineValue?.pMid ?? 0;

  if (useBand) {
    const lowLo = (row.lowValue?.pLow ?? baseMid) - baseMid;
    const lowHi = (row.lowValue?.pHigh ?? baseMid) - baseMid;
    const highLo = (row.highValue?.pLow ?? baseMid) - baseMid;
    const highHi = (row.highValue?.pHigh ?? baseMid) - baseMid;
    const midLo = (row.lowValue?.pMid ?? baseMid) - baseMid;
    const midHi = (row.highValue?.pMid ?? baseMid) - baseMid;
    return {
      lowSeg: orderedSeg(lowLo, lowHi),
      highSeg: orderedSeg(highLo, highHi),
      spine: orderedSeg(midLo, midHi),
      caps: false,
      belowNoise,
    };
  }

  // Median-only style: each segment runs from baseline to that end's median.
  const loMid = (row.lowValue?.pMid ?? baseMid) - baseMid;
  const hiMid = (row.highValue?.pMid ?? baseMid) - baseMid;
  return {
    lowSeg: orderedSeg(0, loMid),
    highSeg: orderedSeg(0, hiMid),
    spine: null,
    caps: false,
    belowNoise,
  };
}

/**
 * Draw tornado rows as floating horizontal bars (delta from baseline).
 *
 * @param {HTMLCanvasElement} canvas
 * @param {object} opts
 * @param {object[]} opts.rows
 * @param {object} opts.metric
 * @param {{ low: number, high: number }} [opts.band]
 * @param {'band'|'median'} [opts.barStyle]
 * @param {string[]} [opts.selectedIds] — variable ids highlighted for curve overlay
 * @param {(variableId: string) => void} [opts.onRowClick]
 */
export function drawTornado(canvas, {
  rows,
  metric,
  band,
  barStyle = 'band',
  selectedIds = [],
  onRowClick,
} = {}) {
  if (!canvas) return;
  destroyChart(canvas);
  if (!rows?.length || !metric) return;

  const theme = getChartTheme();
  const labels = rows.map((r) => r.label);
  const selectedSet = new Set(selectedIds || []);
  const geometry = rows.map((row) => buildTornadoGeometry(row, metric, barStyle));

  const lowColors = geometry.map((g) => (g.belowNoise ? theme.tornadoMuted : theme.tornadoLowEnd));
  const highColors = geometry.map((g) => (g.belowNoise ? theme.tornadoMuted : theme.tornadoHighEnd));

  const selectionPlugin = {
    id: 'sorLabTornadoSelection',
    beforeDatasetsDraw(chart) {
      if (!selectedSet.size) return;
      const { ctx, scales: { y }, chartArea } = chart;
      ctx.save();
      for (let i = 0; i < rows.length; i++) {
        if (!selectedSet.has(rows[i].id)) continue;
        const yPos = y.getPixelForValue(i);
        const half = Math.max(8, (y.getPixelForValue(0) - y.getPixelForValue(1) || 24) / 2 * 0.85);
        ctx.fillStyle = theme.tornadoSelectionFill;
        const r = 4;
        const x0 = chartArea.left;
        const x1 = chartArea.right;
        const y0 = yPos - half;
        const y1 = yPos + half;
        ctx.beginPath();
        ctx.moveTo(x0 + r, y0);
        ctx.arcTo(x1, y0, x1, y1, r);
        ctx.arcTo(x1, y1, x0, y1, r);
        ctx.arcTo(x0, y1, x0, y0, r);
        ctx.arcTo(x0, y0, x1, y0, r);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    },
  };

  const spinePlugin = {
    id: 'sorLabTornadoSpine',
    afterDatasetsDraw(chart) {
      const { ctx, scales: { x, y } } = chart;
      ctx.save();
      for (let i = 0; i < geometry.length; i++) {
        const g = geometry[i];
        if (!g.spine) continue;
        const yPos = y.getPixelForValue(i);
        const x0 = x.getPixelForValue(g.spine[0]);
        const x1 = x.getPixelForValue(g.spine[1]);
        ctx.strokeStyle = g.caps ? theme.axisTick : theme.axisName;
        ctx.lineWidth = g.caps ? 1.5 : 2;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(x0, yPos);
        ctx.lineTo(x1, yPos);
        if (g.caps) {
          ctx.moveTo(x0, yPos - 4);
          ctx.lineTo(x0, yPos + 4);
          ctx.moveTo(x1, yPos - 4);
          ctx.lineTo(x1, yPos + 4);
        }
        ctx.stroke();
      }
      // Zero line (baseline).
      const zeroX = x.getPixelForValue(0);
      ctx.strokeStyle = theme.zeroLine;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(zeroX, y.top);
      ctx.lineTo(zeroX, y.bottom);
      ctx.stroke();
      ctx.restore();
    },
  };

  const tickColors = rows.map((r) => (
    selectedSet.has(r.id) ? theme.accent : theme.axisName
  ));

  new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'lowEnd',
          data: geometry.map((g) => g.lowSeg),
          backgroundColor: lowColors,
          borderWidth: 0,
          borderRadius: 3,
          barPercentage: 0.7,
          categoryPercentage: 0.9,
          grouped: false,
        },
        {
          label: 'highEnd',
          data: geometry.map((g) => g.highSeg),
          backgroundColor: highColors,
          borderWidth: 0,
          borderRadius: 3,
          barPercentage: 0.7,
          categoryPercentage: 0.9,
          grouped: false,
        },
      ],
    },
    plugins: [selectionPlugin, spinePlugin],
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      onClick(_evt, _elements, chart) {
        if (!onRowClick) return;
        const yScale = chart.scales.y;
        const evt = _evt.native || _evt;
        const yPixel = evt?.offsetY ?? evt?.y;
        if (yPixel == null || !yScale) return;
        const idx = Math.round(yScale.getValueForPixel(yPixel));
        if (idx < 0 || idx >= rows.length) return;
        onRowClick(rows[idx].id);
      },
      onHover(evt, _elements, chart) {
        const canvasEl = chart.canvas;
        if (!canvasEl || !onRowClick) return;
        const yScale = chart.scales.y;
        const yPixel = evt.native?.offsetY ?? evt.y;
        if (yPixel == null || !yScale) {
          canvasEl.style.cursor = 'default';
          return;
        }
        const idx = Math.round(yScale.getValueForPixel(yPixel));
        canvasEl.style.cursor = (idx >= 0 && idx < rows.length) ? 'pointer' : 'default';
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          ...chartJsTooltip(theme),
          filter: (item) => item.dataset.label === 'highEnd',
          callbacks: {
            title(items) {
              return items[0]?.label || '';
            },
            label(ctx) {
              const row = rows[ctx.dataIndex];
              if (!row) return null;
              if (metric.kind === 'rate') {
                return `Impact ${formatMetric(row.impact, metric)} (SE ±${formatMetric(row.se, metric)})`;
              }
              const bandLabel = band ? `P${band.low}–P${band.high}` : 'band';
              return `${bandLabel} impact ${formatMetric(row.impact, metric)}`;
            },
          },
        },
      },
      scales: {
        x: {
          ticks: {
            color: theme.axisTick,
            font: { size: 10 },
            callback(v) {
              return formatMetric(v, metric);
            },
          },
          grid: { color: theme.gridLine },
          title: {
            display: true,
            text: `Δ ${metric.label} from baseline`,
            color: theme.axisTitle,
            font: { size: 11 },
          },
        },
        y: {
          reverse: false,
          ticks: {
            color: (ctx) => tickColors[ctx.index] ?? theme.axisName,
            font: { size: 11 },
            autoSkip: false,
          },
          grid: { display: false },
        },
      },
    },
  });
}
