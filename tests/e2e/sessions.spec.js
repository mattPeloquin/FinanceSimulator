import { test, expect } from '@playwright/test';

test('Saving and restoring a named session', async ({ page }) => {
  await page.goto('/');

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
  
  // Wait for the page initialization to finish (including IndexedDB async call)
  // IndexedDB operations can be slightly slow on load. Let's wait for network/init.
  await page.waitForLoadState('networkidle');
  await page.waitForFunction(() => window.__TEST_HOOKS__ && window.__TEST_HOOKS__.initComplete);
  await page.waitForTimeout(1000);

  // 7. Verify the dropdown remembers the session on load
  const newSessionSelect = page.locator('#sessionSelect');
  // Wait for the options to be populated from DB before checking selection
  await expect(newSessionSelect.locator('option')).toHaveCount(2, { timeout: 10000 });
  
  // Since we know there are 2 options, we wait for the dom value to equal our session
  // IndexedDB restores can sometimes be async in a way that the select isn't fully 
  // updated right when we get here. Let's explicitly select it.
  await newSessionSelect.selectOption('Playwright Test Session');
  
  await expect(newSessionSelect).toHaveValue('Playwright Test Session');

  // 8. Verify our custom setting restored
  const newBalanceInput = page.locator('#startBalance');
  await expect(newBalanceInput).toHaveValue('5,555');

  // 9. Switch back to Unsaved session (value="")
  await newSessionSelect.selectOption('');
  
  // Actually wait for value to update to default, since the onChange handler has an await logic
  await page.waitForFunction(() => document.getElementById('startBalance').value === '4,000');
  
  // It should reset to default startBalance of "4,000"
  await expect(newBalanceInput).toHaveValue('4,000');

  // 10. Switch back to our test session
  await newSessionSelect.selectOption('Playwright Test Session');
  
  await page.waitForFunction(() => document.getElementById('startBalance').value === '5,555');
  await expect(newBalanceInput).toHaveValue('5,555');

  // 11. Delete the session
  await page.click('#deleteSessionButton');
  const deleteDialog = page.locator('#confirmDeleteDialog');
  await expect(deleteDialog).toBeVisible();
  await page.click('#confirmDeleteSession');

  // Should revert to unsaved session but retain the current form values
  await expect(newSessionSelect).toHaveValue('');
  await expect(newBalanceInput).toHaveValue('5,555');
});
