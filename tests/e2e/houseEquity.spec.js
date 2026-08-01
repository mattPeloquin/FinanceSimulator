import { test, expect } from '@playwright/test';

async function openHouseEquity(page) {
  await page.waitForFunction(() => window.__TEST_HOOKS__ && window.__TEST_HOOKS__.initComplete);
  await page.click('#feature-more-button');
  await page.click('#more-item-house-equity');
  await expect(page.locator('#feature-house-equity')).toBeVisible();
  await expect(page.locator('#feature-more-button')).toContainText('House Equity');
}

test('House Equity smoke: More → run → comparison chart', async ({ page }) => {
  test.slow();
  await page.goto('/');
  await openHouseEquity(page);

  await expect(page.locator('#house-equity-run')).toBeVisible();
  await page.selectOption('#house-equity-paths', '200');
  await page.fill('#house-equity-years', '10');
  await page.fill('#house-equity-access-year', '2');

  await page.click('#house-equity-run');
  await expect(page.locator('#house-equity-results-section')).toBeVisible({ timeout: 120_000 });
  await expect(page.locator('#house-equity-loading')).toBeHidden();
  await expect(page.locator('#house-equity-compare-chart')).toBeVisible();

  const box = await page.locator('#house-equity-compare-chart').boundingBox();
  expect(box).toBeTruthy();
  expect(box.width).toBeGreaterThan(10);
  expect(box.height).toBeGreaterThan(10);

  await expect(page.locator('#house-equity-summary')).not.toBeEmpty();
  await expect(page.locator('#house-equity-rank-table tbody tr')).toHaveCount(5);
});
