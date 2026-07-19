import { test, expect } from '@playwright/test';

async function waitForInit(page) {
  await page.waitForFunction(() => window.__TEST_HOOKS__ && window.__TEST_HOOKS__.initComplete);
}

test('Results chart sections default open when accordion chrome is empty', async ({ page }) => {
  await page.goto('/');
  await waitForInit(page);
  await page.evaluate(() => localStorage.removeItem('sor:ui-accordions'));
  await page.reload();
  await waitForInit(page);

  expect(await page.locator('#details-simulation-outcomes').evaluate((el) => el.open)).toBe(true);
  expect(await page.locator('#details-surface-chart').evaluate((el) => el.open)).toBe(true);
  expect(await page.locator('#details-withdrawal-heatmap').evaluate((el) => el.open)).toBe(true);
  expect(await page.locator('#details-irr-scatter').evaluate((el) => el.open)).toBe(true);
  expect(await page.locator('#section-investment').evaluate((el) => el.open)).toBe(false);
  expect(await page.locator('#section-withdrawal').evaluate((el) => el.open)).toBe(false);
});

test('Results chart accordion collapse persists across refresh', async ({ page }) => {
  await page.goto('/');
  await waitForInit(page);

  // Results charts live in #resultsSection (hidden until a run). Toggle via the
  // DOM so persistence still fires without needing a full simulation first.
  await page.evaluate(() => {
    document.getElementById('resultsSection')?.classList.remove('hidden');
    const details = document.getElementById('details-surface-chart');
    if (details) details.open = false;
  });
  expect(await page.locator('#details-surface-chart').evaluate((el) => el.open)).toBe(false);
  await page.waitForFunction(() => {
    const raw = localStorage.getItem('sor:ui-accordions');
    return raw && JSON.parse(raw)['details-surface-chart'] === false;
  });

  await page.reload();
  await waitForInit(page);
  expect(await page.locator('#details-surface-chart').evaluate((el) => el.open)).toBe(false);
  expect(await page.locator('#details-withdrawal-heatmap').evaluate((el) => el.open)).toBe(true);
});

test('Expanded settings sections survive refresh and stay independent of scenario autosave', async ({ page }) => {
  await page.goto('/');
  await waitForInit(page);

  // Default: major sections collapsed.
  expect(await page.locator('#section-investment').evaluate((el) => el.open)).toBe(false);
  expect(await page.locator('#section-withdrawal').evaluate((el) => el.open)).toBe(false);

  await page.locator('#section-investment > summary').click();
  await page.locator('#section-advanced > summary').click();
  expect(await page.locator('#section-investment').evaluate((el) => el.open)).toBe(true);
  expect(await page.locator('#section-advanced').evaluate((el) => el.open)).toBe(true);

  // Wait until the UI chrome key is written (separate from sor:autosave).
  await page.waitForFunction(() => {
    const raw = localStorage.getItem('sor:ui-accordions');
    if (!raw) return false;
    const state = JSON.parse(raw);
    return state['section-investment'] === true && state['section-advanced'] === true;
  });

  // Clear scenario autosave so a reload would otherwise fall back to defaults —
  // accordion chrome must not depend on it.
  await page.evaluate(() => localStorage.removeItem('sor:autosave'));

  await page.reload();
  await waitForInit(page);

  expect(await page.locator('#section-investment').evaluate((el) => el.open)).toBe(true);
  expect(await page.locator('#section-advanced').evaluate((el) => el.open)).toBe(true);
  expect(await page.locator('#section-withdrawal').evaluate((el) => el.open)).toBe(false);

  // Collapsing also persists across refresh.
  await page.locator('#section-investment > summary').click();
  await page.waitForFunction(() => {
    const raw = localStorage.getItem('sor:ui-accordions');
    return raw && JSON.parse(raw)['section-investment'] === false;
  });

  await page.reload();
  await waitForInit(page);
  expect(await page.locator('#section-investment').evaluate((el) => el.open)).toBe(false);
  expect(await page.locator('#section-advanced').evaluate((el) => el.open)).toBe(true);
});
