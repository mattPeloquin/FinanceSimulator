import { Chart } from '../../../../ui/charts/chartSetup.js';
import { getChartTheme, chartJsTooltip } from '../../../../ui/charts/chartTheme.js';
import { formatK } from '../../../../ui/format.js';
import { getSleeveMeta } from '../../../../portfolio/registry.js';

function destroyChart(canvas) {
  const existing = Chart.getChart(canvas);
  if (existing) existing.destroy();
}

/** Horizontal bars: impact of low/high weight nudges on median ending balance. */
export function drawWeightTornado(canvas, result) {
  if (!canvas) return;
  destroyChart(canvas);
  const theme = getChartTheme();
  const rows = Array.isArray(result?.tornado) ? result.tornado : [];
  if (!rows.length) {
    new Chart(canvas, {
      type: 'bar',
      data: { labels: [], datasets: [] },
      options: {
        indexAxis: 'y',
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

  const byVar = new Map();
  for (const row of rows) {
    const entry = byVar.get(row.variableId) || { low: 0, high: 0 };
    if (row.direction === 'low') entry.low = row.impact;
    else entry.high = row.impact;
    byVar.set(row.variableId, entry);
  }
  const labels = [...byVar.keys()].map((id) => getSleeveMeta(id)?.label || id);
  const lowData = [...byVar.values()].map((v) => v.low);
  const highData = [...byVar.values()].map((v) => v.high);

  new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Lower weight',
          data: lowData,
          backgroundColor: theme.tornadoLowEnd,
        },
        {
          label: 'Higher weight',
          data: highData,
          backgroundColor: theme.tornadoHighEnd,
        },
      ],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: theme.legend, boxWidth: 12 } },
        tooltip: {
          ...chartJsTooltip(theme),
          callbacks: {
            label: (ctx) => `${ctx.dataset.label}: ${formatK(ctx.parsed.x)} vs baseline`,
          },
        },
      },
      scales: {
        x: {
          title: { display: true, text: 'Δ median ending $', color: theme.axisTitle },
          ticks: { color: theme.axisTick, callback: (v) => formatK(v) },
          grid: { color: theme.gridLine },
        },
        y: { ticks: { color: theme.axisTick }, grid: { display: false } },
      },
    },
  });
}
