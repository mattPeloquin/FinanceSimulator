// Closed-state one/two-line summaries for Investment and Withdrawal accordions.
import {
  readScenarioFromDom,
  MONEY_SCALE,
  SCENARIO_DEFAULTS,
  toDollars,
  normalizeSpendingOverTimeTiers,
  normalizeGiftingTiers,
  parseSpecificWithdrawals,
  fitSpecificWithdrawalsToHorizon,
} from '../state/scenario.js';
import { allocationSummary } from '../core/reportModel.js';
import {
  buildSpendingOverTimeSeries,
  buildBaseWithdrawalSchedule,
  buildGiftingSeries,
} from '../core/withdrawal.js';
import { formatK } from './format.js';

const DIST_METHOD_SHORT = {
  resampling: 'Historical resampling',
  lognormal: 'Log-normal',
  scaledHistorical: 'Smoothed historical',
};

function formatDollarsK(dollars) {
  const k = formatK(dollars) || '0';
  return `$${k}k`;
}

/**
 * Per-year planned withdrawal (base/specific schedule) plus configured gift
 * amounts — the same pieces the schedule preview stacks as "planned".
 */
export function plannedYearlyAmountsIncludingGifts(scenario) {
  const numYears = Math.max(1, parseInt(scenario.numYears, 10) || 30);
  let schedule;
  if ((scenario.withdrawalStrategy || 'base') === 'specific') {
    schedule = fitSpecificWithdrawalsToHorizon(
      parseSpecificWithdrawals(scenario.specificWithdrawals || ''),
      numYears,
    );
  } else {
    const base = (Number(scenario.baseWithdrawal) || 0) * MONEY_SCALE;
    const spendingSeries = buildSpendingOverTimeSeries(
      normalizeSpendingOverTimeTiers(scenario.spendingOverTimeTiers),
      numYears,
      toDollars,
    );
    schedule = buildBaseWithdrawalSchedule(base, spendingSeries, numYears);
  }
  const gifts = buildGiftingSeries(
    normalizeGiftingTiers(scenario.giftingTiers),
    numYears,
    toDollars,
  );
  return schedule.map((amount, i) => Math.max(0, amount) + (gifts[i]?.amount || 0));
}

/**
 * Count nested Withdrawal sections that are in use (each section = 1).
 * Includes Spending Over Time, Major Events, Min Withdrawal, Gifting,
 * Market Adjustment, Balance Adjustment, and Glide Path when configured.
 */
export function countActiveWithdrawalAdjustments(scenario) {
  let n = 0;
  const isSpecific = (scenario.withdrawalStrategy || 'base') === 'specific';

  if (!isSpecific) {
    const spending = normalizeSpendingOverTimeTiers(scenario.spendingOverTimeTiers);
    if (spending.some((t) => (t.changePct || 0) !== 0 || (t.extra || 0) !== 0)) n += 1;

    const events = Array.isArray(scenario.majorEvents) ? scenario.majorEvents : [];
    if (events.some((e) => (Number(e?.amount) || 0) !== 0)) n += 1;
  }

  const floors = isSpecific
    ? scenario.specificWithdrawalFloors
    : scenario.withdrawalFloors;
  if (Array.isArray(floors) && floors.some((t) => (t?.amount ?? 0) > 0)) n += 1;

  const gifts = normalizeGiftingTiers(scenario.giftingTiers);
  if (gifts.some((t) => (t.amount || 0) > 0)) n += 1;

  if (scenario.enableDynamicAdjustments) n += 1;

  const balanceAdj =
    (scenario.floorBalance != null && scenario.floorBalance > 0)
    || (scenario.ceilingBalance != null && scenario.ceilingBalance > 0);
  if (balanceAdj) n += 1;

  const glideOn =
    (scenario.glideTarget !== '' && scenario.glideTarget != null && Number(scenario.glideTarget) > 0)
    || (Number(scenario.glideFraction) || 0) > 0;
  if (glideOn) n += 1;

  return n;
}

/**
 * Two lines max: allocation, then return method + year range.
 * @param {object} scenario
 */
export function formatInvestmentSectionState(scenario) {
  const alloc = allocationSummary(scenario).label;
  const method = DIST_METHOD_SHORT[scenario.distMethod || SCENARIO_DEFAULTS.distMethod]
    || scenario.distMethod
    || SCENARIO_DEFAULTS.distMethod;
  const start = Number(scenario.startYear) || SCENARIO_DEFAULTS.startYear;
  const end = Number(scenario.endYear) || SCENARIO_DEFAULTS.endYear;
  return `${alloc}\n${method} · ${start}–${end}`;
}

/**
 * Line 1: plan range (incl. gifts). Line 2: in-use adjustment section count.
 * @param {object} scenario
 */
export function formatWithdrawalSectionState(scenario) {
  const yearly = plannedYearlyAmountsIncludingGifts(scenario);
  let planLine = 'Plan —';
  if (yearly.length) {
    let min = yearly[0];
    let max = yearly[0];
    for (let i = 1; i < yearly.length; i++) {
      if (yearly[i] < min) min = yearly[i];
      if (yearly[i] > max) max = yearly[i];
    }
    planLine = Math.abs(max - min) < 0.5
      ? `Plan ${formatDollarsK(min)}/yr`
      : `Plan ${formatDollarsK(min)}–${formatDollarsK(max)}/yr`;
  }
  const n = countActiveWithdrawalAdjustments(scenario);
  const word = n === 1 ? 'adjustment' : 'adjustments';
  return `${planLine}\n${n} ${word} active`;
}

function writeStateEl(el, text) {
  if (!el) return;
  el.textContent = text || '';
  el.classList.toggle('hidden', !text);
}

/**
 * Closed-state card for Simulation Outcomes: total and mean withdrawal
 * ranges across the P10–P60 cards.
 * @param {{ totalMin: number, totalMax: number, meanMin: number, meanMax: number }} range
 */
export function formatOutcomesSectionState(range) {
  if (!range) return '';
  const { totalMin, totalMax, meanMin, meanMax } = range;
  const totalLine = Math.abs(totalMax - totalMin) < 0.5
    ? `Total ${formatDollarsK(totalMin)}`
    : `Total ${formatDollarsK(totalMin)}–${formatDollarsK(totalMax)}`;
  const meanLine = Math.abs(meanMax - meanMin) < 0.5
    ? `Mean ${formatDollarsK(meanMin)}/yr`
    : `Mean ${formatDollarsK(meanMin)}–${formatDollarsK(meanMax)}/yr`;
  return `${totalLine}\n${meanLine}`;
}

/** Write closed-state summary text into Investment / Withdrawal headers. */
export function syncSectionSummaries(scenario = null) {
  const s = scenario || readScenarioFromDom();
  writeStateEl(document.getElementById('investmentSectionState'), formatInvestmentSectionState(s));
  writeStateEl(document.getElementById('withdrawalSectionState'), formatWithdrawalSectionState(s));
}

/** Write the Simulation Outcomes closed-state card (P10–P60 totals / means). */
export function syncOutcomesSectionState(range) {
  writeStateEl(document.getElementById('outcomesSectionState'), formatOutcomesSectionState(range));
}
