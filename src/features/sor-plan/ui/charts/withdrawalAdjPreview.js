// Live sparkline of the market-return adjustment curve: adjustment (y) as a
// function of real portfolio return (x), for the low / expected / high
// anchors currently in the form.
import { Chart } from './chartSetup.js';
import { getDynamicAdjustment } from '../../core/withdrawal.js';
import { readDynConfigFromDom } from '../../state/scenario.js';
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

export function chartReturnRange(dynConfig) {
  const { low, high } = dynConfig;
  const span = high.ret - low.ret;
  const pad = span > 0 ? span * 0.1 : 5;
  return { min: low.ret - pad, max: high.ret + pad };
}

/** Build preview points for the market-return adjustment curve. */
export function buildMarketAdjPreviewSeries(dynConfig) {
  const { min, max } = chartReturnRange(dynConfig);
  const points = [];
  for (let i = 0; i <= SAMPLE_POINTS; i++) {
    const realReturn = min + ((max - min) * i) / SAMPLE_POINTS;
    points.push({ x: realReturn, y: getDynamicAdjustment(realReturn, dynConfig) });
  }

  // Ensure exact anchor returns are represented so the curve hits the typed values.
  for (const ret of [dynConfig.low.ret, dynConfig.med.ret, dynConfig.high.ret]) {
    points.push({ x: ret, y: getDynamicAdjustment(ret, dynConfig) });
  }

  points.sort((a, b) => a.x - b.x);
  return points;
}

export function buildMarketAdjAnchorPoints(dynConfig) {
  return [
    { x: dynConfig.low.ret, y: dynConfig.low.adj },
    { x: dynConfig.med.ret, y: dynConfig.med.adj },
    { x: dynConfig.high.ret, y: dynConfig.high.adj },
  ];
}

function buildChart(canvas, points, anchors) {
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
        {
          label: 'Anchors',
          data: anchors,
          borderColor: theme.floorLine,
          backgroundColor: theme.floorLine,
          borderWidth: 0,
          pointRadius: 4,
          pointHoverRadius: 5,
          showLine: false,
          fill: false,
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
          title: { display: true, text: 'Real Market Return (%)', font: { size: 9 }, color: theme.axisTitle },
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
            label: (ctx) => (ctx.dataset.label === 'Anchors'
              ? `Anchor: $${formatK(ctx.parsed.y)}k`
              : `Adjustment: $${formatK(ctx.parsed.y)}k`),
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

  const dynConfig = readDynConfigFromDom();
  const points = buildMarketAdjPreviewSeries(dynConfig);
  const anchors = buildMarketAdjAnchorPoints(dynConfig);
  if (sparkChart) {
    sparkChart.destroy();
    sparkChart = null;
  }
  sparkChart = buildChart(canvas, points, anchors);
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
