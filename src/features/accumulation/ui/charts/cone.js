import { Chart } from '../../../../ui/charts/chartSetup.js';
import { getChartTheme, chartJsTooltip } from '../../../../ui/charts/chartTheme.js';
import { formatK } from '../../../../ui/format.js';

function destroyChart(canvas) {
  const existing = Chart.getChart(canvas);
  if (existing) existing.destroy();
}

/** Draw P10 / P50 / P90 uncertainty cone for Med (and optional Low/High P50 overlays). */
export function drawAccumulationCone(canvas, result) {
  if (!canvas || !result?.med?.cone) return;
  destroyChart(canvas);
  const theme = getChartTheme();
  const cone = result.med.cone;
  const labels = cone.map((c) => c.year);

  const datasets = [
    {
      label: 'P90',
      data: cone.map((c) => c.p90),
      borderColor: theme.axisTick,
      backgroundColor: 'transparent',
      borderWidth: 1,
      pointRadius: 0,
      tension: 0.15,
    },
    {
      label: 'P50 (Med)',
      data: cone.map((c) => c.p50),
      borderColor: theme.accent,
      backgroundColor: 'transparent',
      borderWidth: 2,
      pointRadius: 0,
      tension: 0.15,
    },
    {
      label: 'P10',
      data: cone.map((c) => c.p10),
      borderColor: theme.axisTick,
      backgroundColor: theme.accentFillSoft,
      borderWidth: 1,
      pointRadius: 0,
      tension: 0.15,
      fill: '-2',
    },
  ];

  if (result.savingsImpact?.low?.cone) {
    datasets.push({
      label: 'P50 Low',
      data: result.savingsImpact.low.cone.map((c) => c.p50),
      borderColor: theme.eventMarker,
      borderDash: [4, 4],
      borderWidth: 1.5,
      pointRadius: 0,
      tension: 0.15,
    });
  }
  if (result.savingsImpact?.high?.cone) {
    datasets.push({
      label: 'P50 High',
      data: result.savingsImpact.high.cone.map((c) => c.p50),
      borderColor: theme.planLine,
      borderDash: [4, 4],
      borderWidth: 1.5,
      pointRadius: 0,
      tension: 0.15,
    });
  }

  new Chart(canvas, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: theme.legend, boxWidth: 12 } },
        tooltip: {
          ...chartJsTooltip(theme),
          callbacks: {
            label: (ctx) => `${ctx.dataset.label}: ${formatK(ctx.parsed.y)}`,
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
          beginAtZero: true,
          title: { display: true, text: 'Balance (real $)', color: theme.axisTitle },
          ticks: {
            color: theme.axisTick,
            callback: (v) => formatK(v),
          },
          grid: { color: theme.gridLine },
        },
      },
    },
  });
}
