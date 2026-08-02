import { test, expect } from '@playwright/test';

test('Accumulate run paints growth cone', async ({ page }) => {
  test.slow();

  await page.goto('/');
  await page.waitForFunction(() => window.__TEST_HOOKS__ && window.__TEST_HOOKS__.initComplete);

  await page.click('#tab-accumulate');
  await expect(page.locator('#feature-accumulate')).toBeVisible();
  await expect(page.locator('#accumulate-run')).toBeVisible();
  await expect(page.locator('#accumulate-run')).toHaveText('Run Simulation');
  await expect(page.locator('#accumulate-preset-control')).toBeVisible();
  // Easy Mode starts attached (Steady Saver); editing inputs below detaches it.
  await expect(page.locator('#accumulate-preset-active')).toBeChecked();

  // Keep the smoke run snappy: short horizon, few paths, skip weight explore.
  await page.fill('#accumulate-num-years', '8');
  await page.selectOption('#accumulate-paths', '500');
  await page.selectOption('#accumulate-sweep-paths', '100');
  await page.locator('#accumulate-explore-weights').uncheck();
  await expect(page.locator('#accumulate-preset-active')).not.toBeChecked();

  await page.click('#accumulate-run');
  await expect(page.locator('#accumulate-results-section')).toBeVisible({ timeout: 120_000 });
  await expect(page.locator('#accumulate-loading')).toBeHidden();

  const box = await page.locator('#accumulate-cone-chart').boundingBox();
  expect(box).toBeTruthy();
  expect(box.width).toBeGreaterThan(10);
  expect(box.height).toBeGreaterThan(10);
  // Chart height is constrained by the fixed h-72 wrapper (not unbounded).
  expect(box.height).toBeLessThan(400);

  await expect(page.locator('#accumulate-ending-summary')).not.toBeEmpty();
});
