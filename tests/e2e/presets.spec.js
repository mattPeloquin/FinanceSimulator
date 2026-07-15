import { test, expect } from '@playwright/test';

async function waitForInit(page) {
  await page.waitForFunction(() => window.__TEST_HOOKS__ && window.__TEST_HOOKS__.initComplete);
}

async function waitForAutosave(page, check) {
  await page.waitForFunction((checkSrc) => {
    const raw = localStorage.getItem('sor:autosave');
    if (!raw) return false;
    const { scenario } = JSON.parse(raw);
    return new Function('scenario', `return ${checkSrc}`)(scenario);
  }, check);
}

test('First open: Easy Mode attached, blank portfolio, Goal Seek on', async ({ page }) => {
  await page.goto('/');
  await waitForInit(page);

  await expect(page.locator('#presetActive')).toBeChecked();
  await expect(page.locator('#presetLevel')).toHaveValue('2');
  await expect(page.locator('#presetLevel')).toBeEnabled();
  await expect(page.locator('#presetLevelName')).toContainText('Balanced');
  await expect(page.locator('#runButton')).toHaveText('Find Best Plan');
  await expect(page.locator('#startBalance')).toHaveValue('');
  await expect(page.locator('#resultsSection')).toBeHidden();
});

test('Enter in Starting Portfolio commits like blur (formats the value)', async ({ page }) => {
  await page.goto('/');
  await waitForInit(page);

  await page.fill('#startBalance', '3000');
  await page.press('#startBalance', 'Enter');
  await expect(page.locator('#startBalance')).toHaveValue('3,000');
});

test('Run with blank start shows validation error', async ({ page }) => {
  await page.goto('/');
  await waitForInit(page);

  await page.click('#runButton');
  await expect(page.locator('#resultsSection')).toBeHidden();
  await expect(page.locator('#messageDialog')).toBeVisible();
  await expect(page.locator('#messageDialogText')).toContainText('Starting portfolio');
});

test('Editing a preset-controlled field detaches; values are kept across reload', async ({ page }) => {
  await page.goto('/');
  await waitForInit(page);

  await page.click('#section-investment > summary');
  await page.fill('#bondAllocation', '10');

  await expect(page.locator('#presetActive')).not.toBeChecked();
  await expect(page.locator('#presetLevel')).toBeDisabled();
  await expect(page.locator('#bondAllocation')).toHaveValue('10');

  await waitForAutosave(page, 'scenario.presetActive === false');
  await page.reload();
  await waitForInit(page);
  await expect(page.locator('#presetActive')).not.toBeChecked();
  await expect(page.locator('#bondAllocation')).toHaveValue('10');
});

test('Simple flow: adjust inputs and run a plain simulation from Easy Mode', async ({ page }) => {
  await page.goto('/');
  await waitForInit(page);

  await page.fill('#numYears', '30');
  await page.fill('#startBalance', '2,000');

  await page.click('label:has(#goalSeekMode)');
  await expect(page.locator('#runButton')).toHaveText('Run Simulation');
  await expect(page.locator('#presetActive')).toBeChecked();
  await page.click('summary:has-text("Advanced simulation settings")');
  await page.fill('#numSimulations', '300');

  await page.click('#runButton');
  await expect(page.locator('#resultsSection')).toBeVisible();
  await expect(page.locator('#successRate')).not.toBeEmpty({ timeout: 20000 });
});
