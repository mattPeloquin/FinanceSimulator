// Linked balance bar chart: one bar per year of a single simulation path,
// height = portfolio balance, color = that year's market return (same red/green
// ramp as the 3D surface). Designed to sit under a withdrawal line chart and
// stay in hover-lockstep with it: hovering a bar drives the line chart's
// tooltip, and the line chart's own hover highlights the matching bar.
// Shared by the 3D chart's sample-run dialog and the sequence-risk scatter's
// drill-down.
import { Chart } from './chartSetup.js';
import { getChartTheme } from './chartTheme.js';
import { formatK } from '../format.js';
import { returnColorWithAlpha } from './returnColors.js';

const BAR_ALPHA = 0.72; // non-highlighted bars; the hovered bar goes fully opaque

// `canvas` hosts the bar chart; `getLineChart` resolves the withdrawal line
// chart above it at call time (it may be re-created between selections).
// The returned handle expects a series with { labels, balanceData, returnData }.
export function createLinkedBalanceBars(canvas, getLineChart) {
  let chart = null;
  let series = null;
  let highlightIndex = -1;

  const barColors = () =>
    series.returnData.map((ret, i) => returnColorWithAlpha(ret, i === highlightIndex ? 1 : BAR_ALPHA));

  // Drives the withdrawal line chart's own tooltip from a hover on the balance
  // bar chart, so the two stay in lockstep instead of showing separate tooltips.
  function showLineTooltipAtIndex(index) {
    const lineChart = getLineChart();
    if (!lineChart?.tooltip) return;
    if (index < 0) {
      lineChart.setActiveElements([]);
      lineChart.tooltip.setActiveElements([], { x: 0, y: 0 });
      lineChart.update('none');
      return;
    }
    const active = lineChart.data.datasets
      .map((ds, datasetIndex) => ({ datasetIndex, value: ds.data[index] }))
      .filter(({ value }) => value != null)
      .map(({ datasetIndex }) => ({ datasetIndex, index }));
    if (!active.length) return;
    const point = lineChart.getDatasetMeta(active[0].datasetIndex).data[index];
    const position = point ? { x: point.x, y: point.y } : { x: 0, y: 0 };
    lineChart.setActiveElements(active);
    lineChart.tooltip.setActiveElements(active, position);
    lineChart.update('none');
  }

  function setHighlight(index) {
    if (index === highlightIndex) return;
    highlightIndex = index;
    if (!chart || !series) return;
    chart.data.datasets[0].backgroundColor = barColors();
    chart.update('none');
  }

  // Belt-and-suspenders reset used on top of Chart.js's own hover handling:
  // fires on 'mouseleave' of either canvas so the tooltip/highlight can never
  // get stuck on when the pointer leaves the chart area (e.g. skipping between
  // the two stacked canvases faster than a 'mousemove' can land on the other
  // one first).
  function reset() {
    setHighlight(-1);
    showLineTooltipAtIndex(-1);
  }

  function barOptions() {
    const theme = getChartTheme();
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: {
          title: { display: true, text: 'Year', color: theme.axisTitle },
          ticks: { color: theme.axisTick },
          grid: { display: false },
        },
        y: {
          beginAtZero: true,
          title: { display: true, text: 'Balance ($)', color: theme.axisTitle },
          ticks: { callback: (v) => formatK(v), maxTicksLimit: 4, color: theme.axisTick },
          grid: { color: theme.gridLine },
        },
      },
      plugins: {
        legend: { display: false },
        // The balance chart shows no tooltip of its own; hovering it drives the
        // full tooltip on the withdrawal line chart above (see onHover below).
        tooltip: { enabled: false },
      },
      onHover: (_evt, activeElements) => {
        const index = activeElements.length > 0 ? activeElements[0].index : -1;
        setHighlight(index);
        showLineTooltipAtIndex(index);
      },
    };
  }

  function setSeries(nextSeries) {
    series = nextSeries;
    highlightIndex = -1;
    if (chart) {
      chart.data.labels = series.labels;
      chart.data.datasets[0].data = series.balanceData;
      chart.data.datasets[0].backgroundColor = barColors();
      Object.assign(chart.options, barOptions());
      chart.update();
    } else {
      chart = new Chart(canvas.getContext('2d'), {
        type: 'bar',
        data: {
          labels: series.labels,
          datasets: [{
            label: 'Balance',
            data: series.balanceData,
            backgroundColor: barColors(),
            borderWidth: 0,
            borderRadius: 2,
          }],
        },
        options: barOptions(),
      });
      canvas.addEventListener('mouseleave', reset);
    }
  }

  function applyTheme() {
    if (!chart || !series) return;
    Object.assign(chart.options, barOptions());
    chart.data.datasets[0].backgroundColor = barColors();
    chart.update('none');
  }

  return { setSeries, setHighlight, reset, applyTheme };
}
