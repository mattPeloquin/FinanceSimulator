import { test, expect } from '@playwright/test';

test('Accumulation run paints growth cone', async ({ page }) => {
  test.slow();

  await page.goto('/');
  await page.waitForFunction(() => window.__TEST_HOOKS__ && window.__TEST_HOOKS__.initComplete);

  await page.click('#tab-accumulation');
  await expect(page.locator('#feature-accumulation')).toBeVisible();
  await expect(page.locator('#accumulation-run')).toBeVisible();
  await expect(page.locator('#accumulation-run')).toHaveText('Run Simulation');
  await expect(page.locator('#accumulation-preset-control')).toBeVisible();
  // Easy Mode starts attached (Steady Saver); editing inputs below detaches it.
  await expect(page.locator('#accumulation-preset-active')).toBeChecked();

  // Keep the smoke run snappy: short horizon, few paths, skip weight explore.
  await page.fill('#accumulation-num-years', '8');
  await page.selectOption('#accumulation-paths', '500');
  await page.selectOption('#accumulation-sweep-paths', '100');
  await page.locator('#accumulation-explore-weights').uncheck();
  await expect(page.locator('#accumulation-preset-active')).not.toBeChecked();

  await page.click('#accumulation-run');
  await expect(page.locator('#accumulation-results-section')).toBeVisible({ timeout: 120_000 });
  await expect(page.locator('#accumulation-loading')).toBeHidden();

  const box = await page.locator('#accumulation-cone-chart').boundingBox();
  expect(box).toBeTruthy();
  expect(box.width).toBeGreaterThan(10);
  expect(box.height).toBeGreaterThan(10);
  // Chart height is constrained by the fixed h-72 wrapper (not unbounded).
  expect(box.height).toBeLessThan(400);

  await expect(page.locator('#accumulation-ending-summary')).not.toBeEmpty();
});
