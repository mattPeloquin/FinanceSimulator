import { test, expect } from '@playwright/test';

const CATEGORIES = [
  { avg: 'usLgGrowthAvgReturn', max: 'usLgGrowthMaxReturn', min: 'usLgGrowthMinReturn' },
  { avg: 'usLgValueAvgReturn', max: 'usLgValueMaxReturn', min: 'usLgValueMinReturn' },
  { avg: 'usSmMidAvgReturn', max: 'usSmMidMaxReturn', min: 'usSmMidMinReturn' },
  { avg: 'exUsAvgReturn', max: 'exUsMaxReturn', min: 'exUsMinReturn' },
  { avg: 'bondAvgReturn', max: 'bondMaxReturn', min: 'bondMinReturn' },
  { avg: 'cashAvgReturn', max: 'cashMaxReturn', min: 'cashMinReturn' },
];

test('asset allocation shows real avg and sparkline min/max for the year range', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.__TEST_HOOKS__ && window.__TEST_HOOKS__.initComplete);

  if (!(await page.locator('#section-investment').evaluate((el) => el.open))) {
    await page.click('#section-investment > summary');
  }
  await expect(page.locator('#section-investment')).toHaveAttribute('open', '');

  for (const { avg, max, min } of CATEGORIES) {
    for (const id of [avg, max, min]) {
      const el = page.locator(`#${id}`);
      await expect(el).toBeVisible();
      await expect(el).not.toHaveText('—');
      await expect(el).toHaveText(/^-?\d+(\.\d)?$/);
    }
  }

  const growthAvg = page.locator('#usLgGrowthAvgReturn');
  const growthMax = page.locator('#usLgGrowthMaxReturn');
  const growthMin = page.locator('#usLgGrowthMinReturn');
  const initialAvg = await growthAvg.textContent();
  const initialMax = await growthMax.textContent();
  const initialMin = await growthMin.textContent();

  // Narrow the historical window; stats should recompute.
  await page.fill('#startYear', '2000');
  await page.fill('#endYear', '2010');
  await page.press('#endYear', 'Tab');

  await expect(growthAvg).not.toHaveText(initialAvg, { timeout: 5000 });
  await expect(growthAvg).toHaveText(/^-?\d+(\.\d)?$/);
  await expect(growthMax).toHaveText(/^-?\d+(\.\d)?$/);
  await expect(growthMin).toHaveText(/^-?\d+(\.\d)?$/);

  // Avg, sparkline zero-axis, and min/max pair share the % field vertical center.
  // Digits of +/− min/max line up via a hanging-minus slot.
  const layout = await page.evaluate(() => {
    const avg = document.getElementById('usLgGrowthAvgReturn');
    const pctInput = document.getElementById('usLgGrowthAllocation');
    const chart = document.getElementById('us-lg-growth-mini-chart');
    const max = document.getElementById('usLgGrowthMaxReturn');
    const min = document.getElementById('usLgGrowthMinReturn');
    const cluster = document.getElementById('usLgGrowthRangeCluster');
    const avgBox = avg.getBoundingClientRect();
    const pctBox = pctInput.getBoundingClientRect();
    const chartBox = chart.getBoundingClientRect();
    const maxBox = max.getBoundingClientRect();
    const minBox = min.getBoundingClientRect();
    const clusterBox = cluster.getBoundingClientRect();
    const pctCenter = pctBox.top + pctBox.height / 2;
    const avgCenter = avgBox.top + avgBox.height / 2;
    const axisCenter = (maxBox.bottom + minBox.top) / 2;
    const maxDigitsLeft = maxBox.left;
    const minDigitsLeft = minBox.left;
    return {
      avgLeftOfChart: avgBox.right <= chartBox.left + 1,
      chartLeftOfMax: chartBox.right <= maxBox.left + 1,
      avgCenteredOnPct: Math.abs(avgCenter - pctCenter) < 4,
      axisNearPctCenter: Math.abs(axisCenter - pctCenter) < 4,
      clusterNearPctCenter: Math.abs(clusterBox.top + clusterBox.height / 2 - pctCenter) < 4,
      avgIsGray: avg.closest('p')?.className.includes('text-theme-faint') === true,
      minMaxClose: minBox.top - maxBox.bottom < 20,
      digitsLineUp: Math.abs(maxDigitsLeft - minDigitsLeft) < 2,
      maxHasPct: max.parentElement?.textContent?.includes('%') === true,
      minHasPct: min.parentElement?.textContent?.includes('%') === true,
    };
  });
  expect(layout.avgLeftOfChart).toBe(true);
  expect(layout.chartLeftOfMax).toBe(true);
  expect(layout.avgCenteredOnPct).toBe(true);
  expect(layout.axisNearPctCenter).toBe(true);
  expect(layout.clusterNearPctCenter).toBe(true);
  expect(layout.avgIsGray).toBe(true);
  expect(layout.minMaxClose).toBe(true);
  expect(layout.digitsLineUp).toBe(true);
  expect(layout.maxHasPct).toBe(true);
  expect(layout.minHasPct).toBe(true);

  await expect(page.locator('#section-investment').getByText('Avg', { exact: true })).toHaveCount(0);

  // Restore the default year range.
  await page.fill('#startYear', '1960');
  await page.fill('#endYear', '2025');
  await page.press('#endYear', 'Tab');
  await expect(growthAvg).toHaveText(initialAvg, { timeout: 5000 });
  await expect(growthMax).toHaveText(initialMax);
  await expect(growthMin).toHaveText(initialMin);
});
