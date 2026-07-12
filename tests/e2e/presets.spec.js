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

function firstFloorAmount(page) {
  return page.locator('[data-withdrawal-floor-row="0"] [data-floor-amount]');
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

  expect(await page.locator('#section-investment').evaluate((el) => el.open)).toBe(false);
  expect(await page.locator('#section-withdrawal').evaluate((el) => el.open)).toBe(false);
  await expect(page.locator('#numYears')).toBeVisible();
  await expect(page.locator('#presetLevel')).toBeVisible();
  await expect(page.locator('#resultsSection')).toBeHidden();
});

test('Enter in Starting Portfolio commits like blur (formats the value)', async ({ page }) => {
  await page.goto('/');
  await waitForInit(page);

  await page.fill('#startBalance', '3000');
  await page.press('#startBalance', 'Enter');
  await expect(page.locator('#startBalance')).toHaveValue('3,000');
});

test('Enter in Years to simulate blurs the field', async ({ page }) => {
  await page.goto('/');
  await waitForInit(page);

  await page.locator('#numYears').focus();
  await page.fill('#numYears', '30');
  await page.press('#numYears', 'Enter');
  await expect(page.locator('#numYears')).not.toBeFocused();
});

test('Entering a balance rescales derived values while Goal Seek is on', async ({ page }) => {
  await page.goto('/');
  await waitForInit(page);

  await page.fill('#startBalance', '3,000');

  // Balanced @ 3,000 start / 25 years: 70% lifetime → 84/yr minimum; 40% target.
  await expect(firstFloorAmount(page)).toHaveValue('84');
  await expect(page.locator('#goalSeekTargetEndingBalance')).toHaveValue('1,200');
  await expect(page.locator('#presetActive')).toBeChecked();
});

test('Moving the slider loads the level without running anything', async ({ page }) => {
  await page.goto('/');
  await waitForInit(page);

  await page.fill('#startBalance', '3,000');
  await page.focus('#presetLevel');
  await page.keyboard.press('End');

  await expect(page.locator('#presetLevelName')).toContainText('Aggressive');
  await expect(page.locator('#goalSeekDesiredSuccessPct')).toHaveValue('80');
  await expect(page.locator('#dynLowRet')).toHaveValue('-20');
  // 60% of start over 25 years → 72/yr minimum; full spend-down target.
  await expect(firstFloorAmount(page)).toHaveValue('72');
  await expect(page.locator('#goalSeekTargetEndingBalance')).toHaveValue('0');
  await expect(page.locator('[data-gifting-tier-row="0"] [data-gift-amount]')).toHaveValue('60');
  await expect(page.locator('[data-gifting-tier-row="0"] [data-gift-balance]')).toHaveValue('1,500');

  await expect(page.locator('#resultsSection')).toBeHidden();
  await expect(page.locator('#presetActive')).toBeChecked();
});

test('Changing the years live-rescales the minimum withdrawal while attached', async ({ page }) => {
  await page.goto('/');
  await waitForInit(page);

  await page.fill('#startBalance', '3,000');
  await expect(firstFloorAmount(page)).toHaveValue('84');
  await page.fill('#numYears', '50');
  await expect(firstFloorAmount(page)).toHaveValue('42');
  await expect(page.locator('#presetActive')).toBeChecked();
});

test('Changing the starting balance live-rescales the derived values while attached', async ({ page }) => {
  await page.goto('/');
  await waitForInit(page);

  await page.fill('#startBalance', '6,000');

  await expect(firstFloorAmount(page)).toHaveValue('168');
  await expect(page.locator('[data-gifting-tier-row="0"] [data-gift-amount]')).toHaveValue('60');
  await expect(page.locator('[data-gifting-tier-row="0"] [data-gift-balance]')).toHaveValue('5,400');
  await expect(page.locator('#goalSeekTargetEndingBalance')).toHaveValue('2,400');
  // No-cut threshold = 1 × start.
  await expect(page.locator('#dynNoCutBal')).toHaveValue('6,000');
  // Balanced Easy Mode max-boost drawdown is 1%.
  await expect(page.locator('#dynMaxBoostDrawdownPct')).toHaveValue('1');
  await expect(page.locator('#presetActive')).toBeChecked();
});

test('Toggling Goal Seek off fills the plan but keeps Easy Mode attached', async ({ page }) => {
  await page.goto('/');
  await waitForInit(page);

  await page.fill('#startBalance', '2,000');
  await page.click('label:has(#goalSeekMode)');

  await expect(page.locator('#presetActive')).toBeChecked();
  await expect(page.locator('#runButton')).toHaveText('Run Simulation');
  // Balanced plan @ 2,000: 5% base → 100/yr; guardrails 0.8× / 1.2× start.
  await expect(page.locator('#baseWithdrawal')).toHaveValue('100');
  await expect(page.locator('#floorBalance')).toHaveValue('1,600');
  await expect(page.locator('#ceilingBalance')).toHaveValue('2,400');
  await expect(page.locator('#floorPenalty')).toHaveValue('50');
  await expect(page.locator('#dynLowAdj')).toHaveValue('-33');
  await expect(page.locator('#dynHighAdj')).toHaveValue('33');
  await expect(page.locator('#glideFraction')).toHaveValue('30');
});

test('Slider move with Goal Seek off updates plan fields per level', async ({ page }) => {
  await page.goto('/');
  await waitForInit(page);

  await page.fill('#startBalance', '2,000');
  await page.click('label:has(#goalSeekMode)');
  await page.focus('#presetLevel');
  await page.keyboard.press('Home');

  // Conservative: 4% base → 80/yr; floor 1× / ceiling 1.5× start.
  await expect(page.locator('#baseWithdrawal')).toHaveValue('80');
  await expect(page.locator('#floorBalance')).toHaveValue('2,000');
  await expect(page.locator('#ceilingBalance')).toHaveValue('3,000');
  await expect(page.locator('#floorPenalty')).toHaveValue('40');
  await expect(page.locator('#dynMaxBoostDrawdownPct')).toHaveValue('-1');
  await expect(page.locator('#presetActive')).toBeChecked();

  await page.keyboard.press('End');
  // Aggressive: max-boost drawdown blank (off).
  await expect(page.locator('#dynMaxBoostDrawdownPct')).toHaveValue('');
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
  await expect(page.locator('#risk-preset-control')).toHaveClass(/opacity-50/);
  await expect(page.locator('#bondAllocation')).toHaveValue('10');

  await waitForAutosave(page, 'scenario.presetActive === false');
  await page.reload();
  await waitForInit(page);
  await expect(page.locator('#presetActive')).not.toBeChecked();
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
  await expect(page.locator('#bondAllocation')).toHaveValue('0');
});

test('User-added tiers survive slider moves; only the first tier is managed', async ({ page }) => {
  await page.goto('/');
  await waitForInit(page);

  await page.fill('#startBalance', '3,000');
  await page.click('#section-withdrawal > summary');
  await page.click('#addWithdrawalFloorTier');

  await expect(page.locator('#presetActive')).toBeChecked();
  await expect(page.locator('[data-withdrawal-floor-row]')).toHaveCount(2);

  await page.focus('#presetLevel');
  await page.keyboard.press('Home');
  // Conservative: 80% of 3000 over 25 years → 96/yr.
  await expect(firstFloorAmount(page)).toHaveValue('96');
  await expect(page.locator('[data-withdrawal-floor-row]')).toHaveCount(2);

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
  await expect(page.locator('#startBalance')).toHaveValue('4,200');
  await expect(firstFloorAmount(page)).toHaveValue('88');
  await expect(page.locator('#runButton')).toHaveText('Run Simulation');

  await page.fill('#startBalance', '8,400');
  await expect(firstFloorAmount(page)).toHaveValue('88');
});

test('Current-schema saves that omit Easy Mode load detached', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('sor:autosave', JSON.stringify({
      schemaVersion: 6,
      scenario: {
        startBalance: 5100,
        distMethod: 'resampling',
        goalSeekMode: false,
        withdrawalFloors: [{ amount: 77 }],
      },
      name: '',
      description: '',
    }));
  });
  await page.goto('/');
  await waitForInit(page);

  await expect(page.locator('#presetActive')).not.toBeChecked();
  await expect(page.locator('#startBalance')).toHaveValue('5,100');
  await expect(firstFloorAmount(page)).toHaveValue('77');

  await page.fill('#startBalance', '9,000');
  await expect(firstFloorAmount(page)).toHaveValue('77');
});

test('Easy Mode on/off and level persist across reload', async ({ page }) => {
  await page.goto('/');
  await waitForInit(page);

  await page.focus('#presetLevel');
  await page.keyboard.press('End');
  await expect(page.locator('#presetLevelName')).toContainText('Aggressive');
  await waitForAutosave(page, 'scenario.presetActive === true && scenario.presetLevel === 4');

  await page.reload();
  await waitForInit(page);
  await expect(page.locator('#presetActive')).toBeChecked();
  await expect(page.locator('#presetLevel')).toHaveValue('4');
  await expect(page.locator('#presetLevelName')).toContainText('Aggressive');

  await page.uncheck('#presetActive');
  await waitForAutosave(page, 'scenario.presetActive === false && scenario.presetLevel === 4');
  await page.reload();
  await waitForInit(page);
  await expect(page.locator('#presetActive')).not.toBeChecked();
  await expect(page.locator('#presetLevel')).toHaveValue('4');
  await expect(page.locator('#presetLevel')).toBeDisabled();
});

test('Balanced Easy Mode Find Best Plan retunes guardrails (not an instant infeasible exit)', async ({ page }) => {
  test.slow();
  await page.goto('/');
  await waitForInit(page);

  await page.fill('#startBalance', '3,000');

  await expect(page.locator('#presetLevelName')).toContainText('Balanced');
  await expect(firstFloorAmount(page)).toHaveValue('84');
  await expect(page.locator('#goalSeekDesiredSuccessPct')).toHaveValue('90');
  await expect(page.locator('#goalSeekTargetEndingBalance')).toHaveValue('1,200');

  await page.click('summary:has-text("Advanced simulation settings")');
  await page.fill('#goalSeekNumSimulations', '400');

  await page.click('#runButton');
  await expect(page.locator('#resultsSection')).toBeVisible({ timeout: 120000 });
  await expect(page.locator('#goalSeekWarning')).toBeHidden();

  await expect(page.locator('#floorBalance')).toHaveValue('300');
  await expect(page.locator('#ceilingBalance')).toHaveValue('6,000');
  await expect(page.locator('#floorPenalty')).not.toHaveValue('50');
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

test('Easy Mode recreates the minimum tier when the slider moves after all tiers are removed', async ({ page }) => {
  await page.goto('/');
  await waitForInit(page);

  await page.fill('#startBalance', '3,000');
  await page.click('#section-withdrawal > summary');
  await page.locator('#details-min-withdrawal').evaluate((el) => { el.open = true; });
  await expect(firstFloorAmount(page)).toHaveValue('84');

  await page.click('.remove-withdrawal-floor-tier');
  await expect(page.locator('[data-withdrawal-floor-row]')).toHaveCount(0);

  await page.focus('#presetLevel');
  await page.keyboard.press('Home');
  // Conservative: 80% of 3000 over 25 years → 96/yr.
  await expect(page.locator('[data-withdrawal-floor-row]')).toHaveCount(1);
  await expect(firstFloorAmount(page)).toHaveValue('96');
  await expect(page.locator('#presetActive')).toBeChecked();
});

test('Minimum recovery controls follow the Balanced preset and persist in autosave', async ({ page }) => {
  await page.goto('/');
  await waitForInit(page);

  await page.click('#section-withdrawal > summary');
  await page.locator('#details-min-withdrawal').evaluate((el) => { el.open = true; });
  // Balanced Easy Mode default: 3 consecutive mins, then 2 years on plan.
  await expect(page.locator('#maxConsecutiveMinWithdrawals')).toHaveValue('3');
  await expect(page.locator('#minWithdrawalPlanRecoveryYears')).toHaveValue('2');

  await page.fill('#maxConsecutiveMinWithdrawals', '5');
  await page.fill('#minWithdrawalPlanRecoveryYears', '1');
  await waitForAutosave(page, 'scenario.maxConsecutiveMinWithdrawals === 5 && scenario.minWithdrawalPlanRecoveryYears === 1');

  await page.reload();
  await waitForInit(page);
  await page.click('#section-withdrawal > summary');
  await page.locator('#details-min-withdrawal').evaluate((el) => { el.open = true; });
  await expect(page.locator('#maxConsecutiveMinWithdrawals')).toHaveValue('5');
  await expect(page.locator('#minWithdrawalPlanRecoveryYears')).toHaveValue('1');
});

function firstSpecificFloorPct(page) {
  return page.locator('[data-specific-withdrawal-floor-row="0"] [data-specific-floor-pct]');
}

test('Specific List: Easy Mode fills percentage minimum without changing the typed list', async ({ page }) => {
  await page.goto('/');
  await waitForInit(page);

  await page.fill('#startBalance', '3,000');
  await page.click('#section-withdrawal > summary');
  await page.check('#withdrawal-strategy-specific');
  await page.locator('#details-specific-min-withdrawal').evaluate((el) => { el.open = true; });

  // Balanced @ 3,000 / 25 years → (70/25)/5 × 100 = 56%.
  await expect(firstSpecificFloorPct(page)).toHaveValue('56');
  await expect(page.locator('#presetActive')).toBeChecked();

  await page.fill('#specificWithdrawals', '100\n110');
  await page.focus('#presetLevel');
  await page.keyboard.press('Home');
  // Conservative: (80/25)/4 × 100 = 80%.
  await expect(firstSpecificFloorPct(page)).toHaveValue('80');
  await expect(page.locator('#specificWithdrawals')).toHaveValue('100\n110');
});

test('Specific List: toggling Goal Seek off fills guardrails but does not force Goal Seek on', async ({ page }) => {
  await page.goto('/');
  await waitForInit(page);

  await page.fill('#startBalance', '2,000');
  await page.click('#section-withdrawal > summary');
  await page.check('#withdrawal-strategy-specific');
  await page.click('label:has(#goalSeekMode)');

  await expect(page.locator('#goalSeekMode')).not.toBeChecked();
  await expect(page.locator('#presetActive')).toBeChecked();
  await expect(page.locator('#floorBalance')).toHaveValue('1,600');
  await expect(page.locator('#ceilingBalance')).toHaveValue('2,400');
  await expect(page.locator('#dynLowAdj')).toHaveValue('-33');
  await expect(page.locator('#glideFraction')).toHaveValue('30');
});

test('Specific List: editing tier-0 minimum % detaches Easy Mode', async ({ page }) => {
  await page.goto('/');
  await waitForInit(page);

  await page.fill('#startBalance', '3,000');
  await page.click('#section-withdrawal > summary');
  await page.check('#withdrawal-strategy-specific');
  await page.locator('#details-specific-min-withdrawal').evaluate((el) => { el.open = true; });
  await expect(firstSpecificFloorPct(page)).toHaveValue('56');

  await firstSpecificFloorPct(page).fill('55');
  await expect(page.locator('#presetActive')).not.toBeChecked();
});
