// DOM wiring for the input form. Keeps the form's interactive behaviours in one
// place; the canonical values still live in the scenario state model.
import { ALLOCATION_KEYS, parseCurrency } from '../state/scenario.js';
import { Chart } from './charts/chartSetup.js';

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

export function formatAllCurrencyInputs() {
  document.querySelectorAll('.currency-input').forEach((input) => {
    const val = parseCurrency(input.value);
    if (!Number.isNaN(val)) input.value = val.toLocaleString('en-US');
  });
}

export function updateAllocationTotal() {
  const display = document.getElementById('totalAllocation');
  const inputs = document.querySelectorAll('.allocation-input');
  const total = Array.from(inputs).reduce((sum, i) => sum + (parseFloat(i.value) || 0), 0);
  display.textContent = total.toFixed(1).replace(/\.0$/, '');
  if (Math.abs(total - 100) > 0.01) {
    display.classList.add('text-red-600');
    display.classList.remove('text-green-600');
  } else {
    display.classList.remove('text-red-600');
    display.classList.add('text-green-600');
  }
  return total;
}

export function toggleDistMethod(method) {
  const lognormal = document.getElementById('lognormal-profiles');
  // The block-size control applies to both methods now: it bootstraps blocks for
  // resampling and drives year-to-year smoothing for log-normal, so keep it shown.
  if (method === 'lognormal') {
    lognormal.classList.remove('form-section-hidden');
  } else {
    lognormal.classList.add('form-section-hidden');
  }
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

// Wire up purely-local interactions and forward "something changed" to `onChange`.
export function setupInputBehaviors({ onChange, onDistMethodChange }) {
  const notify = typeof onChange === 'function' ? onChange : () => {};

  document.querySelectorAll('.currency-input').forEach((input) => {
    input.addEventListener('blur', () => {
      const val = parseCurrency(input.value);
      if (!Number.isNaN(val)) input.value = val.toLocaleString('en-US');
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

  // Catch-all for the remaining number/text inputs so autosave stays current.
  document.querySelectorAll('input:not(.currency-input):not(.allocation-input)').forEach((input) => {
    if (input.name === 'distribution-method') return;
    if (input.id === 'blockSize' || input.id === 'blockSizeSlider') return;
    input.addEventListener('change', notify);
  });

  setupAccordionResize();
}

export function allocationTotalValid() {
  const inputs = document.querySelectorAll('.allocation-input');
  const total = Array.from(inputs).reduce((sum, i) => sum + (parseFloat(i.value) || 0), 0);
  return Math.abs(total - 100) <= 0.01;
}

export { ALLOCATION_KEYS };
