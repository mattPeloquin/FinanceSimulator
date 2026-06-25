import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { FIELDS } from '../src/state/scenario.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');

// Required non-field element ids the app wires up at runtime.
const REQUIRED_IDS = [
  'runButton',
  'resultsSection',
  'loadingIndicator',
  'loadingText',
  'progressBar',
  'totalAllocation',
  'year-labels',
  'historical-range-msg',
  'lognormal-profiles',
  'resampling-profiles',
  'blockSizeSlider',
  'sessionSelect',
  'saveSessionButton',
  'deleteSessionButton',
  'exportSessionButton',
  'importSessionButton',
  'importFileInput',
  'successRate',
  'medianBalance',
  'medianWithdrawn',
  'balanceChart',
  'withdrawalChart',
  'resultsChart',
  'surfaceChart',
];

const PERCENTILE_CARD_IDS = [];
for (const p of ['p10', 'p20', 'p30', 'p40', 'p50', 'p60']) {
  PERCENTILE_CARD_IDS.push(`${p}Wd`, `${p}Bal`, `${p}Ret`);
}

function hasId(id) {
  return html.includes(`id="${id}"`);
}

describe('index.html wiring', () => {
  it('contains every scenario field input id', () => {
    const missing = FIELDS.filter((f) => !hasId(f.dom)).map((f) => f.dom);
    expect(missing).toEqual([]);
  });

  it('contains all required element ids', () => {
    const missing = REQUIRED_IDS.filter((id) => !hasId(id));
    expect(missing).toEqual([]);
  });

  it('contains all percentile card ids', () => {
    const missing = PERCENTILE_CARD_IDS.filter((id) => !hasId(id));
    expect(missing).toEqual([]);
  });

  it('has both distribution-method radios', () => {
    expect(html).toMatch(/name="distribution-method"[^>]*value="resampling"/);
    expect(html).toMatch(/name="distribution-method"[^>]*value="lognormal"/);
  });
});
