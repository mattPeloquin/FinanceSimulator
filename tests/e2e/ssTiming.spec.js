import { test, expect } from '@playwright/test';

async function openSsTiming(page) {
  await page.waitForFunction(() => window.__TEST_HOOKS__ && window.__TEST_HOOKS__.initComplete);
  await page.click('#feature-more-button');
  await page.click('#more-item-ss-timing');
  await expect(page.locator('#feature-ss-timing')).toBeVisible();
  await expect(page.locator('#feature-more-button')).toContainText('Social Security');
}

test('Social Security smoke: More → run → strategy chart', async ({ page }) => {
  test.slow();
  await page.goto('/');
  await openSsTiming(page);

  await expect(page.locator('#ss-timing-run')).toBeVisible();
  await page.selectOption('#ss-timing-paths', '200');
  await page.fill('#ss-timing-bridge-balance', '100000');

  await page.click('#ss-timing-run');
  await expect(page.locator('#ss-timing-results-section')).toBeVisible({ timeout: 120_000 });
  await expect(page.locator('#ss-timing-loading')).toBeHidden();
  await expect(page.locator('#ss-timing-strategy-chart')).toBeVisible();

  const box = await page.locator('#ss-timing-strategy-chart').boundingBox();
  expect(box).toBeTruthy();
  expect(box.width).toBeGreaterThan(10);
  expect(box.height).toBeGreaterThan(10);

  await expect(page.locator('#ss-timing-summary')).not.toBeEmpty();
  await expect(page.locator('#ss-timing-grid')).not.toBeEmpty();
  await expect(page.locator('#ss-timing-mc')).not.toBeEmpty();
});
