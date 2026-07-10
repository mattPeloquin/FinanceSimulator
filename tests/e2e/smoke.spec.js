import { test, expect } from '@playwright/test';

// Goal Seek ("Find Best Plan") is on out of the box; these specs exercise a
// plain simulation run, so switch it off first (clicking the toggle also
// detaches the risk preset, which is fine here).
async function disableGoalSeek(page) {
  await page.waitForFunction(() => window.__TEST_HOOKS__ && window.__TEST_HOOKS__.initComplete);
  await page.click('label:has(#goalSeekMode)');
  await expect(page.locator('#runButton')).toHaveText('Run Simulation');
}

test('Core simulation flow runs and populates results', async ({ page }) => {
  // Go to the home page
  await page.goto('/');
  await disableGoalSeek(page);

  // Expect the initial state
  await expect(page.locator('h1')).toContainText('Simulator');

  // Two peer master sections: Investment Planning and Withdrawal Strategy
  await expect(page.locator('#section-investment > summary')).toContainText('Investment Planning');
  await expect(page.locator('#section-withdrawal > summary')).toContainText('Withdrawal Strategy');
  // Goal Seek sits above Investment Planning in the primary inputs column
  await expect(page.locator('#goalSeekMode')).toBeVisible();
  const goalSeekBeforeInvestment = await page.locator('#goalSeekMode').evaluate((el) => {
    const investment = document.getElementById('section-investment');
    return !!(investment && el.compareDocumentPosition(investment) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  expect(goalSeekBeforeInvestment).toBe(true);
  // Advanced settings sit at the bottom of the form (after results)
  await expect(page.locator('#section-advanced > summary')).toHaveText('Advanced simulation settings');

  const themeToggle = page.locator('#themeToggle');
  await expect(themeToggle).toBeVisible();
  await themeToggle.click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await themeToggle.click();
  await expect(page.locator('html')).not.toHaveClass(/dark/);
  
  // Results section should be hidden initially
  const resultsSection = page.locator('#resultsSection');
  await expect(resultsSection).toBeHidden();

  await page.fill('#startBalance', '3000');
  await page.press('#startBalance', 'Enter');

  // Click the Run Simulation button
  await page.click('#runButton');

  // Wait for the results to appear
  await expect(resultsSection).toBeVisible();

  // The charts inside <details> blocks render with 0 height until opened
  // Let's open the details block containing the charts
  await page.click('summary:has-text("Average Timelines")');

  // Wait for specific text elements to populate
  const successRate = page.locator('#successRate');
  await expect(successRate).not.toBeEmpty();
  await expect(successRate).toContainText('%');

  const withdrawalTargetSuccessRate = page.locator('#withdrawalTargetSuccessRate');
  await expect(withdrawalTargetSuccessRate).not.toBeEmpty();
  await expect(withdrawalTargetSuccessRate).toContainText('%');

  const medianBalance = page.locator('#medianBalance');
  await expect(medianBalance).not.toBeEmpty();

  // Percentile cards show both the time-weighted return and the IRR
  await expect(page.locator('#p50Ret')).toContainText('%');
  await expect(page.locator('#p50Irr')).toContainText('IRR');
  await expect(page.locator('#p50Irr')).toContainText('%');

  // Return distribution tiles carry an IRR secondary value
  await page.click('summary:has-text("Distribution of Real Returns")');
  await expect(page.locator('#returnMean')).toContainText('%');
  await expect(page.locator('#returnMeanIrr')).toContainText('%');
  await expect(page.locator('#returnMedianIrr')).toContainText('%');

  // Sequence-risk scatter renders with its summary cards and outcome legend
  await expect(page.locator('#irrScatterCanvas')).toBeVisible();
  await expect(page.locator('#seqMedianIrr')).toContainText('%');
  await expect(page.locator('#seqRequiredIrr')).toContainText('%');
  await expect(page.locator('#irrScatterLegend')).toContainText('Met plan');
  await expect(page.locator('#irrScatterLegend')).toContainText('IRR = Avg');
  await expect(page.locator('#irrScatterLegend')).toContainText('Historical IRR range');

  // Clicking a path dot opens the drill-down: withdrawal line chart with the
  // linked balance bar chart underneath (same pairing as the 3D chart's popup).
  // The dots cluster around the middle of the plot; sweep a small grid of click
  // positions until one lands within a dot's hit radius.
  const scatterCanvas = page.locator('#irrScatterCanvas');
  const drilldown = page.locator('#irrScatterDrilldown');
  const box = await scatterCanvas.boundingBox();
  for (let fy = 0.2; fy <= 0.8 && !(await drilldown.isVisible()); fy += 0.15) {
    for (let fx = 0.2; fx <= 0.8 && !(await drilldown.isVisible()); fx += 0.15) {
      await scatterCanvas.click({ position: { x: box.width * fx, y: box.height * fy } });
    }
  }
  await expect(drilldown).toBeVisible();
  await expect(page.locator('#irrScatterDrilldownTitle')).toContainText('Simulation #');
  await expect(page.locator('#irrScatterPathCanvas')).toBeVisible();
  await expect(page.locator('#irrScatterBalanceCanvas')).toBeVisible();

  // Combined success card and Median End Balance IRR
  await expect(page.locator('#medianIrr')).toContainText('%');

  // IRR distribution histogram at the end of the section
  await expect(page.locator('#irrChart')).toBeVisible();

  // Verify that canvases are rendered
  const balanceChart = page.locator('#balanceChart');
  await expect(balanceChart).toBeVisible();

  const withdrawalChart = page.locator('#withdrawalChart');
  await expect(withdrawalChart).toBeVisible();

  const surfaceChart = page.locator('#surfaceChart canvas');
  await expect(surfaceChart.first()).toBeVisible();
});

test('Historical IRR band survives a year selection shorter than the horizon', async ({ page }) => {
  await page.goto('/');
  await disableGoalSeek(page);
  await page.fill('#startBalance', '3000');
  await page.press('#startBalance', 'Enter');
  // Year-range inputs live under Investment Planning → Historical Data.
  await page.click('#section-investment > summary');
  // 2005–2025 is 21 years against the default 35-year horizon: no true rolling
  // window fits, so the band must fall back to wrapped windows instead of vanishing.
  await page.fill('#startYear', '2005');
  await page.click('#runButton');
  await expect(page.locator('#resultsSection')).toBeVisible();
  await expect(page.locator('#irrScatterLegend')).toContainText('Historical IRR range');
});
