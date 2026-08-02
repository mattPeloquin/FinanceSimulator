import { Chart } from '../../../../ui/charts/chartSetup.js';
import { getChartTheme, chartJsTooltip } from '../../../../ui/charts/chartTheme.js';
import { ALLOCATION_ENGINE_KEYS } from '../../../../core/accumulation.js';
import { getGlidePreviewSeries } from '../inputs.js';

const LABELS = {
  usLgGrowth: 'US Lg Growth',
  usLgValue: 'US Lg Value',
  usSmMid: 'US Sm/Mid',
  exUs: 'Ex-US',
  bond: 'Bond',
  cash: 'Cash',
};

function destroyChart(canvas) {
  const existing = Chart.getChart(canvas);
  if (existing) existing.destroy();
}

/** Stacked area of allocation glidepath (client-side, no MC). */
export function drawGlidePreview(canvas) {
  if (!canvas) return;
  destroyChart(canvas);
  const theme = getChartTheme();
  const series = getGlidePreviewSeries();
  if (!series.length) return;
  const labels = series.map((_, i) => i);
  const palette = theme.labCurvePalette || [];

  new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: ALLOCATION_ENGINE_KEYS.map((key, i) => ({
        label: LABELS[key] || key,
        data: series.map((mix) => (mix[key] || 0) * 100),
        borderColor: palette[i % palette.length] || theme.accent,
        backgroundColor: palette[i % palette.length] || theme.accent,
        fill: i === 0,
        pointRadius: 0,
        tension: 0.1,
        stack: 'alloc',
      })),
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: theme.legend, boxWidth: 10, font: { size: 10 } } },
        tooltip: {
          ...chartJsTooltip(theme),
          callbacks: {
            label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y.toFixed(1)}%`,
          },
        },
      },
      scales: {
        x: {
          title: { display: true, text: 'Year', color: theme.axisTitle },
          ticks: { color: theme.axisTick },
          grid: { color: theme.gridLine },
        },
        y: {
          stacked: true,
          min: 0,
          max: 100,
          title: { display: true, text: 'Weight %', color: theme.axisTitle },
          ticks: { color: theme.axisTick },
          grid: { color: theme.gridLine },
        },
      },
    },
  });
}
