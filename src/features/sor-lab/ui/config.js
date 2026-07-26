// SOR Lab configuration panel: scenario picker, fidelity, variable envelopes.

import * as sessions from '../../../state/sessions.js';
import { FEATURE_SOR_PLAN } from '../../../state/storageKeys.js';
import {
  getLabConfig,
  patchLabConfig,
  setLabResultStale,
} from '../session.js';
import { resolveLabVariables } from '../variables.js';
import { estimateSweepCost } from '../sweep.js';
import { refreshLabStaleBanner } from './results.js';

let bound = false;

export async function renderLabConfig() {
  await refreshScenarioPicker();
  syncFidelityControls();
  await renderVariableList();
  await refreshCostEstimate();
  refreshLabStaleBanner();
}

async function refreshScenarioPicker() {
  const select = document.getElementById('sor-lab-scenario');
  if (!select) return;
  let listed;
  try {
    listed = await sessions.list(FEATURE_SOR_PLAN);
  } catch {
    listed = [];
  }
  if (!Array.isArray(listed)) listed = [];
  const config = getLabConfig();
  const current = config.scenarioRef?.name || '';
  const options = ['<option value="">Select a saved Plan session…</option>'];
  for (const s of listed) {
    const selected = s.name === current ? ' selected' : '';
    options.push(`<option value="${escapeAttr(s.name)}"${selected}>${escapeHtml(s.name)}</option>`);
  }
  select.innerHTML = options.join('');
  if (current && !listed.some((s) => s.name === current)) {
    // Referenced session missing — keep the value visible as a disabled option.
    select.insertAdjacentHTML(
      'beforeend',
      `<option value="${escapeAttr(current)}" selected>(missing) ${escapeHtml(current)}</option>`,
    );
  }
}

function syncFidelityControls() {
  const config = getLabConfig();
  const points = document.getElementById('sor-lab-sweep-points');
  const paths = document.getElementById('sor-lab-paths');
  if (points) points.value = String(config.sweepPoints);
  if (paths) paths.value = String(config.pathsPerPoint);
}

async function renderVariableList() {
  const host = document.getElementById('sor-lab-variable-list');
  if (!host) return;
  const config = getLabConfig();
  if (!config.scenarioRef?.name) {
    host.innerHTML = '<p class="text-xs text-theme-muted">Pick a Plan session to see sweep variables.</p>';
    return;
  }
  let loaded;
  try {
    loaded = await sessions.load(FEATURE_SOR_PLAN, config.scenarioRef.name);
  } catch {
    loaded = null;
  }
  if (!loaded?.payload) {
    host.innerHTML = '<p class="text-xs text-theme-muted">Could not load that Plan session.</p>';
    return;
  }

  const { all } = resolveLabVariables(loaded.payload, config.envelopeOverrides || {});
  const byGroup = new Map();
  for (const entry of all) {
    if (entry.isSentinel) continue; // Sentinels always run; hide from the checklist.
    if (!byGroup.has(entry.group)) byGroup.set(entry.group, []);
    byGroup.get(entry.group).push(entry);
  }

  const parts = [];
  for (const [group, entries] of byGroup) {
    parts.push(`<div class="space-y-1.5">`);
    parts.push(`<h5 class="text-xs font-semibold uppercase tracking-wide text-theme-faint">${escapeHtml(group)}</h5>`);
    for (const entry of entries) {
      const disabled = entry.gatedOff;
      const checked = entry.enabled && !disabled;
      const ov = config.envelopeOverrides?.[entry.id] || {};
      const low = ov.low ?? entry.envelope.low;
      const high = ov.high ?? entry.envelope.high;
      parts.push(`
        <div class="rounded-lg border border-theme-border/70 px-2.5 py-2 ${disabled ? 'opacity-50' : ''}" data-var-id="${escapeAttr(entry.id)}">
          <label class="flex items-start gap-2 text-sm text-theme-body">
            <input type="checkbox" class="sor-lab-var-enabled mt-0.5 rounded border-theme-border"
              data-id="${escapeAttr(entry.id)}" ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''} />
            <span class="min-w-0">
              <span class="font-medium text-theme-heading">${escapeHtml(entry.label)}</span>
              <span class="text-theme-faint"> · ${escapeHtml(entry.category)}</span>
              ${disabled ? `<div class="text-xs text-theme-muted">${escapeHtml(entry.gateReason || '')}</div>` : ''}
            </span>
          </label>
          ${disabled ? '' : `
          <div class="mt-1.5 grid grid-cols-2 gap-2 pl-6">
            <label class="text-xs text-theme-muted">Low
              <input type="number" class="sor-lab-var-low mt-0.5 w-full rounded border border-theme-border bg-theme-input px-1.5 py-1 text-xs text-theme-heading tabular-nums"
                data-id="${escapeAttr(entry.id)}" value="${escapeAttr(String(roundDisplay(low)))}" step="any" />
            </label>
            <label class="text-xs text-theme-muted">High
              <input type="number" class="sor-lab-var-high mt-0.5 w-full rounded border border-theme-border bg-theme-input px-1.5 py-1 text-xs text-theme-heading tabular-nums"
                data-id="${escapeAttr(entry.id)}" value="${escapeAttr(String(roundDisplay(high)))}" step="any" />
            </label>
          </div>`}
        </div>
      `);
    }
    parts.push('</div>');
  }
  host.innerHTML = parts.join('');
}

function roundDisplay(n) {
  if (!Number.isFinite(n)) return n;
  const abs = Math.abs(n);
  if (abs >= 100) return Math.round(n);
  if (abs >= 10) return Math.round(n * 10) / 10;
  return Math.round(n * 100) / 100;
}

async function refreshCostEstimate() {
  const el = document.getElementById('sor-lab-cost');
  if (!el) return;
  const config = getLabConfig();
  if (!config.scenarioRef?.name) {
    el.textContent = '';
    return;
  }
  let loaded;
  try {
    loaded = await sessions.load(FEATURE_SOR_PLAN, config.scenarioRef.name);
  } catch {
    el.textContent = '';
    return;
  }
  if (!loaded?.payload) {
    el.textContent = '';
    return;
  }
  const est = estimateSweepCost(loaded.payload, config);
  if (est.error) {
    el.textContent = est.error;
    return;
  }
  el.textContent = `About ${est.liveVariables} variables · ${est.designPoints} evaluations · ${est.pathsPerPoint.toLocaleString()} paths each (${est.totalPaths.toLocaleString()} total paths)`;
}

function markStaleAndRefresh() {
  setLabResultStale(true);
  refreshLabStaleBanner();
  void refreshCostEstimate();
}

function readOverridesFromDom() {
  const overrides = { ...(getLabConfig().envelopeOverrides || {}) };
  document.querySelectorAll('.sor-lab-var-enabled').forEach((el) => {
    const id = el.getAttribute('data-id');
    if (!id) return;
    const prev = overrides[id] || {};
    overrides[id] = {
      ...prev,
      enabled: !!el.checked,
    };
  });
  document.querySelectorAll('.sor-lab-var-low').forEach((el) => {
    const id = el.getAttribute('data-id');
    if (!id) return;
    const n = Number(el.value);
    if (!Number.isFinite(n)) return;
    overrides[id] = { ...(overrides[id] || {}), low: n };
  });
  document.querySelectorAll('.sor-lab-var-high').forEach((el) => {
    const id = el.getAttribute('data-id');
    if (!id) return;
    const n = Number(el.value);
    if (!Number.isFinite(n)) return;
    overrides[id] = { ...(overrides[id] || {}), high: n };
  });
  return overrides;
}

export function bindLabConfig() {
  if (bound) return;
  bound = true;

  document.getElementById('sor-lab-scenario')?.addEventListener('change', async (e) => {
    const name = e.target.value;
    patchLabConfig({
      scenarioRef: name ? { feature: FEATURE_SOR_PLAN, name } : null,
    });
    markStaleAndRefresh();
    await renderVariableList();
  });

  document.getElementById('sor-lab-sweep-points')?.addEventListener('change', (e) => {
    patchLabConfig({ sweepPoints: Number(e.target.value) });
    markStaleAndRefresh();
  });

  document.getElementById('sor-lab-paths')?.addEventListener('change', (e) => {
    patchLabConfig({ pathsPerPoint: Number(e.target.value) });
    markStaleAndRefresh();
  });

  document.getElementById('sor-lab-reset-envelopes')?.addEventListener('click', async () => {
    patchLabConfig({ envelopeOverrides: {} });
    markStaleAndRefresh();
    await renderVariableList();
  });

  document.getElementById('sor-lab-variable-list')?.addEventListener('change', () => {
    patchLabConfig({ envelopeOverrides: readOverridesFromDom() });
    markStaleAndRefresh();
  });

  // Also catch typing in envelope inputs without waiting for blur-change on some browsers.
  document.getElementById('sor-lab-variable-list')?.addEventListener('input', (e) => {
    if (!(e.target instanceof HTMLInputElement)) return;
    if (!e.target.classList.contains('sor-lab-var-low') && !e.target.classList.contains('sor-lab-var-high')) {
      return;
    }
    patchLabConfig({ envelopeOverrides: readOverridesFromDom() });
    setLabResultStale(true);
    refreshLabStaleBanner();
  });
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]),
  );
}

function escapeAttr(str) {
  return escapeHtml(str);
}
