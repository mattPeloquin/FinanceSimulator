// Register the Chart.js components we use, once.
import { Chart, registerables } from 'chart.js';

Chart.register(...registerables);

export { Chart };
