import { test, expect } from '@playwright/test';

// Goal Seek is on by default; these specs need a plain Run Simulation.
async function disableGoalSeek(page) {
  await page.waitForFunction(() => window.__TEST_HOOKS__ && window.__TEST_HOOKS__.initComplete);
  await page.click('label:has(#goalSeekMode)');
  await expect(page.locator('#runButton')).toHaveText('Run Simulation');
}

test('High core-usage parallel workers complete a simulation in dev', async ({ page }) => {
  test.slow();
  await page.goto('/');
  await disableGoalSeek(page);

  // Defaults leave start balance blank (Easy Mode); the run needs a portfolio.
  await page.fill('#startBalance', '2000');

  // In Vite serve, `?worker&inline` must resolve to a blob WorkerWrapper (virtual
  // module), not a `?worker_file` module Worker — the latter shares the page ESM
  // cache and can hang after HMR until the browser process is killed.
  const workerImport = await page.evaluate(async () => {
    // Worker factory lives on the Plan run module (main.js is a thin bootstrap).
    const text = await (await fetch('/src/features/withdraw/run.js')).text();
    const match = text.match(/SimulationWorker from ["']([^"']+)["']/);
    return match ? match[1] : '';
  });
  expect(workerImport).toContain('dev-inline-worker');
  expect(workerImport).not.toContain('worker_file');

  await page.click('#section-advanced > summary');
  await page.selectOption('#parallelCores', 'high');
  await page.fill('#numSimulations', '300');

  await page.click('#runButton');
  await expect(page.locator('#resultsSection')).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('#successRate')).toContainText('%');
  await expect(page.locator('#loadingIndicator')).toBeHidden();
});

test('Withdraw run survives switching to Lab and charts have size on return', async ({ page }) => {
  test.slow();
  await page.goto('/');
  await disableGoalSeek(page);

  await page.fill('#startBalance', '2500');
  await page.locator('#section-advanced').evaluate((el) => { el.open = true; });
  await page.fill('#numSimulations', '800');

  await page.click('#runButton');
  // Leave mid-run so the job keeps going while Lab (under More) is active.
  await page.click('#feature-more-button');
  await page.click('#more-item-sor-lab');
  await expect(page.locator('#feature-sor-lab')).toBeVisible();
  await expect(page.locator('#feature-withdraw')).toBeHidden();
  await expect(page.locator('#tab-withdraw .feature-tab-badge')).toBeVisible({ timeout: 5_000 });

  await page.click('#tab-withdraw');
  await expect(page.locator('#feature-withdraw')).toBeVisible();
  await expect(page.locator('#resultsSection')).toBeVisible({ timeout: 60_000 });

  await page.evaluate(() => {
    const outcomes = document.getElementById('details-simulation-outcomes');
    const timelines = document.getElementById('details-average-timelines');
    if (outcomes) outcomes.open = true;
    if (timelines) timelines.open = true;
  });

  const balanceBox = await page.locator('#balanceChart').boundingBox();
  expect(balanceBox).toBeTruthy();
  expect(balanceBox.width).toBeGreaterThan(10);
  expect(balanceBox.height).toBeGreaterThan(10);
});
