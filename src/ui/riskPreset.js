// Risk Level preset slider (simple-use mode).
//
// While the "Use preset" checkbox is ON ("attached"):
//   - moving the slider loads that level's settings (see src/state/presets/),
//   - editing Starting Portfolio / Years live-rescales the balance- and
//     horizon-derived values (minimum withdrawal, gifting, balance triggers,
//     target ending balance, spending timeline),
//   - when Goal Seek is off, also fills the full spending plan from presets,
//   - glide spend timing and other preset keys are applied verbatim,
//   - manually editing any preset-controlled field DETACHES: the checkbox
//     flips off and the user's values are kept. Re-checking re-applies the
//     current level.
//
// The slider never runs a simulation — it only writes form values.
//
// Goal Seek's write-back of found plan values does NOT detach: it assigns
// element values directly without firing events, and that is by design —
// presets configure the search; the search fills in the answer.
//
// Toggling Goal Seek on/off does NOT detach Easy Mode.

import {
  parseCurrency,
  writeScenarioFieldsToDom,
  readWithdrawalFloorsFromDom,
  readGiftingTiersFromDom,
  readSpendingOverTimeTiersFromDom,
} from '../state/scenario.js';
import {
  presetForLevel,
  computeDerivedPresetValues,
  DEFAULT_PRESET_LEVEL,
} from '../state/presets/index.js';
import {
  toggleDistMethod,
  refreshDynamicAdjustmentPreviews,
  updateAllocationTotal,
} from './inputs.js';
import { syncBaseWithdrawalPreview } from './charts/basePreview.js';

// Guards the detach listeners while our own writes are in flight (belt and
// suspenders — programmatic value writes don't fire events anyway, but tier
// list rebuilds involve DOM churn we don't want misread as user edits).
let isApplyingPreset = false;
let notify = () => {};

function el(id) {
  return document.getElementById(id);
}

function isAttached() {
  return !!el('presetActive')?.checked;
}

function goalSeekEnabled() {
  return !!el('goalSeekMode')?.checked;
}

function currentLevel() {
  const n = parseInt(el('presetLevel')?.value, 10);
  return Number.isFinite(n) ? n : DEFAULT_PRESET_LEVEL;
}

// The context computeDerivedPresetValues needs: the user's own inputs plus
// the current tier lists (patched in place — user-added tiers survive).
function derivedContext() {
  return {
    startThousands: parseCurrency(el('startBalance')?.value),
    numYears: parseInt(el('numYears')?.value, 10),
    withdrawalFloors: readWithdrawalFloorsFromDom(),
    giftingTiers: readGiftingTiersFromDom(),
    spendingOverTimeTiers: readSpendingOverTimeTiersFromDom(),
    includePlanFields: isAttached() && !goalSeekEnabled(),
  };
}

function updateLevelText() {
  const preset = presetForLevel(currentLevel());
  const nameEl = el('presetLevelName');
  if (nameEl) nameEl.textContent = `${preset.name} — ${preset.description}`;
}

// Reflect attached/detached state: when off, gray the whole Easy Mode block
// (checkbox stays clickable so the user can turn it back on).
function updateControlState() {
  const attached = isAttached();
  const slider = el('presetLevel');
  if (slider) slider.disabled = !attached;
  const control = el('risk-preset-control');
  if (control) control.classList.toggle('opacity-50', !attached);
}

// Refresh the previews/toggles that depend on the fields a preset writes —
// the same set applyScenario() re-runs after a full scenario load.
function refreshDependentUi(patch) {
  if (patch.distMethod != null) toggleDistMethod(patch.distMethod);
  refreshDynamicAdjustmentPreviews();
  updateAllocationTotal();
  syncBaseWithdrawalPreview();
}

function buildPresetPatch(level) {
  const preset = presetForLevel(level);
  return {
    ...preset.scenario,
    ...computeDerivedPresetValues(preset, derivedContext()),
  };
}

/** Apply a slider level: static preset keys + derived values. Never simulates. */
export function applyPresetLevel(level) {
  isApplyingPreset = true;
  try {
    const patch = buildPresetPatch(level);
    writeScenarioFieldsToDom(patch);
    refreshDependentUi(patch);
    updateLevelText();
  } finally {
    isApplyingPreset = false;
  }
  notify();
}

// Recompute derived (and plan when Goal Seek is off) while attached.
function rescaleDerived() {
  if (!isAttached()) return;
  isApplyingPreset = true;
  try {
    const patch = computeDerivedPresetValues(presetForLevel(currentLevel()), derivedContext());
    writeScenarioFieldsToDom(patch);
    refreshDynamicAdjustmentPreviews();
    syncBaseWithdrawalPreview();
  } finally {
    isApplyingPreset = false;
  }
  notify();
}

/** When Goal Seek turns off while attached, fill the preset spending plan. */
export function applyPlanFieldsIfAttached() {
  if (!isAttached() || goalSeekEnabled()) return;
  rescaleDerived();
}

/** Flip the preset off, keeping all current form values. */
export function detachPreset() {
  const checkbox = el('presetActive');
  if (!checkbox || !checkbox.checked) return;
  checkbox.checked = false;
  updateControlState();
  notify();
}

function maybeDetach() {
  if (isApplyingPreset || !isAttached()) return;
  detachPreset();
}

function maybeDetachPlanField() {
  if (isApplyingPreset || !isAttached() || goalSeekEnabled()) return;
  detachPreset();
}

/** Sync the control from a loaded scenario (session load, import, init).
 * Only reflects state — never re-applies the preset patch: the loaded
 * scenario's saved values are the truth. */
export function syncRiskPresetUi(scenario) {
  const slider = el('presetLevel');
  if (slider) slider.value = String(scenario.presetLevel ?? DEFAULT_PRESET_LEVEL);
  const checkbox = el('presetActive');
  if (checkbox) checkbox.checked = !!scenario.presetActive;
  updateControlState();
  updateLevelText();
}

// Detach when the user edits a slider-managed tier field. Only the tiers the
// slider manages count: row 0 of minimum-withdrawal and gifting; the change %
// on the first two spending tiers and the years of spending tier 0. Tier-0
// extra detaches only when Goal Seek is off (Easy Mode owns it then).
function isSliderManagedTierEdit(target) {
  const floorRow = target.closest('[data-withdrawal-floor-row]');
  if (floorRow) return floorRow.dataset.withdrawalFloorRow === '0';

  const giftRow = target.closest('[data-gifting-tier-row]');
  if (giftRow) return giftRow.dataset.giftingTierRow === '0';

  const spendingRow = target.closest('[data-spending-tier-row]');
  if (spendingRow) {
    const row = spendingRow.dataset.spendingTierRow;
    if (target.matches('[data-spending-change]')) return row === '0' || row === '1';
    if (target.matches('[data-spending-years]')) return row === '0';
    if (target.matches('[data-spending-extra]')) {
      return row === '0' && !goalSeekEnabled();
    }
  }
  return false;
}

/** Wire the slider, checkbox, live rescale, and detach detection. */
export function setupRiskPresetControl({ onChange } = {}) {
  notify = typeof onChange === 'function' ? onChange : () => {};

  const slider = el('presetLevel');
  const checkbox = el('presetActive');
  if (!slider || !checkbox) return;

  slider.addEventListener('input', () => {
    updateLevelText();
    if (isAttached()) applyPresetLevel(currentLevel());
  });

  checkbox.addEventListener('change', () => {
    updateControlState();
    if (checkbox.checked) {
      // Re-attaching reloads the current level over whatever was typed.
      applyPresetLevel(currentLevel());
    } else {
      notify();
    }
  });

  // Live rescale of derived values while attached.
  el('startBalance')?.addEventListener('input', rescaleDerived);
  el('numYears')?.addEventListener('input', rescaleDerived);

  // Goal Seek off while attached → fill the preset spending plan (no detach).
  el('goalSeekMode')?.addEventListener('change', () => {
    applyPlanFieldsIfAttached();
  });

  // ---- Detach detection (user edits to preset-controlled fields) ----------

  document.querySelectorAll('input[name="distribution-method"]').forEach((radio) => {
    radio.addEventListener('change', maybeDetach);
  });

  const detachIds = [
    'goalSeekDesiredSuccessPct', 'goalSeekDesiredSuccessPctSlider',
    'goalSeekRiskTolerancePct', 'goalSeekRiskTolerancePctSlider',
    'goalSeekTargetEndingBalance',
    'goalSeekIncludeBaseWithdrawal', 'goalSeekIncludeSpendingOverTime',
    'goalSeekIncludeMarketAdjustments', 'goalSeekIncludeBalanceOverrides',
    'goalSeekIncludeGlidePath',
    'planRiskTolerancePct', 'planRiskTolerancePctSlider',
    'dynLowRet', 'dynMedRet', 'dynHighRet',
    'dynLowBal', 'dynMedBal', 'dynHighBal',
    'glideRate',
    'glideTarget',
  ];
  for (const id of detachIds) {
    const input = el(id);
    if (!input) continue;
    input.addEventListener('input', maybeDetach);
    input.addEventListener('change', maybeDetach);
  }

  const planDetachIds = [
    'baseWithdrawal',
    'floorBalance', 'floorPenalty', 'ceilingBalance', 'ceilingBonus',
    'dynLowAdj', 'dynMedAdj', 'dynHighAdj',
    'glideFraction',
  ];
  for (const id of planDetachIds) {
    const input = el(id);
    if (!input) continue;
    input.addEventListener('input', maybeDetachPlanField);
    input.addEventListener('change', maybeDetachPlanField);
  }

  document.querySelectorAll('.allocation-input').forEach((input) => {
    input.addEventListener('input', maybeDetach);
  });

  for (const listId of ['withdrawalFloorsList', 'giftingTiersList', 'spendingOverTimeTiersList']) {
    const list = el(listId);
    if (!list) continue;
    const handler = (e) => {
      if (isApplyingPreset || !isAttached()) return;
      if (e.target instanceof Element && isSliderManagedTierEdit(e.target)) {
        if (e.target.matches('[data-spending-extra]')) maybeDetachPlanField();
        else detachPreset();
      }
    };
    list.addEventListener('input', handler);
    list.addEventListener('change', handler);
  }
}
