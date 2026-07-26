// Horizontal tornado chart for SOR Lab. Band / median bars for per-path
// metrics; rate bars with sampling-error whiskers.

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

/**
 * Draw tornado rows as floating horizontal bars (delta from baseline).
 */
export function drawTornado(canvas, { rows, metric, band, barStyle = 'band' } = {}) {
  if (!canvas) return;
  destroyChart(canvas);
  if (!rows?.length || !metric) return;

  const theme = getChartTheme();
  const labels = rows.map((r) => r.label);
  const useBand = barStyle === 'band' && metric.kind === 'perPath';

  const lowDeltas = [];
  const highDeltas = [];
  const whiskerLo = [];
  const whiskerHi = [];

  for (const row of rows) {
    if (metric.kind === 'rate') {
      const base = row.baselineValue ?? 0;
      const lo = (row.lowValue ?? base) - base;
      const hi = (row.highValue ?? base) - base;
      lowDeltas.push(Math.min(lo, hi));
      highDeltas.push(Math.max(lo, hi));
      const se = row.se || 0;
      whiskerLo.push(Math.min(lo, hi) - se);
      whiskerHi.push(Math.max(lo, hi) + se);
    } else if (useBand) {
      const baseMid = row.baselineValue?.pMid ?? 0;
      const all = [
        (row.lowValue?.pLow ?? baseMid) - baseMid,
        (row.lowValue?.pHigh ?? baseMid) - baseMid,
        (row.highValue?.pLow ?? baseMid) - baseMid,
        (row.highValue?.pHigh ?? baseMid) - baseMid,
      ];
      // Median spine endpoints (drawn as a darker inset via whisker plugin).
      const midLo = Math.min(
        (row.lowValue?.pMid ?? baseMid) - baseMid,
        (row.highValue?.pMid ?? baseMid) - baseMid,
      );
      const midHi = Math.max(
        (row.lowValue?.pMid ?? baseMid) - baseMid,
        (row.highValue?.pMid ?? baseMid) - baseMid,
      );
      lowDeltas.push(Math.min(...all));
      highDeltas.push(Math.max(...all));
      whiskerLo.push(midLo);
      whiskerHi.push(midHi);
    } else {
      const baseMid = row.baselineValue?.pMid ?? 0;
      const loMid = (row.lowValue?.pMid ?? baseMid) - baseMid;
      const hiMid = (row.highValue?.pMid ?? baseMid) - baseMid;
      lowDeltas.push(Math.min(loMid, hiMid));
      highDeltas.push(Math.max(loMid, hiMid));
      whiskerLo.push(Math.min(loMid, hiMid));
      whiskerHi.push(Math.max(loMid, hiMid));
    }
  }

  const barBase = lowDeltas;
  const barLength = highDeltas.map((hi, i) => hi - lowDeltas[i]);
  const colors = rows.map((r) => (r.belowNoise ? theme.gridLine : theme.accent));

  const spinePlugin = {
    id: 'sorLabTornadoSpine',
    afterDatasetsDraw(chart) {
      const { ctx, scales: { x, y } } = chart;
      ctx.save();
      ctx.strokeStyle = metric.kind === 'rate' ? theme.axisTick : theme.axisName;
      ctx.lineWidth = metric.kind === 'rate' ? 1.5 : 2;
      for (let i = 0; i < rows.length; i++) {
        const yPos = y.getPixelForValue(i);
        const x0 = x.getPixelForValue(whiskerLo[i]);
        const x1 = x.getPixelForValue(whiskerHi[i]);
        ctx.beginPath();
        ctx.moveTo(x0, yPos);
        ctx.lineTo(x1, yPos);
        if (metric.kind === 'rate') {
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

  new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'base',
          data: barBase,
          backgroundColor: 'transparent',
          borderWidth: 0,
          barPercentage: 0.7,
          categoryPercentage: 0.9,
          stack: 'tornado',
        },
        {
          label: 'impact',
          data: barLength,
          backgroundColor: colors,
          borderWidth: 0,
          borderRadius: 3,
          barPercentage: 0.7,
          categoryPercentage: 0.9,
          stack: 'tornado',
        },
      ],
    },
    plugins: [spinePlugin],
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          ...chartJsTooltip(theme),
          filter: (item) => item.dataset.label === 'impact',
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
          stacked: true,
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
          stacked: true,
          reverse: false,
          ticks: {
            color: theme.axisName,
            font: { size: 11 },
            autoSkip: false,
          },
          grid: { display: false },
        },
      },
    },
  });
}
