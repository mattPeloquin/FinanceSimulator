// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { updateAllocationTotal } from '../src/features/withdraw/ui/inputs.js';
import { listSleeves, defaultAllocationPct } from '../src/portfolio/registry.js';

function mountDualFeatureAllocationDom() {
  const mix = defaultAllocationPct();
  const sleeveRows = (prefix) => listSleeves().map((s) => `
    <div data-alloc-row>
      <input class="allocation-input" id="${prefix}${s.pctKey}" value="${mix[s.pctKey] ?? 0}">
    </div>
  `).join('');

  document.body.innerHTML = `
    <div id="feature-withdraw">
      <div id="allocationSparklines">
        ${sleeveRows('')}
        <p>Total: <span id="totalAllocation">0</span>%</p>
      </div>
    </div>
    <div id="feature-accumulate" style="display:none">
      <div id="accumulate-allocation-sparklines">
        ${sleeveRows('accumulate-')}
        <p>Total: <span id="accumulate-total-allocation">0</span>%</p>
      </div>
    </div>
  `;
}

describe('updateAllocationTotal', () => {
  beforeEach(() => {
    mountDualFeatureAllocationDom();
  });

  it('sums only Withdraw sleeve inputs when other features also mount allocation panels', () => {
    const total = updateAllocationTotal();
    expect(total).toBe(100);
    const el = document.getElementById('totalAllocation');
    expect(el.textContent).toBe('100');
    expect(el.classList.contains('text-theme-success')).toBe(true);
    expect(el.classList.contains('text-theme-danger')).toBe(false);
  });
});
