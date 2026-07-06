// Live preview of the specific-withdrawal list entered in the form. Shares
// its chart look with the Base + Spending Over Time preview (see
// schedulePreviewChart.js).
import {
  fitSpecificWithdrawalsToHorizon,
  normalizeSpecificWithdrawalFloors,
  parseSpecificWithdrawals,
  readSpecificWithdrawalFloorsFromDom,
} from '../../state/scenario.js';
import { buildSpecificWithdrawalFloorSeries } from '../../core/withdrawal.js';
import { buildSchedulePreviewChart, renderSchedulePreviewTotal } from './schedulePreviewChart.js';
import { onThemeChange } from '../theme.js';

let previewChart = null;
let pendingFrame = null;
let lastAmounts = null;
let lastFloorSeries = null;

function isSectionVisible() {
  const section = document.getElementById('strategy-specific-section');
  return section && !section.classList.contains('hidden');
}

function readPreviewData(raw) {
  const numYears = parseInt(document.getElementById('numYears')?.value, 10) || 40;
  const amounts = fitSpecificWithdrawalsToHorizon(parseSpecificWithdrawals(raw), numYears);
  const floorSeries = buildSpecificWithdrawalFloorSeries(
    normalizeSpecificWithdrawalFloors(readSpecificWithdrawalFloorsFromDom()),
    amounts,
    numYears,
  );
  return { amounts, floorSeries };
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
  lastFloorSeries = null;
}

function renderPreview(amounts, floorSeries) {
  const canvas = document.getElementById('specificWithdrawalsChart');
  if (!canvas || !isSectionVisible()) return;

  if (canvas.clientWidth === 0 || canvas.clientHeight === 0) {
    pendingFrame = requestAnimationFrame(() => renderPreview(amounts, floorSeries));
    return;
  }

  if (previewChart) {
    previewChart.destroy();
    previewChart = null;
  }

  previewChart = buildSchedulePreviewChart(canvas, amounts, floorSeries, { floorStepped: false });
  renderSchedulePreviewTotal('specificWithdrawalsChartTotal', amounts);
}

export function updateWithdrawalPreviewChart(amounts, floorSeries = null) {
  lastAmounts = amounts;
  lastFloorSeries = floorSeries;
  if (!isSectionVisible()) return;

  if (pendingFrame) cancelAnimationFrame(pendingFrame);
  pendingFrame = requestAnimationFrame(() => {
    pendingFrame = requestAnimationFrame(() => {
      pendingFrame = null;
      renderPreview(amounts, floorSeries);
    });
  });
}

export function syncWithdrawalPreview(raw) {
  const { amounts, floorSeries } = readPreviewData(raw);
  updateWithdrawalPreviewChart(amounts, floorSeries);
}

export function syncWithdrawalPreviewFromForm() {
  const raw = document.getElementById('specificWithdrawals')?.value ?? '';
  syncWithdrawalPreview(raw);
}

export function resizeWithdrawalPreviewChart() {
  if (!previewChart || !isSectionVisible()) return;
  previewChart.resize();
  previewChart.update('none');
}

onThemeChange(() => {
  if (lastAmounts && isSectionVisible()) renderPreview(lastAmounts, lastFloorSeries);
});
