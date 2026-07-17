// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  writeSpendingOverTimeTiersToDom,
  readSpendingOverTimeTiersFromDom,
} from '../src/state/scenario.js';
import {
  toggleSpendingBonusSearchable,
  setupSpendingOverTimeTierList,
} from '../src/ui/inputs.js';

function mountDom({ goalSeek = true, includeSpending = true } = {}) {
  document.body.innerHTML = `
    <input type="checkbox" id="goalSeekMode" ${goalSeek ? 'checked' : ''}>
    <input type="checkbox" id="goalSeekIncludeSpendingOverTime" ${includeSpending ? 'checked' : ''}>
    <div id="spendingOverTimeTiersList"></div>
    <button type="button" id="addSpendingOverTimeTier">Add tier</button>
  `;
}

function firstExtraInput() {
  return document.querySelector('[data-spending-tier-row="0"] [data-spending-extra]');
}

describe('first-tier Extra Withdrawal Goal Seek lock', () => {
  beforeEach(() => {
    mountDom();
  });

  it('disables the first Extra field when writing tiers while Include in search is on', () => {
    writeSpendingOverTimeTiersToDom([{ changePct: 0, extra: 10 }]);
    expect(firstExtraInput().disabled).toBe(true);
  });

  it('keeps later tiers editable', () => {
    writeSpendingOverTimeTiersToDom([
      { changePct: -2, extra: 10, years: 5 },
      { changePct: 0, extra: 0 },
    ]);
    const second = document.querySelector('[data-spending-tier-row="1"] [data-spending-extra]');
    expect(firstExtraInput().disabled).toBe(true);
    expect(second.disabled).toBe(false);
  });

  it('leaves the field editable when Include in search is off', () => {
    document.getElementById('goalSeekIncludeSpendingOverTime').checked = false;
    writeSpendingOverTimeTiersToDom([{ changePct: 0, extra: 10 }]);
    expect(firstExtraInput().disabled).toBe(false);
  });

  it('leaves the field editable when Goal Seek mode is off', () => {
    document.getElementById('goalSeekMode').checked = false;
    writeSpendingOverTimeTiersToDom([{ changePct: 0, extra: 10 }]);
    expect(firstExtraInput().disabled).toBe(false);
  });

  it('re-locks after Add tier rebuilds the list', () => {
    writeSpendingOverTimeTiersToDom([{ changePct: 0, extra: 10 }]);
    toggleSpendingBonusSearchable(true);
    setupSpendingOverTimeTierList({ onChange: () => {} });

    document.getElementById('addSpendingOverTimeTier').click();

    expect(readSpendingOverTimeTiersFromDom()).toHaveLength(2);
    expect(firstExtraInput().disabled).toBe(true);
  });
});
