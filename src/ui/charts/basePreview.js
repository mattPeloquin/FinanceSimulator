// Live sparkline of the "Base + Spending Over Time" withdrawal schedule:
// the base annual withdrawal, staged by spending-over-time tiers, then
// clamped up to the staged minimum-withdrawal floor (mirroring simulatePath's
// unadjustedTarget), all before any market/balance guardrail adjustments are
// layered on at run time.
// Shares its chart look with the Specific List preview (see
// schedulePreviewChart.js).
import {
  parseCurrency,
  MONEY_SCALE,
  toDollars,
  normalizeWithdrawalFloors,
  readWithdrawalFloorsFromDom,
  normalizeGiftingTiers,
  readGiftingTiersFromDom,
  normalizeSpendingOverTimeTiers,
  readSpendingOverTimeTiersFromDom,
} from '../../state/scenario.js';
import {
  buildWithdrawalFloorSeries,
  buildGiftingSeries,
  buildSpendingOverTimeSeries,
  buildBaseWithdrawalSchedule,
} from '../../core/withdrawal.js';
import { buildSchedulePreviewChart, renderSchedulePreviewTotal } from './schedulePreviewChart.js';
import { onThemeChange } from '../theme.js';

let previewChart = null;
let pendingFrame = null;

function isSectionVisible() {
  const preview = document.getElementById('base-schedule-preview');
  return preview && !preview.classList.contains('hidden');
}

export function destroyBaseWithdrawalPreviewChart() {
  if (pendingFrame) {
    cancelAnimationFrame(pendingFrame);
    pendingFrame = null;
  }
  if (previewChart) {
    previewChart.destroy();
    previewChart = null;
  }
}

function readScheduleInputsFromForm() {
  const numYears = parseInt(document.getElementById('numYears')?.value, 10) || 40;
  const base = parseCurrency(document.getElementById('baseWithdrawal')?.value) * MONEY_SCALE;
  const spendingTiers = normalizeSpendingOverTimeTiers(readSpendingOverTimeTiersFromDom());
  const spendingSeries = buildSpendingOverTimeSeries(spendingTiers, numYears, toDollars);
  return { numYears, base, spendingSeries };
}

function buildSchedule({ numYears, base, spendingSeries, floorSeries }) {
  const amounts = buildBaseWithdrawalSchedule(base, spendingSeries, numYears);
  for (let j = 0; j < numYears; j++) {
    const yearFloor = floorSeries?.[j] ?? 0;
    if (amounts[j] >= 0 && yearFloor > 0) {
      amounts[j] = Math.max(amounts[j], yearFloor);
    }
  }
  return amounts;
}

function renderPreview() {
  const canvas = document.getElementById('baseWithdrawalPreviewChart');
  if (!canvas || !isSectionVisible()) return;

  if (canvas.clientWidth === 0 || canvas.clientHeight === 0) {
    pendingFrame = requestAnimationFrame(renderPreview);
    return;
  }

  const scheduleInputs = readScheduleInputsFromForm();
  const floorSeries = buildWithdrawalFloorSeries(
    normalizeWithdrawalFloors(readWithdrawalFloorsFromDom()),
    scheduleInputs.numYears,
    toDollars,
  );
  const amounts = buildSchedule({ ...scheduleInputs, floorSeries });
  const giftingSeries = buildGiftingSeries(
    normalizeGiftingTiers(readGiftingTiersFromDom()),
    scheduleInputs.numYears,
    toDollars,
  );
  const giftAmounts = giftingSeries.map((entry) => entry.amount);
  if (previewChart) {
    previewChart.destroy();
    previewChart = null;
  }
  previewChart = buildSchedulePreviewChart(canvas, amounts, floorSeries, { giftAmounts });
  renderSchedulePreviewTotal('baseWithdrawalPreviewTotal', amounts);
}

export function syncBaseWithdrawalPreview() {
  if (!isSectionVisible()) return;
  if (pendingFrame) cancelAnimationFrame(pendingFrame);
  pendingFrame = requestAnimationFrame(() => {
    pendingFrame = requestAnimationFrame(() => {
      pendingFrame = null;
      renderPreview();
    });
  });
}

export function resizeBaseWithdrawalPreviewChart() {
  if (!previewChart || !isSectionVisible()) return;
  previewChart.resize();
  previewChart.update('none');
}

onThemeChange(() => {
  if (isSectionVisible()) renderPreview();
});
