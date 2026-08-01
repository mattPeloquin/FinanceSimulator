import { Chart } from '../../../../ui/charts/chartSetup.js';
import { getChartTheme, chartJsTooltip } from '../../../../ui/charts/chartTheme.js';
import { formatK } from '../../../../ui/format.js';

function destroyChart(canvas) {
  const existing = Chart.getChart(canvas);
  if (existing) existing.destroy();
}

/** Scatter of ending stdDev (x) vs median ending wealth (y) for weight-grid points. */
export function drawRiskReturnRegion(canvas, result) {
  if (!canvas) return;
  destroyChart(canvas);
  const theme = getChartTheme();
  const points = Array.isArray(result?.region) ? result.region : [];
  if (!points.length) {
    new Chart(canvas, {
      type: 'scatter',
      data: { datasets: [] },
      options: {
        plugins: {
          title: {
            display: true,
            text: 'Allocation explore off for this run',
            color: theme.axisTitle,
          },
        },
      },
    });
    return;
  }

  new Chart(canvas, {
    type: 'scatter',
    data: {
      datasets: [{
        label: 'Mixes',
        data: points.map((p) => ({ x: p.endingStdDev, y: p.endingMedian })),
        backgroundColor: theme.accentFill,
        borderColor: theme.accent,
        pointRadius: 3,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          ...chartJsTooltip(theme),
          callbacks: {
            label: (ctx) => `σ ${formatK(ctx.parsed.x)} → median ${formatK(ctx.parsed.y)}`,
          },
        },
      },
      scales: {
        x: {
          title: { display: true, text: 'Ending balance σ', color: theme.axisTitle },
          ticks: { color: theme.axisTick, callback: (v) => formatK(v) },
          grid: { color: theme.gridLine },
        },
        y: {
          title: { display: true, text: 'Median ending $', color: theme.axisTitle },
          ticks: { color: theme.axisTick, callback: (v) => formatK(v) },
          grid: { color: theme.gridLine },
        },
      },
    },
  });
}
