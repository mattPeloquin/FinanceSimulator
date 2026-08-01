// House Equity config panel — DOM ↔ session + Easy Mode + Plan picker.

import * as sessions from '../../../state/sessions.js';
import { FEATURE_SOR_PLAN } from '../../../state/storageKeys.js';
import { getHouseEquityPresets } from '../presets.js';
import {
  getHouseEquityState,
  patchHouseEquityState,
  applyHouseEquityPreset,
  detachHouseEquityPreset,
} from '../session.js';
import { formatCurrency, parseCurrency } from '../../../state/scenario.js';

function el(id) {
  return document.getElementById(id);
}

function currentPresetLevel() {
  const n = parseInt(el('house-equity-preset-level')?.value, 10);
  return [0, 1, 2].includes(n) ? n : 0;
}

function isPresetAttached() {
  return !!el('house-equity-preset-active')?.checked;
}

function updatePresetLabel() {
  const presets = getHouseEquityPresets();
  const preset = presets[currentPresetLevel()] || presets[0];
  const nameEl = el('house-equity-preset-name');
  if (nameEl && preset) {
    nameEl.textContent = `${preset.name} — ${preset.description}`;
  }
  el('house-equity-preset-control')?.classList.toggle('opacity-50', !isPresetAttached());
}

function applyCurrentPreset() {
  const presets = getHouseEquityPresets();
  const preset = presets[currentPresetLevel()];
  if (!preset) return;
  applyHouseEquityPreset(preset.id, { keepAttached: true });
  renderHouseEquityForm();
}

function setMoney(id, k) {
  const node = el(id);
  if (node) node.value = formatCurrency(k);
}

function readMoney(id, fallback = 0) {
  const n = parseCurrency(el(id)?.value);
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : fallback;
}

function setNum(id, v) {
  const node = el(id);
  if (node) node.value = String(v);
}

function readNum(id, fallback = 0) {
  const n = Number(el(id)?.value);
  return Number.isFinite(n) ? n : fallback;
}

export async function refreshHouseEquityScenarioPicker() {
  const select = el('house-equity-scenario');
  if (!select) return;
  const current = getHouseEquityState().scenarioRef?.name || '';
  let names;
  try {
    names = await sessions.list(FEATURE_SOR_PLAN);
  } catch {
    names = [];
  }
  if (!Array.isArray(names)) names = [];
  select.innerHTML = '<option value="">— Constant return —</option>';
  for (const name of names) {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    select.appendChild(opt);
  }
  select.value = names.includes(current) ? current : '';
  updateConstReturnEnabled();
}

function updateConstReturnEnabled() {
  const linked = !!(el('house-equity-scenario')?.value);
  const node = el('house-equity-const-return');
  if (node) node.disabled = linked;
}

export function renderHouseEquityForm() {
  const s = getHouseEquityState();
  el('house-equity-preset-active').checked = !!s.presetActive;
  el('house-equity-preset-level').value = String(s.presetLevel);
  updatePresetLabel();

  setNum('house-equity-age', s.currentAge);
  setNum('house-equity-years', s.numYears);
  setNum('house-equity-access-year', s.accessYear);
  setMoney('house-equity-spend', s.annualSpendTarget);
  setMoney('house-equity-home', s.homeValue);
  setMoney('house-equity-basis', s.costBasis);
  setMoney('house-equity-mortgage-bal', s.existingMortgageBalance);
  setNum('house-equity-mortgage-rate', s.existingMortgageRate);
  setNum('house-equity-mortgage-term', s.existingMortgageTermYears);
  setNum('house-equity-home-apprec', s.expectedRealAppreciation);
  setNum('house-equity-inflation', s.expectedInflation);
  setNum('house-equity-commission', s.saleCommissionPct);
  setNum('house-equity-other-closing', s.saleOtherClosingPct);
  setMoney('house-equity-cg-exclusion', s.cgExclusion);
  setNum('house-equity-cg-rate', s.longTermCgRate);
  setMoney('house-equity-rent', s.annualRent);
  setNum('house-equity-rent-growth', s.realRentGrowth);
  setNum('house-equity-const-return', s.constantRealReturn);
  el('house-equity-paths').value = String(s.numSimulations);
  el('house-equity-srm-mode').value = s.simplifiedRmMode;
  setNum('house-equity-srm-rate', s.simplifiedRmRate);
  setNum('house-equity-srm-fee', s.simplifiedRmFeePct);
  setNum('house-equity-prm-proceeds', s.privateRmProceedsPct);
  setNum('house-equity-prm-fee', s.privateRmFeePct);
  setNum('house-equity-heloc-ltv', s.helocLtv);
  setNum('house-equity-heloc-rate', s.helocRate);
  setNum('house-equity-cashout-ltv', s.cashOutLtv);
  setNum('house-equity-cashout-rate', s.cashOutRate);

  void refreshHouseEquityScenarioPicker();
}

export function syncHouseEquityFormToState() {
  const scenarioName = el('house-equity-scenario')?.value || '';
  patchHouseEquityState({
    presetActive: isPresetAttached(),
    presetLevel: currentPresetLevel(),
    currentAge: readNum('house-equity-age', 65),
    numYears: readNum('house-equity-years', 25),
    accessYear: readNum('house-equity-access-year', 0),
    annualSpendTarget: readMoney('house-equity-spend'),
    homeValue: readMoney('house-equity-home', 800),
    costBasis: readMoney('house-equity-basis'),
    existingMortgageBalance: readMoney('house-equity-mortgage-bal'),
    existingMortgageRate: readNum('house-equity-mortgage-rate', 0.04),
    existingMortgageTermYears: readNum('house-equity-mortgage-term', 15),
    expectedRealAppreciation: readNum('house-equity-home-apprec', 0.01),
    expectedInflation: readNum('house-equity-inflation', 0.025),
    saleCommissionPct: readNum('house-equity-commission', 0.05),
    saleOtherClosingPct: readNum('house-equity-other-closing', 0.02),
    cgExclusion: readMoney('house-equity-cg-exclusion', 250),
    longTermCgRate: readNum('house-equity-cg-rate', 0.15),
    annualRent: readMoney('house-equity-rent'),
    realRentGrowth: readNum('house-equity-rent-growth', 0),
    constantRealReturn: readNum('house-equity-const-return', 0.04),
    numSimulations: Number(el('house-equity-paths')?.value) || 500,
    simplifiedRmMode: el('house-equity-srm-mode')?.value === 'tenure' ? 'tenure' : 'loc',
    simplifiedRmRate: readNum('house-equity-srm-rate', 6),
    simplifiedRmFeePct: readNum('house-equity-srm-fee', 2),
    privateRmProceedsPct: readNum('house-equity-prm-proceeds', 50),
    privateRmFeePct: readNum('house-equity-prm-fee', 3),
    helocLtv: readNum('house-equity-heloc-ltv', 75),
    helocRate: readNum('house-equity-heloc-rate', 8),
    cashOutLtv: readNum('house-equity-cashout-ltv', 70),
    cashOutRate: readNum('house-equity-cashout-rate', 6.5),
    scenarioRef: scenarioName
      ? { feature: FEATURE_SOR_PLAN, name: scenarioName }
      : null,
  });
}

export function bindHouseEquityInputs() {
  el('house-equity-preset-active')?.addEventListener('change', () => {
    if (isPresetAttached()) applyCurrentPreset();
    else detachHouseEquityPreset();
    updatePresetLabel();
  });
  el('house-equity-preset-level')?.addEventListener('input', () => {
    updatePresetLabel();
    if (isPresetAttached()) applyCurrentPreset();
  });

  const root = document.getElementById('feature-house-equity');
  root?.addEventListener('change', (ev) => {
    const t = ev.target;
    if (!(t instanceof HTMLElement)) return;
    if (t.id?.startsWith('house-equity-') && t.id !== 'house-equity-preset-level'
      && t.id !== 'house-equity-preset-active') {
      if (isPresetAttached() && t.id !== 'house-equity-scenario' && t.id !== 'house-equity-paths') {
        detachHouseEquityPreset();
        el('house-equity-preset-active').checked = false;
        updatePresetLabel();
      }
      syncHouseEquityFormToState();
      if (t.id === 'house-equity-scenario') updateConstReturnEnabled();
    }
  });
  root?.addEventListener('input', (ev) => {
    const t = ev.target;
    if (!(t instanceof HTMLElement)) return;
    if (t.classList?.contains('currency-input') || t.id?.startsWith('house-equity-')) {
      // Live sync on blur is enough for currency; change handler covers selects.
    }
  });

  void refreshHouseEquityScenarioPicker();
}
