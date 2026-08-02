import { test, expect } from '@playwright/test';

test('asset allocation shows real avg for the year range', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.__TEST_HOOKS__ && window.__TEST_HOOKS__.initComplete);

  if (!(await page.locator('#section-investment').evaluate((el) => el.open))) {
    await page.click('#section-investment > summary');
  }
  await expect(page.locator('#section-investment')).toHaveAttribute('open', '');

  // First registry sleeve’s avg readout (ids are `${domId}AvgReturn` from the panel).
  const sleeveAvg = page.locator('#section-investment [id$="AvgReturn"]').first();
  await expect(sleeveAvg).toBeVisible();
  await expect(sleeveAvg).toHaveText(/^-?\d+(\.\d)?$/);
  const initialAvg = await sleeveAvg.textContent();

  await page.fill('#startYear', '2000');
  await page.fill('#endYear', '2010');
  await page.press('#endYear', 'Tab');

  await expect(sleeveAvg).not.toHaveText(initialAvg, { timeout: 5000 });
  await expect(sleeveAvg).toHaveText(/^-?\d+(\.\d)?$/);
});
