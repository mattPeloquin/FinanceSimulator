// Lifetime Plan net-worth chart — median line + P10/P90 band.

import { Chart } from '../../../../ui/charts/chartSetup.js';
import { getChartTheme, chartJsTooltip } from '../../../../ui/charts/chartTheme.js';
import { formatK } from '../../../../ui/format.js';

function moneyTick(v) {
  if (!Number.isFinite(v)) return '';
  if (Math.abs(v) >= 1000) return `$${formatK(v)}k`;
  return `$${Math.round(v)}`;
}

/**
 * @param {HTMLCanvasElement|null} canvas
 * @param {object} planResult - includes netWorth from composeNetWorth
 * @param {import('chart.js').Chart|null} existing
 * @returns {import('chart.js').Chart|null}
 */
export function drawPlanNetWorthChart(canvas, planResult, existing = null) {
  if (existing) existing.destroy();
  const nw = planResult?.netWorth;
  if (!canvas || !nw?.years?.length) return null;

  const theme = getChartTheme();
  const years = nw.years;
  const median = nw.netWorth?.median || [];
  const low = nw.netWorth?.low || [];
  const high = nw.netWorth?.high || [];

  // Band as two datasets: high fill down to median, low as baseline fill.
  // Chart.js fill-to-previous pattern for a simple envelope.
  return new Chart(canvas, {
    type: 'line',
    data: {
      labels: years,
      datasets: [
        {
          label: 'P90',
          data: high,
          borderColor: 'transparent',
          backgroundColor: 'rgba(79, 70, 229, 0.12)',
          fill: '+1',
          pointRadius: 0,
          tension: 0.15,
          order: 3,
        },
        {
          label: 'P10',
          data: low,
          borderColor: 'transparent',
          backgroundColor: 'rgba(79, 70, 229, 0.12)',
          fill: false,
          pointRadius: 0,
          tension: 0.15,
          order: 2,
        },
        {
          label: 'Median net worth',
          data: median,
          borderColor: theme.accent || 'rgba(79, 70, 229, 1)',
          backgroundColor: 'transparent',
          borderWidth: 2.5,
          pointRadius: 0,
          tension: 0.15,
          order: 1,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'bottom' },
        tooltip: {
          ...chartJsTooltip(theme),
          callbacks: {
            label(ctx) {
              const v = ctx.parsed?.y;
              if (!Number.isFinite(v)) return `${ctx.dataset.label}: —`;
              return `${ctx.dataset.label}: $${formatK(v)}k`;
            },
          },
        },
      },
      scales: {
        x: {
          title: { display: true, text: 'Calendar year' },
          grid: { color: theme.gridLine },
        },
        y: {
          title: { display: true, text: 'Real $ (portfolio + home equity)' },
          ticks: { callback: moneyTick },
          grid: { color: theme.gridLine },
        },
      },
    },
  });
}
