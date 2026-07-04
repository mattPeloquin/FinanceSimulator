// DOM wiring for the input form. Keeps the form's interactive behaviours in one
// place; the canonical values still live in the scenario state model.
import { ALLOCATION_KEYS, parseCurrency, readWithdrawalFloorsFromDom, writeWithdrawalFloorsToDom } from '../state/scenario.js';
import { Chart } from './charts/chartSetup.js';
import { syncWithdrawalPreview, destroyWithdrawalPreviewChart } from './charts/withdrawalPreview.js';
import { syncGuardrailPreview } from './charts/guardrailPreview.js';
import { syncWithdrawalAdjPreview } from './charts/withdrawalAdjPreview.js';

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
  // The block-size control applies to resampling and scaled historical (real-year
  // bootstrap) and drives year-to-year smoothing for log-normal.
  if (method === 'lognormal' || method === 'scaledHistorical') {
    lognormal.classList.remove('form-section-hidden');
  } else {
    lognormal.classList.add('form-section-hidden');
    lognormal.open = false;
  }
}

export function toggleWithdrawalStrategy(strategy) {
  const baseSection = document.getElementById('strategy-base-section');
  const specificSection = document.getElementById('strategy-specific-section');
  if (strategy === 'specific') {
    baseSection.classList.add('hidden');
    specificSection.classList.remove('hidden');
    const textarea = document.getElementById('specificWithdrawals');
    if (textarea) syncWithdrawalPreview(textarea.value);
  } else {
    baseSection.classList.remove('hidden');
    specificSection.classList.add('hidden');
    destroyWithdrawalPreviewChart();
  }
}

export function toggleDynamicAdjustments(enabled) {
  const wrapper = document.getElementById('dynamic-adjustments-wrapper');
  if (enabled) {
    wrapper.classList.remove('hidden');
    // The sparkline can't render while the section is hidden; draw it now.
    syncGuardrailPreview();
    syncWithdrawalAdjPreview();
  } else {
    wrapper.classList.add('hidden');
  }
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

  // The spending-scale sparkline tracks its inputs (plus the starting balance,
  // which sets the chart's x-range) as the user types.
  for (const id of ['floorBalance', 'floorPenalty', 'ceilingBalance', 'ceilingBonus', 'startBalance']) {
    const input = document.getElementById(id);
    if (input) input.addEventListener('input', syncGuardrailPreview);
  }
  syncGuardrailPreview();

  for (const id of ['dynLowRet', 'dynMedRet', 'dynHighRet', 'dynLowAdj', 'dynMedAdj', 'dynHighAdj']) {
    const input = document.getElementById(id);
    if (input) input.addEventListener('input', syncWithdrawalAdjPreview);
  }
  syncWithdrawalAdjPreview();

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
    if (input.id === 'specificWithdrawals') return;
    input.addEventListener('change', notify);
  });

  setupWithdrawalFloorList({ onChange: notify });
  setupAccordionResize();
}

export { ALLOCATION_KEYS };
