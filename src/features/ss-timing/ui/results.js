// Social Security results — summary tables + strategy bar chart.

import { Chart } from '../../../ui/charts/chartSetup.js';
import { getChartTheme } from '../../../ui/charts/chartTheme.js';
import { getSsTimingResult, setSsTimingResult, isSsTimingResultStale } from '../session.js';

let strategyChart = null;

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

export function setSsTimingLoading(loading) {
  const box = el('ss-timing-loading');
  const btn = el('ss-timing-run');
  if (box) {
    box.classList.toggle('hidden', !loading);
    box.classList.toggle('flex', loading);
  }
  if (btn) btn.disabled = !!loading;
}

export function updateSsTimingProgress(fraction, stage) {
  const bar = el('ss-timing-loading-bar');
  const text = el('ss-timing-loading-text');
  if (bar) bar.style.width = `${Math.round(Math.max(0, Math.min(1, fraction)) * 100)}%`;
  if (text) text.textContent = stage || 'Running…';
}

export function clearSsTimingResultsUi() {
  el('ss-timing-results-section')?.classList.add('hidden');
  if (strategyChart) {
    strategyChart.destroy();
    strategyChart = null;
  }
}

export function bindSsTimingResults() {
  // no-op hooks reserved for view toggles
}

export function paintSsTimingResults(result) {
  setSsTimingResult(result);
  renderSsTimingCharts();
}

export function renderSsTimingCharts() {
  const result = getSsTimingResult();
  const section = el('ss-timing-results-section');
  if (!result || !section) return;
  section.classList.remove('hidden');

  const stale = el('ss-timing-stale');
  if (stale) stale.classList.toggle('hidden', !isSsTimingResultStale());

  const det = result.deterministic;
  const primaryEnd = result.meta?.primaryEnd
    || det.endAges[det.endAges.length - 2]
    || det.endAges[det.endAges.length - 1];

  // Summary + break-even
  const be = det.breakEven;
  const flipText = det.strip.flips.length
    ? `Ranking flips at end age(s): ${det.strip.flips.map((f) => f.endAge).join(', ')}.`
    : 'No ranking flips across the end-age strip.';
  const beText = be
    ? `Break-even (early vs delay-to-70): around end age ${be.endAge}.`
    : 'Break-even: delayed claiming does not catch up within the scan range.';
  if (el('ss-timing-summary')) {
    el('ss-timing-summary').textContent = `${flipText} ${beText}`;
  }

  // Strategy chart at primary end age
  const labels = det.strategies.map((s) => s.label);
  const values = det.strategies.map((s) => s.byEndAge[primaryEnd]?.lifetime ?? 0);
  const canvas = el('ss-timing-strategy-chart');
  if (canvas) {
    if (strategyChart) strategyChart.destroy();
    const theme = getChartTheme();
    strategyChart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: `Lifetime benefits @ end ${primaryEnd}`,
          data: values,
          backgroundColor: theme.accent || 'rgba(79, 70, 229, 0.65)',
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => fmtMoney(ctx.parsed.y),
            },
          },
        },
        scales: {
          y: {
            ticks: {
              callback: (v) => fmtMoney(v),
            },
          },
        },
      },
    });
  }

  // End-age strip
  const stripHost = el('ss-timing-strip');
  if (stripHost) {
    stripHost.innerHTML = det.endAges.map((age) => {
      const row = det.strip.byEndAge[age];
      const winner = row?.winner;
      return `<div><span class="font-medium">End ${age}:</span> best = ${winner?.label || '—'} (${fmtMoney(winner?.lifetime || 0)})</div>`;
    }).join('');
    if (det.strip.flips.length) {
      stripHost.innerHTML += `<div class="text-theme-accent mt-1">${det.strip.flips.map((f) =>
        `Flip at ${f.endAge}: ${f.from.label} → ${f.to.label}`).join('; ')}</div>`;
    }
  }

  // Claim-age grid (compact): show lifetime at primary end for each cell
  const gridHost = el('ss-timing-grid');
  if (gridHost && det.grid) {
    const { cells, claimAges } = det.grid;
    if (!det.personB) {
      gridHost.innerHTML = `<table class="min-w-full border-collapse"><thead><tr>
        <th class="border border-theme-border px-2 py-1 text-left">Claim</th>
        <th class="border border-theme-border px-2 py-1 text-right">Lifetime @ ${primaryEnd}</th>
      </tr></thead><tbody>${cells.map((c) => {
        const life = c.byEndAge[primaryEnd]?.lifetime ?? 0;
        return `<tr><td class="border border-theme-border px-2 py-1">${c.claimA}</td>
          <td class="border border-theme-border px-2 py-1 text-right">${fmtMoney(life)}</td></tr>`;
      }).join('')}</tbody></table>`;
    } else {
      const map = new Map(cells.map((c) => [`${c.claimA}-${c.claimB}`, c]));
      let html = `<table class="min-w-full border-collapse"><thead><tr><th class="border border-theme-border px-1 py-1">A\\B</th>`;
      for (const b of claimAges) html += `<th class="border border-theme-border px-1 py-1">${b}</th>`;
      html += '</tr></thead><tbody>';
      for (const a of claimAges) {
        html += `<tr><th class="border border-theme-border px-1 py-1">${a}</th>`;
        for (const b of claimAges) {
          const life = map.get(`${a}-${b}`)?.byEndAge[primaryEnd]?.lifetime ?? 0;
          html += `<td class="border border-theme-border px-1 py-1 text-right tabular-nums" title="${fmtMoney(life)}">${Math.round(life / 1000)}k</td>`;
        }
        html += '</tr>';
      }
      html += '</tbody></table>';
      gridHost.innerHTML = html;
    }
  }

  // MC OC panel
  const mcHost = el('ss-timing-mc');
  if (mcHost) {
    const mc = result.mcByStrategy || {};
    const rows = Object.keys(mc).map((id) => {
      const strategy = det.strategies.find((s) => s.id === id);
      const m = mc[id];
      const bridge = m.bridge;
      const bridgeText = bridge
        ? `Bridge success ${(bridge.successRate * 100).toFixed(0)}%; ending P50 ${fmtMoney(bridge.ending.p50)} (P10 ${fmtMoney(bridge.ending.p10)} / P90 ${fmtMoney(bridge.ending.p90)})`
        : 'No bridge years (already at/ past claim) or bridge disabled.';
      return `<div class="rounded border border-theme-border/70 px-3 py-2">
        <div class="font-medium text-theme-heading">${strategy?.label || id}</div>
        <div>Shocked lifetime P50 ${fmtMoney(m.lifetimeShocked.p50)} (P10 ${fmtMoney(m.lifetimeShocked.p10)} / P90 ${fmtMoney(m.lifetimeShocked.p90)})</div>
        <div class="text-theme-muted">${bridgeText}</div>
      </div>`;
    });
    mcHost.innerHTML = rows.length
      ? rows.join('')
      : '<p class="text-theme-muted">MC opportunity-cost was not run.</p>';
  }
}
