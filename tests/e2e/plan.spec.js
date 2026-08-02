import { test, expect } from '@playwright/test';

async function openPlan(page) {
  await page.waitForFunction(() => window.__TEST_HOOKS__ && window.__TEST_HOOKS__.initComplete);
  await page.click('#feature-more-button');
  await page.click('#more-item-plan');
  await expect(page.locator('#feature-plan')).toBeVisible();
  await expect(page.locator('#feature-more-button')).toContainText('Lifetime Plan');
}

test('Lifetime Plan smoke: More → Accumulate source → refresh → net worth chart', async ({ page }) => {
  test.slow();
  await page.goto('/');
  await openPlan(page);

  await expect(page.locator('#plan-run')).toBeVisible();
  await expect(page.locator('#plan-sources-list [data-plan-source-id]')).toHaveCount(1);
  await expect(page.locator('#plan-sources-list [data-field="feature"]')).toHaveValue('accumulate');

  // Remove must clear the row (empty list is allowed); then add one back for the run.
  await page.click('#plan-sources-list [data-action="remove"]');
  await expect(page.locator('#plan-sources-list [data-plan-source-id]')).toHaveCount(0);
  await page.click('#plan-add-source');
  await expect(page.locator('#plan-sources-list [data-plan-source-id]')).toHaveCount(1);

  await page.click('#plan-run');
  await expect(page.locator('#plan-results-section')).toBeVisible({ timeout: 90_000 });
  await expect(page.locator('#plan-loading')).toBeHidden();
  await expect(page.locator('#plan-year-table table tbody tr')).not.toHaveCount(0);
  await expect(page.locator('#plan-summary')).not.toBeEmpty();

  // Default view is net worth.
  await expect(page.locator('#plan-view-networth-panel')).toBeVisible();
  const nwBox = await page.locator('#plan-networth-chart').boundingBox();
  expect(nwBox).toBeTruthy();
  expect(nwBox.width).toBeGreaterThan(10);
  expect(nwBox.height).toBeGreaterThan(10);

  // Cashflow view still available — Accumulate contributions must be non-zero.
  await page.click('#plan-view-cashflow');
  await expect(page.locator('#plan-view-cashflow-panel')).toBeVisible();
  const stackBox = await page.locator('#plan-stack-chart').boundingBox();
  expect(stackBox).toBeTruthy();
  expect(stackBox.width).toBeGreaterThan(10);
  await expect(page.locator('#plan-summary')).toContainText(/Total net cashflow \$-?[1-9]/);
  await expect(page.locator('#plan-totals')).toContainText(/Accumulate:\s*\$-?[1-9]/);
});
