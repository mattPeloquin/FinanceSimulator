// House Equity results — comparison bars, cash paths, portfolio & residual charts.

import { Chart } from '../../../ui/charts/chartSetup.js';
import { getChartTheme } from '../../../ui/charts/chartTheme.js';
import {
  getHouseEquityResult,
  setHouseEquityResult,
  isHouseEquityResultStale,
  getHouseEquityState,
  patchHouseEquityState,
} from '../session.js';

let compareChart = null;
let cashPathChart = null;
let portfolioChart = null;
let residualChart = null;

const PATH_COLORS = [
  'rgba(79, 70, 229, 0.9)',
  'rgba(16, 185, 129, 0.9)',
  'rgba(245, 158, 11, 0.9)',
  'rgba(239, 68, 68, 0.9)',
  'rgba(59, 130, 246, 0.9)',
];

function el(id) {
  return document.getElementById(id);
}

function fmtMoney(n) {
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(n);
}

export function setHouseEquityLoading(loading) {
  const box = el('house-equity-loading');
  const btn = el('house-equity-run');
  if (box) {
    box.classList.toggle('hidden', !loading);
    box.classList.toggle('flex', loading);
  }
  if (btn) btn.disabled = !!loading;
}

export function updateHouseEquityProgress(fraction, stage) {
  const bar = el('house-equity-loading-bar');
  const text = el('house-equity-loading-text');
  if (bar) bar.style.width = `${Math.round(Math.max(0, Math.min(1, fraction)) * 100)}%`;
  if (text) text.textContent = stage || 'Running…';
}

export function clearHouseEquityResultsUi() {
  el('house-equity-results-section')?.classList.add('hidden');
  destroyCharts();
}

function destroyCharts() {
  for (const c of [compareChart, cashPathChart, portfolioChart, residualChart]) {
    if (c) c.destroy();
  }
  compareChart = cashPathChart = portfolioChart = residualChart = null;
}

export function bindHouseEquityResults() {
  // Focus strategy kept in state for future chart highlighting; no dedicated control yet.
  void patchHouseEquityState;
}

export function paintHouseEquityResults(result) {
  setHouseEquityResult(result);
  renderHouseEquityCharts();
}

export function renderHouseEquityCharts() {
  const result = getHouseEquityResult();
  const section = el('house-equity-results-section');
  if (!result || !section) return;
  section.classList.remove('hidden');

  const stale = el('house-equity-stale');
  if (stale) stale.classList.toggle('hidden', !isHouseEquityResultStale());

  const theme = getChartTheme();
  const ranking = result.ranking || [];
  const best = ranking[0];
  const meta = result.meta || {};

  if (el('house-equity-summary')) {
    const ttl = best?.timeToLiquidityP50 != null
      ? ` Median time-to-liquidity for the leader: year ${best.timeToLiquidityP50}.`
      : '';
    el('house-equity-summary').textContent = best
      ? `Highest median cumulative real cash: “${best.label}” (${fmtMoney(best.score)}).${ttl}`
        + ` Access year ${meta.accessYear}. Returns: ${
          meta.portfolioSource === 'link' ? 'linked Withdraw/Plan MC SOR' : 'local portfolio MC SOR'
        }. Residual equity is reported but not used for ranking.`
      : 'No ranking available.';
  }

  // Rank table
  const tbody = el('house-equity-rank-table')?.querySelector('tbody');
  if (tbody) {
    tbody.innerHTML = '';
    for (const row of ranking) {
      const tr = document.createElement('tr');
      tr.className = 'border-t border-theme-border';
      const ttl = row.timeToLiquidityP50 == null ? '—' : `Y${row.timeToLiquidityP50}`;
      tr.innerHTML = `
        <td class="py-1.5 pr-3 font-medium text-theme-body">${row.label}</td>
        <td class="py-1.5 pr-3">${fmtMoney(row.score)}</td>
        <td class="py-1.5 pr-3">${fmtMoney(row.extractedP50)}</td>
        <td class="py-1.5 pr-3">${ttl}</td>
        <td class="py-1.5 pr-3">${Math.round((row.spendMet || 0) * 100)}%</td>
        <td class="py-1.5">${fmtMoney(row.residualP50)}</td>
      `;
      tbody.appendChild(tr);
    }
  }

  // Comparison bars
  const bars = result.comparisonBars?.cumulativeCash || [];
  const compareCanvas = el('house-equity-compare-chart');
  if (compareCanvas) {
    if (compareChart) compareChart.destroy();
    compareChart = new Chart(compareCanvas, {
      type: 'bar',
      data: {
        labels: bars.map((b) => b.label),
        datasets: [
          {
            label: 'P10',
            data: bars.map((b) => b.p10),
            backgroundColor: 'rgba(148, 163, 184, 0.45)',
          },
          {
            label: 'P50',
            data: bars.map((b) => b.p50),
            backgroundColor: theme.accent || 'rgba(79, 70, 229, 0.7)',
          },
          {
            label: 'P90',
            data: bars.map((b) => b.p90),
            backgroundColor: 'rgba(16, 185, 129, 0.45)',
          },
        ],
      },
      options: {
        responsive: true,
        plugins: { legend: { position: 'bottom' } },
        scales: {
          y: {
            ticks: {
              callback: (v) => (Math.abs(v) >= 1000 ? `$${Math.round(v / 1000)}k` : `$${v}`),
            },
          },
        },
      },
    });
  }

  // Median cumulative cash paths
  const strategies = result.strategies || [];
  const years = Array.from({ length: meta.numYears || 0 }, (_, i) => i);
  const cashCanvas = el('house-equity-cash-path-chart');
  if (cashCanvas) {
    if (cashPathChart) cashPathChart.destroy();
    cashPathChart = new Chart(cashCanvas, {
      type: 'line',
      data: {
        labels: years,
        datasets: strategies.map((s, i) => ({
          label: s.label,
          data: result.byStrategy?.[s.id]?.medianPath?.cumulativeRealByYear || [],
          borderColor: PATH_COLORS[i % PATH_COLORS.length],
          backgroundColor: 'transparent',
          tension: 0.15,
          pointRadius: 0,
          borderWidth: 2,
        })),
      },
      options: {
        responsive: true,
        plugins: { legend: { position: 'bottom' } },
        scales: {
          x: { title: { display: true, text: 'Year' } },
          y: {
            ticks: {
              callback: (v) => (Math.abs(v) >= 1000 ? `$${Math.round(v / 1000)}k` : `$${v}`),
            },
          },
        },
      },
    });
  }

  // Portfolio fan (median paths for invest strategies)
  const portCanvas = el('house-equity-portfolio-chart');
  if (portCanvas) {
    if (portfolioChart) portfolioChart.destroy();
    const investIds = ['cashOutInvest', 'sellAndRent'];
    portfolioChart = new Chart(portCanvas, {
      type: 'line',
      data: {
        labels: Array.from({ length: (meta.numYears || 0) + 1 }, (_, i) => i),
        datasets: investIds.map((id, i) => ({
          label: result.byStrategy?.[id]?.label || id,
          data: result.byStrategy?.[id]?.medianPath?.portfolioReal || [],
          borderColor: PATH_COLORS[(i + 3) % PATH_COLORS.length],
          backgroundColor: 'transparent',
          tension: 0.15,
          pointRadius: 0,
          borderWidth: 2,
        })),
      },
      options: {
        responsive: true,
        plugins: { legend: { position: 'bottom' } },
        scales: {
          x: { title: { display: true, text: 'Year' } },
          y: {
            ticks: {
              callback: (v) => (Math.abs(v) >= 1000 ? `$${Math.round(v / 1000)}k` : `$${v}`),
            },
          },
        },
      },
    });
  }

  // Residual equity
  const resCanvas = el('house-equity-residual-chart');
  if (resCanvas) {
    if (residualChart) residualChart.destroy();
    residualChart = new Chart(resCanvas, {
      type: 'line',
      data: {
        labels: Array.from({ length: (meta.numYears || 0) + 1 }, (_, i) => i),
        datasets: strategies.map((s, i) => ({
          label: s.label,
          data: result.byStrategy?.[s.id]?.medianPath?.residualEquityReal || [],
          borderColor: PATH_COLORS[i % PATH_COLORS.length],
          backgroundColor: 'transparent',
          tension: 0.15,
          pointRadius: 0,
          borderWidth: 1.5,
        })),
      },
      options: {
        responsive: true,
        plugins: { legend: { position: 'bottom' } },
        scales: {
          x: { title: { display: true, text: 'Year' } },
          y: {
            ticks: {
              callback: (v) => (Math.abs(v) >= 1000 ? `$${Math.round(v / 1000)}k` : `$${v}`),
            },
          },
        },
      },
    });
  }

  // Keep focus id in sync with top-ranked strategy when unset.
  const focus = getHouseEquityState().focusStrategyId;
  if (!result.byStrategy?.[focus] && best?.id) {
    patchHouseEquityState({ focusStrategyId: best.id });
  }
}
