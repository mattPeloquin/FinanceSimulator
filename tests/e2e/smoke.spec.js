import { test, expect } from '@playwright/test';

test('Core simulation flow runs and populates results', async ({ page }) => {
  // Go to the home page
  await page.goto('/');

  // Expect the initial state
  await expect(page.locator('h1').filter({ hasText: 'Sequence of Returns Simulator' })).toBeVisible();

  const themeToggle = page.locator('#themeToggle');
  await expect(themeToggle).toBeVisible();
  await themeToggle.click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await themeToggle.click();
  await expect(page.locator('html')).not.toHaveClass(/dark/);
  
  // Results section should be hidden initially
  const resultsSection = page.locator('#resultsSection');
  await expect(resultsSection).toBeHidden();

  // Click the Run Simulation button
  await page.click('#runButton');

  // Wait for the results to appear
  await expect(resultsSection).toBeVisible();

  // The charts inside <details> blocks render with 0 height until opened
  // Let's open the details block containing the charts
  await page.click('summary:has-text("Dynamic Withdrawals Timeline")');

  // Wait for specific text elements to populate
  const successRate = page.locator('#successRate');
  await expect(successRate).not.toBeEmpty();
  await expect(successRate).toContainText('%');

  const medianBalance = page.locator('#medianBalance');
  await expect(medianBalance).not.toBeEmpty();

  // Verify that canvases are rendered
  const balanceChart = page.locator('#balanceChart');
  await expect(balanceChart).toBeVisible();

  const withdrawalChart = page.locator('#withdrawalChart');
  await expect(withdrawalChart).toBeVisible();

  const surfaceChart = page.locator('#surfaceChart canvas');
  await expect(surfaceChart.first()).toBeVisible();
});
