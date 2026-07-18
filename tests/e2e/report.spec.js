import { test, expect } from '@playwright/test';

async function disableGoalSeek(page) {
  await page.waitForFunction(() => window.__TEST_HOOKS__ && window.__TEST_HOOKS__.initComplete);
  await page.click('label:has(#goalSeekMode)');
  await expect(page.locator('#runButton')).toHaveText('Run Simulation');
}

test('Plan Snapshot report opens and updates with percentile sliders', async ({ page }) => {
  test.slow();

  await page.goto('/');
  await disableGoalSeek(page);

  await page.fill('#startBalance', '2000');
  await page.press('#startBalance', 'Enter');
  await page.locator('#section-advanced').evaluate((el) => { el.open = true; });
  await page.fill('#numSimulations', '300');

  await page.click('#runButton');
  await expect(page.locator('#resultsSection')).toBeVisible({ timeout: 60_000 });

  const details = page.locator('#details-plan-report');
  await expect(details).toBeAttached();
  await expect(details).not.toHaveAttribute('open', '');

  await page.locator('summary:has-text("Plan Snapshot")').click();
  await expect(details).toHaveAttribute('open', '');

  const verdict = page.locator('#reportVerdictText');
  await expect(verdict).not.toBeEmpty();
  await expect(verdict).toContainText(/simulations|deplet/i);

  const bandCanvas = page.locator('#reportBandCanvas');
  await expect(bandCanvas).toBeVisible();
  const box = await bandCanvas.boundingBox();
  expect(box).toBeTruthy();
  expect(box.width).toBeGreaterThan(100);
  expect(box.height).toBeGreaterThan(50);

  await expect(page.locator('#reportBandLabel')).toContainText('P10–P90');

  await page.locator('#reportPxLow').fill('25');
  await expect(page.locator('#reportPxLowLabel')).toHaveText('P25');
  await expect(page.locator('#reportBandLabel')).toContainText('P25');

  await expect(page.locator('#reportExportPdf')).toBeVisible();
  await expect(page.locator('#reportNextMoves')).toHaveCount(0);
});
