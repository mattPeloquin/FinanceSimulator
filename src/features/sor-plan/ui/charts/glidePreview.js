// Live sparkline of the glide-path spend-down: the per-year balance required
// to fund the remaining plan and land on the glide target (y) across the
// horizon (x), for the target / spend-timing values currently in the form.
// Years where the portfolio sits above this declining path recycle surplus
// into extra spending, so the chart shows exactly when the lever can engage.
// Hidden while the glide target is blank (lever off).
import { Chart } from './chartSetup.js';
import {
  parseCurrency,
  MONEY_SCALE,
  toDollars,
  normalizeSpendingOverTimeTiers,
  readSpendingOverTimeTiersFromDom,
  parseSpecificWithdrawals,
  fitSpecificWithdrawalsToHorizon,
} from '../../state/scenario.js';
import {
  buildSpendingOverTimeSeries,
  buildBaseWithdrawalSchedule,
  buildGlideRequiredBalances,
} from '../../core/withdrawal.js';
import { formatK } from '../format.js';
import { getChartTheme, chartJsTooltip } from './chartTheme.js';
import { onThemeChange } from '../theme.js';

let sparkChart = null;
let pendingFrame = null;

function isSectionVisible() {
  const wrapper = document.getElementById('dynamic-adjustments-wrapper');
  return wrapper && !wrapper.classList.contains('hidden');
}

function readGlideInputsFromForm() {
  const targetRaw = document.getElementById('glideTarget')?.value ?? '';
  const target = targetRaw.trim() === '' ? null : parseCurrency(targetRaw) * MONEY_SCALE;
  const rate = (parseFloat(document.getElementById('glideRate')?.value) || 0) / 100;
  const numYears = parseInt(document.getElementById('numYears')?.value, 10) || 40;
  const strategy = document.querySelector('input[name="withdrawal-strategy"]:checked')?.value || 'base';
  return { target, rate, numYears, strategy };
}

// The unadjusted per-year plan the glide path must keep funding — mirrors the
// engine's unadjustedTarget (schedule or specific list, clamped at 0 for
// non-deposit years). The minimum floor is applied at run time, not here.
function readPlanFromForm({ numYears, strategy }) {
  if (strategy === 'specific') {
    const raw = document.getElementById('specificWithdrawals')?.value ?? '';
    const amounts = fitSpecificWithdrawalsToHorizon(parseSpecificWithdrawals(raw), numYears);
    return amounts.map((amount) => amount);
  }

  const base = parseCurrency(document.getElementById('baseWithdrawal')?.value) * MONEY_SCALE;
  const spendingSeries = buildSpendingOverTimeSeries(
    normalizeSpendingOverTimeTiers(readSpendingOverTimeTiersFromDom()),
    numYears,
    toDollars,
  );
  return buildBaseWithdrawalSchedule(base, spendingSeries, numYears);
}

function buildChart(canvas, required, target) {
  const theme = getChartTheme();
  const labels = required.map((_, j) => j + 1);
  return new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Glide path',
          data: required,
          borderColor: theme.accent,
          backgroundColor: theme.accentFillSofter,
          borderWidth: 2,
          tension: 0,
          pointRadius: 0,
          pointHoverRadius: 3,
          fill: 'origin',
        },
        {
          label: 'Target',
          data: required.map(() => target),
          borderColor: theme.planLine,
          borderWidth: 1.5,
          borderDash: [4, 4],
          pointRadius: 0,
          pointHoverRadius: 0,
          fill: false,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: {
          title: { display: true, text: 'Year', font: { size: 9 }, color: theme.axisTitle },
          ticks: { maxTicksLimit: 8, font: { size: 9 }, color: theme.axisTick },
          grid: { display: false },
        },
        y: {
          beginAtZero: true,
          ticks: { maxTicksLimit: 5, font: { size: 9 }, callback: (v) => formatK(v), color: theme.axisTick },
          grid: { color: theme.gridLine },
        },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          ...chartJsTooltip(theme),
          displayColors: false,
          filter: (item) => item.datasetIndex === 0,
          callbacks: {
            title: (items) => (items.length ? `Year ${items[0].label}` : ''),
            label: (ctx) => `Spend surplus above ${formatK(ctx.parsed.y)}`,
          },
        },
      },
    },
  });
}

function renderSparkline() {
  const wrapper = document.getElementById('glide-preview-wrapper');
  const canvas = document.getElementById('glidePreviewChart');
  if (!wrapper || !canvas || !isSectionVisible()) return;

  const { target, rate, numYears, strategy } = readGlideInputsFromForm();
  // Blank target = lever off: collapse the preview instead of charting a path
  // that would never apply.
  if (target == null || !Number.isFinite(target) || numYears <= 0) {
    wrapper.classList.add('hidden');
    if (sparkChart) {
      sparkChart.destroy();
      sparkChart = null;
    }
    return;
  }
  wrapper.classList.remove('hidden');

  if (canvas.clientWidth === 0 || canvas.clientHeight === 0) {
    pendingFrame = requestAnimationFrame(renderSparkline);
    return;
  }

  const plan = readPlanFromForm({ numYears, strategy });
  const required = buildGlideRequiredBalances(plan, target, rate);
  if (sparkChart) {
    sparkChart.destroy();
    sparkChart = null;
  }
  sparkChart = buildChart(canvas, required, target);
}

export function syncGlidePreview() {
  if (!isSectionVisible()) return;
  if (pendingFrame) cancelAnimationFrame(pendingFrame);
  pendingFrame = requestAnimationFrame(() => {
    pendingFrame = requestAnimationFrame(() => {
      pendingFrame = null;
      renderSparkline();
    });
  });
}

onThemeChange(() => {
  if (isSectionVisible()) renderSparkline();
});
