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

  // In Vite serve, `?worker&inline` must resolve to a blob WorkerWrapper (virtual
  // module), not a `?worker_file` module Worker — the latter shares the page ESM
  // cache and can hang after HMR until the browser process is killed.
  const workerImport = await page.evaluate(async () => {
    const text = await (await fetch('/src/main.js')).text();
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
