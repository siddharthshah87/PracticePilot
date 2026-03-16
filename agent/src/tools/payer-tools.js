// Payer portal workflow tools.
// Login and interact with insurance company websites.

import { z } from 'zod';
import * as browser from '../browser.js';
import { getConfig } from '../config.js';

const PAYER_IDS = [
  'delta_dental', 'cigna', 'metlife', 'aetna',
  'humana', 'united', 'anthem', 'guardian', 'bcbs',
];

export function registerPayerTools(server) {

  server.tool(
    'payer_login',
    `Log into an insurance payer portal. Supported payers: ${PAYER_IDS.join(', ')}. Returns tag ID for subsequent operations on that payer.`,
    {
      payer: z.enum(PAYER_IDS).describe('Payer ID from config'),
      username: z.string().optional().describe('Override username from config'),
      password: z.string().optional().describe('Override password from config'),
    },
    async ({ payer, username, password }) => {
      const config = getConfig();
      const payerConfig = config.payers[payer];
      if (!payerConfig) {
        return { content: [{ type: 'text', text: `Unknown payer: ${payer}` }], isError: true };
      }

      const user = username || payerConfig.username;
      const pass = password || payerConfig.password;

      if (!user || !pass) {
        return {
          content: [{ type: 'text', text: `No credentials for ${payerConfig.label}. Set them in config.json or pass as parameters.` }],
          isError: true,
        };
      }

      await browser.launchBrowser();
      const tabId = await browser.newPage(payerConfig.label);
      const page = browser.getPage(tabId);

      try {
        await browser.navigate(tabId, payerConfig.url);
        await page.waitForTimeout(3000);

        // Generic login flow — works for most payer portals
        // Step 1: Find and fill username
        const usernameSelectors = [
          'input[type="email"]', 'input[name="username"]', 'input[name="email"]',
          'input[name="userId"]', 'input[name="login"]', 'input[id*="user" i]',
          'input[id*="email" i]', 'input[id*="login" i]', 'input[placeholder*="user" i]',
          'input[placeholder*="email" i]', 'input[placeholder*="id" i]',
        ];

        let usernameField = null;
        for (const sel of usernameSelectors) {
          usernameField = await page.$(sel);
          if (usernameField) {
            await usernameField.fill(user);
            break;
          }
        }

        if (!usernameField) {
          // Some sites have a "Continue" step before password
          const inputs = await page.$$('input[type="text"]');
          if (inputs.length > 0) {
            await inputs[0].fill(user);
          }
        }

        // Step 2: Find and fill password
        const passwordField = await page.$('input[type="password"]');
        if (passwordField) {
          await passwordField.fill(pass);
        } else {
          // Some sites show password field after username submission
          await page.keyboard.press('Enter');
          await page.waitForTimeout(3000);
          const passField = await page.$('input[type="password"]');
          if (passField) {
            await passField.fill(pass);
          }
        }

        // Step 3: Click login/submit button
        const submitted = await page.evaluate(() => {
          const btns = Array.from(document.querySelectorAll('button, input[type="submit"], a[role="button"]'));
          const loginBtn = btns.find(b =>
            /log\s*in|sign\s*in|submit|continue/i.test(b.textContent || b.value || '')
          );
          if (loginBtn) {
            loginBtn.click();
            return true;
          }
          return false;
        });

        if (!submitted) {
          await page.keyboard.press('Enter');
        }

        await page.waitForLoadState('domcontentloaded', { timeout: 30000 });
        await page.waitForTimeout(5000);

        const currentUrl = page.url();
        const title = await page.title();

        return {
          content: [{ type: 'text', text: JSON.stringify({
            tabId, payer, label: payerConfig.label, url: currentUrl, title, status: 'logged_in'
          }) }],
        };
      } catch (err) {
        const screenshotPath = await browser.screenshot(tabId, { filename: `${payer}-login-error.png` });
        return {
          content: [{ type: 'text', text: `Login to ${payerConfig.label} failed: ${err.message}. Screenshot: ${screenshotPath}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    'payer_check_eligibility',
    'Check eligibility/benefits for a patient on a payer portal. The payer tab must already be logged in.',
    {
      tabId: z.number().describe('Tab ID of the logged-in payer session'),
      subscriberId: z.string().describe('Subscriber/member ID number'),
      patientName: z.string().optional().describe('Patient name (first last)'),
      dob: z.string().optional().describe('Patient date of birth (MM/DD/YYYY)'),
    },
    async ({ tabId, subscriberId, patientName, dob }) => {
      const page = browser.getPage(tabId);

      try {
        // Navigate to eligibility section
        const eligSelectors = [
          'a:has-text("Eligibility")', 'a:has-text("Benefits")',
          'a:has-text("Verify")', 'a[href*="eligib"]',
          'a[href*="benefit"]', 'a[href*="verify"]',
          'button:has-text("Eligibility")', '[class*="eligib"]',
        ];

        let found = false;
        for (const sel of eligSelectors) {
          try {
            await page.click(sel, { timeout: 3000 });
            found = true;
            break;
          } catch {}
        }

        await page.waitForTimeout(3000);

        // Fill in the eligibility form
        // Try subscriber/member ID field
        const idSelectors = [
          'input[name*="subscriber" i]', 'input[name*="member" i]',
          'input[name*="id" i]', 'input[placeholder*="member" i]',
          'input[placeholder*="subscriber" i]', 'input[placeholder*="id" i]',
          'input[id*="member" i]', 'input[id*="subscriber" i]',
        ];

        for (const sel of idSelectors) {
          const field = await page.$(sel);
          if (field) {
            await field.fill(subscriberId);
            break;
          }
        }

        // Fill DOB if provided
        if (dob) {
          const dobSelectors = [
            'input[name*="dob" i]', 'input[name*="birth" i]',
            'input[name*="date" i]', 'input[placeholder*="birth" i]',
            'input[placeholder*="dob" i]', 'input[placeholder*="mm/dd" i]',
            'input[type="date"]',
          ];
          for (const sel of dobSelectors) {
            const field = await page.$(sel);
            if (field) {
              await field.fill(dob);
              break;
            }
          }
        }

        // Fill patient name if provided
        if (patientName) {
          const [first, ...lastParts] = patientName.split(' ');
          const last = lastParts.join(' ');

          const firstNameField = await page.$('input[name*="first" i], input[placeholder*="first" i]');
          if (firstNameField) await firstNameField.fill(first);

          const lastNameField = await page.$('input[name*="last" i], input[placeholder*="last" i]');
          if (lastNameField) await lastNameField.fill(last);
        }

        // Submit the form
        const submitted = await page.evaluate(() => {
          const btns = Array.from(document.querySelectorAll('button, input[type="submit"]'));
          const submitBtn = btns.find(b =>
            /submit|search|check|verify|look\s*up/i.test(b.textContent || b.value || '')
          );
          if (submitBtn) {
            submitBtn.click();
            return true;
          }
          return false;
        });

        if (!submitted) {
          await page.keyboard.press('Enter');
        }

        await page.waitForTimeout(8000); // Eligibility lookups can be slow

        // Read the results
        const content = await page.evaluate(() => {
          const main = document.querySelector(
            '[class*="result"], [class*="eligib"], [class*="benefit"], [class*="detail"], main, .content'
          );
          return main ? main.innerText : document.body.innerText;
        });

        const truncated = content.length > 40000 ? content.slice(0, 40000) + '\n...(truncated)' : content;

        return {
          content: [{ type: 'text', text: truncated }],
        };
      } catch (err) {
        const screenshotPath = await browser.screenshot(tabId, { filename: `eligibility-error-${Date.now()}.png` });
        return {
          content: [{ type: 'text', text: `Eligibility check failed: ${err.message}. Screenshot: ${screenshotPath}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    'payer_get_claim_status',
    'Check the status of a specific claim on a payer portal.',
    {
      tabId: z.number().describe('Tab ID of the logged-in payer session'),
      claimNumber: z.string().optional().describe('Claim number to look up'),
      subscriberId: z.string().optional().describe('Subscriber/member ID'),
      dateOfService: z.string().optional().describe('Date of service (MM/DD/YYYY)'),
    },
    async ({ tabId, claimNumber, subscriberId, dateOfService }) => {
      const page = browser.getPage(tabId);

      try {
        // Navigate to claims section
        const claimNav = [
          'a:has-text("Claims")', 'a:has-text("Claim Status")',
          'a[href*="claim"]', 'button:has-text("Claims")',
        ];

        for (const sel of claimNav) {
          try {
            await page.click(sel, { timeout: 3000 });
            break;
          } catch {}
        }

        await page.waitForTimeout(3000);

        // Fill claim search form
        if (claimNumber) {
          const claimField = await page.$('input[name*="claim" i], input[placeholder*="claim" i], input[id*="claim" i]');
          if (claimField) await claimField.fill(claimNumber);
        }

        if (subscriberId) {
          const idField = await page.$('input[name*="member" i], input[name*="subscriber" i]');
          if (idField) await idField.fill(subscriberId);
        }

        if (dateOfService) {
          const dateField = await page.$('input[name*="date" i], input[name*="service" i], input[type="date"]');
          if (dateField) await dateField.fill(dateOfService);
        }

        // Submit
        const submitted = await page.evaluate(() => {
          const btns = Array.from(document.querySelectorAll('button, input[type="submit"]'));
          const btn = btns.find(b => /submit|search|check|look/i.test(b.textContent || b.value || ''));
          if (btn) { btn.click(); return true; }
          return false;
        });
        if (!submitted) await page.keyboard.press('Enter');

        await page.waitForTimeout(5000);

        const content = await page.evaluate(() => {
          const main = document.querySelector('[class*="result"], [class*="claim"], main, .content');
          return main ? main.innerText : document.body.innerText;
        });

        const truncated = content.length > 30000 ? content.slice(0, 30000) + '\n...(truncated)' : content;

        return { content: [{ type: 'text', text: truncated }] };
      } catch (err) {
        const screenshotPath = await browser.screenshot(tabId, { filename: `claim-status-error-${Date.now()}.png` });
        return {
          content: [{ type: 'text', text: `Claim status check failed: ${err.message}. Screenshot: ${screenshotPath}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    'payer_download_eob',
    'Download EOB (Explanation of Benefits) documents from a payer portal.',
    {
      tabId: z.number().describe('Tab ID of the logged-in payer session'),
      claimNumber: z.string().optional().describe('Claim number for specific EOB'),
    },
    async ({ tabId, claimNumber }) => {
      const page = browser.getPage(tabId);

      try {
        // Navigate to EOB section
        const eobNav = [
          'a:has-text("EOB")', 'a:has-text("Explanation")',
          'a:has-text("Remittance")', 'a:has-text("ERA")',
          'a[href*="eob"]', 'a[href*="remit"]',
        ];

        for (const sel of eobNav) {
          try {
            await page.click(sel, { timeout: 3000 });
            break;
          } catch {}
        }

        await page.waitForTimeout(3000);

        if (claimNumber) {
          const searchField = await page.$('input[name*="claim" i], input[placeholder*="claim" i], input[name*="search" i]');
          if (searchField) {
            await searchField.fill(claimNumber);
            await page.keyboard.press('Enter');
            await page.waitForTimeout(3000);
          }
        }

        // Try to click download/view links
        const downloadLinks = await page.$$('a[href*="download"], a[href*="eob"], a[href*="pdf"], button:has-text("Download"), button:has-text("View")');

        const results = [];
        for (const link of downloadLinks.slice(0, 5)) { // limit to 5
          const text = await link.innerText().catch(() => '');
          const href = await link.getAttribute('href').catch(() => '');
          results.push({ text: text.trim(), href });
        }

        // Screenshot the page for reference
        const screenshotPath = await browser.screenshot(tabId, { filename: `eob-${Date.now()}.png` });

        return {
          content: [{ type: 'text', text: JSON.stringify({ 
            downloadLinks: results, 
            screenshot: screenshotPath,
            note: 'Download links found. Use navigate or click to download specific EOBs.'
          }, null, 2) }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text', text: `EOB download failed: ${err.message}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    'list_payers',
    'List all configured payer portals and their login status.',
    {},
    async () => {
      const config = getConfig();
      const payers = Object.entries(config.payers).map(([id, p]) => ({
        id,
        label: p.label,
        url: p.url,
        hasCredentials: !!(p.username && p.password),
      }));
      return { content: [{ type: 'text', text: JSON.stringify(payers, null, 2) }] };
    }
  );
}
