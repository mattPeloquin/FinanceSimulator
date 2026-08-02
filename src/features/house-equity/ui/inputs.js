// House Equity config panel — DOM ↔ session + Easy Mode + portfolio source.

import * as sessions from '../../../state/sessions.js';
import { FEATURE_WITHDRAW } from '../../../state/storageKeys.js';
import { getHouseEquityPresets } from '../presets.js';
import {
  getHouseEquityState,
  patchHouseEquityState,
  applyHouseEquityPreset,
  detachHouseEquityPreset,
} from '../session.js';
import { formatCurrency, parseCurrency } from '../../../state/scenario.js';
import { mountPortfolioPanel } from '../../../portfolio/ui/panel.js';
import { renderPortfolioPreview } from '../../../portfolio/ui/preview.js';
import { fromWithdrawScenario } from '../../../portfolio/adapters.js';
import { pickReturnsAllocationSlice } from '../../../state/returnsAllocationSlice.js';

/** @type {ReturnType<typeof mountPortfolioPanel> | null} */
let portfolioUi = null;

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

async function updatePortfolioPreview() {
  const name = el('house-equity-scenario')?.value;
  const host = el('house-equity-portfolio-preview');
  if (!name) {
    renderPortfolioPreview(host, null);
    return;
  }
  try {
    const loaded = await sessions.load(FEATURE_WITHDRAW, name);
    if (!loaded?.payload) {
      renderPortfolioPreview(host, null);
      return;
    }
    renderPortfolioPreview(host, fromWithdrawScenario(loaded.payload), { sessionName: name });
  } catch {
    renderPortfolioPreview(host, null);
  }
}

async function updatePortfolioSourceUi() {
  const source = document.querySelector('input[name="house-equity-portfolio-source"]:checked')?.value
    || getHouseEquityState().portfolioSource
    || 'local';
  const linkMode = source === 'link';
  el('house-equity-link-wrap')?.classList.toggle('hidden', !linkMode);
  el('house-equity-returns-host')?.classList.toggle('hidden', linkMode);
  if (linkMode) await updatePortfolioPreview();
  else portfolioUi?.refreshFromState();
}

export async function refreshHouseEquityScenarioPicker() {
  const select = el('house-equity-scenario');
  if (!select) return;
  const current = getHouseEquityState().scenarioRef?.name || '';
  let names;
  try {
    const list = await sessions.list(FEATURE_WITHDRAW);
    names = (list || []).map((s) => s.name).filter(Boolean);
  } catch {
    names = [];
  }
  select.innerHTML = '<option value="">Select a saved Withdraw session…</option>';
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
  await updatePortfolioSourceUi();
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

  const source = s.scenarioRef?.name ? 'link' : (s.portfolioSource || 'local');
  const linkRadio = el('house-equity-source-link');
  const localRadio = el('house-equity-source-local');
  if (linkRadio) linkRadio.checked = source === 'link';
  if (localRadio) localRadio.checked = source !== 'link';

  portfolioUi?.refreshFromState();
  void refreshHouseEquityScenarioPicker();
}

export function syncHouseEquityFormToState() {
  const source = document.querySelector('input[name="house-equity-portfolio-source"]:checked')?.value
    || 'local';
  const scenarioName = el('house-equity-scenario')?.value || '';
  const localPortfolio = portfolioUi?.readFromDom()
    || pickReturnsAllocationSlice(getHouseEquityState().portfolio || {});
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
    portfolioSource: source,
    scenarioRef: source === 'link' && scenarioName
      ? { feature: FEATURE_WITHDRAW, name: scenarioName }
      : null,
    portfolio: localPortfolio,
  });
}

export function bindHouseEquityInputs() {
  const host = el('house-equity-returns-host');
  if (host && !portfolioUi) {
    portfolioUi = mountPortfolioPanel(host, {
      idPrefix: 'house-equity-',
      mountMarkup: true,
      wrapAccordion: true,
      showOverTime: false,
      syncSparklines: true,
      sectionTitle: 'Investment Planning',
      sectionHelp: 'Historical years, distribution method, and asset allocation for Monte Carlo returns.',
      getPortfolio: () => pickReturnsAllocationSlice(getHouseEquityState().portfolio || {}),
      setPortfolio: (partial) => {
        patchHouseEquityState({
          portfolio: { ...pickReturnsAllocationSlice(getHouseEquityState().portfolio || {}), ...partial },
          portfolioSource: 'local',
        });
      },
    });
  }

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
    if (t.name === 'house-equity-portfolio-source') {
      syncHouseEquityFormToState();
      void updatePortfolioSourceUi();
      return;
    }
    if (t.id?.startsWith('house-equity-') && t.id !== 'house-equity-preset-level'
      && t.id !== 'house-equity-preset-active') {
      if (isPresetAttached() && t.id !== 'house-equity-scenario' && t.id !== 'house-equity-paths') {
        detachHouseEquityPreset();
        el('house-equity-preset-active').checked = false;
        updatePresetLabel();
      }
      syncHouseEquityFormToState();
      if (t.id === 'house-equity-scenario') void updatePortfolioSourceUi();
    }
  });

  void refreshHouseEquityScenarioPicker();
}
