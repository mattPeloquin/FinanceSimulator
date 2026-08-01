import { formatK } from '../../../ui/format.js';
import {
  getAccumulationResult,
  isAccumulationResultStale,
  setAccumulationResult,
} from '../session.js';
import { drawAccumulationCone } from './charts/cone.js';
import { drawSavingsImpact } from './charts/savings.js';
import { drawRiskReturnRegion } from './charts/region.js';
import { drawWeightTornado } from './charts/tornado.js';
import { drawGlidePreview } from './charts/glide.js';

function el(id) {
  return document.getElementById(id);
}

/** Match Plan: hide results while loading; show spinner + cancel under Run. */
export function setAccumulationLoading(loading) {
  const box = el('accumulation-loading');
  const results = el('accumulation-results-section');
  const runBtn = el('accumulation-run');
  if (loading) {
    results?.classList.add('hidden');
    box?.classList.remove('hidden');
    box?.classList.add('flex');
    updateAccumulationProgress(0, 'Running simulations');
  } else {
    box?.classList.add('hidden');
    box?.classList.remove('flex');
  }
  if (runBtn) runBtn.disabled = !!loading;
}

export function updateAccumulationProgress(fraction, stage) {
  const pct = Math.round(Math.max(0, Math.min(1, fraction || 0)) * 100);
  if (el('accumulation-loading-bar')) {
    el('accumulation-loading-bar').style.width = `${pct}%`;
  }
  if (el('accumulation-loading-text')) {
    const prefix = stage ? `${stage}… ${pct}%` : `Running simulations… ${pct}%`;
    el('accumulation-loading-text').textContent = prefix;
  }
  if (el('accumulation-status')) {
    el('accumulation-status').textContent = stage
      ? `${stage} (${pct}%)`
      : '';
  }
}

export function clearAccumulationResultsUi() {
  el('accumulation-results-section')?.classList.add('hidden');
  el('accumulation-stale')?.classList.add('hidden');
}

export function paintAccumulationResults(payload) {
  const result = payload?.result || payload;
  if (!result?.med) return;
  setAccumulationResult(result);

  el('accumulation-results-section')?.classList.remove('hidden');
  el('accumulation-stale')?.classList.toggle('hidden', !isAccumulationResultStale());

  const ending = result.med.ending;
  if (el('accumulation-ending-summary') && ending) {
    el('accumulation-ending-summary').textContent =
      `Med ending — P10 ${formatK(ending.p10)}, median ${formatK(ending.median)}, P90 ${formatK(ending.p90)} (real $).`;
  }

  renderAccumulationCharts();
}

export function renderAccumulationCharts() {
  const result = getAccumulationResult();
  if (!result) return;
  drawAccumulationCone(el('accumulation-cone-chart'), result);
  drawSavingsImpact(el('accumulation-savings-chart'), result);
  drawRiskReturnRegion(el('accumulation-region-chart'), result);
  drawWeightTornado(el('accumulation-tornado-chart'), result);
  drawGlidePreview(el('accumulation-glide-chart'));
}

export function bindAccumulationResults() {
  // Charts redraw on activate / after paint; no extra bindings yet.
}
