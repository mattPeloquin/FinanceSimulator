// Roth Convert config panel — DOM ↔ session + Easy Mode + Plan picker.

import * as sessions from '../../../state/sessions.js';
import { FEATURE_WITHDRAW } from '../../../state/storageKeys.js';
import { getRothConvertPresets } from '../presets.js';
import {
  getRothConvertState,
  patchRothConvertState,
  applyRothConvertPreset,
  detachRothConvertPreset,
} from '../session.js';
import { normalizeTaxLadder } from '../../../data/taxLadderIllustrative.js';
import { MONEY_SCALE, formatCurrency, parseCurrency } from '../../../state/scenario.js';

function el(id) {
  return document.getElementById(id);
}

function currentPresetLevel() {
  const n = parseInt(el('roth-convert-preset-level')?.value, 10);
  return [0, 1, 2].includes(n) ? n : 0;
}

function isPresetAttached() {
  return !!el('roth-convert-preset-active')?.checked;
}

function updatePresetLabel() {
  const presets = getRothConvertPresets();
  const preset = presets[currentPresetLevel()] || presets[0];
  const nameEl = el('roth-convert-preset-name');
  if (nameEl && preset) {
    nameEl.textContent = `${preset.name} — ${preset.description}`;
  }
  el('roth-convert-preset-control')?.classList.toggle('opacity-50', !isPresetAttached());
}

function applyCurrentPreset() {
  const presets = getRothConvertPresets();
  const preset = presets[currentPresetLevel()];
  if (!preset) return;
  applyRothConvertPreset(preset.id, { keepAttached: true });
  renderRothConvertForm();
}

function rateToPctDisplay(rate) {
  const pct = (Number(rate) || 0) * 100;
  // Whole percents when clean; otherwise one decimal (e.g. 22.5).
  return Math.abs(pct - Math.round(pct)) < 1e-9
    ? String(Math.round(pct))
    : String(Math.round(pct * 10) / 10);
}

function renderLadder(ladder) {
  const host = el('roth-convert-ladder');
  if (!host) return;
  const tiers = normalizeTaxLadder(ladder);
  host.innerHTML = '';

  const header = document.createElement('div');
  header.className = 'grid grid-cols-[1fr_5.5rem] gap-2 text-[10px] uppercase text-theme-faint font-semibold';
  header.innerHTML = '<span>Up to</span><span class="text-center">Rate</span>';
  host.appendChild(header);

  tiers.forEach((tier, i) => {
    const ratePct = rateToPctDisplay(tier.rate);
    const rateField = `
      <div class="input-adorned has-suffix">
        <input type="number" data-ladder-rate="${i}" step="0.5" min="0" max="60"
          value="${ratePct}"
          class="w-full rounded border border-theme-border bg-theme-input px-2 py-1 text-sm text-center" />
        <span class="input-adorn-suffix">%</span>
      </div>`;

    const row = document.createElement('div');
    // items-center keeps the % field on the same vertical center as the ceiling input.
    row.className = 'grid grid-cols-[1fr_5.5rem] gap-2 items-center';

    if (!Number.isFinite(tier.ceiling) && i === tiers.length - 1) {
      row.innerHTML = `
        <span class="text-xs text-theme-muted">Above prior →</span>
        ${rateField}
      `;
    } else {
      // UI edits ceilings in $000s (nearest thousand), matching Plan currency fields.
      const ceilingK = formatCurrency(tier.ceiling / MONEY_SCALE);
      row.innerHTML = `
        <div class="input-adorned has-suffix">
          <input type="text" data-ladder-ceiling="${i}" value="${ceilingK}"
            class="currency-input w-full rounded border border-theme-border bg-theme-input px-2 py-1 text-sm" />
          <span class="input-adorn-suffix">000s</span>
        </div>
        ${rateField}
      `;
    }
    host.appendChild(row);
  });
}

function readLadderFromDom() {
  const host = el('roth-convert-ladder');
  if (!host) return getRothConvertState().ladder;
  const ceilings = [...host.querySelectorAll('[data-ladder-ceiling]')];
  const rates = [...host.querySelectorAll('[data-ladder-rate]')];
  const tiers = rates.map((rateEl, i) => {
    const ceilEl = ceilings.find((c) => c.getAttribute('data-ladder-ceiling') === String(i));
    // Inputs are $000s → engine dollars (normalizeTaxLadder rounds to nearest $1k).
    const ceilingK = ceilEl ? parseCurrency(ceilEl.value) : NaN;
    // UI rates are percent (22); state/engine use decimals (0.22).
    const ratePct = Number(rateEl.value) || 0;
    return {
      ceiling: Number.isFinite(ceilingK) ? ceilingK * MONEY_SCALE : Infinity,
      rate: ratePct / 100,
    };
  });
  return normalizeTaxLadder(tiers);
}

export async function refreshRothScenarioPicker() {
  const select = el('roth-convert-scenario');
  if (!select) return;
  const current = getRothConvertState().scenarioRef?.name || '';
  let names;
  try {
    const list = await sessions.list(FEATURE_WITHDRAW);
    names = (list || []).map((s) => s.name).filter(Boolean);
  } catch {
    names = [];
  }
  select.innerHTML = '';
  const none = document.createElement('option');
  none.value = '';
  none.textContent = 'None — use constant real return';
  select.appendChild(none);
  for (const name of names) {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    select.appendChild(opt);
  }
  if (current && !names.includes(current)) {
    const missing = document.createElement('option');
    missing.value = current;
    missing.textContent = `(missing) ${current}`;
    select.appendChild(missing);
  }
  select.value = current || '';
  updateReturnModeUi();
}

function updateReturnModeUi() {
  const linked = !!(el('roth-convert-scenario')?.value);
  el('roth-convert-const-return-wrap')?.classList.toggle('opacity-50', linked);
  const input = el('roth-convert-const-return');
  if (input) input.disabled = linked;
}

function updateCoupleUi() {
  const couple = !!el('roth-convert-couple')?.checked;
  el('roth-convert-age-b-wrap')?.classList.toggle('hidden', !couple);
}

export function renderRothConvertForm() {
  const s = getRothConvertState();
  if (el('roth-convert-preset-active')) el('roth-convert-preset-active').checked = !!s.presetActive;
  if (el('roth-convert-preset-level')) el('roth-convert-preset-level').value = String(s.presetLevel);
  updatePresetLabel();

  if (el('roth-convert-couple')) el('roth-convert-couple').checked = !!s.couple;
  if (el('roth-convert-age-a')) el('roth-convert-age-a').value = String(s.ageA);
  if (el('roth-convert-age-b')) el('roth-convert-age-b').value = String(s.ageB);
  updateCoupleUi();

  if (el('roth-convert-trad')) el('roth-convert-trad').value = formatCurrency(s.tradBalance);
  if (el('roth-convert-roth')) el('roth-convert-roth').value = formatCurrency(s.rothBalance);
  if (el('roth-convert-taxable')) el('roth-convert-taxable').value = formatCurrency(s.taxableBalance);
  if (el('roth-convert-basis')) el('roth-convert-basis').value = formatCurrency(s.taxableBasis);
  if (el('roth-convert-gain-rate')) el('roth-convert-gain-rate').value = String(s.taxableGainRate);
  if (el('roth-convert-other-income')) el('roth-convert-other-income').value = formatCurrency(s.otherTaxableIncome);

  if (el('roth-convert-fill-tier')) el('roth-convert-fill-tier').value = String(s.fillTierRate);
  if (el('roth-convert-annual-cap')) el('roth-convert-annual-cap').value = formatCurrency(s.annualConversionCap);
  const payRadios = document.querySelectorAll('input[name="roth-convert-tax-payment"]');
  payRadios.forEach((r) => {
    r.checked = r.value === s.taxPayment;
  });

  renderLadder(s.ladder);

  if (el('roth-convert-rate-premium')) el('roth-convert-rate-premium').value = String(s.ratePremium);
  if (el('roth-convert-tax-noise')) el('roth-convert-tax-noise').value = String(s.taxNoiseStd);
  if (el('roth-convert-rmd')) el('roth-convert-rmd').checked = !!s.rmdEnabled;
  if (el('roth-convert-qcd')) el('roth-convert-qcd').checked = !!s.qcdEnabled;
  if (el('roth-convert-qcd-annual')) el('roth-convert-qcd-annual').value = formatCurrency(s.qcdAnnual);
  if (el('roth-convert-spouse-sole')) el('roth-convert-spouse-sole').checked = !!s.spouseSoleBeneficiary;

  if (el('roth-convert-const-return')) el('roth-convert-const-return').value = String(s.constantRealReturn);
  if (el('roth-convert-years')) el('roth-convert-years').value = String(s.numYears);
  if (el('roth-convert-paths')) el('roth-convert-paths').value = String(s.numSimulations);

  void refreshRothScenarioPicker();
}

export function syncRothConvertFormToState() {
  const pay = document.querySelector('input[name="roth-convert-tax-payment"]:checked')?.value;
  const scenarioName = el('roth-convert-scenario')?.value || '';
  patchRothConvertState({
    presetActive: isPresetAttached(),
    presetLevel: currentPresetLevel(),
    couple: !!el('roth-convert-couple')?.checked,
    ageA: parseInt(el('roth-convert-age-a')?.value, 10),
    ageB: parseInt(el('roth-convert-age-b')?.value, 10),
    tradBalance: parseCurrency(el('roth-convert-trad')?.value),
    rothBalance: parseCurrency(el('roth-convert-roth')?.value),
    taxableBalance: parseCurrency(el('roth-convert-taxable')?.value),
    taxableBasis: parseCurrency(el('roth-convert-basis')?.value),
    taxableGainRate: Number(el('roth-convert-gain-rate')?.value),
    otherTaxableIncome: parseCurrency(el('roth-convert-other-income')?.value),
    fillTierRate: Number(el('roth-convert-fill-tier')?.value),
    annualConversionCap: parseCurrency(el('roth-convert-annual-cap')?.value),
    taxPayment: pay === 'withhold' ? 'withhold' : 'fromTaxable',
    ladder: readLadderFromDom(),
    ratePremium: Number(el('roth-convert-rate-premium')?.value),
    taxNoiseStd: Number(el('roth-convert-tax-noise')?.value),
    rmdEnabled: !!el('roth-convert-rmd')?.checked,
    qcdEnabled: !!el('roth-convert-qcd')?.checked,
    qcdAnnual: parseCurrency(el('roth-convert-qcd-annual')?.value),
    spouseSoleBeneficiary: !!el('roth-convert-spouse-sole')?.checked,
    scenarioRef: scenarioName
      ? { feature: FEATURE_WITHDRAW, name: scenarioName }
      : null,
    constantRealReturn: Number(el('roth-convert-const-return')?.value),
    numYears: parseInt(el('roth-convert-years')?.value, 10),
    numSimulations: parseInt(el('roth-convert-paths')?.value, 10),
  });
}

function onFieldChange() {
  if (isPresetAttached()) detachRothConvertPreset();
  syncRothConvertFormToState();
}

export function bindRothConvertInputs() {
  el('roth-convert-preset-active')?.addEventListener('change', () => {
    if (isPresetAttached()) applyCurrentPreset();
    else {
      detachRothConvertPreset();
      updatePresetLabel();
    }
  });
  el('roth-convert-preset-level')?.addEventListener('input', () => {
    updatePresetLabel();
    if (isPresetAttached()) applyCurrentPreset();
  });

  const ids = [
    'roth-convert-couple', 'roth-convert-age-a', 'roth-convert-age-b',
    'roth-convert-trad', 'roth-convert-roth', 'roth-convert-taxable', 'roth-convert-basis',
    'roth-convert-gain-rate', 'roth-convert-other-income',
    'roth-convert-fill-tier', 'roth-convert-annual-cap',
    'roth-convert-rate-premium', 'roth-convert-tax-noise',
    'roth-convert-rmd', 'roth-convert-qcd', 'roth-convert-qcd-annual', 'roth-convert-spouse-sole',
    'roth-convert-const-return', 'roth-convert-years', 'roth-convert-paths',
  ];
  for (const id of ids) {
    el(id)?.addEventListener('change', () => {
      if (id === 'roth-convert-couple') updateCoupleUi();
      onFieldChange();
    });
  }
  document.querySelectorAll('input[name="roth-convert-tax-payment"]').forEach((r) => {
    r.addEventListener('change', onFieldChange);
  });
  el('roth-convert-ladder')?.addEventListener('change', onFieldChange);

  el('roth-convert-scenario')?.addEventListener('change', () => {
    onFieldChange();
    updateReturnModeUi();
  });
}
