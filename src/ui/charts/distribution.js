// Histogram of average annual real returns.
import { Chart } from './chartSetup.js';

let distributionChart = null;

// `histogram` is the precomputed { labels, bins, binSize } from the worker.
export function drawDistributionChart(histogram) {
  const ctx = document.getElementById('resultsChart').getContext('2d');
  const { labels, bins, binSize } = histogram;

  if (distributionChart) distributionChart.destroy();
  distributionChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels.map((l) => (l * 100).toFixed(1) + '%'),
      datasets: [
        {
          label: 'Frequency of Outcomes',
          data: bins,
          backgroundColor: 'rgba(79, 70, 229, 0.6)',
          borderColor: 'rgba(79, 70, 229, 1)',
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
        x: { title: { display: true, text: 'Average Annual Real Return' }, ticks: { autoSkip: true, maxTicksLimit: 10 } },
        y: { title: { display: true, text: 'Frequency' }, beginAtZero: true },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
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
