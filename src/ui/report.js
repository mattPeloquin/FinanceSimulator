// Plan Snapshot report UI — lazy render on open, Px sliders, Export PDF.
// Charts follow the app theme on screen and are re-rendered with a forced
// light palette around printing so a dark-mode "Save as PDF" stays paper-friendly.
// The report also has its own light/dark override (reportThemeMode), separate
// from the app's theme toggle, so it never looks jarring next to the rest of
// the UI while still always printing light.

import { buildPlanSnapshot } from '../core/reportModel.js';
import { isDarkMode, onThemeChange } from './theme.js';
import {
  drawWithdrawalBand,
  drawBalanceFan,
  drawSuccessDonut,
  renderSuccessHero,
  drawFourPctMetric,
  drawDepletionStrip,
  drawAllocationDonut,
  allocationLegendItems,
} from './charts/reportCharts.js';

const BAND_STORAGE_KEY = 'sor:report-band';
const THEME_STORAGE_KEY = 'sor:report-theme-mode';
const DEFAULT_BAND = { low: 10, high: 90 };

let lastRun = null;
let dirty = true;
let renderedForKey = null;
// null = follow the app's theme; 'light' / 'dark' = report-local override.
let themeOverride = null;

function loadBandPrefs() {
  try {
    const raw = localStorage.getItem(BAND_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_BAND };
    const parsed = JSON.parse(raw);
    const low = Number(parsed.low);
    const high = Number(parsed.high);
    if (!Number.isFinite(low) || !Number.isFinite(high)) return { ...DEFAULT_BAND };
    return {
      low: Math.min(45, Math.max(0, Math.round(low / 5) * 5)),
      high: Math.min(100, Math.max(55, Math.round(high / 5) * 5)),
    };
  } catch {
    return { ...DEFAULT_BAND };
  }
}

function saveBandPrefs(low, high) {
  try {
    localStorage.setItem(BAND_STORAGE_KEY, JSON.stringify({ low, high }));
  } catch {
    /* ignore quota / private mode */
  }
}

function loadThemeOverride() {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    return raw === 'light' || raw === 'dark' ? raw : null;
  } catch {
    return null;
  }
}

function saveThemeOverride(value) {
  try {
    if (value) localStorage.setItem(THEME_STORAGE_KEY, value);
    else localStorage.removeItem(THEME_STORAGE_KEY);
  } catch {
    /* ignore quota / private mode */
  }
}

/** Report's own effective dark mode — the override if set, else the app's. */
function effectiveDark() {
  if (themeOverride === 'light') return false;
  if (themeOverride === 'dark') return true;
  return isDarkMode();
}

/** Scope the report's CSS variables to the override via report-force-* classes
 * (see tailwind.config.js) so it can show light/dark independent of the app. */
function applyThemeOverrideClass() {
  const el = document.getElementById('planReport');
  if (!el) return;
  el.classList.toggle('report-force-light', themeOverride === 'light');
  el.classList.toggle('report-force-dark', themeOverride === 'dark');
}

function getPx() {
  const lowEl = document.getElementById('reportPxLow');
  const highEl = document.getElementById('reportPxHigh');
  return {
    pLow: lowEl ? Number(lowEl.value) : DEFAULT_BAND.low,
    pHigh: highEl ? Number(highEl.value) : DEFAULT_BAND.high,
  };
}

function syncPxLabels() {
  const { pLow, pHigh } = getPx();
  const loLabel = document.getElementById('reportPxLowLabel');
  const hiLabel = document.getElementById('reportPxHighLabel');
  if (loLabel) loLabel.textContent = `P${pLow}`;
  if (hiLabel) hiLabel.textContent = `P${pHigh}`;
}

function clearChildren(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

/** Escape text for safe innerHTML insertion. */
function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Wrap any whitespace-delimited token that contains a digit in <strong> so the
 * numeric values (dollar amounts, percentages, counts) read as the emphasis. */
function boldNumbers(text) {
  return escapeHtml(text).replace(
    /([\w$%.,+-]*\d[\w$%.,+-]*)/g,
    '<strong class="font-bold text-theme-heading print:text-slate-900">$1</strong>',
  );
}

function fillList(el, items) {
  if (!el) return;
  clearChildren(el);
  for (const text of items) {
    const li = document.createElement('li');
    li.className = 'report-bullet';
    li.innerHTML = boldNumbers(text);
    el.appendChild(li);
  }
}

/** Fill a legend container with colored-dot + label spans. */
function fillLegend(el, items) {
  if (!el) return;
  clearChildren(el);
  for (const item of items) {
    const span = document.createElement('span');
    span.className = 'report-legend-dot';
    const dot = document.createElement('span');
    dot.className = 'inline-block w-2.5 h-2.5 rounded-full';
    dot.style.backgroundColor = item.color;
    span.appendChild(dot);
    span.appendChild(document.createTextNode(item.label));
    el.appendChild(span);
  }
}

function successHeroEls() {
  return {
    number: document.getElementById('reportHeroSuccess'),
    onPlanNumber: document.getElementById('reportHeroOnPlan'),
    onPlanLabel: document.getElementById('reportHeroOnPlanLabel'),
    pill: document.getElementById('reportVerdictPill'),
  };
}

function runKey(run, pLow, pHigh, dark) {
  if (!run) return null;
  return `${run.result?.seed}|${run.result?.numSimulations}|${pLow}|${pHigh}|${run.goalSeekWarning || ''}|${dark ? 'd' : 'l'}`;
}

function buildSnap(pLow, pHigh) {
  return buildPlanSnapshot(
    lastRun.result,
    lastRun.scenario,
    lastRun.fourPercentComparison,
    { pLow, pHigh, goalSeekWarning: lastRun.goalSeekWarning },
  );
}

function renderFull({ forceLight = false } = {}) {
  if (!lastRun?.result) return;
  const { pLow, pHigh } = getPx();
  const dark = forceLight ? false : effectiveDark();
  const snap = buildSnap(pLow, pHigh);

  const h1 = document.getElementById('reportHeaderLine1');
  if (h1) h1.textContent = snap.header.line1;

  const footer = document.getElementById('reportFooterMeta');
  if (footer) footer.textContent = snap.footerLine || '';

  fillList(document.getElementById('reportPlanBullets'), snap.planBullets);

  const bandLabel = document.getElementById('reportBandLabel');
  if (bandLabel && snap.band) {
    bandLabel.textContent = `${snap.band.lowLabel}–${snap.band.highLabel}`;
  }
  const taxNote = document.getElementById('reportBandTaxNote');
  if (taxNote) taxNote.classList.toggle('hidden', !snap.taxActive);

  const depNote = document.getElementById('reportDepletionNote');
  const depWrap = document.getElementById('reportDepletionChartWrap');
  if (snap.depletion.note) {
    if (depNote) {
      depNote.textContent = snap.depletion.note;
      depNote.classList.remove('hidden');
    }
    if (depWrap) depWrap.classList.add('hidden');
  } else {
    if (depNote) depNote.classList.add('hidden');
    if (depWrap) depWrap.classList.remove('hidden');
    drawDepletionStrip(document.getElementById('reportDepletionCanvas'), snap.depletion, { dark });
  }

  renderSuccessHero(successHeroEls(), {
    ...snap.success,
    shortfallTolerance: snap.shortfallTolerance,
  }, { dark });
  drawSuccessDonut(document.getElementById('reportSuccessDonut'), snap.success, { dark });
  drawFourPctMetric(document.getElementById('reportFourPctSpend'), 'spend', snap.fourPct, { dark });
  drawFourPctMetric(document.getElementById('reportFourPctSurvival'), 'survival', snap.fourPct, { dark });
  if (snap.band) {
    drawWithdrawalBand(document.getElementById('reportBandCanvas'), snap.band, {
      dark,
      shortfallTolerance: snap.shortfallTolerance,
    });
  }
  drawBalanceFan(document.getElementById('reportFanCanvas'), snap.fan, { dark });
  drawAllocationDonut(document.getElementById('reportAllocationDonut'), snap.allocation, { dark });
  fillLegend(document.getElementById('reportAllocationLegend'), allocationLegendItems(snap.allocation, dark));

  renderedForKey = runKey(lastRun, pLow, pHigh, dark);
  dirty = false;
}

function renderBandAndFanOnly() {
  if (!lastRun?.result) return;
  const { pLow, pHigh } = getPx();
  const dark = effectiveDark();
  const snap = buildSnap(pLow, pHigh);
  const bandLabel = document.getElementById('reportBandLabel');
  if (bandLabel && snap.band) {
    bandLabel.textContent = `${snap.band.lowLabel}–${snap.band.highLabel}`;
  }
  if (snap.band) {
    drawWithdrawalBand(document.getElementById('reportBandCanvas'), snap.band, {
      dark,
      shortfallTolerance: snap.shortfallTolerance,
    });
  }
  drawBalanceFan(document.getElementById('reportFanCanvas'), snap.fan, { dark });
  renderedForKey = runKey(lastRun, pLow, pHigh, dark);
}

function ensureRendered() {
  if (!lastRun) return;
  const { pLow, pHigh } = getPx();
  const key = runKey(lastRun, pLow, pHigh, effectiveDark());
  if (dirty || key !== renderedForKey) renderFull();
}

/** Paint the report using the app's current light/dark mode (for thumbs). */
export function ensureReportPainted() {
  if (!lastRun) return;
  const previousOverride = themeOverride;
  themeOverride = null;
  applyThemeOverrideClass();
  renderFull();
  themeOverride = previousOverride;
  applyThemeOverrideClass();
}

export function onNewRun(run) {
  lastRun = run;
  dirty = true;
  const details = document.getElementById('details-plan-report');
  if (details?.open) {
    renderFull();
  }
}

export function initReport() {
  const prefs = loadBandPrefs();
  const lowEl = document.getElementById('reportPxLow');
  const highEl = document.getElementById('reportPxHigh');
  if (lowEl) lowEl.value = String(prefs.low);
  if (highEl) highEl.value = String(prefs.high);
  syncPxLabels();

  themeOverride = loadThemeOverride();
  const modeEl = document.getElementById('reportThemeMode');
  if (modeEl) modeEl.value = themeOverride || 'auto';
  applyThemeOverrideClass();

  const onPxInput = () => {
    syncPxLabels();
    const { pLow, pHigh } = getPx();
    saveBandPrefs(pLow, pHigh);
    const details = document.getElementById('details-plan-report');
    if (details?.open && lastRun) renderBandAndFanOnly();
  };
  lowEl?.addEventListener('input', onPxInput);
  highEl?.addEventListener('input', onPxInput);

  modeEl?.addEventListener('change', () => {
    themeOverride = modeEl.value === 'light' || modeEl.value === 'dark' ? modeEl.value : null;
    saveThemeOverride(themeOverride);
    applyThemeOverrideClass();
    const details = document.getElementById('details-plan-report');
    if (details?.open && lastRun) renderFull();
  });

  const details = document.getElementById('details-plan-report');
  details?.addEventListener('toggle', () => {
    if (!details.open) return;
    // Canvases size to zero while hidden; wait a frame so layout settles.
    requestAnimationFrame(() => ensureRendered());
  });

  // Follow the app theme while the report is open, unless the report has its
  // own override set.
  onThemeChange(() => {
    if (themeOverride) return;
    if (details?.open && lastRun) renderFull();
  });

  // Force-light around printing (covers both the Export button and Ctrl+P),
  // then restore the report-appropriate rendering afterwards. The DOM colors
  // themselves are forced light purely via CSS (see tailwind.config.js);
  // only the canvas-drawn charts need a JS-driven re-render here.
  window.addEventListener('beforeprint', () => {
    if (lastRun && details?.open && effectiveDark()) renderFull({ forceLight: true });
  });
  window.addEventListener('afterprint', () => {
    if (lastRun && details?.open && effectiveDark()) renderFull();
  });

  document.getElementById('reportExportPdf')?.addEventListener('click', () => {
    if (!lastRun) return;
    if (details) details.open = true;
    renderFull({ forceLight: true });
    // Two frames: one for chart layout, one for paint, before the print dialog.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        window.print();
        // Restore report-appropriate rendering after the dialog closes.
        if (effectiveDark()) renderFull();
      });
    });
  });
}
