import { test, expect } from '@playwright/test';

// Goal Seek ("Find Best Plan") is on out of the box; these specs exercise a
// plain simulation run, so switch it off first (clicking the toggle also
// detaches the risk preset, which is fine here).
async function disableGoalSeek(page) {
  await page.waitForFunction(() => window.__TEST_HOOKS__ && window.__TEST_HOOKS__.initComplete);
  await page.click('label:has(#goalSeekMode)');
  await expect(page.locator('#runButton')).toHaveText('Run Simulation');
}

async function runDeterministicSim(page, { numSimulations = '100' } = {}) {
  await page.fill('#startBalance', '2000');
  await page.fill('#horizonMinusYears', '0');
  await page.fill('#horizonPlusYears', '0');
  await page.click('summary:has-text("Advanced simulation settings")');
  await page.fill('#numYears', '30');
  await page.fill('#numSimulations', numSimulations);
  await page.fill('#randomSeed', '12345');
  await page.click('#runButton');
  await expect(page.locator('#resultsSection')).toBeVisible();
}

test('Charts receive the expected data arrays after a run', async ({ page }) => {
  await page.goto('/');
  await disableGoalSeek(page);
  await runDeterministicSim(page);

  await page.waitForFunction(() => {
    const hooks = window.__TEST_HOOKS__;
    if (!hooks || !hooks.surfaceChart) return false;
    const opt = hooks.surfaceChart.getOption();
    const pathLen = (opt?.series || [])
      .filter((s) => typeof s.name === 'string' && s.name.startsWith('paths'))
      .reduce((n, s) => n + (s.data?.length || 0), 0);
    return pathLen > 0;
  });

  const chartData = await page.evaluate(() => {
    const hooks = window.__TEST_HOOKS__;
    const opt = hooks.surfaceChart?.getOption();
    const pathSeries = (opt?.series || []).filter(
      (s) => typeof s.name === 'string' && s.name.startsWith('paths'),
    );
    return {
      balanceDataLength: hooks.balanceChart?.data.datasets[0]?.data?.length,
      withdrawalDataLength: hooks.withdrawalChart?.data.datasets[0]?.data?.length,
      surfaceDataLength: pathSeries.reduce((n, s) => n + (s.data?.length || 0), 0),
      rawSeriesName: pathSeries[0]?.name,
    };
  });

  expect(chartData.balanceDataLength).toBe(31);
  expect(chartData.withdrawalDataLength).toBe(30);
  expect(chartData.rawSeriesName).toMatch(/^paths/);
  // Surface: 200 columns × (30 years + 1), split across per-year series
  expect(chartData.surfaceDataLength).toBe(6200);
});

test('3D surface drill-down updates title and returns to overview', async ({ page }) => {
  await page.goto('/');
  await disableGoalSeek(page);
  await runDeterministicSim(page, { numSimulations: '1000' });

  await page.waitForFunction(() => {
    const hooks = window.__TEST_HOOKS__;
    return hooks?.surfaceChart && hooks?.enterSurfaceDrilldown;
  });

  await expect(page.locator('#surfaceChartTitle')).toHaveText('Explore specific paths');

  const drillState = await page.evaluate(() => {
    window.__TEST_HOOKS__.enterSurfaceDrilldown(50);
    return {
      viewMode: window.__TEST_HOOKS__.surfaceViewMode(),
      title: document.getElementById('surfaceChartTitle')?.textContent?.trim(),
    };
  });
  expect(drillState.viewMode).toBe('drilldown');
  expect(drillState.title).toMatch(/^Explore paths near P/);

  const restored = await page.evaluate(() => {
    window.__TEST_HOOKS__.exitSurfaceDrilldown();
    return {
      viewMode: window.__TEST_HOOKS__.surfaceViewMode(),
      title: document.getElementById('surfaceChartTitle')?.textContent?.trim(),
    };
  });
  expect(restored.viewMode).toBe('overview');
  expect(restored.title).toBe('Explore specific paths');
});

test('Withdrawal heatmap renders after a run', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/');
  await disableGoalSeek(page);
  await runDeterministicSim(page);

  await page.waitForFunction(() => window.__TEST_HOOKS__?.withdrawalHeatmap);
  await expect(page.locator('#withdrawalHeatmapCanvas')).toBeVisible();

  const shape = await page.evaluate(() => window.__TEST_HOOKS__.withdrawalHeatmap());
  expect(shape.numYears).toBeGreaterThanOrEqual(30);
  expect(shape.encoding).toBe('plan');
  expect(shape.numCols).toBeGreaterThan(0);
});
