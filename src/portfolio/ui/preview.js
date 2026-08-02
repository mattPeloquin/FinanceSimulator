// Read-only summary of a linked Plan / Withdraw portfolio.

import { summarizePortfolio } from '../api.js';
import { normalizePortfolio } from '../slice.js';

/**
 * Render a compact preview into hostEl.
 * @param {HTMLElement} hostEl
 * @param {object|null} portfolio - nested portfolio slice
 * @param {{ sessionName?: string }} [meta]
 */
export function renderPortfolioPreview(hostEl, portfolio, meta = {}) {
  if (!hostEl) return;
  if (!portfolio) {
    hostEl.innerHTML = `
      <p class="text-xs text-theme-faint">No linked portfolio selected.</p>`;
    hostEl.classList.add('hidden');
    return;
  }
  hostEl.classList.remove('hidden');
  const s = summarizePortfolio(normalizePortfolio(portfolio));
  const name = meta.sessionName ? `<span class="font-medium text-theme-body">${escapeHtml(meta.sessionName)}</span> · ` : '';
  const sleeveChips = s.sleeves
    .filter((x) => x.pct > 0)
    .map((x) => `
      <span class="inline-flex items-center gap-1 text-[11px] text-theme-muted">
        <span class="inline-block w-2 h-2 rounded-sm" style="background:${x.color}"></span>
        ${escapeHtml(x.label)} ${Math.round(x.pct)}%
      </span>`)
    .join('');

  hostEl.innerHTML = `
    <div class="rounded-lg border border-theme-border bg-theme-muted/30 px-3 py-2 space-y-1.5" data-portfolio-preview>
      <p class="text-xs text-theme-body">
        ${name}${escapeHtml(s.distMethodLabel)} · ${escapeHtml(s.yearLabel)}
        ${s.tierCount > 1 ? ` · ${s.tierCount} allocation tiers` : ''}
      </p>
      <div class="flex flex-wrap gap-x-3 gap-y-1">${sleeveChips || '<span class="text-xs text-theme-faint">—</span>'}</div>
    </div>`;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
