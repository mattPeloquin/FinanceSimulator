// Live preview of the specific-withdrawal list entered in the form. Shares
// its chart look with the Base + Spending Over Time preview (see
// schedulePreviewChart.js).
import { fitSpecificWithdrawalsToHorizon, parseSpecificWithdrawals } from '../../state/scenario.js';
import { buildSchedulePreviewChart, renderSchedulePreviewTotal } from './schedulePreviewChart.js';
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

  previewChart = buildSchedulePreviewChart(canvas, amounts);
  renderSchedulePreviewTotal('specificWithdrawalsChartTotal', amounts);
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
