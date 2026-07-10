import { test, expect } from '@playwright/test';

async function waitForInit(page) {
  await page.waitForFunction(() => window.__TEST_HOOKS__ && window.__TEST_HOOKS__.initComplete);
}

test('Major Events section supports add, edit, and remove', async ({ page }) => {
  await page.goto('/');
  await waitForInit(page);

  await page.locator('#section-withdrawal > summary').click();
  await page.locator('#details-major-events > summary').click();

  await expect(page.locator('#details-major-events')).toBeVisible();
  await expect(page.locator('#addMajorEvent')).toBeVisible();

  await page.click('#addMajorEvent');
  await expect(page.locator('[data-major-event-row]')).toHaveCount(1);

  await page.fill('[data-major-event-amount]', '250');
  await page.fill('[data-major-event-start]', '5');
  await page.fill('[data-major-event-years]', '');

  await page.click('#addMajorEvent');
  await expect(page.locator('[data-major-event-row]')).toHaveCount(2);

  await page.locator('.remove-major-event').first().click();
  await expect(page.locator('[data-major-event-row]')).toHaveCount(1);

  await expect(page.locator('#baseWithdrawalPreviewChart')).toBeVisible();
});
