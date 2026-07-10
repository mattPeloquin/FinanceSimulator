// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  loadAccordionState,
  saveAccordionState,
  setAccordionOpen,
} from '../src/state/persistence.js';
import { setupAccordionResize } from '../src/ui/inputs.js';

describe('accordion persistence', () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = `
      <details id="section-investment"><summary>Investment</summary><div></div></details>
      <details id="section-withdrawal" open><summary>Withdrawal</summary><div></div></details>
      <details><summary>No id</summary><div></div></details>
    `;
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('load/save round-trip only keeps boolean open flags', () => {
    saveAccordionState({
      'section-investment': true,
      'section-withdrawal': false,
      junk: 'nope',
    });
    expect(loadAccordionState()).toEqual({
      'section-investment': true,
      'section-withdrawal': false,
    });
  });

  it('setAccordionOpen merges into the stored map', () => {
    setAccordionOpen('section-investment', true);
    setAccordionOpen('section-withdrawal', false);
    expect(loadAccordionState()).toEqual({
      'section-investment': true,
      'section-withdrawal': false,
    });
  });

  it('setupAccordionResize restores saved open state and persists toggles', () => {
    localStorage.setItem(
      'sor:ui-accordions',
      JSON.stringify({ 'section-investment': true, 'section-withdrawal': false }),
    );

    setupAccordionResize();

    expect(document.getElementById('section-investment').open).toBe(true);
    expect(document.getElementById('section-withdrawal').open).toBe(false);

    const investment = document.getElementById('section-investment');
    investment.open = false;
    investment.dispatchEvent(new Event('toggle'));
    expect(loadAccordionState()['section-investment']).toBe(false);

    // Unidentified details are ignored for persistence.
    const before = JSON.stringify(loadAccordionState());
    const anonymous = document.querySelector('details:not([id])');
    anonymous.open = true;
    anonymous.dispatchEvent(new Event('toggle'));
    expect(JSON.stringify(loadAccordionState())).toBe(before);
  });

  it('uses HTML defaults when nothing is stored yet', () => {
    setupAccordionResize();
    expect(document.getElementById('section-investment').open).toBe(false);
    expect(document.getElementById('section-withdrawal').open).toBe(true);
  });
});
