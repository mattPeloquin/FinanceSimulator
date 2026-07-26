// Shared line-chart builder for the small withdrawal-schedule "spark charts"
// used by both the Base + Spending Over Time and Specific List sections, so
// the two look and behave identically (same axes, tooltip, and total label).
import { Chart } from './chartSetup.js';
import { formatK } from '../format.js';
import { getChartTheme, chartJsTooltip } from './chartTheme.js';
import { buildGiftOverlaySeries } from '../../core/withdrawal.js';

// `floorSeries`, when given and it contains any positive value, is drawn as a
// dashed reference line — a guide for the minimum-withdrawal backstop that
// sits alongside the schedule without changing the schedule's own values.
// `floorStepped` (default true): use Chart.js stepped rendering for flat
// dollar tiers (Base strategy). Set false for percentage floors that scale
// with each year's list amount (Specific List) so the line follows the schedule shape.
function clampToWithdrawals(values) {
  return values.map((v) => Math.max(0, v));
}

export function buildSchedulePreviewChart(canvas, amounts, floorSeries = null, { floorStepped = true, giftAmounts = null, eventAmounts = null } = {}) {
  const theme = getChartTheme();
  const labels = amounts.map((_, i) => String(i + 1));
  const displayAmounts = clampToWithdrawals(amounts);
  const displayFloor = Array.isArray(floorSeries) ? clampToWithdrawals(floorSeries) : null;
  const showFloor = displayFloor?.some((v) => v > 0);
  const giftOverlay = Array.isArray(giftAmounts)
    ? buildGiftOverlaySeries(displayAmounts, giftAmounts)
    : null;
  const showGift = giftOverlay?.some((v) => v != null);
  const events = Array.isArray(eventAmounts) ? eventAmounts : null;
  const eventMarkers = events
    ? displayAmounts.map((y, j) => (events[j] !== 0 ? y : null))
    : null;
  const showEvents = eventMarkers?.some((v) => v != null);

  const datasets = [
    {
      label: 'Withdrawal',
      data: displayAmounts,
      borderColor: theme.accent,
      backgroundColor: theme.accentFillSoft,
      borderWidth: 2,
      tension: 0.1,
      pointRadius: displayAmounts.length <= 40 ? 3 : 0,
      pointHoverRadius: 4,
      fill: true,
      order: 1,
    },
  ];

  if (showFloor) {
    datasets.push({
      label: 'Minimum',
      data: displayFloor,
      borderColor: theme.floorLine,
      backgroundColor: 'transparent',
      borderWidth: 1.5,
      borderDash: [4, 3],
      ...(floorStepped ? { stepped: 'before' } : { tension: 0.1 }),
      pointRadius: 0,
      pointHoverRadius: 3,
      fill: false,
      order: 0,
    });
  }

  if (showGift) {
    datasets.push({
      label: 'Gift',
      data: giftOverlay,
      borderColor: theme.giftLine,
      backgroundColor: 'transparent',
      borderWidth: 1,
      borderDash: [2, 2],
      tension: 0.1,
      pointRadius: 0,
      pointHoverRadius: 3,
      fill: false,
      order: 2,
      spanGaps: false,
    });
  }

  if (showEvents) {
    datasets.push({
      label: 'Event',
      data: eventMarkers,
      showLine: false,
      spanGaps: false,
      borderColor: theme.eventMarker,
      backgroundColor: theme.eventMarker,
      pointRadius: 5,
      pointHoverRadius: 6,
      fill: false,
      order: 3,
    });
  }

  return new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: {
          ticks: { maxTicksLimit: 8, font: { size: 9 }, color: theme.axisTick },
          grid: { display: false },
        },
        y: {
          beginAtZero: true,
          min: 0,
          ticks: { maxTicksLimit: 5, font: { size: 9 }, callback: (v) => `$${formatK(v)}`, color: theme.axisTick },
          grid: { color: theme.gridLine },
        },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          ...chartJsTooltip(theme),
          displayColors: false,
          callbacks: {
            title: (items) => `Year ${items[0].label}`,
            label: (ctx) => {
              if (ctx.dataset.label === 'Minimum') return `Minimum: ${formatK(ctx.parsed.y)}k`;
              if (ctx.dataset.label === 'Gift') return `Gift ceiling: ${formatK(ctx.parsed.y)}k`;
              if (ctx.dataset.label === 'Event') {
                const ev = events?.[ctx.dataIndex] ?? 0;
                if (!ev) return null;
                const sign = ev > 0 ? '+' : '';
                return `Event: ${sign}${formatK(ev)}k`;
              }
              return `Withdrawal: ${formatK(ctx.parsed.y)}k`;
            },
          },
        },
      },
    },
  });
}

// Deposits (negative schedule years) are omitted from the preview chart and total.
export function renderSchedulePreviewTotal(totalLabelId, amounts) {
  const label = document.getElementById(totalLabelId);
  if (!label) return;
  const total = amounts.reduce((sum, v) => sum + (v > 0 ? v : 0), 0);
  label.textContent = `Total: $${formatK(total)}`;
}
