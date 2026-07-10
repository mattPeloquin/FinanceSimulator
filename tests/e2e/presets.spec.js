import { test, expect } from '@playwright/test';

async function waitForInit(page) {
  await page.waitForFunction(() => window.__TEST_HOOKS__ && window.__TEST_HOOKS__.initComplete);
}

// The autosave debounce is 400ms; wait until the given check passes against
// the persisted scenario before reloading.
async function waitForAutosave(page, check) {
  await page.waitForFunction((checkSrc) => {
    const raw = localStorage.getItem('sor:autosave');
    if (!raw) return false;
    const { scenario } = JSON.parse(raw);
    return new Function('scenario', `return ${checkSrc}`)(scenario);
  }, check);
}

function firstFloorAmount(page) {
  return page.locator('[data-withdrawal-floor-row="0"] [data-floor-amount]');
}

test('First open: simple-use mode with the Balanced preset and collapsed sections', async ({ page }) => {
  await page.goto('/');
  await waitForInit(page);

  // Slider attached at the middle (Balanced) level.
  await expect(page.locator('#presetActive')).toBeChecked();
  await expect(page.locator('#presetLevel')).toHaveValue('2');
  await expect(page.locator('#presetLevel')).toBeEnabled();
  await expect(page.locator('#presetLevelName')).toContainText('Balanced');

  // Goal Seek is on out of the box — Run finds the best plan.
  await expect(page.locator('#runButton')).toHaveText('Find Best Plan');

  // All major sections start collapsed; the horizon/balance/slider surface is
  // always visible.
  expect(await page.locator('#section-investment').evaluate((el) => el.open)).toBe(false);
  expect(await page.locator('#section-withdrawal').evaluate((el) => el.open)).toBe(false);
  await expect(page.locator('#numYears')).toBeVisible();
  await expect(page.locator('#startBalance')).toBeVisible();
  await expect(page.locator('#presetLevel')).toBeVisible();

  // Balanced derived values at the 3,000 default start.
  await expect(firstFloorAmount(page)).toHaveValue('100');
  await expect(page.locator('#goalSeekTargetEndingBalance')).toHaveValue('1,500');

  await expect(page.locator('#resultsSection')).toBeHidden();
});

test('Moving the slider loads the level without running anything', async ({ page }) => {
  await page.goto('/');
  await waitForInit(page);

  // End = slider max = level 4 (Aggressive).
  await page.focus('#presetLevel');
  await page.keyboard.press('End');

  await expect(page.locator('#presetLevelName')).toContainText('Aggressive');
  await expect(page.locator('#goalSeekDesiredSuccessPct')).toHaveValue('80');
  await expect(page.locator('#dynLowRet')).toHaveValue('-20');
  // 4% of 3,000 → 120 minimum; full spend-down target.
  await expect(firstFloorAmount(page)).toHaveValue('120');
  await expect(page.locator('#goalSeekTargetEndingBalance')).toHaveValue('0');
  // Gifting: 2% of start above 1.15 × start.
  await expect(page.locator('[data-gifting-tier-row="0"] [data-gift-amount]')).toHaveValue('60');
  await expect(page.locator('[data-gifting-tier-row="0"] [data-gift-balance]')).toHaveValue('3,450');

  // The slider only writes settings — no simulation, still attached.
  await expect(page.locator('#resultsSection')).toBeHidden();
  await expect(page.locator('#presetActive')).toBeChecked();
});

test('Changing the starting balance live-rescales the derived values while attached', async ({ page }) => {
  await page.goto('/');
  await waitForInit(page);

  await page.fill('#startBalance', '6,000');

  // Balanced formulas at a 6,000 start: 3.3333% → 200 minimum; 1% gifting
  // above 1.33 × start; 50% target kept; 1/3 balance trigger.
  await expect(firstFloorAmount(page)).toHaveValue('200');
  await expect(page.locator('[data-gifting-tier-row="0"] [data-gift-amount]')).toHaveValue('60');
  await expect(page.locator('[data-gifting-tier-row="0"] [data-gift-balance]')).toHaveValue('7,980');
  await expect(page.locator('#goalSeekTargetEndingBalance')).toHaveValue('3,000');
  await expect(page.locator('#dynLowBal')).toHaveValue('2,000');

  // Editing the primary inputs never detaches the slider.
  await expect(page.locator('#presetActive')).toBeChecked();
});

test('Editing a preset-controlled field detaches; values are kept across reload', async ({ page }) => {
  await page.goto('/');
  await waitForInit(page);

  // Allocations are preset-controlled — open Investment Planning and edit one.
  await page.click('#section-investment > summary');
  await page.fill('#bondAllocation', '10');

  await expect(page.locator('#presetActive')).not.toBeChecked();
  await expect(page.locator('#presetLevel')).toBeDisabled();
  await expect(page.locator('#risk-preset-control')).toHaveClass(/opacity-50/);
  await expect(page.locator('#bondAllocation')).toHaveValue('10');

  // Detached state survives a reload via autosave.
  await waitForAutosave(page, 'scenario.presetActive === false');
  await page.reload();
  await waitForInit(page);
  await expect(page.locator('#presetActive')).not.toBeChecked();
  await expect(page.locator('#presetLevel')).toBeDisabled();
  await expect(page.locator('#bondAllocation')).toHaveValue('10');
});

test('Re-attaching reloads the current level over manual edits', async ({ page }) => {
  await page.goto('/');
  await waitForInit(page);

  await page.click('#section-investment > summary');
  await page.fill('#bondAllocation', '10');
  await expect(page.locator('#presetActive')).not.toBeChecked();

  await page.check('#presetActive');
  await expect(page.locator('#presetLevel')).toBeEnabled();
  await expect(page.locator('#risk-preset-control')).not.toHaveClass(/opacity-50/);
  // Balanced's bond allocation snaps back.
  await expect(page.locator('#bondAllocation')).toHaveValue('5');
});

test('User-added tiers survive slider moves; only the first tier is managed', async ({ page }) => {
  await page.goto('/');
  await waitForInit(page);

  // The minimum-withdrawal list lives inside the collapsed Withdrawal Strategy
  // section (its inner details is auto-opened by Goal Seek mode).
  await page.click('#section-withdrawal > summary');
  await page.click('#addWithdrawalFloorTier');

  // Adding a tier beyond the first is not a preset-controlled edit.
  await expect(page.locator('#presetActive')).toBeChecked();
  await expect(page.locator('[data-withdrawal-floor-row]')).toHaveCount(2);

  // Level 0 (Conservative): Home = slider min. First tier gets 2.5% of 3,000
  // = 75; the user's added tier is preserved.
  await page.focus('#presetLevel');
  await page.keyboard.press('Home');
  await expect(firstFloorAmount(page)).toHaveValue('75');
  await expect(page.locator('[data-withdrawal-floor-row]')).toHaveCount(2);

  // Editing the slider-managed first tier detaches.
  await firstFloorAmount(page).fill('99');
  await expect(page.locator('#presetActive')).not.toBeChecked();
});

test('Pre-slider saves load detached with their values intact', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('sor:autosave', JSON.stringify({
      schemaVersion: 4,
      scenario: {
        startBalance: 4200,
        distMethod: 'resampling',
        goalSeekMode: false,
        withdrawalFloors: [{ amount: 88 }],
      },
      name: '',
      description: '',
    }));
  });
  await page.goto('/');
  await waitForInit(page);

  await expect(page.locator('#presetActive')).not.toBeChecked();
  await expect(page.locator('#presetLevel')).toBeDisabled();
  await expect(page.locator('#startBalance')).toHaveValue('4,200');
  await expect(firstFloorAmount(page)).toHaveValue('88');
  await expect(page.locator('#runButton')).toHaveText('Run Simulation');

  // Detached: editing the balance must NOT rescale the old floor tier.
  await page.fill('#startBalance', '8,400');
  await expect(firstFloorAmount(page)).toHaveValue('88');
});

test('Simple flow: adjust inputs and run a plain simulation from the preset state', async ({ page }) => {
  await page.goto('/');
  await waitForInit(page);

  // Type the two simple-mode inputs.
  await page.fill('#numYears', '30');
  await page.fill('#startBalance', '2,000');

  // Run a plain (fast) simulation rather than a Goal Seek search: switch the
  // mode off (this detaches the preset, which is fine) and trim the run size.
  await page.click('label:has(#goalSeekMode)');
  await expect(page.locator('#runButton')).toHaveText('Run Simulation');
  await page.click('summary:has-text("Advanced simulation settings")');
  await page.fill('#numSimulations', '300');

  await page.click('#runButton');
  await expect(page.locator('#resultsSection')).toBeVisible();
  await expect(page.locator('#successRate')).not.toBeEmpty({ timeout: 20000 });
});
