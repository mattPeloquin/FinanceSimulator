import { Chart } from '../../../../ui/charts/chartSetup.js';
import { getChartTheme, chartJsTooltip } from '../../../../ui/charts/chartTheme.js';
import { formatK } from '../../../../ui/format.js';

function destroyChart(canvas) {
  const existing = Chart.getChart(canvas);
  if (existing) existing.destroy();
}

/** Bar compare of Low / Med / High median ending balances. */
export function drawSavingsImpact(canvas, result) {
  if (!canvas || !result?.savingsImpact) return;
  destroyChart(canvas);
  const theme = getChartTheme();
  const impact = result.savingsImpact;
  const labels = ['Low (0.5×)', 'Med (1×)', 'High (1.5×)'];
  const medians = [
    impact.low?.ending?.median ?? 0,
    impact.med?.ending?.median ?? 0,
    impact.high?.ending?.median ?? 0,
  ];
  const p10 = [
    impact.low?.ending?.p10 ?? 0,
    impact.med?.ending?.p10 ?? 0,
    impact.high?.ending?.p10 ?? 0,
  ];
  const p90 = [
    impact.low?.ending?.p90 ?? 0,
    impact.med?.ending?.p90 ?? 0,
    impact.high?.ending?.p90 ?? 0,
  ];

  new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'P10',
          data: p10,
          backgroundColor: theme.tornadoMuted,
        },
        {
          label: 'Median',
          data: medians,
          backgroundColor: theme.accentFill,
        },
        {
          label: 'P90',
          data: p90,
          backgroundColor: theme.tornadoHighEnd,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: theme.legend, boxWidth: 12 } },
        tooltip: {
          ...chartJsTooltip(theme),
          callbacks: { label: (ctx) => `${ctx.dataset.label}: ${formatK(ctx.parsed.y)}` },
        },
      },
      scales: {
        x: { ticks: { color: theme.axisTick }, grid: { display: false } },
        y: {
          ticks: { color: theme.axisTick, callback: (v) => formatK(v) },
          grid: { color: theme.gridLine },
        },
      },
    },
  });
}
