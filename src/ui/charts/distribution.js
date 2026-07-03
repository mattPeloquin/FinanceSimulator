// Histograms of average annual and individual year real returns.
import { Chart } from './chartSetup.js';
import { getChartTheme, chartJsTooltip } from './chartTheme.js';
import { onThemeChange, isDarkMode, themeHex, themeRgba } from '../theme.js';
import { closestHistogramBin } from '../../core/statistics.js';

// Reference markers in priority order when two land on the same bin.
const MARKERS = [
  { label: 'Median', colorPath: 'percentile.p50', getValue: (rs) => rs.median },
  { label: 'P5', colorPath: 'percentile.p5', getValue: (rs) => rs.p5 },
  { label: 'P95', colorPath: 'percentile.p60', getValue: (rs) => rs.p95 },
  { label: 'Mean − 1σ', colorPath: 'status.danger', getValue: (rs) => rs.mean - rs.stdDev },
  { label: 'Mean + 1σ', colorPath: 'status.success', getValue: (rs) => rs.mean + rs.stdDev },
];

const avgChartState = { chart: null, histogram: null, returnSummary: null };
const allYearsChartState = { chart: null, histogram: null, returnSummary: null };

function buildBarStyles(histogram, returnSummary, theme) {
  const { labels, bins, binSize } = histogram;
  const n = bins.length;
  const mode = isDarkMode() ? 'dark' : 'light';
  const bg = new Array(n).fill(theme.accentFill);
  const border = new Array(n).fill(theme.accentStroke);
  const markersByBin = Array.from({ length: n }, () => []);
  const colored = new Set();

  for (const marker of MARKERS) {
    const bin = closestHistogramBin(marker.getValue(returnSummary), labels, binSize);
    markersByBin[bin].push(marker.label);
    if (!colored.has(bin)) {
      colored.add(bin);
      bg[bin] = themeRgba(marker.colorPath, mode, 0.75);
      border[bin] = themeHex(marker.colorPath, mode);
    }
  }

  return { bg, border, markersByBin };
}

function renderLegend(legendId) {
  const el = document.getElementById(legendId);
  if (!el) return;
  const mode = isDarkMode() ? 'dark' : 'light';
  el.innerHTML = MARKERS.map(
    (m) =>
      `<span class="inline-flex items-center gap-1.5 text-xs text-theme-faint">` +
      `<span class="inline-block w-3 h-3 rounded-sm shrink-0" style="background:${themeRgba(m.colorPath, mode, 0.75)};border:1px solid ${themeHex(m.colorPath, mode)}"></span>` +
      `${m.label}</span>`,
  ).join('');
}

function renderHistogramChart(canvasId, legendId, xAxisTitle, histogram, returnSummary, state) {
  state.histogram = histogram;
  state.returnSummary = returnSummary;

  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  const { labels, bins, binSize } = histogram;
  const theme = getChartTheme();
  const { bg, border, markersByBin } = buildBarStyles(histogram, returnSummary, theme);

  renderLegend(legendId);

  if (state.chart) state.chart.destroy();
  state.chart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels.map((l) => (l * 100).toFixed(1) + '%'),
      datasets: [
        {
          label: 'Frequency of Outcomes',
          data: bins,
          backgroundColor: bg,
          borderColor: border,
          borderWidth: 1,
          barPercentage: 1.0,
          categoryPercentage: 1.0,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          title: { display: true, text: xAxisTitle, color: theme.axisTitle },
          ticks: { autoSkip: true, maxTicksLimit: 10, color: theme.axisTick },
          grid: { color: theme.gridLine },
        },
        y: {
          title: { display: true, text: 'Frequency', color: theme.axisTitle },
          beginAtZero: true,
          ticks: { color: theme.axisTick },
          grid: { color: theme.gridLine },
        },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          ...chartJsTooltip(theme),
          callbacks: {
            title: (c) => {
              const lo = labels[c[0].dataIndex];
              return `Return: ${(lo * 100).toFixed(1)}% to ${((lo + binSize) * 100).toFixed(1)}%`;
            },
            afterBody: (items) => {
              const markers = markersByBin[items[0].dataIndex];
              if (!markers.length) return [];
              return [`Reference: ${markers.join(', ')}`];
            },
          },
        },
      },
    },
  });
}

export function drawDistributionChart(histogram, returnSummary) {
  renderHistogramChart(
    'resultsChart',
    'returnHistogramLegend',
    'Average Annual Real Return',
    histogram,
    returnSummary,
    avgChartState,
  );
}

export function drawAllYearsDistributionChart(histogram, returnSummary) {
  renderHistogramChart(
    'allYearsChart',
    'allYearsHistogramLegend',
    'Individual Year Real Return',
    histogram,
    returnSummary,
    allYearsChartState,
  );
}

onThemeChange(() => {
  if (avgChartState.histogram && avgChartState.returnSummary) {
    drawDistributionChart(avgChartState.histogram, avgChartState.returnSummary);
  }
  if (allYearsChartState.histogram && allYearsChartState.returnSummary) {
    drawAllYearsDistributionChart(allYearsChartState.histogram, allYearsChartState.returnSummary);
  }
});
