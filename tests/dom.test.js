import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { FIELDS } from '../src/state/scenario.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// index.html is assembled from Handlebars partials at build time (see
// vite.config.js). Mirror that here: collect every src/partials/**/*.html file
// by name and recursively substitute {{> name }} references.
function loadPartials(dir, partials = {}) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      loadPartials(full, partials);
    } else if (entry.name.endsWith('.html')) {
      partials[entry.name.replace(/\.html$/, '')] = readFileSync(full, 'utf8');
    }
  }
  return partials;
}

function inlinePartials(source, partials) {
  return source.replace(/\{\{>\s*([\w-]+)\s*\}\}/g, (_, name) =>
    inlinePartials(partials[name] ?? '', partials)
  );
}

const partials = loadPartials(join(__dirname, '..', 'src', 'partials'));
const html = inlinePartials(readFileSync(join(__dirname, '..', 'index.html'), 'utf8'), partials);

// Required non-field element ids the app wires up at runtime.
const REQUIRED_IDS = [
  'runButton',
  'resultsSection',
  'goalSeekWarning',
  'goalSeekWarningMessage',
  'loadingIndicator',
  'loadingText',
  'progressBar',
  'cancelSimulationButton',
  'messageDialog',
  'messageDialogTitle',
  'messageDialogText',
  'messageDialogOk',
  'totalAllocation',
  'year-labels',
  'historical-range-msg',
  'historical-range-help',
  'lognormal-profiles',
  'resampling-profiles',
  'smoothing-control',
  'scaledHistoricalSmoothingSlider',
  'goalSeekDesiredSuccessPctSlider',
  'goalSeekRiskTolerancePctSlider',
  'blockSizeSlider',
  'sessionSelect',
  'newSessionButton',
  'saveSessionButton',
  'copySessionButton',
  'deleteSessionButton',
  'exportSessionButton',
  'importSessionButton',
  'importFileInput',
  'sessionNote',
  'saveSessionDialogTitle',
  'saveSessionDescription',
  'themeToggle',
  'goal-seek-wrapper',
  'successRate',
  'withdrawalTargetSuccessRate',
  'medianBalance',
  'medianReturn',
  'medianWithdrawn',
  'plannedWithdrawn',
  'guardrailPreviewChart',
  'withdrawalAdjPreviewChart',
  'balanceChart',
  'withdrawalChart',
  'resultsChart',
  'returnMean',
  'returnMedian',
  'returnMin',
  'returnMax',
  'returnStdDev',
  'allYearsMean',
  'allYearsMedian',
  'allYearsMin',
  'allYearsMax',
  'allYearsStdDev',
  'allYearsChart',
  'surfaceChart',
  'irrScatterCanvas',
  'irrScatterLegend',
  'irrScatterDrilldown',
  'irrScatterPathCanvas',
  'irrScatterBalanceCanvas',
  'largeWithdrawalCanvas',
  'largeBalanceCanvas',
];

const PERCENTILE_CARD_IDS = [];
for (const p of ['p10', 'p20', 'p30', 'p40', 'p50', 'p60']) {
  PERCENTILE_CARD_IDS.push(`${p}Wd`, `${p}Delta`, `${p}Bal`, `${p}EndYear`, `${p}Ret`);
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

  it('has all distribution-method radios', () => {
    expect(html).toMatch(/name="distribution-method"[^>]*value="resampling"/);
    expect(html).toMatch(/name="distribution-method"[^>]*value="scaledHistorical"/);
    expect(html).toMatch(/name="distribution-method"[^>]*value="lognormal"/);
  });
});
