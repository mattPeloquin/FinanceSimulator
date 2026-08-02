import { formatK } from '../../../ui/format.js';
import {
  getAccumulateResult,
  isAccumulateResultStale,
  setAccumulateResult,
} from '../session.js';
import { drawAccumulateCone } from './charts/cone.js';
import { drawSavingsImpact } from './charts/savings.js';
import { drawRiskReturnRegion } from './charts/region.js';
import { drawWeightTornado } from './charts/tornado.js';
import { drawGlidePreview } from './charts/glide.js';

function el(id) {
  return document.getElementById(id);
}

/** Match Plan: hide results while loading; show spinner + cancel under Run. */
export function setAccumulateLoading(loading) {
  const box = el('accumulate-loading');
  const results = el('accumulate-results-section');
  const runBtn = el('accumulate-run');
  if (loading) {
    results?.classList.add('hidden');
    box?.classList.remove('hidden');
    box?.classList.add('flex');
    updateAccumulateProgress(0, 'Running simulations');
  } else {
    box?.classList.add('hidden');
    box?.classList.remove('flex');
  }
  if (runBtn) runBtn.disabled = !!loading;
}

export function updateAccumulateProgress(fraction, stage) {
  const pct = Math.round(Math.max(0, Math.min(1, fraction || 0)) * 100);
  if (el('accumulate-loading-bar')) {
    el('accumulate-loading-bar').style.width = `${pct}%`;
  }
  if (el('accumulate-loading-text')) {
    const prefix = stage ? `${stage}… ${pct}%` : `Running simulations… ${pct}%`;
    el('accumulate-loading-text').textContent = prefix;
  }
  if (el('accumulate-status')) {
    el('accumulate-status').textContent = stage
      ? `${stage} (${pct}%)`
      : '';
  }
}

export function clearAccumulateResultsUi() {
  el('accumulate-results-section')?.classList.add('hidden');
  el('accumulate-stale')?.classList.add('hidden');
}

export function paintAccumulateResults(payload) {
  const result = payload?.result || payload;
  if (!result?.med) return;
  setAccumulateResult(result);

  el('accumulate-results-section')?.classList.remove('hidden');
  el('accumulate-stale')?.classList.toggle('hidden', !isAccumulateResultStale());

  const ending = result.med.ending;
  if (el('accumulate-ending-summary') && ending) {
    el('accumulate-ending-summary').textContent =
      `Med ending — P10 ${formatK(ending.p10)}, median ${formatK(ending.median)}, P90 ${formatK(ending.p90)} (real $).`;
  }

  renderAccumulateCharts();
}

export function renderAccumulateCharts() {
  const result = getAccumulateResult();
  if (!result) return;
  drawAccumulateCone(el('accumulate-cone-chart'), result);
  drawSavingsImpact(el('accumulate-savings-chart'), result);
  drawRiskReturnRegion(el('accumulate-region-chart'), result);
  drawWeightTornado(el('accumulate-tornado-chart'), result);
  drawGlidePreview(el('accumulate-glide-chart'));
}

export function bindAccumulateResults() {
  // Charts redraw on activate / after paint; no extra bindings yet.
}
