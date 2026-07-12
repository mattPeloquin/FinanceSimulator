import { test, expect } from '@playwright/test';

async function waitForInit(page) {
  await page.waitForLoadState('networkidle');
  await page.waitForFunction(() => window.__TEST_HOOKS__ && window.__TEST_HOOKS__.initComplete);
}

test('Saving and restoring a named session', async ({ page }) => {
  await page.goto('/');
  await waitForInit(page);

  // 1. Change a setting so it diverges from default
  await page.fill('#startBalance', '5,555');

  // 2. Click Save
  await page.click('#saveSessionButton');

  // 3. The <dialog> modal should appear. Wait for it.
  const dialog = page.locator('#saveSessionDialog');
  await expect(dialog).toBeVisible();

  // 4. Fill in the session name and confirm
  await page.fill('#saveSessionName', 'Playwright Test Session');
  await page.click('#confirmSaveSession');

  // Modal should close
  await expect(dialog).toBeHidden();

  // 5. The dropdown should now be selected to 'Playwright Test Session'
  const sessionSelect = page.locator('#sessionSelect');
  await expect(sessionSelect).toHaveValue('Playwright Test Session');

  // 6. Reload the page completely
  await page.reload();

  await waitForInit(page);
  await page.waitForTimeout(1000);

  // 7. Verify the dropdown remembers the session on load
  const newSessionSelect = page.locator('#sessionSelect');
  await expect(newSessionSelect.locator('option')).toHaveCount(2, { timeout: 10000 });

  await newSessionSelect.selectOption('Playwright Test Session');
  await expect(newSessionSelect).toHaveValue('Playwright Test Session');

  // 8. Verify our custom setting restored
  const newBalanceInput = page.locator('#startBalance');
  await expect(newBalanceInput).toHaveValue('5,555');

  // 9. Switch back to Unsaved session — stashed values persist (not defaults)
  await newSessionSelect.selectOption('');

  await page.waitForFunction(() => document.getElementById('startBalance').value === '5,555');
  await expect(newBalanceInput).toHaveValue('5,555');

  // 10. Switch back to our test session
  await newSessionSelect.selectOption('Playwright Test Session');

  await page.waitForFunction(() => document.getElementById('startBalance').value === '5,555');
  await expect(newBalanceInput).toHaveValue('5,555');

  // 11. Delete the session
  await page.click('#deleteSessionButton');
  const deleteDialog = page.locator('#confirmDeleteDialog');
  await expect(deleteDialog).toBeVisible();
  await page.click('#confirmDeleteSession');

  await expect(newSessionSelect).toHaveValue('');
  await expect(newBalanceInput).toHaveValue('5,555');
});

test('Header keeps theme toggle on the right; session buttons wrap under the dropdown', async ({ page }) => {
  await page.goto('/');
  await waitForInit(page);

  const themeToggle = page.locator('#themeToggle');
  const sessionSelect = page.locator('#sessionSelect');
  const saveButton = page.locator('#saveSessionButton');

  // Wide: theme stays on the right edge of the header row
  await page.setViewportSize({ width: 1200, height: 800 });
  const wide = await page.evaluate(() => {
    const theme = document.getElementById('themeToggle').getBoundingClientRect();
    const select = document.getElementById('sessionSelect').getBoundingClientRect();
    const save = document.getElementById('saveSessionButton').getBoundingClientRect();
    return {
      themeRight: theme.right,
      themeTop: theme.top,
      selectBottom: select.bottom,
      saveTop: save.top,
      viewportWidth: window.innerWidth,
    };
  });
  expect(wide.themeRight).toBeGreaterThan(wide.viewportWidth - 80);
  // Buttons sit beside the dropdown (tops roughly aligned)
  expect(wide.saveTop).toBeLessThan(wide.selectBottom);

  // Narrow: theme still on the right; buttons drop below the dropdown
  await page.setViewportSize({ width: 420, height: 800 });
  const narrow = await page.evaluate(() => {
    const theme = document.getElementById('themeToggle').getBoundingClientRect();
    const select = document.getElementById('sessionSelect').getBoundingClientRect();
    const save = document.getElementById('saveSessionButton').getBoundingClientRect();
    return {
      themeRight: theme.right,
      selectBottom: select.bottom,
      saveTop: save.top,
      viewportWidth: window.innerWidth,
    };
  });
  expect(narrow.themeRight).toBeGreaterThan(narrow.viewportWidth - 80);
  expect(narrow.saveTop).toBeGreaterThanOrEqual(narrow.selectBottom - 2);

  await expect(themeToggle).toBeVisible();
  await expect(sessionSelect).toBeVisible();
  await expect(saveButton).toBeVisible();
});

test('Reset restores a named session to its last Save', async ({ page }) => {
  await page.goto('/');
  await waitForInit(page);

  const sessionSelect = page.locator('#sessionSelect');
  const balanceInput = page.locator('#startBalance');
  const resetButton = page.locator('#resetSessionButton');

  await expect(resetButton).toBeDisabled();

  await page.fill('#startBalance', '5,555');
  await page.click('#saveSessionButton');
  await page.fill('#saveSessionName', 'Reset Test Session');
  await page.click('#confirmSaveSession');

  await expect(sessionSelect).toHaveValue('Reset Test Session');
  await expect(resetButton).toBeEnabled();

  // Edit without saving, then Reset should restore the last Save
  await page.fill('#startBalance', '9,999');
  await page.click('#resetSessionButton');
  await page.waitForFunction(() => document.getElementById('startBalance').value === '5,555');
  await expect(balanceInput).toHaveValue('5,555');

  // Save a new value, edit again, Reset should restore the newer Save
  await page.fill('#startBalance', '7,777');
  await page.click('#saveSessionButton');
  await page.click('#confirmSaveSession');
  await page.fill('#startBalance', '1,111');
  await page.click('#resetSessionButton');
  await page.waitForFunction(() => document.getElementById('startBalance').value === '7,777');
  await expect(balanceInput).toHaveValue('7,777');

  await page.click('#deleteSessionButton');
  await page.click('#confirmDeleteSession');
  await expect(resetButton).toBeDisabled();
});

test('Session description, Copy, and New', async ({ page }) => {
  await page.goto('/');
  await waitForInit(page);

  const sessionSelect = page.locator('#sessionSelect');
  const sessionNote = page.locator('#sessionNote');
  const balanceInput = page.locator('#startBalance');

  // Save with description
  await page.fill('#startBalance', '5,555');
  await page.click('#saveSessionButton');
  await page.fill('#saveSessionName', 'Desc Test Session');
  await page.fill('#saveSessionDescription', 'Retirement baseline with extra buffer');
  await page.click('#confirmSaveSession');

  await expect(sessionSelect).toHaveValue('Desc Test Session');
  await expect(sessionNote).toBeVisible();
  await expect(sessionNote).toHaveText('Retirement baseline with extra buffer');

  // Copy with unsaved edits — original session in storage stays at 5,555
  await page.fill('#startBalance', '7,777');
  await page.click('#copySessionButton');
  await page.fill('#saveSessionName', 'Desc Test Session Copy');
  await page.click('#confirmSaveSession');

  await expect(sessionSelect).toHaveValue('Desc Test Session Copy');
  await expect(balanceInput).toHaveValue('7,777');
  await expect(sessionNote).toHaveText('Retirement baseline with extra buffer');

  // Original session unchanged in storage
  await sessionSelect.selectOption('Desc Test Session');
  await page.waitForFunction(() => document.getElementById('startBalance').value === '5,555');
  await expect(balanceInput).toHaveValue('5,555');
  await expect(sessionNote).toHaveText('Retirement baseline with extra buffer');

  // Unsaved edits on named session, then New silently saves and resets
  await page.fill('#startBalance', '6,666');
  await page.click('#newSessionButton');

  await expect(sessionSelect).toHaveValue('');
  await expect(sessionNote).toBeHidden();
  // Defaults leave the start balance blank (Easy Mode).
  await page.waitForFunction(() => document.getElementById('startBalance').value === '');
  await expect(balanceInput).toHaveValue('');

  // Reload saved edits from before New (original was auto-saved with 6,666)
  await sessionSelect.selectOption('Desc Test Session');
  await page.waitForFunction(() => document.getElementById('startBalance').value === '6,666');
  await expect(balanceInput).toHaveValue('6,666');

  // Cleanup
  await sessionSelect.selectOption('Desc Test Session');
  await page.click('#deleteSessionButton');
  const deleteDialog = page.locator('#confirmDeleteDialog');
  await expect(deleteDialog).toBeVisible();
  await page.click('#confirmDeleteSession');
  await expect(deleteDialog).toBeHidden();

  await sessionSelect.selectOption('Desc Test Session Copy');
  await expect(sessionSelect).toHaveValue('Desc Test Session Copy');
  await expect(page.locator('#deleteSessionButton')).toBeEnabled();
  await page.click('#deleteSessionButton');
  await expect(deleteDialog).toBeVisible();
  await page.click('#confirmDeleteSession');
});

test('Unsaved session persists when switching away and back', async ({ page }) => {
  await page.goto('/');
  await waitForInit(page);

  const sessionSelect = page.locator('#sessionSelect');
  const balanceInput = page.locator('#startBalance');

  await page.fill('#startBalance', '4,444');
  await page.click('#saveSessionButton');
  await page.fill('#saveSessionName', 'Stash Test Session');
  await page.click('#confirmSaveSession');

  await page.fill('#startBalance', '1,111'); // Change so we can detect the restore
  await sessionSelect.selectOption('');
  await page.waitForFunction(() => document.getElementById('startBalance').value === '4,444');
  
  await page.fill('#startBalance', '9,999');
  await sessionSelect.selectOption('Stash Test Session');
  await page.waitForFunction(() => document.getElementById('startBalance').value === '4,444');
  await expect(balanceInput).toHaveValue('4,444');

  await sessionSelect.selectOption('');
  await page.waitForFunction(() => document.getElementById('startBalance').value === '9,999');
  await expect(balanceInput).toHaveValue('9,999');

  await page.click('#newSessionButton');
  // Defaults leave the start balance blank (Easy Mode).
  await page.waitForFunction(() => document.getElementById('startBalance').value === '');
  await expect(balanceInput).toHaveValue('');

  await sessionSelect.selectOption('');
  await expect(balanceInput).toHaveValue('');

  await sessionSelect.selectOption('Stash Test Session');
  await page.click('#deleteSessionButton');
  await page.click('#confirmDeleteSession');
});
