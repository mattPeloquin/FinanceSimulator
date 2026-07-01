// Live sparkline of the balance-based spending scale: multiplier (y) as a
// function of portfolio balance (x), for the floor/ceiling values currently in
// the form. Lets users see the ramp they configured instead of guessing.
import { Chart } from './chartSetup.js';
import { balanceScaleMultiplier } from '../../core/withdrawal.js';
import { parseCurrency, MONEY_SCALE } from '../../state/scenario.js';
import { formatK } from '../format.js';

const SAMPLE_POINTS = 80;

let sparkChart = null;
let pendingFrame = null;

function isSectionVisible() {
  const wrapper = document.getElementById('dynamic-adjustments-wrapper');
  return wrapper && !wrapper.classList.contains('hidden');
}

// Read the guardrail inputs straight from the form, in dollars/decimals,
// mirroring how buildSimParams prepares them for the engine.
function readPortfolioFromForm() {
  const dollars = (id) => parseCurrency(document.getElementById(id)?.value) * MONEY_SCALE;
  const pct = (id) => (parseFloat(document.getElementById(id)?.value) || 0) / 100;
  return {
    floorBalance: dollars('floorBalance'),
    floorPenalty: pct('floorPenalty'),
    ceilingBalance: dollars('ceilingBalance') || Infinity,
    ceilingBonus: pct('ceilingBonus'),
    startBalance: dollars('startBalance'),
  };
}

// Pick an x-axis range wide enough to show both ramps in action.
function chartMaxBalance(portfolio) {
  const anchors = [portfolio.startBalance, portfolio.floorBalance * 2];
  if (Number.isFinite(portfolio.ceilingBalance)) anchors.push(portfolio.ceilingBalance * 2);
  const max = Math.max(...anchors, 0);
  return max > 0 ? max : 1_000_000;
}

function buildSeries(portfolio) {
  const maxBalance = chartMaxBalance(portfolio);
  const points = [];
  for (let i = 0; i <= SAMPLE_POINTS; i++) {
    const balance = (maxBalance * i) / SAMPLE_POINTS;
    points.push({ x: balance, y: balanceScaleMultiplier(balance, portfolio) });
  }
  return points;
}

function buildChart(canvas, points) {
  return new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      datasets: [
        {
          label: 'Spending multiplier',
          data: points,
          borderColor: '#4f46e5',
          backgroundColor: 'rgba(79, 70, 229, 0.10)',
          borderWidth: 2,
          tension: 0,
          pointRadius: 0,
          pointHoverRadius: 3,
          fill: { target: { value: 1 } },
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: {
          type: 'linear',
          title: { display: true, text: 'Portfolio Balance ($000s)', font: { size: 9 } },
          ticks: { maxTicksLimit: 6, font: { size: 9 }, callback: (v) => formatK(v) },
          grid: { display: false },
        },
        y: {
          beginAtZero: true,
          ticks: { maxTicksLimit: 5, font: { size: 9 }, callback: (v) => `${v}\u00d7` },
          grid: { color: 'rgba(148,163,184,0.2)' },
        },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          displayColors: false,
          callbacks: {
            title: (items) => `Balance: ${formatK(items[0].parsed.x)}`,
            label: (ctx) => `Spending \u00d7${ctx.parsed.y.toFixed(2)}`,
          },
        },
      },
    },
  });
}

function renderSparkline() {
  const canvas = document.getElementById('guardrailPreviewChart');
  if (!canvas || !isSectionVisible()) return;

  // Chart.js reads parent size at init — skip if layout hasn't run yet.
  if (canvas.clientWidth === 0 || canvas.clientHeight === 0) {
    pendingFrame = requestAnimationFrame(renderSparkline);
    return;
  }

  const points = buildSeries(readPortfolioFromForm());
  if (sparkChart) {
    sparkChart.data.datasets[0].data = points;
    sparkChart.update('none');
    return;
  }
  sparkChart = buildChart(canvas, points);
}

export function syncGuardrailPreview() {
  if (!isSectionVisible()) return;
  if (pendingFrame) cancelAnimationFrame(pendingFrame);
  // Wait for the section to finish laying out after becoming visible.
  pendingFrame = requestAnimationFrame(() => {
    pendingFrame = requestAnimationFrame(() => {
      pendingFrame = null;
      renderSparkline();
    });
  });
}
