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

test('3D surface drill-down updates title and axis, then returns to overview', async ({ page }) => {
  await page.goto('/');

  await page.click('summary:has-text("Advanced simulation settings")');
  await page.fill('#numYears', '30');
  await page.fill('#numSimulations', '1000');
  await page.fill('#randomSeed', '12345');

  await page.click('#runButton');
  await expect(page.locator('#resultsSection')).toBeVisible();

  await page.waitForFunction(() => {
    const hooks = window.__TEST_HOOKS__;
    return hooks?.surfaceChart && hooks?.enterSurfaceDrilldown;
  });

  const overviewTitle = await page.locator('#surfaceChartTitle').textContent();
  expect(overviewTitle?.trim()).toBe('Explore specific paths');

  const drillState = await page.evaluate(() => {
    window.__TEST_HOOKS__.enterSurfaceDrilldown(50);
    const opt = window.__TEST_HOOKS__.surfaceChart.getOption();
    return {
      viewMode: window.__TEST_HOOKS__.surfaceViewMode(),
      title: document.getElementById('surfaceChartTitle')?.textContent?.trim(),
      xAxisName: opt?.xAxis3D?.[0]?.name,
      firstLabel: window.__TEST_HOOKS__.surfaceXAxisLabel(0),
      lastLabel: window.__TEST_HOOKS__.surfaceXAxisLabel(199),
      surfaceLen: opt?.series?.find((s) => s.name === 'paths')?.data?.length ?? 0,
    };
  });

  expect(drillState.viewMode).toBe('drilldown');
  expect(drillState.title).not.toBe('Explore specific paths');
  expect(drillState.title).toMatch(/^Explore paths near P/);
  expect(drillState.xAxisName).toMatch(/^Percentile \(near P/);
  expect(drillState.lastLabel).not.toBe('P60');
  expect(drillState.surfaceLen).toBe(6200);

  const restored = await page.evaluate(() => {
    window.__TEST_HOOKS__.exitSurfaceDrilldown();
    return {
      viewMode: window.__TEST_HOOKS__.surfaceViewMode(),
      title: document.getElementById('surfaceChartTitle')?.textContent?.trim(),
      firstLabel: window.__TEST_HOOKS__.surfaceXAxisLabel(0),
      lastLabel: window.__TEST_HOOKS__.surfaceXAxisLabel(199),
    };
  });

  expect(restored.viewMode).toBe('overview');
  expect(restored.title).toBe('Explore specific paths');
  expect(restored.firstLabel).toBe('P5');
  expect(restored.lastLabel).toBe('P60');
});

test('3D surface double-click triggers drill-down', async ({ page }) => {
  await page.goto('/');

  await page.click('summary:has-text("Advanced simulation settings")');
  await page.fill('#numYears', '30');
  await page.fill('#numSimulations', '1000');
  await page.fill('#randomSeed', '12345');

  await page.click('#runButton');
  await expect(page.locator('#resultsSection')).toBeVisible();

  await page.waitForFunction(() => window.__TEST_HOOKS__?.surfaceChart);

  await page.evaluate(() => {
    const chart = window.__TEST_HOOKS__.surfaceChart;
    const data = chart.getOption().series.find((s) => s.name === 'paths')?.data;
    const point = data?.[Math.floor(data.length / 2)];
    if (!point) throw new Error('no surface point');
    const value = Array.isArray(point) ? point : point.value;
    const event = { value, seriesName: 'paths' };
    chart.trigger('click', event);
    chart.trigger('click', event);
  });

  await expect(page.locator('#surfaceChartTitle')).not.toHaveText('Explore specific paths');
  expect(await page.evaluate(() => window.__TEST_HOOKS__.surfaceViewMode())).toBe('drilldown');
});
