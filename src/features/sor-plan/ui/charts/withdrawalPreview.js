// Live preview of the specific-withdrawal list entered in the form. Shares
// its chart look with the Base + Spending Over Time preview (see
// schedulePreviewChart.js).
import {
  fitSpecificWithdrawalsToHorizon,
  normalizeSpecificWithdrawalFloors,
  parseSpecificWithdrawals,
  readSpecificWithdrawalFloorsFromDom,
  normalizeGiftingTiers,
  readGiftingTiersFromDom,
  toDollars,
} from '../../state/scenario.js';
import { buildSpecificWithdrawalFloorSeries, buildGiftingSeries } from '../../core/withdrawal.js';
import { buildSchedulePreviewChart, renderSchedulePreviewTotal } from './schedulePreviewChart.js';
import { onThemeChange } from '../theme.js';

let previewChart = null;
let pendingFrame = null;
let lastAmounts = null;
let lastFloorSeries = null;
let lastGiftAmounts = null;

function isSectionVisible() {
  const preview = document.getElementById('specific-schedule-preview');
  return preview && !preview.classList.contains('hidden');
}

function readPreviewData(raw) {
  const numYears = parseInt(document.getElementById('numYears')?.value, 10) || 40;
  const amounts = fitSpecificWithdrawalsToHorizon(parseSpecificWithdrawals(raw), numYears);
  const floorSeries = buildSpecificWithdrawalFloorSeries(
    normalizeSpecificWithdrawalFloors(readSpecificWithdrawalFloorsFromDom()),
    amounts,
    numYears,
  );
  const giftingSeries = buildGiftingSeries(
    normalizeGiftingTiers(readGiftingTiersFromDom()),
    numYears,
    toDollars,
  );
  const giftAmounts = giftingSeries.map((entry) => entry.amount);
  return { amounts, floorSeries, giftAmounts };
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
  lastGiftAmounts = null;
}

function renderPreview(amounts, floorSeries, giftAmounts) {
  const canvas = document.getElementById('specificWithdrawalsChart');
  if (!canvas || !isSectionVisible()) return;

  if (canvas.clientWidth === 0 || canvas.clientHeight === 0) {
    pendingFrame = requestAnimationFrame(() => renderPreview(amounts, floorSeries, giftAmounts));
    return;
  }

  if (previewChart) {
    previewChart.destroy();
    previewChart = null;
  }

  previewChart = buildSchedulePreviewChart(canvas, amounts, floorSeries, { floorStepped: false, giftAmounts });
  renderSchedulePreviewTotal('specificWithdrawalsChartTotal', amounts);
}

export function updateWithdrawalPreviewChart(amounts, floorSeries = null, giftAmounts = null) {
  lastAmounts = amounts;
  lastFloorSeries = floorSeries;
  lastGiftAmounts = giftAmounts;
  if (!isSectionVisible()) return;

  if (pendingFrame) cancelAnimationFrame(pendingFrame);
  pendingFrame = requestAnimationFrame(() => {
    pendingFrame = requestAnimationFrame(() => {
      pendingFrame = null;
      renderPreview(amounts, floorSeries, giftAmounts);
    });
  });
}

export function syncWithdrawalPreview(raw) {
  const { amounts, floorSeries, giftAmounts } = readPreviewData(raw);
  updateWithdrawalPreviewChart(amounts, floorSeries, giftAmounts);
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
  if (lastAmounts && isSectionVisible()) renderPreview(lastAmounts, lastFloorSeries, lastGiftAmounts);
});

if (typeof window !== 'undefined') {
  window.__TEST_HOOKS__ = window.__TEST_HOOKS__ || {};
  window.__TEST_HOOKS__.specificSchedulePreview = () => {
    if (!previewChart) return null;
    const min = previewChart.data.datasets.find((d) => d.label === 'Minimum');
    return {
      labels: previewChart.data.labels?.length ?? 0,
      hasMinimum: !!min,
      minimumFirst: min?.data?.[0] ?? null,
      withdrawalFirst: previewChart.data.datasets[0]?.data?.[0] ?? null,
    };
  };
}
