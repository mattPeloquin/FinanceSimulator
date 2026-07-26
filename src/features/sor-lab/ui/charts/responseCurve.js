// Per-variable response curve: metric (with percentile band) vs swept parameter.

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

function formatParam(value, unit) {
  if (value == null || !Number.isFinite(value)) return '—';
  if (unit === '$000s') return Number(value).toLocaleString('en-US');
  if (unit === '%' || unit === 'pp') return `${Math.round(value * 10) / 10}`;
  if (unit === '×') return `${Math.round(value * 100) / 100}×`;
  if (unit === 'years') return String(Math.round(value));
  return String(Math.round(value * 100) / 100);
}

export function drawResponseCurve(canvas, curve) {
  if (!canvas) return;
  destroyChart(canvas);
  if (!curve?.x?.length || !curve.metric) return;

  const theme = getChartTheme();
  const { metric, band, x, series, variable, baselineValue } = curve;
  const labels = x.map((v) => formatParam(v, variable.unit));

  const datasets = [];

  if (metric.kind === 'rate') {
    datasets.push({
      label: metric.label,
      data: series.value,
      borderColor: theme.accent,
      backgroundColor: theme.accent,
      pointRadius: 3,
      tension: 0.2,
      fill: false,
    });
  } else {
    const pLow = series.percentiles[band.low] || [];
    const pMid = series.percentiles[50] || [];
    const pHigh = series.percentiles[band.high] || [];
    // Band as fill between high and low via two datasets.
    datasets.push({
      label: `P${band.high}`,
      data: pHigh,
      borderColor: 'transparent',
      backgroundColor: theme.accentFillSoft,
      pointRadius: 0,
      fill: '+1',
      tension: 0.2,
    });
    datasets.push({
      label: `P${band.low}`,
      data: pLow,
      borderColor: 'transparent',
      backgroundColor: theme.accentFillSoft,
      pointRadius: 0,
      fill: false,
      tension: 0.2,
    });
    datasets.push({
      label: 'Median',
      data: pMid,
      borderColor: theme.accent,
      backgroundColor: theme.accent,
      pointRadius: 3,
      tension: 0.2,
      fill: false,
    });
  }

  const baselinePlugin = {
    id: 'sorLabBaselineMark',
    afterDatasetsDraw(chart) {
      if (baselineValue == null || !Number.isFinite(baselineValue)) return;
      // Find nearest x index for the baseline parameter value.
      let best = 0;
      let bestDist = Infinity;
      for (let i = 0; i < x.length; i++) {
        const d = Math.abs(x[i] - baselineValue);
        if (d < bestDist) {
          bestDist = d;
          best = i;
        }
      }
      const { ctx, scales: { x: xScale, y } } = chart;
      const px = xScale.getPixelForValue(best);
      ctx.save();
      ctx.strokeStyle = theme.zeroLine;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(px, y.top);
      ctx.lineTo(px, y.bottom);
      ctx.stroke();
      ctx.restore();
    },
  };

  new Chart(canvas, {
    type: 'line',
    data: { labels, datasets },
    plugins: [baselinePlugin],
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          display: metric.kind !== 'rate',
          labels: { color: theme.legend, boxWidth: 12, font: { size: 10 } },
        },
        tooltip: {
          ...chartJsTooltip(theme),
          callbacks: {
            label(ctx) {
              return `${ctx.dataset.label}: ${formatMetric(ctx.parsed.y, metric)}`;
            },
          },
        },
      },
      scales: {
        x: {
          ticks: { color: theme.axisTick, font: { size: 10 }, maxRotation: 0 },
          grid: { color: theme.gridLine },
          title: {
            display: true,
            text: variable.label,
            color: theme.axisTitle,
            font: { size: 11 },
          },
        },
        y: {
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
            text: metric.label,
            color: theme.axisTitle,
            font: { size: 11 },
          },
        },
      },
    },
  });
}
