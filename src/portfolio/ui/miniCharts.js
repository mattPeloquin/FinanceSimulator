// Allocation sparkline mini-charts — sleeve list from the portfolio registry.
import { formatPct1 } from '../../core/precision.js';
import { Chart } from '../../ui/charts/chartSetup.js';
import {
  getMiniChartSeries,
  averageRealReturn,
  sparklineRange,
  sparklineZeroTopPct,
} from '../historyMath.js';
import { INFLATION, listSleeves } from '../registry.js';
import { getChartTheme, chartJsTooltip } from '../../ui/charts/chartTheme.js';
import { onThemeChange, isDarkMode, themeRgba } from '../../ui/theme.js';

function kebab(historyKey) {
  return String(historyKey).replace(/_/g, '-');
}

/** Build sparkline config rows from the registry (+ optional id prefix). */
export function miniChartConfigs(idPrefix = '') {
  return listSleeves().map((s) => {
    const stem = s.domId;
    const p = idPrefix;
    return {
      canvasId: `${p}${kebab(s.historyKey)}-mini-chart`,
      avgId: `${p}${stem}AvgReturn`,
      maxId: `${p}${stem}MaxReturn`,
      minId: `${p}${stem}MinReturn`,
      clusterId: `${p}${stem}RangeCluster`,
      plotId: `${p}${stem}SparkPlot`,
      key: s.historyKey,
      color: s.color,
      name: s.label,
    };
  });
}

function setPctText(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = value == null || Number.isNaN(value) ? '—' : formatPct1(value);
}

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
let lastPrefix = '';
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

export function resizeMiniCharts(idPrefix = lastPrefix) {
  for (const cfg of miniChartConfigs(idPrefix)) {
    const canvas = document.getElementById(cfg.canvasId);
    Chart.getChart(canvas)?.resize();
  }
}

function scheduleResize() {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => resizeMiniCharts(lastPrefix), 100);
}

export function setupMiniChartResizeHandling(root = document) {
  window.addEventListener('resize', scheduleResize);
  const allocationSection = root.querySelector?.('#allocationSparklines')
    || document.getElementById('allocationSparklines');
  if (allocationSection && typeof ResizeObserver !== 'undefined') {
    const observer = new ResizeObserver(scheduleResize);
    observer.observe(allocationSection);
  }
}

export function updateMiniCharts(startYear, endYear, idPrefix = '') {
  lastStartYear = startYear;
  lastEndYear = endYear;
  lastPrefix = idPrefix;
  const series = getMiniChartSeries(startYear, endYear);
  const inflationKey = INFLATION.historyKey;
  for (const cfg of miniChartConfigs(idPrefix)) {
    const range = sparklineRange(series[cfg.key], series[inflationKey]) ?? { min: 0, max: 0 };
    drawMiniChart(
      cfg.canvasId,
      series.years,
      series[cfg.key],
      series[inflationKey],
      cfg.color,
      cfg.name,
      range.min,
      range.max,
    );
    renderSparklineStats(cfg, series[cfg.key], series[inflationKey]);
  }
  return series.years;
}

onThemeChange(() => {
  if (lastStartYear != null && lastEndYear != null) {
    updateMiniCharts(lastStartYear, lastEndYear, lastPrefix);
  }
});
