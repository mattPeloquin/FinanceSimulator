// DOM wiring for the input form. Keeps the form's interactive behaviours in one
// place; the canonical values still live in the scenario state model.
import { ALLOCATION_KEYS, parseCurrency, readWithdrawalFloorsFromDom, writeWithdrawalFloorsToDom, readSpecificWithdrawalFloorsFromDom, writeSpecificWithdrawalFloorsToDom, readGiftingTiersFromDom, writeGiftingTiersToDom, readSpendingOverTimeTiersFromDom, writeSpendingOverTimeTiersToDom } from '../state/scenario.js';
import { formatPct1, roundPct1 } from '../core/precision.js';
import { normalizeYearRange } from '../data/historicalData.js';
import { Chart } from './charts/chartSetup.js';
import { syncWithdrawalPreview, syncWithdrawalPreviewFromForm, destroyWithdrawalPreviewChart } from './charts/withdrawalPreview.js';
import { syncGuardrailPreview } from './charts/guardrailPreview.js';
import { syncWithdrawalAdjPreview } from './charts/withdrawalAdjPreview.js';
import { syncBaseWithdrawalPreview, destroyBaseWithdrawalPreviewChart } from './charts/basePreview.js';

// Charts created inside a collapsed <details> render at 0px; resize them when the
// accordion is opened so they fill the now-visible container.
export function setupAccordionResize() {
  document.querySelectorAll('details').forEach((details) => {
    details.addEventListener('toggle', () => {
      if (!details.open) return;
      details.querySelectorAll('canvas').forEach((canvas) => {
        Chart.getChart(canvas)?.resize();
      });
    });
  });
}

const OPTIONAL_BALANCE_OVERRIDE_IDS = new Set(['dynLowBal', 'dynMedBal', 'dynHighBal']);

function formatCurrencyInputValue(input) {
  const val = parseCurrency(input.value);
  if (OPTIONAL_BALANCE_OVERRIDE_IDS.has(input.id) && val === 0) {
    input.value = '';
    return;
  }
  if (!Number.isNaN(val)) input.value = val.toLocaleString('en-US');
}

function formatPctInputValue(input) {
  const n = parseFloat(input.value);
  if (Number.isNaN(n)) return;
  input.value = formatPct1(roundPct1(n));
}

// Set min/max on the year-range fields, show data-quality help, and clamp on blur.
export function setupHistoricalYearRangeInputs({ minYear, maxYear, styleIndexFromYear, onChange }) {
  const startEl = document.getElementById('startYear');
  const endEl = document.getElementById('endYear');
  const helpEl = document.getElementById('historical-range-help');
  if (!startEl || !endEl) return;

  startEl.min = String(minYear);
  startEl.max = String(maxYear);
  endEl.min = String(minYear);
  endEl.max = String(maxYear);

  if (helpEl) {
    helpEl.textContent =
      `Built-in data spans ${minYear}–${maxYear}. Years before ${styleIndexFromYear} are approximate reconstructions; from ${styleIndexFromYear} onward the US asset classes use style-level index series (e.g. Fama-French).`;
  }

  function clampBoth(triggerChange) {
    const { startYear, endYear } = normalizeYearRange(startEl.value, endEl.value, minYear, maxYear);
    const startStr = String(startYear);
    const endStr = String(endYear);
    const changed = startEl.value !== startStr || endEl.value !== endStr;
    startEl.value = startStr;
    endEl.value = endStr;
    if (changed && triggerChange) onChange?.();
  }

  const onBlur = () => clampBoth(true);
  startEl.addEventListener('blur', onBlur);
  endEl.addEventListener('blur', onBlur);

  // Normalize saved or imported values that fall outside the available range.
  clampBoth(false);
}

export function formatAllCurrencyInputs() {
  document.querySelectorAll('.currency-input').forEach((input) => {
    formatCurrencyInputValue(input);
  });
}

export function updateAllocationTotal() {
  const display = document.getElementById('totalAllocation');
  const inputs = document.querySelectorAll('.allocation-input');
  const total = Array.from(inputs).reduce((sum, i) => sum + (parseFloat(i.value) || 0), 0);
  display.textContent = total.toFixed(1).replace(/\.0$/, '');
  if (Math.abs(total - 100) > 0.01) {
    display.classList.add('text-theme-danger');
    display.classList.remove('text-theme-success');
  } else {
    display.classList.remove('text-theme-danger');
    display.classList.add('text-theme-success');
  }
  return total;
}

export function toggleDistMethod(method) {
  const lognormal = document.getElementById('lognormal-profiles');
  // The block-size control applies to resampling and smoothed historical (real-year
  // bootstrap) and drives year-to-year smoothing for log-normal.
  if (method === 'lognormal' || method === 'scaledHistorical') {
    lognormal.classList.remove('form-section-hidden');
  } else {
    lognormal.classList.add('form-section-hidden');
    lognormal.open = false;
  }

  const isScaled = method === 'scaledHistorical';
  const smoothInput = document.getElementById('scaledHistoricalSmoothing');
  const smoothSlider = document.getElementById('scaledHistoricalSmoothingSlider');
  const smoothControl = document.getElementById('smoothing-control');
  if (smoothInput) smoothInput.disabled = !isScaled;
  if (smoothSlider) smoothSlider.disabled = !isScaled;
  if (smoothControl) smoothControl.classList.toggle('opacity-50', !isScaled);
}

export function toggleWithdrawalStrategy(strategy) {
  const baseSection = document.getElementById('strategy-base-section');
  const specificSection = document.getElementById('strategy-specific-section');
  const basePreview = document.getElementById('base-schedule-preview');
  const specificPreview = document.getElementById('specific-schedule-preview');
  if (strategy === 'specific') {
    baseSection.classList.add('hidden');
    specificSection.classList.remove('hidden');
    basePreview?.classList.add('hidden');
    specificPreview?.classList.remove('hidden');
    const textarea = document.getElementById('specificWithdrawals');
    if (textarea) syncWithdrawalPreview(textarea.value);
    destroyBaseWithdrawalPreviewChart();
  } else {
    baseSection.classList.remove('hidden');
    specificSection.classList.add('hidden');
    basePreview?.classList.remove('hidden');
    specificPreview?.classList.add('hidden');
    destroyWithdrawalPreviewChart();
    syncBaseWithdrawalPreview();
  }
}

// Maps each "include in search" checkbox id to the input field(s) it takes
// over while Goal Seek mode is on. Each checkbox covers every spending lever
// that's actually inside its own <details> section: Market adjustment
// includes both the market-triggered $ adjustments AND their balance
// override thresholds; Balance adjustment includes the floor/ceiling balance
// thresholds AND their cut/boost rates.
const GOAL_SEEK_LEVER_FIELDS = {
  goalSeekIncludeBaseWithdrawal: ['baseWithdrawal'],
  goalSeekIncludeMarketAdjustments: ['dynLowAdj', 'dynMedAdj', 'dynHighAdj', 'dynLowBal', 'dynMedBal', 'dynHighBal'],
  goalSeekIncludeBalanceOverrides: ['floorBalance', 'ceilingBalance', 'floorPenalty', 'ceilingBonus'],
};

// Gray out (or restore) the first spending-over-time tier's extra field when
// Goal Seek is allowed to tune it.
export function toggleSpendingBonusSearchable(included) {
  const input = document.querySelector('[data-spending-tier-row="0"] [data-spending-extra]');
  if (input) input.disabled = included;
}

// Gray out (or restore) the fields a search lever has taken over. Included
// fields are disabled — Goal Seek will choose their values — and left
// editable again once the lever is unchecked or Goal Seek mode turns off.
export function toggleFieldSearchable(fieldIds, included) {
  for (const id of fieldIds) {
    const input = document.getElementById(id);
    if (input) input.disabled = included;
  }
}

// When Goal Seek is on, expand the withdrawal accordions the user needs to see:
// minimum withdrawal always; market/balance sections only when marked for search.
function syncGoalSeekSectionExpansion() {
  const goalSeekEnabled = !!document.getElementById('goalSeekMode')?.checked;
  if (!goalSeekEnabled) return;

  // Minimum withdrawal only applies to (and is only visible under) the Base
  // strategy — expanding it under Specific List would just open an empty,
  // hidden accordion.
  const strategy = document.querySelector('input[name="withdrawal-strategy"]:checked')?.value;
  const minDetails = document.getElementById('details-min-withdrawal');
  if (minDetails && strategy !== 'specific') minDetails.open = true;

  const specificMinDetails = document.getElementById('details-specific-min-withdrawal');
  if (specificMinDetails && strategy === 'specific') specificMinDetails.open = true;

  if (document.getElementById('goalSeekIncludeSpendingOverTime')?.checked) {
    const spendingDetails = document.getElementById('details-spending-over-time');
    if (spendingDetails) spendingDetails.open = true;
  }

  if (document.getElementById('goalSeekIncludeMarketAdjustments')?.checked) {
    const marketDetails = document.getElementById('details-market-adjustment');
    if (marketDetails) marketDetails.open = true;
  }

  if (document.getElementById('goalSeekIncludeBalanceOverrides')?.checked) {
    const balanceDetails = document.getElementById('details-balance-adjustment');
    if (balanceDetails) balanceDetails.open = true;
  }
}

// Show/hide the Goal Seek panel and its per-field "include in search"
// checkboxes, and relabel the Run button so it's clear a search (not a plain
// simulation) will run. Turning the mode off releases any grayed-out fields.
export function toggleGoalSeekMode(enabled) {
  const wrapper = document.getElementById('goal-seek-wrapper');
  if (wrapper) wrapper.classList.toggle('hidden', !enabled);

  for (const [checkboxId, fieldIds] of Object.entries(GOAL_SEEK_LEVER_FIELDS)) {
    const wrap = document.getElementById(`${checkboxId}Wrap`);
    if (wrap) wrap.style.display = enabled ? '' : 'none';

    const checkbox = document.getElementById(checkboxId);
    const included = enabled && !!checkbox?.checked;
    toggleFieldSearchable(fieldIds, included);
  }

  const spendingWrap = document.getElementById('goalSeekIncludeSpendingOverTimeWrap');
  if (spendingWrap) spendingWrap.style.display = enabled ? '' : 'none';
  const spendingCheckbox = document.getElementById('goalSeekIncludeSpendingOverTime');
  toggleSpendingBonusSearchable(enabled && !!spendingCheckbox?.checked);

  const runButton = document.getElementById('runButton');
  if (runButton) runButton.textContent = enabled ? 'Find Best Plan' : 'Run Simulation';

  syncGoalSeekSectionExpansion();
}

export function toggleDynamicAdjustments(enabled) {
  const wrapper = document.getElementById('dynamic-adjustments-wrapper');
  if (enabled) {
    wrapper.classList.remove('hidden');
    refreshDynamicAdjustmentPreviews();
  } else {
    wrapper.classList.add('hidden');
  }
}

export function refreshDynamicAdjustmentPreviews() {
  syncGuardrailPreview();
  syncWithdrawalAdjPreview();
}

function formatWithdrawalFloorCurrencyInput(input) {
  const val = parseCurrency(input.value);
  if (!Number.isNaN(val)) input.value = val.toLocaleString('en-US');
}

export function setupWithdrawalFloorList({ onChange }) {
  const list = document.getElementById('withdrawalFloorsList');
  const addBtn = document.getElementById('addWithdrawalFloorTier');
  if (!list || !addBtn) return;

  const notify = typeof onChange === 'function' ? onChange : () => {};

  addBtn.addEventListener('click', () => {
    const tiers = readWithdrawalFloorsFromDom();
    if (tiers.length === 0) {
      writeWithdrawalFloorsToDom([{ amount: 0 }]);
      notify();
      return;
    }
    const last = tiers.pop();
    tiers.push({ amount: last.amount, years: 1 });
    tiers.push(last);
    writeWithdrawalFloorsToDom(tiers);
    notify();
  });

  list.addEventListener('click', (e) => {
    const btn = e.target.closest('.remove-withdrawal-floor-tier');
    if (!btn) return;
    const tiers = readWithdrawalFloorsFromDom();
    tiers.splice(Number(btn.closest('[data-withdrawal-floor-row]')?.dataset.withdrawalFloorRow), 1);
    writeWithdrawalFloorsToDom(tiers);
    notify();
  });

  list.addEventListener('change', notify);

  list.addEventListener('blur', (e) => {
    if (e.target.matches('[data-floor-amount]')) {
      formatWithdrawalFloorCurrencyInput(e.target);
      notify();
    }
  }, true);
}

export function setupSpecificWithdrawalFloorList({ onChange }) {
  const list = document.getElementById('specificWithdrawalFloorsList');
  const addBtn = document.getElementById('addSpecificWithdrawalFloorTier');
  if (!list || !addBtn) return;

  const notify = typeof onChange === 'function' ? onChange : () => {};

  addBtn.addEventListener('click', () => {
    const tiers = readSpecificWithdrawalFloorsFromDom();
    if (tiers.length === 0) {
      writeSpecificWithdrawalFloorsToDom([{ pct: 80 }]);
      notify();
      return;
    }
    const last = tiers.pop();
    tiers.push({ pct: last.pct, years: 1 });
    tiers.push(last);
    writeSpecificWithdrawalFloorsToDom(tiers);
    notify();
  });

  list.addEventListener('click', (e) => {
    const btn = e.target.closest('.remove-specific-withdrawal-floor-tier');
    if (!btn) return;
    const tiers = readSpecificWithdrawalFloorsFromDom();
    tiers.splice(Number(btn.closest('[data-specific-withdrawal-floor-row]')?.dataset.specificWithdrawalFloorRow), 1);
    writeSpecificWithdrawalFloorsToDom(tiers);
    notify();
  });

  list.addEventListener('change', notify);
  list.addEventListener('input', notify);
}

export function setupSpendingOverTimeTierList({ onChange }) {
  const list = document.getElementById('spendingOverTimeTiersList');
  const addBtn = document.getElementById('addSpendingOverTimeTier');
  if (!list || !addBtn) return;

  const notify = typeof onChange === 'function' ? onChange : () => {};

  addBtn.addEventListener('click', () => {
    const tiers = readSpendingOverTimeTiersFromDom();
    if (tiers.length === 0) {
      writeSpendingOverTimeTiersToDom([{ changePct: 0, extra: 0 }]);
      notify();
      return;
    }
    const last = tiers.pop();
    tiers.push({ changePct: last.changePct, extra: last.extra, years: 1 });
    tiers.push(last);
    writeSpendingOverTimeTiersToDom(tiers);
    notify();
  });

  list.addEventListener('click', (e) => {
    const btn = e.target.closest('.remove-spending-over-time-tier');
    if (!btn) return;
    const tiers = readSpendingOverTimeTiersFromDom();
    tiers.splice(Number(btn.closest('[data-spending-tier-row]')?.dataset.spendingTierRow), 1);
    writeSpendingOverTimeTiersToDom(tiers);
    notify();
  });

  list.addEventListener('change', notify);
  list.addEventListener('input', notify);

  list.addEventListener('blur', (e) => {
    if (e.target.matches('[data-spending-extra]')) {
      formatWithdrawalFloorCurrencyInput(e.target);
      notify();
    }
  }, true);
}

export function setupGiftingTierList({ onChange }) {
  const list = document.getElementById('giftingTiersList');
  const addBtn = document.getElementById('addGiftingTier');
  if (!list || !addBtn) return;

  const notify = typeof onChange === 'function' ? onChange : () => {};

  addBtn.addEventListener('click', () => {
    const tiers = readGiftingTiersFromDom();
    if (tiers.length === 0) {
      writeGiftingTiersToDom([{ amount: 0, balance: 0 }]);
      notify();
      return;
    }
    const last = tiers.pop();
    tiers.push({ amount: last.amount, balance: last.balance, years: 1 });
    tiers.push(last);
    writeGiftingTiersToDom(tiers);
    notify();
  });

  list.addEventListener('click', (e) => {
    const btn = e.target.closest('.remove-gifting-tier');
    if (!btn) return;
    const tiers = readGiftingTiersFromDom();
    tiers.splice(Number(btn.closest('[data-gifting-tier-row]')?.dataset.giftingTierRow), 1);
    writeGiftingTiersToDom(tiers);
    notify();
  });

  list.addEventListener('change', notify);

  list.addEventListener('blur', (e) => {
    if (e.target.matches('[data-gift-amount], [data-gift-balance]')) {
      formatWithdrawalFloorCurrencyInput(e.target);
      notify();
    }
  }, true);
}

export function renderYearLabels(years) {
  const container = document.getElementById('year-labels');
  let html = '';
  if (years.length > 0) {
    const step = Math.ceil(years.length / 6);
    for (let i = 0; i < years.length; i += step) html += `<span>${years[i]}</span>`;
    if ((years.length - 1) % step !== 0) html += `<span>${years[years.length - 1]}</span>`;
  }
  container.innerHTML = html;
}

// Wrap `.pct-input` fields with an in-box % suffix (log-normal profile grid).
function adornPctInputs() {
  document.querySelectorAll('input.pct-input').forEach((input) => {
    if (input.closest('.input-adorned')) return;
    const wrap = document.createElement('div');
    wrap.className = 'input-adorned has-suffix';
    const suffix = document.createElement('span');
    suffix.className = 'input-adorn-suffix';
    suffix.textContent = '%';
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);
    wrap.appendChild(suffix);
  });
}

// Wire up purely-local interactions and forward "something changed" to `onChange`.
export function setupInputBehaviors({ onChange, onDistMethodChange }) {
  const notify = typeof onChange === 'function' ? onChange : () => {};

  adornPctInputs();

  document.querySelectorAll('.currency-input').forEach((input) => {
    input.addEventListener('blur', () => {
      formatCurrencyInputValue(input);
      notify();
    });
  });

  document.querySelectorAll('input.pct-input').forEach((input) => {
    input.addEventListener('blur', () => {
      formatPctInputValue(input);
      notify();
    });
  });

  document.querySelectorAll('.allocation-input').forEach((input) => {
    input.addEventListener('input', () => {
      updateAllocationTotal();
      notify();
    });
  });

  const blockSize = document.getElementById('blockSize');
  const blockSizeSlider = document.getElementById('blockSizeSlider');
  blockSizeSlider.addEventListener('input', (e) => {
    blockSize.value = e.target.value;
    notify();
  });
  blockSize.addEventListener('input', (e) => {
    blockSizeSlider.value = e.target.value;
    notify();
  });

  const scaledHistoricalSmoothing = document.getElementById('scaledHistoricalSmoothing');
  const scaledHistoricalSmoothingSlider = document.getElementById('scaledHistoricalSmoothingSlider');
  if (scaledHistoricalSmoothing && scaledHistoricalSmoothingSlider) {
    scaledHistoricalSmoothingSlider.addEventListener('input', (e) => {
      scaledHistoricalSmoothing.value = e.target.value;
      notify();
    });
    scaledHistoricalSmoothing.addEventListener('input', (e) => {
      scaledHistoricalSmoothingSlider.value = e.target.value;
      notify();
    });
  }

  const goalSeekDesiredSuccessPct = document.getElementById('goalSeekDesiredSuccessPct');
  const goalSeekDesiredSuccessPctSlider = document.getElementById('goalSeekDesiredSuccessPctSlider');
  if (goalSeekDesiredSuccessPct && goalSeekDesiredSuccessPctSlider) {
    goalSeekDesiredSuccessPctSlider.addEventListener('input', (e) => {
      goalSeekDesiredSuccessPct.value = e.target.value;
      notify();
    });
    goalSeekDesiredSuccessPct.addEventListener('input', (e) => {
      goalSeekDesiredSuccessPctSlider.value = e.target.value;
      notify();
    });
  }

  const goalSeekRiskTolerancePct = document.getElementById('goalSeekRiskTolerancePct');
  const goalSeekRiskTolerancePctSlider = document.getElementById('goalSeekRiskTolerancePctSlider');
  if (goalSeekRiskTolerancePct && goalSeekRiskTolerancePctSlider) {
    goalSeekRiskTolerancePctSlider.addEventListener('input', (e) => {
      goalSeekRiskTolerancePct.value = e.target.value;
      notify();
    });
    goalSeekRiskTolerancePct.addEventListener('input', (e) => {
      goalSeekRiskTolerancePctSlider.value = e.target.value;
      notify();
    });
  }

  const planRiskTolerancePct = document.getElementById('planRiskTolerancePct');
  const planRiskTolerancePctSlider = document.getElementById('planRiskTolerancePctSlider');
  if (planRiskTolerancePct && planRiskTolerancePctSlider) {
    planRiskTolerancePctSlider.addEventListener('input', (e) => {
      planRiskTolerancePct.value = e.target.value;
      notify();
    });
    planRiskTolerancePct.addEventListener('input', (e) => {
      planRiskTolerancePctSlider.value = e.target.value;
      notify();
    });
  }

  document.querySelectorAll('input[name="distribution-method"]').forEach((radio) => {
    radio.addEventListener('change', (e) => {
      toggleDistMethod(e.target.value);
      if (typeof onDistMethodChange === 'function') onDistMethodChange(e.target.value);
      notify();
    });
  });

  document.querySelectorAll('input[name="withdrawal-strategy"]').forEach((radio) => {
    radio.addEventListener('change', (e) => {
      toggleWithdrawalStrategy(e.target.value);
      notify();
    });
  });

  const dynAdjCheck = document.getElementById('enableDynamicAdjustments');
  if (dynAdjCheck) {
    dynAdjCheck.addEventListener('change', (e) => {
      toggleDynamicAdjustments(e.target.checked);
      notify();
    });
  }

  const goalSeekModeCheck = document.getElementById('goalSeekMode');
  if (goalSeekModeCheck) {
    goalSeekModeCheck.addEventListener('change', (e) => {
      toggleGoalSeekMode(e.target.checked);
      notify();
    });
  }

  const spendingCheckbox = document.getElementById('goalSeekIncludeSpendingOverTime');
  if (spendingCheckbox) {
    spendingCheckbox.addEventListener('change', (e) => {
      toggleSpendingBonusSearchable(e.target.checked);
      notify();
    });
  }

  for (const [checkboxId, fieldIds] of Object.entries(GOAL_SEEK_LEVER_FIELDS)) {
    const checkbox = document.getElementById(checkboxId);
    if (!checkbox) continue;
    checkbox.addEventListener('change', (e) => {
      toggleFieldSearchable(fieldIds, e.target.checked);
      if (checkboxId === 'goalSeekIncludeMarketAdjustments' || checkboxId === 'goalSeekIncludeBalanceOverrides') {
        syncGoalSeekSectionExpansion();
      }
      notify();
    });
  }

  // The spending-scale sparkline tracks its inputs (plus the starting balance,
  // which sets the chart's x-range) as the user types.
  for (const id of ['floorBalance', 'floorPenalty', 'ceilingBalance', 'ceilingBonus', 'startBalance']) {
    const input = document.getElementById(id);
    if (input) input.addEventListener('input', syncGuardrailPreview);
  }
  syncGuardrailPreview();

  for (const id of ['dynLowRet', 'dynMedRet', 'dynHighRet', 'dynLowAdj', 'dynMedAdj', 'dynHighAdj']) {
    const input = document.getElementById(id);
    if (input) {
      input.addEventListener('input', syncWithdrawalAdjPreview);
      input.addEventListener('change', syncWithdrawalAdjPreview);
    }
  }
  syncWithdrawalAdjPreview();

  for (const id of ['baseWithdrawal', 'numYears']) {
    const input = document.getElementById(id);
    if (input) input.addEventListener('input', syncBaseWithdrawalPreview);
  }
  syncBaseWithdrawalPreview();

  const specificWithdrawals = document.getElementById('specificWithdrawals');
  if (specificWithdrawals) {
    specificWithdrawals.addEventListener('input', (e) => {
      syncWithdrawalPreview(e.target.value);
      notify();
    });
    specificWithdrawals.addEventListener('change', notify);
  }

  const numYears = document.getElementById('numYears');
  if (numYears) {
    numYears.addEventListener('input', () => {
      const strategy = document.querySelector('input[name="withdrawal-strategy"]:checked')?.value;
      if (strategy === 'specific' && specificWithdrawals) {
        syncWithdrawalPreview(specificWithdrawals.value);
      }
    });
  }

  // Catch-all for the remaining number/text inputs so autosave stays current.
  document.querySelectorAll('input:not(.currency-input):not(.allocation-input), textarea').forEach((input) => {
    if (input.name === 'distribution-method' || input.name === 'withdrawal-strategy') return;
    if (input.id === 'blockSize' || input.id === 'blockSizeSlider' || input.id === 'enableDynamicAdjustments') return;
    if (input.id === 'goalSeekMode' || input.id in GOAL_SEEK_LEVER_FIELDS) return;
    if (
      input.id === 'scaledHistoricalSmoothing' ||
      input.id === 'scaledHistoricalSmoothingSlider' ||
      input.id === 'goalSeekDesiredSuccessPctSlider' ||
      input.id === 'goalSeekRiskTolerancePctSlider' ||
      input.id === 'planRiskTolerancePctSlider'
    ) return;
    if (input.id === 'specificWithdrawals') return;
    input.addEventListener('change', notify);
  });

  setupWithdrawalFloorList({ onChange: notify });
  setupSpecificWithdrawalFloorList({ onChange: notify });
  setupSpendingOverTimeTierList({ onChange: notify });
  setupGiftingTierList({ onChange: notify });

  // Redraw the base spending preview's minimum-withdrawal guide line whenever
  // a tier is typed into, added, or removed. Registered after
  // setupWithdrawalFloorList so its DOM rebuild (add/remove tier) has already
  // happened by the time this runs.
  const spendingOverTimeTiersList = document.getElementById('spendingOverTimeTiersList');
  if (spendingOverTimeTiersList) {
    spendingOverTimeTiersList.addEventListener('input', syncBaseWithdrawalPreview);
    spendingOverTimeTiersList.addEventListener('click', syncBaseWithdrawalPreview);
  }
  const addSpendingOverTimeTierBtn = document.getElementById('addSpendingOverTimeTier');
  if (addSpendingOverTimeTierBtn) {
    addSpendingOverTimeTierBtn.addEventListener('click', syncBaseWithdrawalPreview);
  }

  const withdrawalFloorsList = document.getElementById('withdrawalFloorsList');
  if (withdrawalFloorsList) {
    withdrawalFloorsList.addEventListener('input', syncBaseWithdrawalPreview);
    withdrawalFloorsList.addEventListener('click', syncBaseWithdrawalPreview);
  }
  const addWithdrawalFloorTierBtn = document.getElementById('addWithdrawalFloorTier');
  if (addWithdrawalFloorTierBtn) {
    addWithdrawalFloorTierBtn.addEventListener('click', syncBaseWithdrawalPreview);
  }

  const specificWithdrawalFloorsList = document.getElementById('specificWithdrawalFloorsList');
  if (specificWithdrawalFloorsList) {
    specificWithdrawalFloorsList.addEventListener('input', syncWithdrawalPreviewFromForm);
    specificWithdrawalFloorsList.addEventListener('click', syncWithdrawalPreviewFromForm);
  }
  const addSpecificWithdrawalFloorTierBtn = document.getElementById('addSpecificWithdrawalFloorTier');
  if (addSpecificWithdrawalFloorTierBtn) {
    addSpecificWithdrawalFloorTierBtn.addEventListener('click', syncWithdrawalPreviewFromForm);
  }

  const giftingTiersList = document.getElementById('giftingTiersList');
  if (giftingTiersList) {
    giftingTiersList.addEventListener('input', () => {
      syncBaseWithdrawalPreview();
      syncWithdrawalPreviewFromForm();
    });
    giftingTiersList.addEventListener('click', () => {
      syncBaseWithdrawalPreview();
      syncWithdrawalPreviewFromForm();
    });
  }
  const addGiftingTierBtn = document.getElementById('addGiftingTier');
  if (addGiftingTierBtn) {
    addGiftingTierBtn.addEventListener('click', () => {
      syncBaseWithdrawalPreview();
      syncWithdrawalPreviewFromForm();
    });
  }

  setupAccordionResize();
}

export { ALLOCATION_KEYS };
