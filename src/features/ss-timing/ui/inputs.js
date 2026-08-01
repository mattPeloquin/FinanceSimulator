// Social Security config panel — DOM ↔ session + Easy Mode + shared returns UI.

import {
  getSsTimingState,
  patchSsTimingState,
  applySsTimingPreset,
  detachSsTimingPreset,
} from '../session.js';
import { getSsTimingPresets } from '../presets.js';
import { pickReturnsAllocationSlice } from '../../../state/returnsAllocationSlice.js';
import { createReturnsAllocationUi } from '../../../ui/returnsAllocation/controller.js';

let isApplyingPreset = false;
/** @type {ReturnType<typeof createReturnsAllocationUi> | null} */
let returnsUi = null;

function el(id) {
  return document.getElementById(id);
}

function readNumber(id, fallback = 0) {
  const n = Number(el(id)?.value);
  return Number.isFinite(n) ? n : fallback;
}

function isPresetAttached() {
  return !!el('ss-timing-preset-active')?.checked;
}

function currentPresetLevel() {
  const n = parseInt(el('ss-timing-preset-level')?.value, 10);
  return [0, 1, 2].includes(n) ? n : 0;
}

function updatePresetName() {
  const presets = getSsTimingPresets();
  const preset = presets[currentPresetLevel()] || presets[0];
  const nameEl = el('ss-timing-preset-name');
  if (nameEl && preset) {
    nameEl.textContent = `${preset.name} — ${preset.description}`;
  }
}

function updatePresetControlState() {
  const attached = isPresetAttached();
  const slider = el('ss-timing-preset-level');
  if (slider) slider.disabled = !attached;
  el('ss-timing-preset-control')?.classList.toggle('opacity-50', !attached);
}

function applyLevelFromSlider() {
  const presets = getSsTimingPresets();
  const preset = presets[currentPresetLevel()];
  if (!preset) return;
  isApplyingPreset = true;
  try {
    applySsTimingPreset(preset.id, { keepAttached: true });
    renderSsTimingForm();
  } finally {
    isApplyingPreset = false;
  }
}

function parseEndAges(text) {
  return String(text || '')
    .split(/[,;\s]+/)
    .map((s) => parseInt(s, 10))
    .filter((n) => Number.isFinite(n) && n >= 70 && n <= 120);
}

export function syncSsTimingFormToState() {
  const state = getSsTimingState();
  const returnsPartial = returnsUi?.readFromDom() || pickReturnsAllocationSlice(state);
  const couple = !!el('ss-timing-couple')?.checked;

  patchSsTimingState({
    couple,
    personA: {
      ...state.personA,
      birthYear: readNumber('ss-timing-a-birth', state.personA.birthYear),
      currentAge: readNumber('ss-timing-a-age', state.personA.currentAge),
      piaMonthly: readNumber('ss-timing-a-pia', state.personA.piaMonthly),
      claimAge: readNumber('ss-timing-a-claim', state.personA.claimAge),
    },
    personB: {
      ...state.personB,
      birthYear: readNumber('ss-timing-b-birth', state.personB.birthYear),
      currentAge: readNumber('ss-timing-b-age', state.personB.currentAge),
      piaMonthly: readNumber('ss-timing-b-pia', state.personB.piaMonthly),
      claimAge: readNumber('ss-timing-b-claim', state.personB.claimAge),
    },
    endAges: parseEndAges(el('ss-timing-end-ages')?.value) || state.endAges,
    numSimulations: Number(el('ss-timing-paths')?.value) || state.numSimulations,
    ...returnsPartial,
    allocationOverTimeTiers: [returnsPartial.allocation],
    bridge: {
      enabled: !!el('ss-timing-bridge-enabled')?.checked,
      startBalance: readNumber('ss-timing-bridge-balance', state.bridge.startBalance),
      annualSpend: readNumber('ss-timing-bridge-spend', state.bridge.annualSpend),
    },
    policy: {
      ...state.policy,
      baseTaxRate: readNumber('ss-timing-tax-rate', state.policy.baseTaxRate),
      taxNoiseStd: readNumber('ss-timing-tax-noise', state.policy.taxNoiseStd),
      benefitCut: {
        ...state.policy.benefitCut,
        mode: el('ss-timing-cut-mode')?.value || 'none',
      },
    },
    presetActive: isPresetAttached(),
    presetLevel: currentPresetLevel(),
  });

  const bBlock = el('ss-timing-person-b');
  if (bBlock) bBlock.classList.toggle('opacity-50', !couple);
}

export function renderSsTimingForm() {
  const state = getSsTimingState();
  if (el('ss-timing-couple')) el('ss-timing-couple').checked = state.couple !== false;
  if (el('ss-timing-a-birth')) el('ss-timing-a-birth').value = state.personA.birthYear;
  if (el('ss-timing-a-age')) el('ss-timing-a-age').value = state.personA.currentAge;
  if (el('ss-timing-a-pia')) el('ss-timing-a-pia').value = state.personA.piaMonthly;
  if (el('ss-timing-a-claim')) el('ss-timing-a-claim').value = state.personA.claimAge;
  if (el('ss-timing-b-birth')) el('ss-timing-b-birth').value = state.personB.birthYear;
  if (el('ss-timing-b-age')) el('ss-timing-b-age').value = state.personB.currentAge;
  if (el('ss-timing-b-pia')) el('ss-timing-b-pia').value = state.personB.piaMonthly;
  if (el('ss-timing-b-claim')) el('ss-timing-b-claim').value = state.personB.claimAge;
  if (el('ss-timing-end-ages')) el('ss-timing-end-ages').value = state.endAges.join(', ');
  if (el('ss-timing-bridge-enabled')) el('ss-timing-bridge-enabled').checked = state.bridge.enabled !== false;
  if (el('ss-timing-bridge-balance')) el('ss-timing-bridge-balance').value = state.bridge.startBalance;
  if (el('ss-timing-bridge-spend')) el('ss-timing-bridge-spend').value = state.bridge.annualSpend;
  if (el('ss-timing-tax-rate')) el('ss-timing-tax-rate').value = state.policy.baseTaxRate;
  if (el('ss-timing-tax-noise')) el('ss-timing-tax-noise').value = state.policy.taxNoiseStd;
  if (el('ss-timing-cut-mode')) el('ss-timing-cut-mode').value = state.policy.benefitCut.mode;
  if (el('ss-timing-paths')) el('ss-timing-paths').value = String(state.numSimulations);
  if (el('ss-timing-preset-active')) el('ss-timing-preset-active').checked = state.presetActive !== false;
  if (el('ss-timing-preset-level')) el('ss-timing-preset-level').value = String(state.presetLevel ?? 0);
  updatePresetName();
  updatePresetControlState();
  el('ss-timing-person-b')?.classList.toggle('opacity-50', !state.couple);
  returnsUi?.refreshFromState();
}

export function bindSsTimingInputs() {
  const host = el('ss-timing-returns-host');
  if (host && !returnsUi) {
    returnsUi = createReturnsAllocationUi(host, {
      idPrefix: 'ss-timing-',
      mountMarkup: true,
      getSlice: () => pickReturnsAllocationSlice(getSsTimingState()),
      setSlice: (partial) => patchSsTimingState(partial),
      onChange: () => {
        if (isApplyingPreset) return;
        if (getSsTimingState().presetActive) {
          detachSsTimingPreset();
          if (el('ss-timing-preset-active')) el('ss-timing-preset-active').checked = false;
          updatePresetControlState();
        }
      },
    });
  }

  renderSsTimingForm();

  const root = el('feature-ss-timing');
  if (!root) return;

  el('ss-timing-preset-active')?.addEventListener('change', () => {
    if (isApplyingPreset) return;
    if (isPresetAttached()) applyLevelFromSlider();
    else {
      detachSsTimingPreset();
      updatePresetControlState();
    }
  });

  el('ss-timing-preset-level')?.addEventListener('input', () => {
    updatePresetName();
    if (isApplyingPreset || !isPresetAttached()) return;
    applyLevelFromSlider();
  });

  root.addEventListener('change', (e) => {
    if (isApplyingPreset) return;
    if (!(e.target instanceof HTMLElement)) return;
    if (e.target.id?.startsWith('ss-timing-preset')) return;
    if (e.target.closest('#ss-timing-returns-host')) return;
    if (e.target.id?.startsWith('ss-timing-')) {
      const wasAttached = getSsTimingState().presetActive;
      syncSsTimingFormToState();
      if (wasAttached) {
        detachSsTimingPreset();
        if (el('ss-timing-preset-active')) el('ss-timing-preset-active').checked = false;
        updatePresetControlState();
      }
    }
  });
}
