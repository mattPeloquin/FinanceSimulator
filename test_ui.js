import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  page.on('console', msg => console.log('BROWSER CONSOLE:', msg.type(), msg.text()));
  page.on('pageerror', err => console.log('BROWSER ERROR:', err));
  
  page.on('dialog', async dialog => {
    console.log('BROWSER DIALOG:', dialog.type(), dialog.message());
    if (dialog.type() === 'prompt') {
      await dialog.accept('Test Session');
    } else {
      await dialog.accept();
    }
  });

  await page.goto('http://localhost:5174/');
  await page.waitForLoadState('networkidle');
  
  console.log('Clicking Save Button...');
  await page.click('#saveSessionButton');
  
  await page.waitForTimeout(1000);
  
  const options = await page.$$eval('#sessionSelect option', opts => opts.map(o => o.value));
  console.log('Session Select Options:', options);
  
  console.log('Done.');
  await browser.close();
})();