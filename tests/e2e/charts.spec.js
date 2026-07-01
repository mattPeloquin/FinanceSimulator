import { test, expect } from '@playwright/test';

test('Charts receive the expected data arrays (robust validation)', async ({ page }) => {
  await page.goto('/');

  // Override inputs for a predictable run. 
  // We specify a fixed seed and 1 simulation block to keep lengths deterministic.
  // numSimulations is inside an advanced details block, open it first
  await page.click('summary:has-text("Advanced simulation settings")');
  await page.fill('#numYears', '30');
  await page.fill('#numSimulations', '100');
  await page.fill('#randomSeed', '12345');

  // Trigger the run
  await page.click('#runButton');

  // Wait for the results block
  await expect(page.locator('#resultsSection')).toBeVisible();

  // Evaluate the internal chart hooks
  // Echats can render asynchronously, wait until data populates
  await page.waitForFunction(() => {
    const hooks = window.__TEST_HOOKS__;
    if (!hooks || !hooks.surfaceChart) return false;
    const opt = hooks.surfaceChart.getOption();
    const seriesData = opt?.series?.find(s => s.name === 'paths' || s.name === 'focus');
    return seriesData?.data?.length > 0;
  });

  const chartData = await page.evaluate(() => {
    const hooks = window.__TEST_HOOKS__;
    if (!hooks) return null;
    
    // Echats stores data inside option.series for the 3d chart. 
    // We expect series 'dim' or 'focus' (if pinned) with the full data.
    // 'dim' has the full set of points across all columns when not pinned.
    const opt = hooks.surfaceChart?.getOption();
    const seriesData = opt?.series?.find(s => s.name === 'paths' || s.name === 'focus');
    const surfaceLen = seriesData?.data?.length || 0;

    return {
      balanceDataLength: hooks.balanceChart?.data.datasets[0]?.data?.length,
      withdrawalDataLength: hooks.withdrawalChart?.data.datasets[0]?.data?.length,
      surfaceDataLength: surfaceLen,
      rawSeriesName: seriesData?.name
    };
  });

  expect(chartData).not.toBeNull();
  
  // Balance chart has N+1 points (includes Year 0)
  expect(chartData.balanceDataLength).toBe(31);
  
  // Withdrawal chart has N points
  expect(chartData.withdrawalDataLength).toBe(30);

  // Surface chart data length equals Num Columns (always 200) * (Num Years + 1)
  // 200 * 31 points = 6200
  // Note: we have two series, paths and focus. paths should have the 6200 points.
  expect(chartData.rawSeriesName).toMatch(/^(paths|focus)$/);
  expect(chartData.surfaceDataLength).toBe(6200);
});
