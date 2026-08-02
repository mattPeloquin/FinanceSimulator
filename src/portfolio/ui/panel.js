// Mountable Withdraw-parity portfolio panel (years, dist methods, sparklines,
// profiles, allocation, optional over-time). Sleeve rows are generated from
// the registry — never hard-coded.

import { listSleeves, INFLATION } from '../registry.js';
import {
  YEAR_RANGE,
  canonicalizeDistMethod,
  normalizeAllocationPct,
  normalizePortfolio,
  buildSamplesAndProfiles,
  isValidYearRange,
} from '../slice.js';
import { formatInvestmentAccordionPill } from '../api.js';
import { updateMiniCharts, setupMiniChartResizeHandling } from './miniCharts.js';
import { minAvailableYear, maxAvailableYear } from '../historicalData.js';

const DIST_RADIOS = [
  {
    value: 'resampling',
    idSuffix: 'dist-resampling',
    title: 'Historical Resampling',
    help: 'Directly sample from historical data, preserving asset correlations.',
  },
  {
    value: 'scaledHistorical',
    idSuffix: 'dist-scaled-historical',
    title: 'Smoothed Historical',
    help: 'Reuses real historical year-to-year sequences and correlations lightly smoothed to fill gaps. Optionally rescale to your own return/volatility assumptions.',
  },
  {
    value: 'lognormal',
    idSuffix: 'dist-lognormal',
    title: 'Log-Normal Distribution',
    help: "Simulate from each asset's Mean and Standard Deviation, correlated using the historical correlation matrix for the selected year range.",
  },
];

function kebab(historyKey) {
  return String(historyKey).replace(/_/g, '-');
}

function elId(prefix, name) {
  if (!prefix) return name;
  const kebabName = name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/_/g, '-')
    .toLowerCase();
  return `${prefix}${kebabName}`;
}

function buildProfileRows(prefix) {
  const rows = listSleeves().map((s) => `
    <label class="font-medium text-theme-body">${s.label}</label>
    <input type="number" step="0.1" id="${prefix}${s.meanKey}" class="pct-input block w-full rounded-md input-theme sm:text-sm p-1">
    <input type="number" step="0.1" id="${prefix}${s.stdKey}" class="pct-input block w-full rounded-md input-theme sm:text-sm p-1">
  `).join('');
  return `${rows}
    <label class="font-medium text-theme-body">${INFLATION.label}</label>
    <input type="number" step="0.1" id="${prefix}${INFLATION.meanKey}" class="pct-input block w-full rounded-md input-theme sm:text-sm p-1">
    <input type="number" step="0.1" id="${prefix}${INFLATION.stdKey}" class="pct-input block w-full rounded-md input-theme sm:text-sm p-1">`;
}

function buildAllocRow(prefix, s) {
  const canvasId = `${prefix}${kebab(s.historyKey)}-mini-chart`;
  return `
    <div data-alloc-row class="grid grid-cols-[6.25rem_3.5rem_minmax(0,1fr)] grid-rows-[auto_auto] gap-x-3">
      <label for="${prefix}${s.pctKey}" class="row-start-1 col-start-1 block text-xs font-medium text-theme-body leading-tight">${s.label}</label>
      <div class="row-start-2 col-start-1 self-center justify-self-center w-[4.75rem] input-adorned has-suffix">
        <input type="number" id="${prefix}${s.pctKey}" class="allocation-input block w-full rounded-md input-theme text-xs p-1 text-center">
        <span class="input-adorn-suffix">%</span>
      </div>
      <p class="row-start-2 col-start-2 self-center text-right pr-3 text-xs text-theme-faint tabular-nums leading-none" title="Average real (inflation-adjusted) annual return">
        <span id="${prefix}${s.domId}AvgReturn">—</span>%
      </p>
      <div class="row-start-2 col-start-3 relative h-14 min-w-0">
        <div id="${prefix}${s.domId}SparkPlot" class="absolute left-0 right-0 h-14 flex gap-x-1 items-stretch" style="top: 0%">
          <div class="relative h-14 w-full min-w-0 flex-1">
            <canvas id="${canvasId}" class="absolute inset-0 w-full h-full"></canvas>
          </div>
          <div class="relative h-14 w-12 shrink-0" title="Sparkline high / low (nominal %)">
            <div id="${prefix}${s.domId}RangeCluster" class="absolute left-0 right-0 flex flex-col gap-1 text-[10px] text-theme-faint tabular-nums leading-none -translate-y-1/2" style="top: 50%">
              <span class="flex justify-end items-baseline">
                <span data-sign class="inline-block w-2 text-right"></span>
                <span id="${prefix}${s.domId}MaxReturn">—</span><span>%</span>
              </span>
              <span class="flex justify-end items-baseline">
                <span data-sign class="inline-block w-2 text-right"></span>
                <span id="${prefix}${s.domId}MinReturn">—</span><span>%</span>
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>`;
}

function buildRichMarkup(prefix, { showOverTime, wrapAccordion, sectionTitle, sectionHelp }) {
  const startId = elId(prefix, prefix ? 'start-year' : 'startYear');
  const endId = elId(prefix, prefix ? 'end-year' : 'endYear');
  const helpId = elId(prefix, prefix ? 'historical-range-help' : 'historical-range-help');
  const msgId = elId(prefix, prefix ? 'historical-range-msg' : 'historical-range-msg');
  const radioName = prefix ? `${prefix}distribution-method` : 'distribution-method';
  const profilesId = elId(prefix, prefix ? 'lognormal-profiles' : 'lognormal-profiles');
  const totalId = elId(prefix, prefix ? 'total-allocation' : 'totalAllocation');
  const yearLabelsId = elId(prefix, prefix ? 'year-labels' : 'year-labels');
  const sparkHostId = elId(prefix, prefix ? 'allocation-sparklines' : 'allocationSparklines');

  const distBlock = DIST_RADIOS.map((d) => {
    const rid = prefix ? `${prefix}${d.idSuffix}` : d.idSuffix;
    return `
      <label for="${rid}" class="relative flex items-start p-3 border rounded-lg cursor-pointer has-[:checked]:bg-theme-accent-subtle has-[:checked]:border-theme-accent">
        <div class="flex items-center h-5">
          <input id="${rid}" name="${radioName}" type="radio" value="${d.value}" class="focus:ring-theme-accent h-4 w-4 text-theme-accent border-theme-input">
        </div>
        <div class="ml-3 text-sm">
          <span class="block font-medium text-theme-body">${d.title}</span>
          <span class="block text-theme-faint">${d.help}</span>
        </div>
      </label>`;
  }).join('');

  const overTime = showOverTime ? `
    <div class="mt-6 pt-4 border-theme-border">
      <details id="${elId(prefix, prefix ? 'details-allocation-over-time' : 'details-allocation-over-time')}" class="group border rounded-lg border-theme-border bg-theme-surface shadow-sm">
        <summary class="cursor-pointer select-none px-4 py-3 text-xs font-semibold text-theme-body flex items-center justify-between">
          <span>Adjust allocation over time</span>
          <svg class="w-4 h-4 text-theme-faint transition-transform group-open:rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/></svg>
        </summary>
        <div class="px-4 pb-4 pt-1 border-t border-theme-border space-y-3">
          <p class="text-xs text-theme-faint mt-2">Asset Allocation above is year 0. Each tier below is a later target mix — the plan glides linearly between them. Intermediate <strong>Years</strong> is how long the glide to that tier takes; the last tier covers remaining years. Keep one tier that matches your starting mix for a flat allocation. Each tier’s categories must sum to 100%.</p>
          <div id="${elId(prefix, prefix ? 'allocation-over-time-tiers-list' : 'allocationOverTimeTiersList')}" class="space-y-2"></div>
          <button type="button" id="${elId(prefix, prefix ? 'add-allocation-over-time-tier' : 'addAllocationOverTimeTier')}" class="text-xs font-medium text-theme-accent hover:underline">Add tier</button>
          <div id="${elId(prefix, prefix ? 'allocation-over-time-preview' : 'allocation-over-time-preview')}" class="relative h-40 bg-theme-surface rounded-md border border-theme-border">
            <canvas id="${elId(prefix, prefix ? 'allocation-over-time-preview-chart' : 'allocationOverTimePreviewChart')}" class="absolute inset-0 w-full h-full p-1"></canvas>
          </div>
        </div>
      </details>
    </div>` : '';

  const body = `
    <div class="space-y-6" data-portfolio-panel>
      <div class="space-y-3">
        <p class="text-sm text-theme-muted pt-3">Select the range of years to use as basis for simulating future returns.</p>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 items-end">
          <div>
            <label for="${startId}" class="block text-sm font-medium text-theme-body">Start Year</label>
            <input type="number" id="${startId}" class="mt-1 block w-full rounded-md input-theme sm:text-sm p-2" step="1">
          </div>
          <div>
            <label for="${endId}" class="block text-sm font-medium text-theme-body">End Year</label>
            <input type="number" id="${endId}" class="mt-1 block w-full rounded-md input-theme sm:text-sm p-2" step="1">
          </div>
        </div>
        <p id="${helpId}" class="text-xs text-theme-faint"></p>
        <p id="${msgId}" class="text-xs text-theme-faint text-center mt-2"></p>
        <fieldset>
          <legend class="font-medium text-theme-body pt-4">Distribution Method</legend>
          <div class="mt-3 grid grid-cols-1 gap-3">
            ${distBlock}
            <details id="${profilesId}" class="form-section-hidden group border border-theme-border rounded-lg">
              <summary class="cursor-pointer select-none px-3 py-2 text-sm font-medium text-theme-body flex items-center justify-between">
                <span>Return Assumptions (Mean / Std Dev)</span>
                <svg class="w-4 h-4 text-theme-faint transition-transform group-open:rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/></svg>
              </summary>
              <div class="px-3 pb-3 pt-1 border-t border-theme-border">
                <div class="grid grid-cols-3 gap-x-4 gap-y-2 text-sm items-center">
                  <span class="font-medium text-theme-faint">Category</span>
                  <span class="font-medium text-theme-faint">Mean</span>
                  <span class="font-medium text-theme-faint">Std Dev</span>
                  ${buildProfileRows(prefix)}
                </div>
              </div>
            </details>
          </div>
        </fieldset>
      </div>
      <div id="${sparkHostId}" class="space-y-1 pr-4">
        <h4 class="font-medium text-theme-body pt-2 pb-1">Asset Allocation</h4>
        <div class="grid grid-cols-[6.25rem_3.5rem_minmax(0,1fr)] gap-x-3">
          <div></div><div></div>
          <div class="flex min-w-0 gap-x-1">
            <div id="${yearLabelsId}" class="flex flex-1 justify-between text-xs text-theme-faint px-1 min-w-0"></div>
            <div class="w-12 shrink-0" aria-hidden="true"></div>
          </div>
        </div>
        ${listSleeves().map((s) => buildAllocRow(prefix, s)).join('')}
        <div class="text-left">
          <p class="text-xs font-semibold">Total: <span id="${totalId}">100</span>%</p>
        </div>
        ${overTime}
      </div>
    </div>`;

  if (!wrapAccordion) return body;

  // Unique accordion ids per feature prefix so multiple mounts never collide.
  const stem = prefix ? String(prefix).replace(/-$/, '') : '';
  const sectionId = stem ? `${stem}-section-investment` : 'section-investment';
  const stateId = stem ? `${stem}-investment-section-state` : 'investmentSectionState';

  return `
    <details id="${sectionId}" class="group border rounded-lg bg-theme-accent-subtle/30">
      <summary class="cursor-pointer select-none flex items-center gap-3 p-4">
        <div class="min-w-0 flex-1">
          <h3 class="text-lg font-semibold text-theme-body">${sectionTitle}</h3>
          <p class="text-xs text-theme-faint mt-0.5">${sectionHelp}</p>
        </div>
        <div id="${stateId}" class="w-max max-w-[40%] shrink-0 text-right text-[10px] font-normal text-theme-body leading-snug whitespace-pre-line line-clamp-2 rounded-md border border-theme-accent/40 bg-theme-accent-subtle px-3 py-2 shadow-sm group-open:hidden"></div>
        <svg class="w-4 h-4 text-theme-faint transition-transform group-open:rotate-180 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/></svg>
      </summary>
      <div class="space-y-6 px-4 pb-4 pt-1 border-t border-theme-border">
        ${body}
      </div>
    </details>`;
}

/**
 * Mount the rich portfolio panel into a host element.
 *
 * @param {HTMLElement} hostEl
 * @param {object} options
 * @param {string} [options.idPrefix]
 * @param {() => object} options.getPortfolio
 * @param {(partial: object) => void} options.setPortfolio
 * @param {'edit'|'readonly'} [options.mode]
 * @param {boolean} [options.showOverTime]
 * @param {boolean} [options.wrapAccordion] - Withdraw-style details wrapper
 * @param {boolean} [options.mountMarkup]
 * @param {(portfolio: object) => void} [options.onChange]
 * @param {boolean} [options.syncSparklines]
 */
export function mountPortfolioPanel(hostEl, options = {}) {
  if (!hostEl) {
    return {
      refreshFromState() {},
      readFromDom() { return null; },
      refreshSparklines() {},
      destroy() {},
      YEAR_RANGE,
    };
  }

  const prefix = options.idPrefix ?? '';
  const getPortfolio = options.getPortfolio;
  const setPortfolio = options.setPortfolio;
  const onChange = options.onChange;
  const mode = options.mode || 'edit';
  const showOverTime = options.showOverTime !== false && !prefix;
  const wrapAccordion = !!options.wrapAccordion;
  const mountMarkup = options.mountMarkup !== false;
  const syncSparklines = options.syncSparklines !== false;
  const radioName = prefix ? `${prefix}distribution-method` : 'distribution-method';
  const stem = prefix ? String(prefix).replace(/-$/, '') : '';
  const sectionStateId = stem ? `${stem}-investment-section-state` : 'investmentSectionState';

  if (mountMarkup) {
    hostEl.innerHTML = buildRichMarkup(prefix, {
      showOverTime,
      wrapAccordion,
      sectionTitle: options.sectionTitle || 'Investment Planning',
      sectionHelp: options.sectionHelp
        || 'Return assumptions and portfolio allocation (Easy Mode can set these for you).',
    });
  }

  const startEl = () => document.getElementById(elId(prefix, prefix ? 'start-year' : 'startYear'));
  const endEl = () => document.getElementById(elId(prefix, prefix ? 'end-year' : 'endYear'));
  const helpEl = () => document.getElementById(elId(prefix, prefix ? 'historical-range-help' : 'historical-range-help'));
  const totalEl = () => document.getElementById(elId(prefix, prefix ? 'total-allocation' : 'totalAllocation'));
  const yearLabelsEl = () => document.getElementById(elId(prefix, prefix ? 'year-labels' : 'year-labels'));
  const sectionStateEl = () => hostEl.querySelector(`#${sectionStateId}`)
    || document.getElementById(sectionStateId);

  if (helpEl()) {
    helpEl().textContent = `Available historical years: ${minAvailableYear}–${maxAvailableYear}.`;
  }

  function readFromDom() {
    const startYear = parseInt(startEl()?.value, 10);
    const endYear = parseInt(endEl()?.value, 10);
    const checked = hostEl.querySelector(`input[name="${radioName}"]:checked`)
      || document.querySelector(`input[name="${radioName}"]:checked`);
    const distMethod = canonicalizeDistMethod(checked?.value, getPortfolio()?.distMethod);
    const allocation = {};
    for (const s of listSleeves()) {
      const el = document.getElementById(`${prefix}${s.pctKey}`);
      const n = Number(el?.value);
      allocation[s.pctKey] = Number.isFinite(n) ? n : 0;
    }
    const profiles = {};
    let anyProfile = false;
    for (const s of listSleeves()) {
      const m = Number(document.getElementById(`${prefix}${s.meanKey}`)?.value);
      const sd = Number(document.getElementById(`${prefix}${s.stdKey}`)?.value);
      if (Number.isFinite(m)) { profiles[s.meanKey] = m; anyProfile = true; }
      if (Number.isFinite(sd)) { profiles[s.stdKey] = sd; anyProfile = true; }
    }
    const im = Number(document.getElementById(`${prefix}${INFLATION.meanKey}`)?.value);
    const isd = Number(document.getElementById(`${prefix}${INFLATION.stdKey}`)?.value);
    if (Number.isFinite(im)) { profiles[INFLATION.meanKey] = im; anyProfile = true; }
    if (Number.isFinite(isd)) { profiles[INFLATION.stdKey] = isd; anyProfile = true; }

    const base = getPortfolio() || {};
    return normalizePortfolio({
      ...base,
      startYear: Number.isFinite(startYear) ? startYear : base.startYear,
      endYear: Number.isFinite(endYear) ? endYear : base.endYear,
      distMethod,
      allocation: normalizeAllocationPct(allocation),
      profiles: anyProfile ? { ...(base.profiles || {}), ...profiles } : base.profiles,
    });
  }

  function writeProfiles(profiles) {
    if (!profiles) return;
    for (const s of listSleeves()) {
      const mEl = document.getElementById(`${prefix}${s.meanKey}`);
      const sEl = document.getElementById(`${prefix}${s.stdKey}`);
      if (mEl && profiles[s.meanKey] != null) mEl.value = String(profiles[s.meanKey]);
      if (sEl && profiles[s.stdKey] != null) sEl.value = String(profiles[s.stdKey]);
    }
    const im = document.getElementById(`${prefix}${INFLATION.meanKey}`);
    const is = document.getElementById(`${prefix}${INFLATION.stdKey}`);
    if (im && profiles[INFLATION.meanKey] != null) im.value = String(profiles[INFLATION.meanKey]);
    if (is && profiles[INFLATION.stdKey] != null) is.value = String(profiles[INFLATION.stdKey]);
  }

  function updateTotal() {
    const display = totalEl();
    if (!display) return;
    let sum = 0;
    // Scope to this panel’s sleeve rows — never sum other features’ mounts.
    hostEl.querySelectorAll('[data-alloc-row] .allocation-input').forEach((input) => {
      sum += parseFloat(input.value) || 0;
    });
    display.textContent = String(Math.round(sum * 10) / 10).replace(/\.0$/, '');
    if (Math.abs(sum - 100) > 0.01) {
      display.classList.add('text-theme-danger');
      display.classList.remove('text-theme-success');
    } else {
      display.classList.remove('text-theme-danger');
      display.classList.add('text-theme-success');
    }
  }

  /** Closed-accordion summary pill (stock/bond · method · years). */
  function updateSectionPill(portfolio) {
    if (!wrapAccordion) return;
    const badge = sectionStateEl();
    if (!badge) return;
    const text = formatInvestmentAccordionPill(
      portfolio || getPortfolio() || readFromDom(),
    );
    badge.textContent = text || '';
    badge.classList.toggle('hidden', !text);
  }

  function refreshSparklines() {
    if (!syncSparklines) return;
    const p = getPortfolio() || readFromDom();
    if (!isValidYearRange(p.startYear, p.endYear)) return;
    const years = updateMiniCharts(p.startYear, p.endYear, prefix);
    const yl = yearLabelsEl();
    if (yl && years?.length) {
      yl.innerHTML = `<span>${years[0]}</span><span>${years[years.length - 1]}</span>`;
    }
  }

  function refreshFromState() {
    const p = normalizePortfolio(getPortfolio());
    if (startEl()) startEl().value = String(p.startYear);
    if (endEl()) endEl().value = String(p.endYear);
    const method = canonicalizeDistMethod(p.distMethod);
    const radio = hostEl.querySelector(`input[name="${radioName}"][value="${method}"]`)
      || document.querySelector(`input[name="${radioName}"][value="${method}"]`);
    if (radio) radio.checked = true;
    for (const s of listSleeves()) {
      const el = document.getElementById(`${prefix}${s.pctKey}`);
      if (el) el.value = String(p.allocation[s.pctKey] ?? 0);
    }
    if (p.profiles) writeProfiles(p.profiles);
    else {
      const { profiles } = buildSamplesAndProfiles(p, { forceProfiles: true });
      if (profiles) writeProfiles(profiles);
    }
    updateTotal();
    refreshSparklines();
    updateSectionPill(p);
    if (mode === 'readonly') {
      hostEl.querySelectorAll('input, select, button').forEach((node) => {
        node.disabled = true;
      });
    }
  }

  function handleChange() {
    if (mode === 'readonly') return;
    const partial = readFromDom();
    // Preserve over-time tiers unless allocation starting mix changed without tiers UI.
    const prev = getPortfolio() || {};
    const next = {
      ...partial,
      allocationOverTimeTiers: prev.allocationOverTimeTiers?.length
        ? prev.allocationOverTimeTiers
        : [partial.allocation],
    };
    setPortfolio(next);
    const merged = normalizePortfolio({ ...prev, ...next });
    updateTotal();
    refreshSparklines();
    updateSectionPill(merged);
    onChange?.(merged);
  }

  const onInput = (ev) => {
    if (!(ev.target instanceof HTMLElement)) return;
    if (!hostEl.contains(ev.target)) return;
    handleChange();
  };

  hostEl.addEventListener('change', onInput);
  hostEl.addEventListener('input', onInput);
  setupMiniChartResizeHandling(hostEl);
  refreshFromState();

  return {
    refreshFromState,
    readFromDom,
    refreshSparklines,
    updateTotal,
    YEAR_RANGE,
    destroy() {
      hostEl.removeEventListener('change', onInput);
      hostEl.removeEventListener('input', onInput);
    },
  };
}

export { YEAR_RANGE, buildRichMarkup };
