// Lifetime Plan results — charts, year table, totals.

import { formatK } from '../../../ui/format.js';
import { onThemeChange } from '../../../ui/theme.js';
import {
  getPlanResult,
  setPlanResultStale,
  isPlanResultStale,
  getPlanState,
  getPlanWarnings,
} from '../session.js';
import { drawPlanStackChart, drawPlanCumulativeChart } from './charts/stack.js';
import { drawPlanNetWorthChart } from './charts/netWorth.js';

let stackChart = null;
let cumulativeChart = null;
let netWorthChart = null;

function el(id) {
  return document.getElementById(id);
}

function fmtMoney(n) {
  if (!Number.isFinite(n)) return '—';
  return `$${formatK(n)}k`;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function setPlanLoading(loading) {
  const box = el('plan-loading');
  const btn = el('plan-run');
  if (box) {
    box.classList.toggle('hidden', !loading);
    box.classList.toggle('flex', loading);
  }
  if (btn) btn.disabled = !!loading;
}

export function updatePlanProgress(fraction, stage) {
  const bar = el('plan-loading-bar');
  const text = el('plan-loading-text');
  if (bar) bar.style.width = `${Math.round(Math.max(0, Math.min(1, fraction)) * 100)}%`;
  if (text) text.textContent = stage || 'Running…';
}

export function clearPlanResultsUi() {
  el('plan-results-section')?.classList.add('hidden');
  destroyCharts();
}

function destroyCharts() {
  if (stackChart) stackChart.destroy();
  if (cumulativeChart) cumulativeChart.destroy();
  if (netWorthChart) netWorthChart.destroy();
  stackChart = cumulativeChart = netWorthChart = null;
}

export function bindPlanResults() {
  onThemeChange(() => {
    if (getPlanResult()) renderPlanCharts();
  });
}

/**
 * Store result (already built) and paint.
 * @param {object} result
 */
export function paintPlanResults(result) {
  void result;
  setPlanResultStale(false);
  renderPlanCharts();
}

export function renderPlanCharts() {
  const result = getPlanResult();
  const section = el('plan-results-section');
  if (!result || !section) return;
  section.classList.remove('hidden');

  const stale = el('plan-stale');
  if (stale) stale.classList.toggle('hidden', !isPlanResultStale());

  const warnings = getPlanWarnings();
  const warnEl = el('plan-warnings');
  if (warnEl) {
    if (warnings.length) {
      warnEl.textContent = warnings.join(' ');
      warnEl.classList.remove('hidden');
    } else {
      warnEl.textContent = '';
      warnEl.classList.add('hidden');
    }
  }

  const meta = result.sourceMeta || [];
  const state = getPlanState();
  if (el('plan-summary')) {
    const parts = meta.map((s) => `${s.label} from ${s.startYear}`);
    const nw = result.netWorth?.netWorth?.median;
    const lastNw = Array.isArray(nw) ? nw[nw.length - 1] : null;
    const nwBit = Number.isFinite(lastNw)
      ? ` Ending median net worth ${fmtMoney(lastNw)}.`
      : '';
    el('plan-summary').textContent = meta.length
      ? `Window ${state.planStartYear}–${state.planEndYear}. Sources: ${parts.join('; ')}. `
        + `Total net cashflow ${fmtMoney(result.totals?.net)}.${nwBit}`
      : (result.netWorth
        ? `Window ${state.planStartYear}–${state.planEndYear}.${nwBit}`
        : 'No sources in the aggregate.');
  }

  if (el('plan-totals')) {
    const bits = meta.map((s) => {
      const total = result.totals?.bySource?.[s.id];
      return `<span class="mr-3">${escapeHtml(s.label)}: <strong>${fmtMoney(total)}</strong></span>`;
    });
    el('plan-totals').innerHTML = bits.join('')
      + (meta.length
        ? `<span class="mr-3">Net: <strong>${fmtMoney(result.totals?.net)}</strong></span>`
        : '');
  }

  // View panels
  const isNw = state.view !== 'cashflow';
  el('plan-view-networth-panel')?.classList.toggle('hidden', !isNw);
  el('plan-view-cashflow-panel')?.classList.toggle('hidden', isNw);

  renderYearTable(result);

  if (isNw) {
    netWorthChart = drawPlanNetWorthChart(
      el('plan-networth-chart'),
      result,
      netWorthChart,
    );
  } else {
    stackChart = drawPlanStackChart(el('plan-stack-chart'), result, stackChart);
    cumulativeChart = drawPlanCumulativeChart(
      el('plan-cumulative-chart'),
      result,
      cumulativeChart,
    );
  }
}

function renderYearTable(result) {
  const host = el('plan-year-table');
  if (!host) return;
  const meta = result.sourceMeta || [];
  const rows = result.rows || [];
  const nw = result.netWorth;
  const years = result.years || [];

  if (!years.length) {
    host.innerHTML = '<p class="text-theme-muted">No years in the plan window.</p>';
    return;
  }

  const headCells = [
    '<th class="px-2 py-1 text-left">Year</th>',
    ...meta.map((s) => `<th class="px-2 py-1 text-right">${escapeHtml(s.label)}</th>`),
    meta.length ? '<th class="px-2 py-1 text-right">Net CF</th>' : '',
    nw ? '<th class="px-2 py-1 text-right">Portfolio</th>' : '',
    nw ? '<th class="px-2 py-1 text-right">Home equity</th>' : '',
    nw ? '<th class="px-2 py-1 text-right">Net worth</th>' : '',
  ].join('');

  // Prefer cashflow rows when present; otherwise synthesize from years + nw.
  const body = years.map((year, i) => {
    const row = rows[i] || { year, bySource: {}, net: 0 };
    const srcCells = meta.map((s) => {
      const v = row.bySource?.[s.id] || 0;
      return `<td class="px-2 py-1 text-right">${fmtMoney(v)}</td>`;
    }).join('');
    const nwMed = nw?.netWorth?.median?.[i];
    const portMed = nw?.portfolio?.median?.[i];
    const home = nw?.homeEquity?.[i];
    return `<tr class="border-t border-theme-border">
      <td class="px-2 py-1 font-medium text-theme-body">${year}</td>
      ${srcCells}
      ${meta.length ? `<td class="px-2 py-1 text-right font-medium">${fmtMoney(row.net)}</td>` : ''}
      ${nw ? `<td class="px-2 py-1 text-right">${fmtMoney(portMed)}</td>` : ''}
      ${nw ? `<td class="px-2 py-1 text-right">${fmtMoney(home)}</td>` : ''}
      ${nw ? `<td class="px-2 py-1 text-right font-medium">${fmtMoney(nwMed)}</td>` : ''}
    </tr>`;
  }).join('');

  host.innerHTML = `
    <table class="min-w-full text-left">
      <thead class="text-xs text-theme-muted">
        <tr>${headCells}</tr>
      </thead>
      <tbody>${body}</tbody>
    </table>
  `;
}
