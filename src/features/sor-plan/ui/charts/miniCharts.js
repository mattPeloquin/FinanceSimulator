// Allocation sparkline mini-charts showing each asset class vs inflation.
import { formatPct1 } from '../../core/precision.js';
import { Chart } from './chartSetup.js';
import {
  getMiniChartSeries,
  averageRealReturn,
  sparklineRange,
  sparklineZeroTopPct,
} from '../../core/history.js';
import { getChartTheme, chartJsTooltip } from './chartTheme.js';
import { onThemeChange, isDarkMode, themeRgba, themeTokens } from '../theme.js';

const MINI_CHARTS = [
  {
    canvasId: 'us-lg-growth-mini-chart',
    avgId: 'usLgGrowthAvgReturn',
    maxId: 'usLgGrowthMaxReturn',
    minId: 'usLgGrowthMinReturn',
    clusterId: 'usLgGrowthRangeCluster',
    plotId: 'usLgGrowthSparkPlot',
    key: 'us_lg_growth',
    color: themeTokens.chartAssets.us_lg_growth,
    name: 'US Lg Growth',
  },
  {
    canvasId: 'us-lg-value-mini-chart',
    avgId: 'usLgValueAvgReturn',
    maxId: 'usLgValueMaxReturn',
    minId: 'usLgValueMinReturn',
    clusterId: 'usLgValueRangeCluster',
    plotId: 'usLgValueSparkPlot',
    key: 'us_lg_value',
    color: themeTokens.chartAssets.us_lg_value,
    name: 'US Lg Value',
  },
  {
    canvasId: 'us-sm-mid-mini-chart',
    avgId: 'usSmMidAvgReturn',
    maxId: 'usSmMidMaxReturn',
    minId: 'usSmMidMinReturn',
    clusterId: 'usSmMidRangeCluster',
    plotId: 'usSmMidSparkPlot',
    key: 'us_sm_mid',
    color: themeTokens.chartAssets.us_sm_mid,
    name: 'US Sm/Mid',
  },
  {
    canvasId: 'ex-us-mini-chart',
    avgId: 'exUsAvgReturn',
    maxId: 'exUsMaxReturn',
    minId: 'exUsMinReturn',
    clusterId: 'exUsRangeCluster',
    plotId: 'exUsSparkPlot',
    key: 'ex_us',
    color: themeTokens.chartAssets.ex_us,
    name: 'ex-US',
  },
  {
    canvasId: 'bond-mini-chart',
    avgId: 'bondAvgReturn',
    maxId: 'bondMaxReturn',
    minId: 'bondMinReturn',
    clusterId: 'bondRangeCluster',
    plotId: 'bondSparkPlot',
    key: 'bond',
    color: themeTokens.chartAssets.bond,
    name: 'Bond',
  },
  {
    canvasId: 'cash-mini-chart',
    avgId: 'cashAvgReturn',
    maxId: 'cashMaxReturn',
    minId: 'cashMinReturn',
    clusterId: 'cashRangeCluster',
    plotId: 'cashSparkPlot',
    key: 'cash',
    color: themeTokens.chartAssets.cash,
    name: 'Cash',
  },
];

function setPctText(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = value == null || Number.isNaN(value) ? '—' : formatPct1(value);
}

// Signed % row: hanging minus in a fixed-width slot so digits of +/− line up.
function setSignedPct(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  const signEl = el.parentElement?.querySelector('[data-sign]');
  if (value == null || Number.isNaN(value)) {
    el.textContent = '—';
    if (signEl) signEl.textContent = '';
    return;
  }
  if (signEl) signEl.textContent = value < 0 ? '−' : '';
  el.textContent = formatPct1(Math.abs(value));
}

// Park the sparkline so its locked Y=0 line sits on the vertical midpoint of
// the plot track (which is CSS-centered on the allocation % field).
function positionPlotOnAxis(cfg, zeroPct) {
  const plot = document.getElementById(cfg.plotId);
  const cluster = document.getElementById(cfg.clusterId);
  if (plot) plot.style.top = `${50 - zeroPct}%`;
  if (cluster) cluster.style.top = `${zeroPct}%`;
}

function renderSparklineStats(cfg, assetSeries, inflationSeries) {
  setPctText(cfg.avgId, averageRealReturn(assetSeries, inflationSeries));
  const range = sparklineRange(assetSeries, inflationSeries);
  setSignedPct(cfg.maxId, range?.max);
  setSignedPct(cfg.minId, range?.min);
  positionPlotOnAxis(cfg, sparklineZeroTopPct(range));
}

const instances = {};
let lastStartYear = null;
let lastEndYear = null;
let resizeTimer = null;

function buildMiniChart(canvas, labels, assetData, inflationData, color, assetName, yMin, yMax) {
  const theme = getChartTheme();
  const zeroLineData = labels.map(() => 0);

  return new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Zero Line', data: zeroLineData, borderColor: theme.zeroLine, borderWidth: 1, fill: false, pointRadius: 0 },
        {
          label: 'Inflation',
          data: inflationData,
          borderColor: themeRgba('status.danger', isDarkMode() ? 'dark' : 'light', 0.5),
          borderWidth: 1,
          fill: false,
          pointRadius: 0,
        },
        { label: assetName, data: assetData, borderColor: color, borderWidth: 1.5, fill: false, tension: 0.1, pointRadius: 0 },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      layout: { padding: 0 },
      scales: {
        x: { display: false },
        // Lock to the same extent used for min/max labels so the drawn zero
        // line matches sparklineZeroTopPct exactly (no Chart.js grace/nice ticks).
        y: { display: false, min: yMin, max: yMax, grace: 0 },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          ...chartJsTooltip(theme),
          intersect: false,
          mode: 'index',
          filter: (ti) => ti.datasetIndex !== 0,
          callbacks: {
            title: (c) => `Year: ${c[0].label}`,
            label: (c) =>
              c.datasetIndex === 1
                ? `Inflation: ${formatPct1(c.raw)}%`
                : `${assetName} Return: ${formatPct1(c.raw)}%`,
          },
        },
      },
      interaction: { mode: 'nearest', axis: 'x', intersect: false },
    },
  });
}

function drawMiniChart(canvasId, labels, assetData, inflationData, color, assetName, yMin, yMax) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  if (canvas.clientWidth === 0 || canvas.clientHeight === 0) {
    requestAnimationFrame(() => {
      drawMiniChart(canvasId, labels, assetData, inflationData, color, assetName, yMin, yMax);
    });
    return;
  }

  if (instances[canvasId]) instances[canvasId].destroy();
  instances[canvasId] = buildMiniChart(canvas, labels, assetData, inflationData, color, assetName, yMin, yMax);
}

export function resizeMiniCharts() {
  for (const cfg of MINI_CHARTS) {
    const canvas = document.getElementById(cfg.canvasId);
    Chart.getChart(canvas)?.resize();
  }
}

function scheduleResize() {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(resizeMiniCharts, 100);
}

function setupResizeHandling() {
  window.addEventListener('resize', scheduleResize);

  const allocationSection = document.getElementById('allocationSparklines');
  if (allocationSection && typeof ResizeObserver !== 'undefined') {
    const observer = new ResizeObserver(scheduleResize);
    observer.observe(allocationSection);
  }
}

export function updateMiniCharts(startYear, endYear) {
  lastStartYear = startYear;
  lastEndYear = endYear;
  const series = getMiniChartSeries(startYear, endYear);
  for (const cfg of MINI_CHARTS) {
    const range = sparklineRange(series[cfg.key], series.inflation) ?? { min: 0, max: 0 };
    drawMiniChart(
      cfg.canvasId,
      series.years,
      series[cfg.key],
      series.inflation,
      cfg.color,
      cfg.name,
      range.min,
      range.max
    );
    renderSparklineStats(cfg, series[cfg.key], series.inflation);
  }
  return series.years;
}

onThemeChange(() => {
  if (lastStartYear != null && lastEndYear != null) {
    updateMiniCharts(lastStartYear, lastEndYear);
  }
});

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupResizeHandling);
  } else {
    setupResizeHandling();
  }
}
