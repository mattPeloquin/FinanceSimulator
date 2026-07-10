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

test('Auto metric switches from totals to mean/yr when a horizon range is set', async ({ page }) => {
  test.slow(); // two full simulation runs
  await page.goto('/');
  await disableGoalSeek(page);

  // Fixed horizon + auto -> lifetime totals everywhere; the outcome cards
  // show the two per-year metrics side by side underneath, median first.
  await runSimulation(page);
  await expect(page.locator('#medianWithdrawnLabel')).toHaveText('Median Total Withdrawn');
  await expect(page.locator('#medianWithdrawnSecondaryLabel')).toHaveText('Median / Year');
  await expect(page.locator('#medianWithdrawnSecondary2Label')).toHaveText('Mean / Year');
  await expect(page.locator('#plannedWithdrawnLabel')).toHaveText('Planned Total Withdrawal');
  await expect(page.locator('#plannedWithdrawnSecondaryLabel')).toHaveText('Median / Year');
  await expect(page.locator('#plannedWithdrawnSecondary2Label')).toHaveText('Mean / Year');
  await expect(page.locator('#p50WdLabel')).toHaveText('Total Withdrawn');
  await expect(page.locator('#p50WdSecondaryLabel')).toHaveText('Median / Year');
  await expect(page.locator('#p50WdSecondary2Label')).toHaveText('Mean / Year');
  await expect(page.locator('#outcomesDescription')).toContainText('ranked by total withdrawn');

  // Enable a +/- horizon range -> auto resolves to mean withdrawal per year.
  await page.fill('#horizonPlusYears', '5');
  await page.fill('#horizonMinusYears', '5');
  await page.click('#runButton');
  await expect(page.locator('#medianWithdrawnLabel')).toHaveText('Mean Withdrawal / Year', { timeout: 20000 });
  await expect(page.locator('#medianWithdrawnSecondaryLabel')).toHaveText('Median / Year');
  await expect(page.locator('#medianWithdrawnSecondary2Label')).toHaveText('Total Withdrawn');
  await expect(page.locator('#plannedWithdrawnLabel')).toHaveText('Planned Mean / Year');
  await expect(page.locator('#plannedWithdrawnSecondaryLabel')).toHaveText('Median / Year');
  await expect(page.locator('#plannedWithdrawnSecondary2Label')).toHaveText('Total Withdrawn');
  await expect(page.locator('#p50WdLabel')).toHaveText('Mean / Year');
  await expect(page.locator('#p50WdSecondaryLabel')).toHaveText('Median / Year');
  await expect(page.locator('#p50WdSecondary2Label')).toHaveText('Total Withdrawn');
  await expect(page.locator('#outcomesDescription')).toContainText('ranked by mean withdrawal per year');
  await expect(page.locator('#outcomesDescription')).toContainText('Horizons vary across runs.');

  // The per-year primary must be roughly total / horizon — far smaller than
  // the lifetime total in the right secondary slot; the median-per-year in
  // the left slot is a per-year value of the same magnitude as the mean.
  const meanPerYear = parseK(await page.locator('#p50Wd').textContent());
  const medianPerYear = parseK(await page.locator('#p50WdSecondary').textContent());
  const total = parseK(await page.locator('#p50WdSecondary2').textContent());
  expect(meanPerYear).toBeGreaterThan(0);
  expect(medianPerYear).toBeGreaterThan(0);
  expect(total).toBeGreaterThan(meanPerYear * 10);
  expect(total).toBeGreaterThan(medianPerYear * 10);
});

test('Explicit median/yr and mean/yr metric selections drive the labels', async ({ page }) => {
  test.slow(); // two full simulation runs
  await page.goto('/');
  await disableGoalSeek(page);

  // The metric selector sits inside the collapsed advanced-settings block.
  await page.click('summary:has-text("Advanced simulation settings")');

  // Explicit median/yr keeps the old behavior even with a horizon range.
  await page.fill('#horizonPlusYears', '5');
  await page.selectOption('#withdrawalMetric', 'medianYearly');
  await runSimulation(page);
  await expect(page.locator('#medianWithdrawnLabel')).toHaveText('Median Withdrawal / Year');
  await expect(page.locator('#p50WdLabel')).toHaveText('Median / Year');
  await expect(page.locator('#p50WdSecondaryLabel')).toHaveText('Mean / Year');
  await expect(page.locator('#p50WdSecondary2Label')).toHaveText('Total Withdrawn');
  await expect(page.locator('#outcomesDescription')).toContainText('ranked by median withdrawal per year');

  // Explicit mean/yr works on a fixed horizon too.
  await page.fill('#horizonPlusYears', '0');
  await page.selectOption('#withdrawalMetric', 'meanYearly');
  await page.click('#runButton');
  await expect(page.locator('#medianWithdrawnLabel')).toHaveText('Mean Withdrawal / Year', { timeout: 20000 });
  await expect(page.locator('#p50WdLabel')).toHaveText('Mean / Year');
  const meanPerYear = parseK(await page.locator('#p50Wd').textContent());
  expect(meanPerYear).toBeGreaterThan(0);
});
