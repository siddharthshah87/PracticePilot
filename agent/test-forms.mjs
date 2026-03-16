// Assign forms to Bhimji Hirani (NP) — Monday March 16
// Strategy: use Playwright locators instead of evaluate() where possible
// Key insight from run 1: "Add Form" button (mat-stroked-button) only appears
// when appointment is properly clicked AND Forms pane is open

import * as browser from './src/browser.js';
import { getConfig } from './src/config.js';
import * as readline from 'readline';

const config = getConfig();
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
function ask(q) { return new Promise(r => rl.question(q, r)); }

async function run() {
  console.log('=== Assign Forms: Bhimji Hirani ===\n');

  // 1. Launch & login
  console.log('[1] Launch browser...');
  await browser.launchBrowser({ headless: false });
  const tabId = await browser.newPage('curve');
  const page = browser.getPage(tabId);

  await browser.navigate(tabId, config.curve.url);
  await page.waitForTimeout(4000);

  const url = page.url();
  if (url.includes('sso') || url.includes('login')) {
    console.log('  Logging in...');
    await page.fill('#username', config.curve.username);
    await page.fill('input[type="password"]', config.curve.password);
    await page.click('button[type="submit"]');
    await page.waitForLoadState('domcontentloaded', { timeout: 30000 });
    await page.waitForTimeout(5000);
    const bodyText = await page.innerText('body').catch(() => '');
    if (bodyText.includes('2-Factor') || bodyText.includes('2-factor')) {
      console.log('  MFA required...');
      await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button, a'));
        const btn = btns.find(b => /email\s*code/i.test(b.textContent || ''));
        if (btn) btn.click();
      });
      await page.waitForTimeout(3000);
      const code = await ask('>> Enter 6-digit MFA code: ');
      const codeField = await page.$('#mat-input-2') || await page.$('input[type="text"]');
      if (codeField) await codeField.fill(code.trim());
      await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const btn = btns.find(b => /confirm|verify|submit/i.test(b.textContent || ''));
        if (btn) btn.click();
      });
      await page.waitForLoadState('domcontentloaded', { timeout: 30000 });
      await page.waitForTimeout(10000);
    }
  }
  console.log('  ✓ Logged in\n');

  // 2. Navigate to Week view + March 16
  console.log('[2] Navigate to Monday March 16...');
  // Click Week view
  await page.evaluate(() => {
    const el = Array.from(document.querySelectorAll('a, button, span')).find(e => e.textContent.trim() === 'Week');
    if (el) el.click();
  });
  await page.waitForTimeout(3000);

  // Click "16" in the March 2026 mini calendar
  await page.evaluate(() => {
    const cells = Array.from(document.querySelectorAll('td, a, button, span, div'));
    for (const cell of cells) {
      if ((cell.textContent || '').trim() === '16') {
        let parent = cell.closest('table');
        if (!parent) parent = cell.parentElement?.parentElement?.parentElement;
        const pt = (parent && parent.innerText) ? parent.innerText : '';
        if (pt.includes('March') && pt.includes('2026')) { cell.click(); return; }
      }
    }
  });
  await page.waitForTimeout(4000);

  // Take a screenshot to see current schedule state
  await browser.screenshot(tabId, { filename: 'step2-schedule.png' });
  console.log('  ✓ On schedule\n');

  // 3. Click Bhimji's appointment — try multiple approaches
  console.log('[3] Clicking Bhimji Hirani...');
  
  // Approach A: Use Playwright text locator
  let clicked = false;
  try {
    const bhimjiLoc = page.locator('text=Bhimji').first();
    if (await bhimjiLoc.isVisible({ timeout: 5000 })) {
      await bhimjiLoc.click();
      clicked = true;
      console.log('  ✓ Clicked via text locator');
    }
  } catch (e) {
    console.log('  Text locator failed:', e.message.slice(0, 80));
  }

  // Approach B: Search all divs in schedule for Bhimji text
  if (!clicked) {
    const result = await page.evaluate(() => {
      // Try schedule area first
      let root = document.querySelector('.schedule');
      if (!root) root = document.body;
      const divs = root.querySelectorAll('div, span, td');
      for (const el of divs) {
        if ((el.innerText || '').includes('Bhimji') && el.getBoundingClientRect().height > 20) {
          el.click();
          return 'clicked div containing Bhimji';
        }
      }
      // Try any element containing Bhimji
      const all = document.querySelectorAll('*');
      for (const el of all) {
        if ((el.textContent || '').includes('Bhimji') && el.children.length < 5 && el.getBoundingClientRect().height > 10) {
          el.click();
          return 'clicked element: ' + el.tagName + ' ' + (el.textContent || '').trim().slice(0, 50);
        }
      }
      return 'not found';
    });
    console.log('  Approach B:', result);
    clicked = result !== 'not found';
  }
  
  await page.waitForTimeout(3000);
  await browser.screenshot(tabId, { filename: 'step3-bhimji.png' });

  // Verify Bhimji is loaded in the right panel
  const bodyText = await page.innerText('body').catch(() => '');
  console.log('  Bhimji in page:', bodyText.includes('Bhimji') || bodyText.includes('Hirani'));

  // 4. Open the Forms pane
  console.log('\n[4] Opening Forms section...');
  
  // Find and check the Forms title pane
  const formsResult = await page.evaluate(() => {
    const panes = Array.from(document.querySelectorAll('.dijitTitlePaneTitle'));
    // Find the Forms pane specifically (not "Files and Letters")
    for (const pane of panes) {
      const titleNode = pane.querySelector('.dijitTitlePaneTextNode');
      const text = titleNode ? titleNode.textContent.trim() : (pane.textContent || '').trim();
      if (text === 'Forms' || text === '+ Forms' || text === '- Forms') {
        const isOpen = pane.classList.contains('dijitOpen');
        if (isOpen) {
          return 'Forms already open';
        }
        pane.click();
        return 'clicked to open Forms';
      }
    }
    // Fallback: look for any pane containing just "Forms"
    for (const pane of panes) {
      const text = (pane.textContent || '').trim();
      if (/^\+?\s*Forms$/.test(text) || /^-?\s*Forms$/.test(text)) {
        pane.click();
        return 'clicked Forms (fallback)';
      }
    }
    return 'Forms pane not found';
  });
  console.log('  Result:', formsResult);
  await page.waitForTimeout(3000);

  // 5. Check for "Add Form" button  
  console.log('\n[5] Looking for Add Form button...');

  // Wait for Add Form button to appear (Forms pane loads async content)
  let addFormClicked = false;
  try {
    const addBtn = page.locator('button:has-text("Add Form")').first();
    await addBtn.waitFor({ state: 'visible', timeout: 15000 });
    console.log('  ✓ "Add Form" button visible');
    
    // Screenshot right before clicking
    await browser.screenshot(tabId, { filename: 'step5-before-add.png' });
    
    await addBtn.click();
    addFormClicked = true;
    console.log('  ✓ Clicked "Add Form"');
  } catch (e) {
    console.log('  Button wait failed:', e.message.slice(0, 100));
    
    // List all visible buttons for debugging
    const visibleBtns = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('button'))
        .filter(b => b.offsetParent !== null)
        .map(b => (b.textContent || '').trim())
        .filter(t => t.length > 0 && t.length < 50);
    });
    console.log('  Visible buttons:', visibleBtns.join(' | '));
  }
  
  await page.waitForTimeout(3000);
  await browser.screenshot(tabId, { filename: 'step5-after-add.png' });

  if (!addFormClicked) {
    console.log('\n  !! Add Form button not found. Dumping page state...');
    // Dump the state around the Forms section for debugging
    const formsSectionHTML = await page.evaluate(() => {
      const panes = Array.from(document.querySelectorAll('.dijitTitlePaneTitle'));
      for (const pane of panes) {
        const text = (pane.textContent || '').trim();
        if (text.includes('Forms') && !text.includes('Files')) {
          const container = pane.closest('.dijitTitlePane');
          if (container) {
            return container.outerHTML.slice(0, 3000);
          }
        }
      }
      return 'no forms container found';
    });
    console.log('  Forms HTML:', formsSectionHTML.slice(0, 500));
    
    // Ask user to check screen
    await ask('\n>> Add Form not found. Check the browser and press Enter to continue...');
  }

  // 6. Explore the dialog/form that opened
  console.log('\n[6] Exploring the add-form dialog...');
  
  // Check for dialogs/overlays
  const dialogInfo = await page.evaluate(() => {
    const selectors = [
      'mat-dialog-container',
      '.mat-dialog-container', 
      '.cdk-overlay-pane',
      '[role="dialog"]',
      '.dijitDialog',
      '.dijitDialogPaneContent',
      '.modal',
      '.modal-dialog',
      '[class*="dialog"]',
      '[class*="Dialog"]',
    ];
    
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && (el.offsetParent !== null || el.clientHeight > 0)) {
        const text = (el.innerText || '').trim();
        if (text.length > 10) {
          return { selector: sel, text: text.slice(0, 3000) };
        }
      }
    }
    return null;
  });

  if (dialogInfo) {
    console.log(`  Found dialog (${dialogInfo.selector}):`);
    console.log('  ', dialogInfo.text.slice(0, 800).replace(/\n/g, '\n    '));
  } else {
    console.log('  No dialog found. Checking overlay panel...');
    const overlayText = await page.evaluate(() => {
      const overlays = document.querySelectorAll('.cdk-overlay-container *');
      let text = '';
      for (const el of overlays) {
        if (el.offsetParent !== null && el.children.length === 0) {
          const t = (el.textContent || '').trim();
          if (t) text += t + '\n';
        }
      }
      return text || 'empty';
    });
    console.log('  Overlay text:', overlayText.slice(0, 500));
  }

  // 7. Find and interact with category selection
  console.log('\n[7] Category selection...');
  
  // Look for all mat-select, select, dropdown elements
  const formElements = await page.evaluate(() => {
    const result = [];
    // Angular Material elements
    const matSels = document.querySelectorAll('mat-select, mat-form-field, mat-checkbox, mat-list-item, mat-radio-button');
    for (const el of matSels) {
      if (el.offsetParent !== null || el.clientHeight > 0) {
        result.push({
          tag: el.tagName.toLowerCase(),
          text: (el.textContent || '').trim().slice(0, 80),
          cls: (el.className || '').toString().slice(0, 50),
        });
      }
    }
    // Regular form elements
    const inputs = document.querySelectorAll('select, input[type="checkbox"], input[type="radio"]');
    for (const el of inputs) {
      if (el.offsetParent !== null) {
        const label = el.closest('label, .mat-form-field')?.textContent?.trim() || '';
        result.push({
          tag: el.tagName.toLowerCase() + '[' + (el.type || '') + ']',
          text: label.slice(0, 80),
          cls: (el.className || '').toString().slice(0, 50),
        });
      }
    }
    return result.slice(0, 30);
  });
  
  console.log(`  Form elements: ${formElements.length}`);
  for (const el of formElements) {
    console.log(`    [${el.tag}] "${el.text}"`);
  }

  // Try clicking "New Patient" or "New" in the dialog
  const catResult = await page.evaluate(() => {
    // First check inside dialog/overlay
    const containers = document.querySelectorAll('.cdk-overlay-pane, mat-dialog-container, [role="dialog"], .dijitDialog');
    let scope = [];
    for (const c of containers) {
      if (c.offsetParent !== null || c.clientHeight > 0) {
        scope.push(...Array.from(c.querySelectorAll('*')));
      }
    }
    if (scope.length === 0) scope = Array.from(document.querySelectorAll('*'));
    
    // Look for category items - "New Patient", "New", etc.
    for (const el of scope) {
      const text = (el.textContent || '').trim();
      if (/^New Patient$/i.test(text) && el.offsetParent !== null) {
        el.click();
        return 'clicked "New Patient"';
      }
    }
    for (const el of scope) {
      const text = (el.textContent || '').trim();
      if (/^New$/i.test(text) && el.offsetParent !== null) {
        el.click();
        return 'clicked "New"';
      }
    }
    // Try mat-option elements
    const opts = document.querySelectorAll('mat-option, [role="option"]');
    for (const opt of opts) {
      const text = (opt.textContent || '').trim();
      if (/new/i.test(text)) {
        opt.click();
        return 'clicked option: ' + text;
      }
    }
    return 'no category found';
  });
  console.log('  Category:', catResult);
  await page.waitForTimeout(2000);
  await browser.screenshot(tabId, { filename: 'step7-category.png' });

  // 8. Select all checkboxes/forms
  console.log('\n[8] Selecting all forms...');
  
  const cbInfo = await page.evaluate(() => {
    const cbs = Array.from(document.querySelectorAll('mat-checkbox, input[type="checkbox"], [role="checkbox"]'));
    const visible = cbs.filter(c => c.offsetParent !== null);
    let checked = 0;
    for (const cb of visible) {
      const isChecked = cb.classList.contains('mat-checkbox-checked') || 
                        cb.checked || 
                        cb.getAttribute('aria-checked') === 'true';
      if (!isChecked) {
        cb.click();
        checked++;
      }
    }
    return { total: visible.length, checked };
  });
  console.log(`  Checkboxes: ${cbInfo.total} total, ${cbInfo.checked} newly checked`);

  // Also try "Select All" if available
  const selAll = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('*'));
    for (const el of els) {
      if (/^select all$/i.test((el.textContent || '').trim()) && el.offsetParent !== null && el.children.length <= 2) {
        el.click();
        return 'clicked Select All';
      }
    }
    return 'no Select All';
  });
  console.log('  Select All:', selAll);
  await page.waitForTimeout(2000);
  await browser.screenshot(tabId, { filename: 'step8-selected.png' });

  // 9. Click Assign/Save/Submit
  console.log('\n[9] Assigning...');
  const assignResult = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const targets = ['Assign', 'Save', 'Submit', 'Done', 'Confirm', 'OK', 'Apply', 'Add'];
    for (const target of targets) {
      for (const btn of btns) {
        if ((btn.textContent || '').trim() === target && btn.offsetParent !== null) {
          btn.click();
          return 'clicked: ' + target;
        }
      }
    }
    return 'no assign button found — buttons: ' + btns.filter(b => b.offsetParent !== null).map(b => (b.textContent || '').trim()).filter(t => t.length < 20).join(', ');
  });
  console.log('  Result:', assignResult);
  await page.waitForTimeout(3000);
  await browser.screenshot(tabId, { filename: 'step9-assigned.png' });

  console.log('\n=== Done! Check browser. ===\n');
  await ask('Press Enter to close browser... ');
  rl.close();
  await browser.closeBrowser();
}

try {
  await run();
} catch (err) {
  console.error('FATAL:', err.message, err.stack);
  rl.close();
  await browser.closeBrowser().catch(() => {});
}
