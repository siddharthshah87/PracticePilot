import * as browser from './src/browser.js';
import { getConfig } from './src/config.js';
import * as readline from 'readline';

const config = getConfig();

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
function ask(q) { return new Promise(r => rl.question(q, r)); }

try {
  console.log('1. Launching VISIBLE browser (persistent session)...');
  await browser.launchBrowser({ headless: false });
  const tabId = await browser.newPage('curve');
  const page = browser.getPage(tabId);

  console.log('2. Navigating to Curve SSO...');
  await browser.navigate(tabId, config.curve.url);
  await page.waitForTimeout(4000);

  // Check if already logged in from saved session
  const urlBefore = page.url();
  const bodyBefore = await page.innerText('body').catch(() => '');
  if (!urlBefore.includes('sso') && !bodyBefore.includes('Log in')) {
    console.log('   Already logged in! (session cookies worked — no MFA needed)');
  } else {
    console.log('3. Filling credentials...');
    await page.fill('#username', config.curve.username);
    await page.fill('input[type="password"]', config.curve.password);

    console.log('4. Clicking Log in...');
    await page.click('button[type="submit"]');
    await page.waitForLoadState('domcontentloaded', { timeout: 30000 });
    await page.waitForTimeout(5000);

    // Check for MFA
    const bodyText = await page.innerText('body').catch(() => '');
    if (bodyText.includes('2-Factor') || bodyText.includes('verification') || bodyText.includes('2-factor')) {
      console.log('5. MFA page detected — check your email for the code.');
      console.log('   (After this one time, future logins will skip MFA.)');

      // Try clicking "Email code" if button exists
      await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button, a'));
        const btn = btns.find(b => /email\s*code/i.test(b.textContent || ''));
        if (btn) btn.click();
      });
      await page.waitForTimeout(3000);

      const code = await ask('\nEnter 6-digit MFA code from your email: ');
      console.log('   Entering code...');

      // Fill the code
      const codeField = await page.$('#mat-input-2') || await page.$('input[type="text"]');
      if (codeField) {
        await codeField.fill(code.trim());
      }

      // Click confirm
      await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const btn = btns.find(b => /confirm|verify|submit/i.test(b.textContent || ''));
        if (btn) btn.click();
      });

      console.log('6. Confirming MFA code...');
      await page.waitForLoadState('domcontentloaded', { timeout: 30000 });
      await page.waitForTimeout(10000);
    }
  }

  console.log('\n7. Current URL:', page.url());
  console.log('   Title:', await page.title());
  console.log('\n   Browser is open on your screen — take a look!');

  await ask('\nPress Enter when ready to close the browser... ');
  
  rl.close();
  await browser.closeBrowser();
  console.log('Done! Session saved — next login should skip MFA.');

} catch (err) {
  console.error('ERROR:', err.message);
  rl.close();
  await browser.closeBrowser().catch(() => {});
}
