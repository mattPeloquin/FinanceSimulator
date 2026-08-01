import { test, expect } from '@playwright/test';

async function savePlanSession(page, name) {
  await page.waitForFunction(() => window.__TEST_HOOKS__ && window.__TEST_HOOKS__.initComplete);
  await page.fill('#startBalance', '2000');
  await page.press('#startBalance', 'Enter');
  await page.locator('#section-advanced').evaluate((el) => { el.open = true; });
  await page.fill('#numSimulations', '200');

  await page.click('#saveSessionButton');
  await page.fill('#saveSessionName', name);
  await page.click('#confirmSaveSession');
  await expect(page.locator('#sessionSelect')).toHaveValue(name);
}

test('SOR Lab sensitivity run paints tornado and survives tab switch', async ({ page }) => {
  test.slow();
  await page.goto('/');

  await savePlanSession(page, 'Lab Smoke Plan');

  await page.click('#tab-sor-lab');
  await expect(page.locator('#feature-sor-lab')).toBeVisible();
  await expect(page.locator('#sor-lab-run')).toBeVisible();

  await page.selectOption('#sor-lab-scenario', 'Lab Smoke Plan');
  await page.selectOption('#sor-lab-sweep-points', '5');
  await page.selectOption('#sor-lab-paths', '1000');

  // Disable most variables via the checklist for a faster smoke — keep a few.
  await page.waitForSelector('.sor-lab-var-enabled');
  const checkboxes = page.locator('.sor-lab-var-enabled:not(:disabled)');
  const count = await checkboxes.count();
  for (let i = 0; i < count; i++) {
    const box = checkboxes.nth(i);
    const id = await box.getAttribute('data-id');
    const keep = id === 'startBalance' || id === 'baseWithdrawal' || id === 'equitySharePct';
    await box.setChecked(keep);
  }

  await page.click('#sor-lab-run');

  // Switch away mid-run; Lab job should keep going with a tab badge.
  await page.click('#tab-sor-plan');
  await expect(page.locator('#feature-sor-plan')).toBeVisible();
  await expect(page.locator('#tab-sor-lab .feature-tab-badge')).toBeVisible({ timeout: 10_000 });

  await page.click('#tab-sor-lab');
  await expect(page.locator('#feature-sor-lab')).toBeVisible();
  await expect(page.locator('#sor-lab-results-panel')).toBeVisible({ timeout: 120_000 });
  await expect(page.locator('#sor-lab-loading')).toBeHidden();

  const tornadoBox = await page.locator('#sor-lab-tornado').boundingBox();
  expect(tornadoBox).toBeTruthy();
  expect(tornadoBox.width).toBeGreaterThan(10);
  expect(tornadoBox.height).toBeGreaterThan(10);

  // Clicking a tornado row toggles a selection chip for the response curve.
  await page.locator('#sor-lab-tornado').click({ position: { x: 120, y: 40 } });
  await expect(page.locator('#sor-lab-curve-chips button[data-curve-id]').first()).toBeVisible();
  const curveBox = await page.locator('#sor-lab-curve').boundingBox();
  expect(curveBox).toBeTruthy();
  expect(curveBox.width).toBeGreaterThan(10);
  expect(curveBox.height).toBeGreaterThan(10);

  // Metric change is post-run — no loading flash.
  await page.selectOption('#sor-lab-metric', 'endingBalance');
  await expect(page.locator('#sor-lab-loading')).toBeHidden();
  await expect(page.locator('#sor-lab-results-panel')).toBeVisible();
});
