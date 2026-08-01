import { test, expect } from '@playwright/test';

async function openRothConvert(page) {
  await page.waitForFunction(() => window.__TEST_HOOKS__ && window.__TEST_HOOKS__.initComplete);
  await page.click('#feature-more-button');
  await page.click('#more-item-roth-convert');
  await expect(page.locator('#feature-roth-convert')).toBeVisible();
  await expect(page.locator('#feature-more-button')).toContainText('Roth Convert');
}

test('Roth Convert smoke: More → run → response chart', async ({ page }) => {
  test.slow();
  await page.goto('/');
  await openRothConvert(page);

  await expect(page.locator('#roth-convert-run')).toBeVisible();
  await page.selectOption('#roth-convert-paths', '200');
  await page.fill('#roth-convert-years', '8');

  await page.click('#roth-convert-run');
  await expect(page.locator('#roth-convert-results-section')).toBeVisible({ timeout: 120_000 });
  await expect(page.locator('#roth-convert-loading')).toBeHidden();
  await expect(page.locator('#roth-convert-response-chart')).toBeVisible();

  const box = await page.locator('#roth-convert-response-chart').boundingBox();
  expect(box).toBeTruthy();
  expect(box.width).toBeGreaterThan(10);
  expect(box.height).toBeGreaterThan(10);

  await expect(page.locator('#roth-convert-summary')).not.toBeEmpty();
  await expect(page.locator('#roth-convert-year-table')).not.toBeEmpty();
});
