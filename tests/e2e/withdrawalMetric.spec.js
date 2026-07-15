import { test, expect } from '@playwright/test';

// Strips formatK output ("1,234") down to a comparable number.
function parseK(text) {
  return parseFloat((text || '').replace(/[^0-9.-]/g, ''));
}

async function runSimulation(page) {
  await page.click('#runButton');
  await expect(page.locator('#resultsSection')).toBeVisible();
  await expect(page.locator('#medianWithdrawn')).not.toBeEmpty({ timeout: 20000 });
}

// Goal Seek ("Find Best Plan") is on out of the box; these specs exercise a
// plain simulation run, so switch it off first (clicking the toggle also
// detaches the risk preset, which is fine here).
async function disableGoalSeek(page) {
  await page.waitForFunction(() => window.__TEST_HOOKS__ && window.__TEST_HOOKS__.initComplete);
  await page.click('label:has(#goalSeekMode)');
  await expect(page.locator('#runButton')).toHaveText('Run Simulation');
}

// Explicit median/mean metric selections are covered in Vitest
// (resolveWithdrawalMetric / withdrawalMetricLabels). This e2e only checks
// that auto mode flips labels when a horizon range is introduced.
test('Auto metric switches from totals to mean/yr when a horizon range is set', async ({ page }) => {
  test.slow(); // two full simulation runs
  await page.goto('/');
  await disableGoalSeek(page);

  await page.fill('#startBalance', '2000');
  await page.fill('#horizonPlusYears', '0');
  await page.fill('#horizonMinusYears', '0');

  await runSimulation(page);
  await expect(page.locator('#medianWithdrawnLabel')).toHaveText('Median Total Withdrawn');
  await expect(page.locator('#p50WdLabel')).toHaveText('Total Withdrawn');
  await expect(page.locator('#outcomesDescription')).toContainText('ranked by total withdrawn');

  await page.fill('#horizonPlusYears', '5');
  await page.fill('#horizonMinusYears', '5');
  await page.click('#runButton');
  await expect(page.locator('#medianWithdrawnLabel')).toHaveText('Mean Withdrawal / Year', { timeout: 20000 });
  await expect(page.locator('#p50WdLabel')).toHaveText('Mean / Year');
  await expect(page.locator('#outcomesDescription')).toContainText('ranked by mean withdrawal per year');

  const meanPerYear = parseK(await page.locator('#p50Wd').textContent());
  const total = parseK(await page.locator('#p50WdSecondary2').textContent());
  expect(meanPerYear).toBeGreaterThan(0);
  expect(total).toBeGreaterThan(meanPerYear * 10);
});
