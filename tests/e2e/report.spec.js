import { test, expect } from '@playwright/test';

async function disableGoalSeek(page) {
  await page.waitForFunction(() => window.__TEST_HOOKS__ && window.__TEST_HOOKS__.initComplete);
  await page.click('label:has(#goalSeekMode)');
  await expect(page.locator('#runButton')).toHaveText('Run Simulation');
}

test('Plan Snapshot report opens and updates with percentile sliders', async ({ page }) => {
  test.slow();

  // The bento grid switches to its report layout at the medium breakpoint.
  await page.setViewportSize({ width: 800, height: 900 });
  await page.goto('/');
  await disableGoalSeek(page);

  await page.fill('#startBalance', '2000');
  await page.press('#startBalance', 'Enter');
  await page.locator('#section-advanced').evaluate((el) => { el.open = true; });
  await page.fill('#numSimulations', '300');

  await page.click('#runButton');
  await expect(page.locator('#resultsSection')).toBeVisible({ timeout: 60_000 });

  const details = page.locator('#details-plan-report');
  await expect(details).toBeAttached();
  await expect(details).not.toHaveAttribute('open', '');

  await page.locator('summary:has-text("Plan Snapshot")').click();
  await expect(details).toHaveAttribute('open', '');

  // Verdict prose was removed; the two hero stats + gauges donut now carry it.
  await expect(page.locator('#reportVerdictText')).toHaveCount(0);
  await expect(page.locator('#reportHeaderLine1')).not.toBeEmpty();
  await expect(page.locator('#reportHeaderLine2')).toHaveCount(0);
  await expect(page.locator('#reportSuccessBarFill')).toHaveCount(0);
  await expect(page.locator('#reportOnPlanBarFill')).toHaveCount(0);
  await expect(page.locator('#reportSequenceBullet')).toHaveCount(0);

  const bandCanvas = page.locator('#reportBandCanvas');
  await expect(bandCanvas).toBeVisible();
  const box = await bandCanvas.boundingBox();
  expect(box).toBeTruthy();
  expect(box.width).toBeGreaterThan(100);
  expect(box.height).toBeGreaterThan(50);

  const successDonut = page.locator('#reportSuccessDonut');
  await expect(successDonut).toBeVisible();
  const donutBox = await successDonut.boundingBox();
  expect(donutBox).toBeTruthy();
  expect(donutBox.width).toBeGreaterThan(100);
  expect(donutBox.height).toBeGreaterThan(50);
  // The donut sits to the right of the verdict card.
  const verdictBox = await page.locator('#reportVerdictCard').boundingBox();
  expect(verdictBox).toBeTruthy();
  expect(donutBox.x).toBeGreaterThan(verdictBox.x);

  await expect(page.locator('#reportBandLabel')).toContainText('P10–P90');

  await page.locator('#reportPxLow').fill('25');
  await expect(page.locator('#reportPxLowLabel')).toHaveText('P25');
  await expect(page.locator('#reportBandLabel')).toContainText('P25');

  // Two equal-weight hero stats: not depleted + on plan, plus a status pill.
  const heroNumber = page.locator('#reportHeroSuccess');
  await expect(heroNumber).toBeVisible();
  await expect(heroNumber).toContainText('%');
  const heroOnPlan = page.locator('#reportHeroOnPlan');
  await expect(heroOnPlan).toBeVisible();
  await expect(heroOnPlan).toContainText('%');
  await expect(page.locator('#reportVerdictPill')).not.toBeEmpty();

  // 4% comparison is split into two minimized charts on honest scales.
  await expect(page.locator('#reportFourPctBars')).toHaveCount(0);
  await expect(page.locator('#reportFourPctSpend')).toBeVisible();
  await expect(page.locator('#reportFourPctSurvival')).toBeVisible();

  // Generated date + simulation count moved to the footer.
  await expect(page.locator('#reportFooterMeta')).toContainText(/simulations/i);

  // Report-local appearance toggle is independent of the app's theme toggle.
  const themeMode = page.locator('#reportThemeMode');
  await expect(themeMode).toHaveValue('auto');
  await themeMode.selectOption('dark');
  await expect(page.locator('#planReport')).toHaveClass(/report-force-dark/);
  await themeMode.selectOption('light');
  await expect(page.locator('#planReport')).toHaveClass(/report-force-light/);
  await themeMode.selectOption('auto');
  await expect(page.locator('#planReport')).not.toHaveClass(/report-force-light|report-force-dark/);

  await expect(page.locator('#reportExportPdf')).toBeVisible();
  await expect(page.locator('#reportNextMoves')).toHaveCount(0);
});
