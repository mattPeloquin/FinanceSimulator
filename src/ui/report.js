// Plan Snapshot report UI — lazy render on open, Px sliders, Export PDF.
// Charts follow the app theme on screen and are re-rendered with a forced
// light palette around printing so a dark-mode "Save as PDF" stays paper-friendly.

import { buildPlanSnapshot } from '../core/reportModel.js';
import { isDarkMode, onThemeChange } from './theme.js';
import {
  drawWithdrawalBand,
  drawBalanceFan,
  drawSuccessDonut,
  drawFourPctBars,
  drawSequenceBullet,
  drawDepletionStrip,
  drawAllocationDonut,
} from './charts/reportCharts.js';

const BAND_STORAGE_KEY = 'sor:report-band';
const DEFAULT_BAND = { low: 10, high: 90 };

let lastRun = null;
let dirty = true;
let renderedForKey = null;

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

function fillList(el, items) {
  if (!el) return;
  clearChildren(el);
  for (const text of items) {
    const li = document.createElement('li');
    li.textContent = text;
    el.appendChild(li);
  }
}

function fillVerdict(el, sentences) {
  if (!el) return;
  clearChildren(el);
  for (const sentence of sentences) {
    const p = document.createElement('p');
    p.textContent = sentence;
    el.appendChild(p);
  }
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
  const dark = forceLight ? false : isDarkMode();
  const snap = buildSnap(pLow, pHigh);

  const h1 = document.getElementById('reportHeaderLine1');
  const h2 = document.getElementById('reportHeaderLine2');
  if (h1) h1.textContent = snap.header.line1;
  if (h2) h2.textContent = snap.header.line2;

  fillVerdict(document.getElementById('reportVerdictText'), snap.verdict);
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

  drawSuccessDonut(document.getElementById('reportSuccessDonut'), snap.success, { dark });
  drawFourPctBars(document.getElementById('reportFourPctBars'), snap.fourPct, { dark });
  drawSequenceBullet(document.getElementById('reportSequenceBullet'), snap.sequence, { dark });
  if (snap.band) {
    drawWithdrawalBand(document.getElementById('reportBandCanvas'), snap.band, { dark });
  }
  drawBalanceFan(document.getElementById('reportFanCanvas'), snap.fan, { dark });
  drawAllocationDonut(document.getElementById('reportAllocationDonut'), snap.allocation, { dark });

  renderedForKey = runKey(lastRun, pLow, pHigh, dark);
  dirty = false;
}

function renderBandAndFanOnly() {
  if (!lastRun?.result) return;
  const { pLow, pHigh } = getPx();
  const dark = isDarkMode();
  const snap = buildSnap(pLow, pHigh);
  const bandLabel = document.getElementById('reportBandLabel');
  if (bandLabel && snap.band) {
    bandLabel.textContent = `${snap.band.lowLabel}–${snap.band.highLabel}`;
  }
  if (snap.band) {
    drawWithdrawalBand(document.getElementById('reportBandCanvas'), snap.band, { dark });
  }
  drawBalanceFan(document.getElementById('reportFanCanvas'), snap.fan, { dark });
  renderedForKey = runKey(lastRun, pLow, pHigh, dark);
}

function ensureRendered() {
  if (!lastRun) return;
  const { pLow, pHigh } = getPx();
  const key = runKey(lastRun, pLow, pHigh, isDarkMode());
  if (dirty || key !== renderedForKey) renderFull();
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

  const onPxInput = () => {
    syncPxLabels();
    const { pLow, pHigh } = getPx();
    saveBandPrefs(pLow, pHigh);
    const details = document.getElementById('details-plan-report');
    if (details?.open && lastRun) renderBandAndFanOnly();
  };
  lowEl?.addEventListener('input', onPxInput);
  highEl?.addEventListener('input', onPxInput);

  const details = document.getElementById('details-plan-report');
  details?.addEventListener('toggle', () => {
    if (!details.open) return;
    // Canvases size to zero while hidden; wait a frame so layout settles.
    requestAnimationFrame(() => ensureRendered());
  });

  // Follow the app theme while the report is open.
  onThemeChange(() => {
    if (details?.open && lastRun) renderFull();
  });

  // Force-light around printing (covers both the Export button and Ctrl+P),
  // then restore the on-screen theme afterwards.
  window.addEventListener('beforeprint', () => {
    if (lastRun && details?.open && isDarkMode()) renderFull({ forceLight: true });
  });
  window.addEventListener('afterprint', () => {
    if (lastRun && details?.open && isDarkMode()) renderFull();
  });

  document.getElementById('reportExportPdf')?.addEventListener('click', () => {
    if (!lastRun) return;
    if (details) details.open = true;
    renderFull({ forceLight: true });
    // Two frames: one for chart layout, one for paint, before the print dialog.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        window.print();
        // Restore theme-appropriate rendering after the dialog closes.
        if (isDarkMode()) renderFull();
      });
    });
  });
}
