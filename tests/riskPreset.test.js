// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { setupWithdrawalFloorList } from '../src/ui/inputs.js';
import { setupRiskPresetControl, applyPresetLevel } from '../src/ui/riskPreset.js';
import { PRESETS, DEFAULT_PRESET_LEVEL } from '../src/state/presets/index.js';
import { readWithdrawalFloorsFromDom } from '../src/state/scenario.js';

function mountPresetDom({ attached = false } = {}) {
  document.body.innerHTML = `
    <input type="checkbox" id="presetActive" ${attached ? 'checked' : ''}>
    <input type="range" id="presetLevel" value="${DEFAULT_PRESET_LEVEL}">
    <span id="presetLevelName"></span>
    <div id="risk-preset-control"></div>
    <input id="startBalance" value="3,000">
    <input id="numYears" value="25">
    <input type="checkbox" id="goalSeekMode" checked>
    <input id="goalSeekDesiredSuccessPct" value="90">
    <input id="goalSeekDesiredSuccessPctSlider" value="90">
    <input id="goalSeekRiskTolerancePct" value="10">
    <input id="goalSeekRiskTolerancePctSlider" value="10">
    <input id="goalSeekTargetEndingBalance" value="">
    <input type="checkbox" id="goalSeekIncludeBaseWithdrawal" checked>
    <input type="checkbox" id="goalSeekIncludeSpendingOverTime" checked>
    <input type="checkbox" id="goalSeekIncludeMarketAdjustments" checked>
    <input type="checkbox" id="goalSeekIncludeBalanceOverrides" checked>
    <input type="checkbox" id="goalSeekIncludeGlidePath" checked>
    <input id="planRiskTolerancePct" value="10">
    <input id="planRiskTolerancePctSlider" value="10">
    <input id="dynLowRet" value="-15">
    <input id="dynMedRet" value="5">
    <input id="dynHighRet" value="20">
    <input id="dynNoCutBal" value="">
    <input id="glideRate" value="-2">
    <input id="glideTarget" value="">
    <input id="maxConsecutiveMinWithdrawals" value="3">
    <input id="maxConsecutiveMinWithdrawalsSpecific" value="3">
    <input id="minWithdrawalPlanRecoveryYears" value="2">
    <input id="minWithdrawalPlanRecoveryYearsSpecific" value="2">
    <input id="baseWithdrawal" value="0">
    <input id="floorBalance" value="0">
    <input id="floorPenalty" value="50">
    <input id="ceilingBalance" value="0">
    <input id="ceilingBonus" value="50">
    <input id="dynLowAdj" value="0">
    <input id="dynMedAdj" value="0">
    <input id="dynHighAdj" value="0">
    <input id="glideFraction" value="50">
    <input name="distribution-method" type="radio" value="resampling" checked>
    <div id="lognormal-profiles"></div>
    <span id="totalAllocation">100</span>
    <div id="withdrawalFloorsList"></div>
    <button type="button" id="addWithdrawalFloorTier">Add tier</button>
    <div id="giftingTiersList"></div>
    <div id="spendingOverTimeTiersList"></div>
  `;
}

function expectedMinAmount(level = DEFAULT_PRESET_LEVEL) {
  const life = PRESETS[level].derived.minWithdrawalLifetimePctOfStart;
  return Math.round(3000 * (life / 100) / 25);
}

describe('applyPresetLevel minimum tier', () => {
  beforeEach(() => {
    mountPresetDom({ attached: true });
    setupWithdrawalFloorList({ onChange: () => {} });
    setupRiskPresetControl({ onChange: () => {} });
  });

  it('creates a minimum tier when Easy Mode is re-attached with an empty list', () => {
    document.getElementById('presetActive').checked = false;
    expect(readWithdrawalFloorsFromDom()).toHaveLength(0);

    document.getElementById('presetActive').checked = true;
    applyPresetLevel(DEFAULT_PRESET_LEVEL);

    const tiers = readWithdrawalFloorsFromDom();
    expect(tiers).toHaveLength(1);
    expect(tiers[0].amount).toBe(expectedMinAmount());
  });

  it('creates a minimum tier when the slider moves with an empty list', () => {
    applyPresetLevel(0);

    const tiers = readWithdrawalFloorsFromDom();
    expect(tiers).toHaveLength(1);
    expect(tiers[0].amount).toBe(expectedMinAmount(0));
  });

  it('recreates the minimum tier after all tiers are removed and the slider moves', () => {
    applyPresetLevel(DEFAULT_PRESET_LEVEL);
    expect(readWithdrawalFloorsFromDom()).toHaveLength(1);

    document.querySelector('.remove-withdrawal-floor-tier').click();
    expect(readWithdrawalFloorsFromDom()).toHaveLength(0);

    applyPresetLevel(0);
    expect(readWithdrawalFloorsFromDom()).toEqual([{ amount: expectedMinAmount(0) }]);
  });
});
