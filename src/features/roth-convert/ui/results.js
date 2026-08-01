// Roth Convert results — multi-dim charts from packaged MC output.

import { Chart } from '../../../ui/charts/chartSetup.js';
import { getChartTheme } from '../../../ui/charts/chartTheme.js';
import {
  getRothConvertResult,
  setRothConvertResult,
  isRothConvertResultStale,
  getRothConvertState,
  patchRothConvertState,
} from '../session.js';

let responseChart = null;
let scatterChart = null;
let heatmapChart = null;
let fanChart = null;

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

export function setRothConvertLoading(loading) {
  const box = el('roth-convert-loading');
  const btn = el('roth-convert-run');
  if (box) {
    box.classList.toggle('hidden', !loading);
    box.classList.toggle('flex', loading);
  }
  if (btn) btn.disabled = !!loading;
}

export function updateRothConvertProgress(fraction, stage) {
  const bar = el('roth-convert-loading-bar');
  const text = el('roth-convert-loading-text');
  if (bar) bar.style.width = `${Math.round(Math.max(0, Math.min(1, fraction)) * 100)}%`;
  if (text) text.textContent = stage || 'Running…';
}

export function clearRothConvertResultsUi() {
  el('roth-convert-results-section')?.classList.add('hidden');
  destroyCharts();
}

function destroyCharts() {
  for (const c of [responseChart, scatterChart, heatmapChart, fanChart]) {
    if (c) c.destroy();
  }
  responseChart = scatterChart = heatmapChart = fanChart = null;
}

export function bindRothConvertResults() {
  el('roth-convert-focus-strategy')?.addEventListener('change', () => {
    const id = el('roth-convert-focus-strategy')?.value;
    if (id) patchRothConvertState({ focusStrategyId: id });
    renderRothConvertCharts();
  });
}

export function paintRothConvertResults(result) {
  setRothConvertResult(result);
  renderRothConvertCharts();
}

function focusStrategyId(result) {
  const preferred = getRothConvertState().focusStrategyId || 'custom';
  if (result.byStrategy?.[preferred]) return preferred;
  return result.recommendation?.bestStrategyId || 'custom';
}

export function renderRothConvertCharts() {
  const result = getRothConvertResult();
  const section = el('roth-convert-results-section');
  if (!result || !section) return;
  section.classList.remove('hidden');

  const stale = el('roth-convert-stale');
  if (stale) stale.classList.toggle('hidden', !isRothConvertResultStale());

  const theme = getChartTheme();
  const focusId = focusStrategyId(result);
  const zero = result.byStrategy?.zero;
  const focus = result.byStrategy?.[focusId];

  // Focus strategy picker
  const select = el('roth-convert-focus-strategy');
  if (select) {
    select.innerHTML = '';
    for (const s of result.strategies || []) {
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = s.label;
      select.appendChild(opt);
    }
    select.value = focusId;
  }

  // Summary
  const rec = result.recommendation || {};
  const bestLabel = (result.strategies || []).find((s) => s.id === rec.bestStrategyId)?.label
    || rec.bestStrategyId;
  const zeroP50 = result.responseCurve?.find((r) => r.id === 'zero')?.p50 ?? 0;
  const beat = focus?.beatBaselineRate;
  if (el('roth-convert-summary')) {
    const helpLine = rec.convertsHelp
      ? `Median ending wealth is highest for “${bestLabel}” (${fmtMoney(rec.bestP50)}) vs $0 (${fmtMoney(zeroP50)}).`
      : `Median ending wealth is highest with $0 conversion (${fmtMoney(zeroP50)}) — converting does not help under these assumptions.`;
    const beatLine = beat != null
      ? ` Selected strategy beats $0 on ${Math.round(beat * 100)}% of CRN-paired paths.`
      : '';
    el('roth-convert-summary').textContent = helpLine + beatLine
      + ` Tax payment: ${result.meta?.taxPayment === 'withhold' ? 'withhold from conversion' : 'from taxable'}.`
      + ` Returns: ${result.meta?.returnMode === 'market' ? 'linked Plan market MC' : 'constant real return'}.`;
  }

  // Response curve
  const curve = result.responseCurve || [];
  const respCanvas = el('roth-convert-response-chart');
  if (respCanvas) {
    if (responseChart) responseChart.destroy();
    responseChart = new Chart(respCanvas, {
      type: 'bar',
      data: {
        labels: curve.map((c) => c.label),
        datasets: [
          {
            label: 'P10',
            data: curve.map((c) => c.p10),
            backgroundColor: 'rgba(148, 163, 184, 0.45)',
          },
          {
            label: 'P50',
            data: curve.map((c) => c.p50),
            backgroundColor: theme.accent || 'rgba(79, 70, 229, 0.7)',
          },
          {
            label: 'P90',
            data: curve.map((c) => c.p90),
            backgroundColor: 'rgba(16, 185, 129, 0.45)',
          },
        ],
      },
      options: {
        responsive: true,
        plugins: {
          legend: { position: 'bottom' },
          title: { display: false },
        },
        scales: {
          y: {
            ticks: {
              callback: (v) => `$${(v / 1000).toFixed(0)}k`,
            },
          },
        },
      },
    });
  }

  // Scatter tax vs wealth
  const scatterCanvas = el('roth-convert-scatter-chart');
  if (scatterCanvas && focus?.scatter) {
    if (scatterChart) scatterChart.destroy();
    scatterChart = new Chart(scatterCanvas, {
      type: 'scatter',
      data: {
        datasets: [{
          label: focus.strategy?.label || focusId,
          data: focus.scatter.map((p) => ({ x: p.lifetimeTax, y: p.endingWealth })),
          backgroundColor: theme.accent || 'rgba(79, 70, 229, 0.45)',
          pointRadius: 3,
        }],
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: {
          x: {
            title: { display: true, text: 'Lifetime tax' },
            ticks: { callback: (v) => `$${(v / 1000).toFixed(0)}k` },
          },
          y: {
            title: { display: true, text: 'Ending wealth' },
            ticks: { callback: (v) => `$${(v / 1000).toFixed(0)}k` },
          },
        },
      },
    });
  }

  // Heatmap as line bands averaged by rank quintiles (lightweight Chart.js stand-in)
  renderHeatmapProxy(focus, theme);

  // Fans: focus vs zero net worth P10/P50/P90
  renderFan(focus, zero, theme);

  // Median year table
  renderYearTable(focus?.percentiles?.p50?.years || []);
}

function renderHeatmapProxy(focus, theme) {
  const canvas = el('roth-convert-heatmap');
  if (!canvas || !focus?.heatmaps?.netWorth) return;
  if (heatmapChart) heatmapChart.destroy();

  const hm = focus.heatmaps.netWorth;
  const n = hm.numSimulations;
  const years = hm.numYears;
  const values = hm.values;
  // Average each year within P10–P40, P40–P60, P60–P90 rank bands.
  const bands = [
    { label: 'P10–P40', lo: 0.10, hi: 0.40, color: 'rgba(148, 163, 184, 0.8)' },
    { label: 'P40–P60', lo: 0.40, hi: 0.60, color: theme.accent || 'rgba(79, 70, 229, 0.85)' },
    { label: 'P60–P90', lo: 0.60, hi: 0.90, color: 'rgba(16, 185, 129, 0.8)' },
  ];
  const labels = Array.from({ length: years }, (_, y) => `Y${y + 1}`);
  const datasets = bands.map((band) => {
    const lo = Math.floor(band.lo * (n - 1));
    const hi = Math.floor(band.hi * (n - 1));
    const series = new Array(years).fill(0);
    const count = Math.max(1, hi - lo + 1);
    for (let rank = lo; rank <= hi; rank++) {
      for (let y = 0; y < years; y++) {
        series[y] += values[rank * years + y] || 0;
      }
    }
    for (let y = 0; y < years; y++) series[y] /= count;
    return {
      label: band.label,
      data: series,
      borderColor: band.color,
      backgroundColor: 'transparent',
      tension: 0.2,
      pointRadius: 0,
    };
  });

  heatmapChart = new Chart(canvas, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      plugins: {
        legend: { position: 'bottom' },
        title: {
          display: true,
          text: 'Rank-band average net worth by year (heatmap source)',
          font: { size: 11 },
        },
      },
      scales: {
        y: { ticks: { callback: (v) => `$${(v / 1000).toFixed(0)}k` } },
      },
    },
  });
}

function renderFan(focus, zero, theme) {
  const canvas = el('roth-convert-fan-chart');
  if (!canvas || !focus?.percentiles) return;
  if (fanChart) fanChart.destroy();

  const years = focus.percentiles.p50?.netWorthByYear?.length || 0;
  const labels = Array.from({ length: years }, (_, y) => `Y${y + 1}`);
  const datasets = [];

  const addBand = (entry, labelPrefix, color) => {
    if (!entry?.percentiles) return;
    datasets.push({
      label: `${labelPrefix} P50`,
      data: entry.percentiles.p50.netWorthByYear,
      borderColor: color,
      backgroundColor: 'transparent',
      borderWidth: 2,
      pointRadius: 0,
      tension: 0.15,
    });
    datasets.push({
      label: `${labelPrefix} P10–P90`,
      data: entry.percentiles.p90.netWorthByYear,
      borderColor: 'transparent',
      backgroundColor: color.replace(/[\d.]+\)$/, '0.12)').replace('rgb(', 'rgba('),
      pointRadius: 0,
      fill: '-1',
      tension: 0.15,
    });
    // Ensure P10 is the previous dataset for fill — Chart.js fill:-1 needs order.
    // Simpler: just plot P10/P50/P90 lines.
  };

  // Clearer: three lines for focus + dashed P50 for zero.
  const f = focus.percentiles;
  datasets.push(
    {
      label: 'Selected P10',
      data: f.p10.netWorthByYear,
      borderColor: 'rgba(148, 163, 184, 0.8)',
      borderDash: [4, 4],
      pointRadius: 0,
      tension: 0.15,
    },
    {
      label: 'Selected P50',
      data: f.p50.netWorthByYear,
      borderColor: theme.accent || 'rgba(79, 70, 229, 0.9)',
      borderWidth: 2,
      pointRadius: 0,
      tension: 0.15,
    },
    {
      label: 'Selected P90',
      data: f.p90.netWorthByYear,
      borderColor: 'rgba(16, 185, 129, 0.8)',
      borderDash: [4, 4],
      pointRadius: 0,
      tension: 0.15,
    },
  );
  if (zero?.percentiles?.p50) {
    datasets.push({
      label: '$0 baseline P50',
      data: zero.percentiles.p50.netWorthByYear,
      borderColor: 'rgba(239, 68, 68, 0.85)',
      borderWidth: 2,
      pointRadius: 0,
      tension: 0.15,
    });
  }

  fanChart = new Chart(canvas, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      plugins: { legend: { position: 'bottom' } },
      scales: {
        y: { ticks: { callback: (v) => `$${(v / 1000).toFixed(0)}k` } },
      },
    },
  });
  void addBand;
}

function renderYearTable(years) {
  const host = el('roth-convert-year-table');
  if (!host) return;
  if (!years.length) {
    host.innerHTML = '<p class="text-theme-muted">No median-path years.</p>';
    return;
  }
  const rows = years.map((y) => `
    <tr class="border-t border-theme-border">
      <td class="px-2 py-1">${y.yearIndex + 1}</td>
      <td class="px-2 py-1">${y.ageA}${y.ageB != null ? ` / ${y.ageB}` : ''}</td>
      <td class="px-2 py-1 text-right">${fmtMoney(y.convert)}</td>
      <td class="px-2 py-1 text-right">${fmtMoney(y.rmd)}</td>
      <td class="px-2 py-1 text-right">${fmtMoney(y.qcd)}</td>
      <td class="px-2 py-1 text-right">${fmtMoney(y.taxDue)}</td>
      <td class="px-2 py-1 text-right">${fmtMoney(y.trad)}</td>
      <td class="px-2 py-1 text-right">${fmtMoney(y.roth)}</td>
      <td class="px-2 py-1 text-right">${fmtMoney(y.taxable)}</td>
      <td class="px-2 py-1 text-right font-medium">${fmtMoney(y.netWorth)}</td>
    </tr>
  `).join('');
  host.innerHTML = `
    <table class="min-w-full text-left">
      <thead>
        <tr class="text-theme-muted">
          <th class="px-2 py-1">Yr</th>
          <th class="px-2 py-1">Age</th>
          <th class="px-2 py-1 text-right">Convert</th>
          <th class="px-2 py-1 text-right">RMD</th>
          <th class="px-2 py-1 text-right">QCD</th>
          <th class="px-2 py-1 text-right">Tax</th>
          <th class="px-2 py-1 text-right">Trad</th>
          <th class="px-2 py-1 text-right">Roth</th>
          <th class="px-2 py-1 text-right">Taxable</th>
          <th class="px-2 py-1 text-right">Net worth</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}
