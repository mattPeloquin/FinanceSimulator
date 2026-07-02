// Histogram of average annual real returns.
import { Chart } from './chartSetup.js';
import { getChartTheme, chartJsTooltip } from './chartTheme.js';
import { onThemeChange } from '../theme.js';

let distributionChart = null;
let lastHistogram = null;

export function drawDistributionChart(histogram) {
  lastHistogram = histogram;
  const ctx = document.getElementById('resultsChart').getContext('2d');
  const { labels, bins, binSize } = histogram;
  const theme = getChartTheme();

  if (distributionChart) distributionChart.destroy();
  distributionChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels.map((l) => (l * 100).toFixed(1) + '%'),
      datasets: [
        {
          label: 'Frequency of Outcomes',
          data: bins,
          backgroundColor: theme.accentFill,
          borderColor: theme.accentStroke,
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
          title: { display: true, text: 'Average Annual Real Return', color: theme.axisTitle },
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
          },
        },
      },
    },
  });
}

onThemeChange(() => {
  if (lastHistogram) drawDistributionChart(lastHistogram);
});
