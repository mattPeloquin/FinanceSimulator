// Live preview of the specific-withdrawal list entered in the form.
import { parseSpecificWithdrawals } from '../../state/scenario.js';
import { Chart } from './chartSetup.js';
import { formatK } from '../format.js';

let previewChart = null;
let pendingFrame = null;

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
}

function buildChart(canvas, amounts) {
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
          title: { display: true, text: 'Year', font: { size: 10 } },
          ticks: { maxTicksLimit: 12, font: { size: 9 } },
        },
        y: {
          beginAtZero: true,
          ticks: { callback: (v) => formatK(v), font: { size: 9 } },
        },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
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

  // Chart.js reads parent size at init — skip if layout hasn't run yet.
  if (canvas.clientWidth === 0 || canvas.clientHeight === 0) {
    pendingFrame = requestAnimationFrame(() => renderPreview(amounts));
    return;
  }

  if (previewChart) {
    previewChart.data.labels = amounts.map((_, i) => String(i + 1));
    previewChart.data.datasets[0].data = amounts;
    previewChart.data.datasets[0].pointRadius = amounts.length <= 40 ? 3 : 0;
    previewChart.update();
    previewChart.resize();
    return;
  }

  previewChart = buildChart(canvas, amounts);
}

export function updateWithdrawalPreviewChart(amounts) {
  if (!isSectionVisible()) return;

  if (pendingFrame) cancelAnimationFrame(pendingFrame);
  // Wait for the section to finish laying out after becoming visible.
  pendingFrame = requestAnimationFrame(() => {
    pendingFrame = requestAnimationFrame(() => {
      pendingFrame = null;
      renderPreview(amounts);
    });
  });
}

export function syncWithdrawalPreview(raw) {
  updateWithdrawalPreviewChart(parseSpecificWithdrawals(raw));
}

export function resizeWithdrawalPreviewChart() {
  if (!previewChart || !isSectionVisible()) return;
  previewChart.resize();
  previewChart.update('none');
}
