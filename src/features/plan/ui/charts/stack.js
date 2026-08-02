// Lifetime Plan charts — stacked annual cashflows + cumulative net line.

import { Chart } from '../../../../ui/charts/chartSetup.js';
import { getChartTheme, chartJsTooltip } from '../../../../ui/charts/chartTheme.js';
import { formatK } from '../../../../ui/format.js';

const SOURCE_COLORS = [
  'rgba(79, 70, 229, 0.75)',
  'rgba(16, 185, 129, 0.75)',
  'rgba(245, 158, 11, 0.75)',
  'rgba(239, 68, 68, 0.75)',
  'rgba(59, 130, 246, 0.75)',
  'rgba(168, 85, 247, 0.75)',
  'rgba(20, 184, 166, 0.75)',
  'rgba(244, 63, 94, 0.75)',
];

function moneyTick(v) {
  if (!Number.isFinite(v)) return '';
  if (Math.abs(v) >= 1000) return `$${formatK(v)}k`;
  return `$${Math.round(v)}`;
}

/**
 * Collect finite values from source series + net for y-axis bounds.
 * Chart.js stacks positives and negatives separately; we still force the
 * axis through 0 and include the most negative outflow so bars below zero
 * are never clipped away.
 * @param {object} planResult
 * @returns {{ min: number, max: number }}
 */
export function cashflowAxisBounds(planResult) {
  const vals = [];
  const meta = planResult?.sourceMeta || [];
  for (const src of meta) {
    for (const v of planResult.bySource?.[src.id] || []) {
      if (Number.isFinite(v)) vals.push(v);
    }
  }
  for (const v of planResult?.net || []) {
    if (Number.isFinite(v)) vals.push(v);
  }
  if (!vals.length) return { min: 0, max: 1 };
  const rawMin = Math.min(0, ...vals);
  const rawMax = Math.max(0, ...vals);
  const pad = Math.max(Math.abs(rawMax), Math.abs(rawMin), 1) * 0.05;
  return {
    // Keep a sliver above zero when the series is all outflows so the $0 line
    // is not glued to the top edge (reads as “empty chart” at a glance).
    min: rawMin < 0 ? rawMin - pad : 0,
    max: rawMax > 0 ? rawMax + pad : pad,
  };
}

/**
 * @param {HTMLCanvasElement|null} canvas
 * @param {object} planResult
 * @param {import('chart.js').Chart|null} existing
 * @returns {import('chart.js').Chart|null}
 */
export function drawPlanStackChart(canvas, planResult, existing = null) {
  if (existing) existing.destroy();
  if (!canvas || !planResult?.years?.length) return null;

  const theme = getChartTheme();
  const years = planResult.years;
  const meta = planResult.sourceMeta || [];
  const { min: yMin, max: yMax } = cashflowAxisBounds(planResult);

  // Diverging stacks: Chart.js stacks same-sign values together. Put inflows
  // and outflows in separate stack ids so outflows always paint below zero
  // even when mixed with inflows in the same year.
  /** @type {import('chart.js').ChartDataset[]} */
  const datasets = [];
  meta.forEach((src, i) => {
    const raw = planResult.bySource?.[src.id] || years.map(() => 0);
    const color = SOURCE_COLORS[i % SOURCE_COLORS.length];
    const label = src.label || src.feature;
    const positives = raw.map((v) => (Number(v) > 0 ? Number(v) : 0));
    const negatives = raw.map((v) => (Number(v) < 0 ? Number(v) : 0));
    const hasPos = positives.some((v) => v !== 0);
    const hasNeg = negatives.some((v) => v !== 0);

    if (hasPos) {
      datasets.push({
        type: 'bar',
        label,
        data: positives,
        backgroundColor: color,
        stack: 'in',
        order: 2,
      });
    }
    if (hasNeg) {
      datasets.push({
        type: 'bar',
        label: hasPos ? `${label} (out)` : label,
        data: negatives,
        backgroundColor: color,
        stack: 'out',
        order: 2,
      });
    }
    if (!hasPos && !hasNeg) {
      datasets.push({
        type: 'bar',
        label,
        data: positives,
        backgroundColor: color,
        stack: 'in',
        order: 2,
      });
    }
  });

  datasets.push({
    type: 'line',
    label: 'Net',
    data: planResult.net || [],
    borderColor: theme.accent || 'rgba(79, 70, 229, 1)',
    backgroundColor: 'transparent',
    borderWidth: 2,
    tension: 0.15,
    pointRadius: 0,
    order: 1,
    // Do not stack the net line with the bars — overlay only.
    yAxisID: 'y',
  });

  return new Chart(canvas, {
    type: 'bar',
    data: { labels: years, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'bottom' },
        tooltip: {
          ...chartJsTooltip(theme),
          filter(item) {
            // Skip zero segments from the split in/out datasets.
            const v = item.parsed?.y;
            return Number.isFinite(v) && v !== 0;
          },
          callbacks: {
            label(ctx) {
              const v = ctx.parsed?.y;
              if (!Number.isFinite(v)) return `${ctx.dataset.label}: —`;
              const sign = v < 0 ? '-' : '';
              return `${ctx.dataset.label}: ${sign}$${formatK(Math.abs(v))}k`;
            },
          },
        },
      },
      scales: {
        x: {
          stacked: true,
          title: { display: true, text: 'Calendar year' },
          grid: { color: theme.gridLine },
        },
        y: {
          stacked: true,
          beginAtZero: true,
          min: yMin,
          max: yMax,
          title: { display: true, text: 'Real $ (+ in / − out)' },
          ticks: { callback: moneyTick },
          grid: { color: theme.gridLine },
        },
      },
    },
  });
}

/**
 * @param {HTMLCanvasElement|null} canvas
 * @param {object} planResult
 * @param {import('chart.js').Chart|null} existing
 * @returns {import('chart.js').Chart|null}
 */
export function drawPlanCumulativeChart(canvas, planResult, existing = null) {
  if (existing) existing.destroy();
  if (!canvas || !planResult?.years?.length) return null;

  const theme = getChartTheme();
  return new Chart(canvas, {
    type: 'line',
    data: {
      labels: planResult.years,
      datasets: [{
        label: 'Cumulative net',
        data: planResult.cumulative || [],
        borderColor: theme.accent || 'rgba(79, 70, 229, 1)',
        backgroundColor: 'rgba(79, 70, 229, 0.12)',
        fill: true,
        tension: 0.15,
        pointRadius: 0,
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
            label(ctx) {
              return `Cumulative: $${formatK(ctx.parsed?.y)}k`;
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
          title: { display: true, text: 'Real $' },
          ticks: { callback: moneyTick },
          grid: { color: theme.gridLine },
        },
      },
    },
  });
}
