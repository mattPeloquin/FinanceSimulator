// Live sparkline of the "Base + Spending Over Time" withdrawal schedule:
// the base annual withdrawal, front-loaded by the annual real change and
// boosted by the early-years bonus, then clamped up to the staged minimum-
// withdrawal floor (mirroring simulatePath's unadjustedTarget), all before
// any market/balance guardrail adjustments are layered on at run time.
// Shares its chart look with the Specific List preview (see
// schedulePreviewChart.js).
import { parseCurrency, MONEY_SCALE, toDollars, normalizeWithdrawalFloors, readWithdrawalFloorsFromDom } from '../../state/scenario.js';
import { buildWithdrawalFloorSeries } from '../../core/withdrawal.js';
import { buildSchedulePreviewChart, renderSchedulePreviewTotal } from './schedulePreviewChart.js';
import { onThemeChange } from '../theme.js';

let previewChart = null;
let pendingFrame = null;

function isSectionVisible() {
  const section = document.getElementById('strategy-base-section');
  return section && !section.classList.contains('hidden');
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
  const spendChangeRate = (parseFloat(document.getElementById('spendChangePct')?.value) || 0) / 100;
  const goGoBonus = parseCurrency(document.getElementById('goGoBonus')?.value) * MONEY_SCALE;
  const goGoYears = parseInt(document.getElementById('goGoYears')?.value, 10) || 0;
  return { numYears, base, spendChangeRate, goGoBonus, goGoYears };
}

// Mirrors simulatePath's unadjustedTarget formula for the base strategy:
// each year scales the base by the annual real-change rate, adds a flat
// bonus for the first `goGoYears` years, then adheres to that year's
// minimum-withdrawal floor (if any) — same order of operations as the engine.
function buildSchedule({ numYears, base, spendChangeRate, goGoBonus, goGoYears, floorSeries }) {
  const amounts = [];
  for (let j = 0; j < numYears; j++) {
    const ageFactor = (1 + spendChangeRate) ** j;
    let amount = base * ageFactor;
    if (j < goGoYears) amount += goGoBonus;
    if (base >= 0 && amount < 0) amount = 0;
    const yearFloor = floorSeries?.[j] ?? 0;
    if (amount >= 0 && yearFloor > 0) amount = Math.max(amount, yearFloor);
    amounts.push(amount);
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
  if (previewChart) {
    previewChart.destroy();
    previewChart = null;
  }
  previewChart = buildSchedulePreviewChart(canvas, amounts, floorSeries);
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
