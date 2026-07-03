// Live sparkline of the market-return adjustment curve: adjustment (y) as a
// function of nominal portfolio return (x), for the low / expected / high
// anchors currently in the form.
import { Chart } from './chartSetup.js';
import { getDynamicAdjustment } from '../../core/withdrawal.js';
import { parseCurrency, MONEY_SCALE } from '../../state/scenario.js';
import { formatK } from '../format.js';
import { getChartTheme, chartJsTooltip } from './chartTheme.js';
import { onThemeChange } from '../theme.js';

const SAMPLE_POINTS = 80;

let sparkChart = null;
let pendingFrame = null;

function isSectionVisible() {
  const wrapper = document.getElementById('dynamic-adjustments-wrapper');
  return wrapper && !wrapper.classList.contains('hidden');
}

function readDynConfigFromForm() {
  const ret = (id) => parseFloat(document.getElementById(id)?.value) || 0;
  const adj = (id) => parseCurrency(document.getElementById(id)?.value) * MONEY_SCALE;
  return {
    low: { ret: ret('dynLowRet'), adj: adj('dynLowAdj') },
    med: { ret: ret('dynMedRet'), adj: adj('dynMedAdj') },
    high: { ret: ret('dynHighRet'), adj: adj('dynHighAdj') },
  };
}

function chartReturnRange(dynConfig) {
  const { low, high } = dynConfig;
  const span = high.ret - low.ret;
  const pad = span > 0 ? span * 0.1 : 5;
  return { min: low.ret - pad, max: high.ret + pad };
}

function buildSeries(dynConfig) {
  const { min, max } = chartReturnRange(dynConfig);
  const points = [];
  for (let i = 0; i <= SAMPLE_POINTS; i++) {
    const nominalReturn = min + ((max - min) * i) / SAMPLE_POINTS;
    points.push({ x: nominalReturn, y: getDynamicAdjustment(nominalReturn, dynConfig) });
  }
  return points;
}

function buildChart(canvas, points) {
  const theme = getChartTheme();
  return new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      datasets: [
        {
          label: 'Adjustment',
          data: points,
          borderColor: theme.accent,
          backgroundColor: theme.accentFillSofter,
          borderWidth: 2,
          tension: 0,
          pointRadius: 0,
          pointHoverRadius: 3,
          fill: { target: { value: 0 } },
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
          title: { display: true, text: 'Nominal Market Return (%)', font: { size: 9 }, color: theme.axisTitle },
          ticks: { maxTicksLimit: 6, font: { size: 9 }, callback: (v) => `${v}%`, color: theme.axisTick },
          grid: { display: false },
        },
        y: {
          ticks: {
            maxTicksLimit: 5,
            font: { size: 9 },
            callback: (v) => `$${formatK(v)}k`,
            color: theme.axisTick,
          },
          grid: { color: theme.gridLine },
        },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          ...chartJsTooltip(theme),
          displayColors: false,
          callbacks: {
            title: (items) => `Return: ${items[0].parsed.x.toFixed(1)}%`,
            label: (ctx) => `Adjustment: $${formatK(ctx.parsed.y)}k`,
          },
        },
      },
    },
  });
}

function renderSparkline() {
  const canvas = document.getElementById('withdrawalAdjPreviewChart');
  if (!canvas || !isSectionVisible()) return;

  if (canvas.clientWidth === 0 || canvas.clientHeight === 0) {
    pendingFrame = requestAnimationFrame(renderSparkline);
    return;
  }

  const points = buildSeries(readDynConfigFromForm());
  if (sparkChart) {
    sparkChart.destroy();
    sparkChart = null;
  }
  sparkChart = buildChart(canvas, points);
}

export function syncWithdrawalAdjPreview() {
  if (!isSectionVisible()) return;
  if (pendingFrame) cancelAnimationFrame(pendingFrame);
  pendingFrame = requestAnimationFrame(() => {
    pendingFrame = requestAnimationFrame(() => {
      pendingFrame = null;
      renderSparkline();
    });
  });
}

onThemeChange(() => {
  if (isSectionVisible()) renderSparkline();
});
