// Live preview of the specific-withdrawal list entered in the form.
import { fitSpecificWithdrawalsToHorizon, parseSpecificWithdrawals } from '../../state/scenario.js';
import { Chart } from './chartSetup.js';
import { formatK } from '../format.js';
import { getChartTheme, chartJsTooltip } from './chartTheme.js';
import { onThemeChange } from '../theme.js';

let previewChart = null;
let pendingFrame = null;
let lastAmounts = null;

function isSectionVisible() {
  const section = document.getElementById('strategy-specific-section');
  return section && !section.classList.contains('hidden');
}

export function destroyWithdrawalPreviewChart() {
  if (pendingFrame) {
    cancelAnimationFrame(pendingFrame);
    pendingFrame = null;
  }
  if (previewChart) {
    previewChart.destroy();
    previewChart = null;
  }
  lastAmounts = null;
}

function buildChart(canvas, amounts) {
  const theme = getChartTheme();
  const labels = amounts.map((_, i) => String(i + 1));
  return new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Withdrawal',
          data: amounts,
          borderColor: '#4f46e5',
          backgroundColor: 'rgba(79, 70, 229, 0.12)',
          borderWidth: 2,
          tension: 0.1,
          pointRadius: amounts.length <= 40 ? 3 : 0,
          pointHoverRadius: 4,
          fill: true,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      scales: {
        x: {
          title: { display: true, text: 'Year', font: { size: 10 }, color: theme.axisTitle },
          ticks: { maxTicksLimit: 12, font: { size: 9 }, color: theme.axisTick },
          grid: { color: theme.gridLine },
        },
        y: {
          beginAtZero: true,
          ticks: { callback: (v) => formatK(v), font: { size: 9 }, color: theme.axisTick },
          grid: { color: theme.gridLine },
        },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          ...chartJsTooltip(theme),
          callbacks: {
            label: (ctx) => ` ${formatK(ctx.raw)}`,
          },
        },
      },
    },
  });
}

function renderPreview(amounts) {
  const canvas = document.getElementById('specificWithdrawalsChart');
  if (!canvas || !isSectionVisible()) return;

  if (canvas.clientWidth === 0 || canvas.clientHeight === 0) {
    pendingFrame = requestAnimationFrame(() => renderPreview(amounts));
    return;
  }

  if (previewChart) {
    previewChart.destroy();
    previewChart = null;
  }

  previewChart = buildChart(canvas, amounts);
}

export function updateWithdrawalPreviewChart(amounts) {
  lastAmounts = amounts;
  if (!isSectionVisible()) return;

  if (pendingFrame) cancelAnimationFrame(pendingFrame);
  pendingFrame = requestAnimationFrame(() => {
    pendingFrame = requestAnimationFrame(() => {
      pendingFrame = null;
      renderPreview(amounts);
    });
  });
}

export function syncWithdrawalPreview(raw) {
  const numYears = parseInt(document.getElementById('numYears')?.value, 10) || 40;
  const amounts = fitSpecificWithdrawalsToHorizon(parseSpecificWithdrawals(raw), numYears);
  updateWithdrawalPreviewChart(amounts);
}

export function resizeWithdrawalPreviewChart() {
  if (!previewChart || !isSectionVisible()) return;
  previewChart.resize();
  previewChart.update('none');
}

onThemeChange(() => {
  if (lastAmounts && isSectionVisible()) renderPreview(lastAmounts);
});
