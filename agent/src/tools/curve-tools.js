// Curve Dental workflow tools.
// Compound actions that automate common tasks inside Curve Hero.

import { z } from 'zod';
import * as browser from '../browser.js';
import { getConfig } from '../config.js';

// Internal helpers

async function ensureLoggedIn(tabId) {
  const page = browser.getPage(tabId);
  const url = page.url();
  // If we're on the login page or a blank page, we need to log in
  if (url === 'about:blank' || url.includes('login') || url.includes('signin')) {
    return false;
  }
  // Check for a Curve-specific element that indicates logged-in state
  const loggedIn = await page.evaluate(() => {
    return !!(
      document.querySelector('[class*="patient"]') ||
      document.querySelector('[class*="schedule"]') ||
      document.querySelector('[class*="nav"]') ||
      document.querySelector('#app')
    );
  }).catch(() => false);
  return loggedIn;
}

export function registerCurveTools(server) {

  server.tool(
    'curve_login',
    'Log into Curve Dental (curvehero.com). Opens a new tab, navigates to Curve, and enters credentials from config. Returns the tab ID for subsequent Curve operations.',
    { 
      username: z.string().optional().describe('Override username from config'),
      password: z.string().optional().describe('Override password from config'),
    },
    async ({ username, password }) => {
      const config = getConfig();
      const user = username || config.curve.username;
      const pass = password || config.curve.password;

      if (!user || !pass) {
        return {
          content: [{ type: 'text', text: 'Error: Curve credentials not set. Add them to config.json or pass as parameters.' }],
          isError: true,
        };
      }

      await browser.launchBrowser();
      const tabId = await browser.newPage('curve');
      const page = browser.getPage(tabId);

      await browser.navigate(tabId, config.curve.url);

      // Wait for login form — Curve uses various login page structures
      // Try common patterns
      try {
        await page.waitForSelector('input[type="email"], input[name="username"], input[name="email"], #username, #email', { timeout: 15000 });
        
        // Fill username
        const usernameSelector = await page.evaluate(() => {
          const selectors = ['input[type="email"]', 'input[name="username"]', 'input[name="email"]', '#username', '#email'];
          for (const s of selectors) {
            if (document.querySelector(s)) return s;
          }
          return null;
        });

        if (usernameSelector) {
          await page.fill(usernameSelector, user);
        }

        // Fill password
        const passwordSelector = 'input[type="password"]';
        await page.waitForSelector(passwordSelector, { timeout: 5000 });
        await page.fill(passwordSelector, pass);

        // Click login button
        const loginBtn = await page.evaluate(() => {
          const btns = Array.from(document.querySelectorAll('button, input[type="submit"]'));
          const login = btns.find(b => /log\s*in|sign\s*in|submit/i.test(b.textContent || b.value || ''));
          if (login) {
            login.click();
            return true;
          }
          return false;
        });

        if (!loginBtn) {
          await page.keyboard.press('Enter');
        }

        // Wait for navigation away from login page
        await page.waitForLoadState('domcontentloaded', { timeout: 30000 });
        await page.waitForTimeout(3000); // Allow SPA to settle

        const currentUrl = page.url();
        const title = await page.title();

        return {
          content: [{ type: 'text', text: JSON.stringify({ tabId, url: currentUrl, title, status: 'logged_in' }) }],
        };
      } catch (err) {
        const screenshotPath = await browser.screenshot(tabId, { filename: 'curve-login-error.png' });
        return {
          content: [{ type: 'text', text: `Login failed: ${err.message}. Screenshot: ${screenshotPath}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    'curve_get_schedule',
    'Get the patient schedule from Curve for a given date. Returns a list of patients with appointment times. Requires an active Curve tab (use curve_login first).',
    {
      tabId: z.number().describe('Tab ID of the logged-in Curve session'),
      date: z.string().optional().describe('Date to get schedule for (YYYY-MM-DD). Default: today'),
    },
    async ({ tabId, date }) => {
      const page = browser.getPage(tabId);

      try {
        // Navigate to schedule view
        // Curve typically has a schedule/calendar area
        const scheduleSelectors = [
          'a[href*="schedule"]', 'a[href*="calendar"]',
          '[class*="schedule"]', '[class*="calendar"]',
          'nav a:has-text("Schedule")', 'nav a:has-text("Calendar")',
        ];

        let found = false;
        for (const sel of scheduleSelectors) {
          try {
            const el = await page.$(sel);
            if (el) {
              await el.click();
              found = true;
              break;
            }
          } catch {}
        }

        if (!found) {
          // Try navigating directly
          const baseUrl = page.url().split('/').slice(0, 3).join('/');
          await page.goto(`${baseUrl}/schedule`, { waitUntil: 'domcontentloaded' });
        }

        await page.waitForTimeout(3000);

        // If a specific date was requested, try to navigate to it
        if (date) {
          // Try to find a date picker or input
          const dateInput = await page.$('input[type="date"], input[class*="date"]');
          if (dateInput) {
            await dateInput.fill(date);
            await page.waitForTimeout(2000);
          }
        }

        // Extract schedule content
        const content = await page.evaluate(() => {
          // Try to grab the main content area with schedule data
          const mainContent = document.querySelector(
            '[class*="schedule"], [class*="calendar"], [class*="appointment"], main, .content, #content'
          );
          return mainContent ? mainContent.innerText : document.body.innerText;
        });

        // Truncate if massive
        const truncated = content.length > 30000 ? content.slice(0, 30000) + '\n...(truncated)' : content;

        return {
          content: [{ type: 'text', text: truncated }],
        };
      } catch (err) {
        const screenshotPath = await browser.screenshot(tabId, { filename: 'curve-schedule-error.png' });
        return {
          content: [{ type: 'text', text: `Failed to get schedule: ${err.message}. Screenshot: ${screenshotPath}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    'curve_open_patient',
    'Open a specific patient\'s chart in Curve by searching for their name. Returns patient info and available tabs.',
    {
      tabId: z.number().describe('Tab ID of the logged-in Curve session'),
      patientName: z.string().describe('Patient name to search for'),
    },
    async ({ tabId, patientName }) => {
      const page = browser.getPage(tabId);

      try {
        // Look for a patient search field
        const searchSelectors = [
          'input[placeholder*="patient" i]', 'input[placeholder*="search" i]',
          'input[class*="search"]', 'input[aria-label*="search" i]',
          '#patient-search', '#search',
        ];

        let searchInput = null;
        for (const sel of searchSelectors) {
          searchInput = await page.$(sel);
          if (searchInput) break;
        }

        if (!searchInput) {
          // Try clicking a search icon first
          const searchIcon = await page.$('[class*="search-icon"], [class*="magnif"], button[aria-label*="search" i]');
          if (searchIcon) {
            await searchIcon.click();
            await page.waitForTimeout(1000);
            for (const sel of searchSelectors) {
              searchInput = await page.$(sel);
              if (searchInput) break;
            }
          }
        }

        if (!searchInput) {
          return {
            content: [{ type: 'text', text: 'Could not find patient search field. Try navigating to the patient list first.' }],
            isError: true,
          };
        }

        await searchInput.fill(patientName);
        await page.waitForTimeout(2000); // Wait for search results

        // Click on the first result
        const resultSelectors = [
          '[class*="search-result"]', '[class*="patient-result"]',
          '[class*="dropdown"] a', '[class*="autocomplete"] li',
          'table tbody tr', '.list-item',
        ];

        let clicked = false;
        for (const sel of resultSelectors) {
          const results = await page.$$(sel);
          for (const result of results) {
            const text = await result.innerText().catch(() => '');
            if (text.toLowerCase().includes(patientName.toLowerCase().split(' ')[0])) {
              await result.click();
              clicked = true;
              break;
            }
          }
          if (clicked) break;
        }

        if (!clicked) {
          await page.keyboard.press('Enter');
        }

        await page.waitForTimeout(3000);

        // Read the patient chart content
        const content = await page.evaluate(() => {
          const main = document.querySelector('main, .content, #content, [class*="patient"]');
          return main ? main.innerText : document.body.innerText;
        });

        const truncated = content.length > 20000 ? content.slice(0, 20000) + '\n...(truncated)' : content;
        const currentUrl = page.url();

        return {
          content: [{ type: 'text', text: JSON.stringify({ url: currentUrl, patientName, chartContent: truncated }) }],
        };
      } catch (err) {
        const screenshotPath = await browser.screenshot(tabId, { filename: 'curve-patient-error.png' });
        return {
          content: [{ type: 'text', text: `Failed to open patient: ${err.message}. Screenshot: ${screenshotPath}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    'curve_get_patient_info',
    'Read a patient\'s info from their Curve chart. Navigates through profile, insurance, billing, and claims tabs to collect all data.',
    {
      tabId: z.number().describe('Tab ID with a patient chart open'),
      tabs: z.array(z.string()).optional().describe('Which tabs to read: profile, insurance, billing, claims, recare, charting. Default: all'),
    },
    async ({ tabId, tabs: requestedTabs }) => {
      const page = browser.getPage(tabId);
      const tabsToRead = requestedTabs || ['profile', 'insurance', 'billing', 'claims'];
      const results = {};

      for (const tabName of tabsToRead) {
        try {
          // Click the tab
          const tabSelectors = [
            `a:has-text("${tabName}")`,
            `button:has-text("${tabName}")`,
            `[class*="tab"]:has-text("${tabName}")`,
            `li:has-text("${tabName}")`,
          ];

          let clicked = false;
          for (const sel of tabSelectors) {
            try {
              await page.click(sel, { timeout: 3000 });
              clicked = true;
              break;
            } catch {}
          }

          if (!clicked) {
            results[tabName] = '(tab not found)';
            continue;
          }

          await page.waitForTimeout(2000);

          // Read tab content
          const content = await page.evaluate(() => {
            const main = document.querySelector('main, .content, #content, [class*="tab-content"], [class*="panel"]');
            return main ? main.innerText : document.body.innerText;
          });

          results[tabName] = content.length > 10000 ? content.slice(0, 10000) + '...(truncated)' : content;
        } catch (err) {
          results[tabName] = `(error: ${err.message})`;
        }
      }

      return {
        content: [{ type: 'text', text: JSON.stringify(results, null, 2) }],
      };
    }
  );

  server.tool(
    'curve_get_claims',
    'Get outstanding or denied claims from Curve for a patient or the whole practice.',
    {
      tabId: z.number().describe('Tab ID of the logged-in Curve session'),
      filter: z.enum(['outstanding', 'denied', 'all']).optional().describe('Filter claims. Default: outstanding'),
    },
    async ({ tabId, filter }) => {
      const page = browser.getPage(tabId);
      const claimFilter = filter || 'outstanding';

      try {
        // Navigate to claims/billing area
        const claimsNav = [
          'a:has-text("Claims")', 'a:has-text("Billing")',
          'a[href*="claims"]', 'a[href*="billing"]',
          '[class*="claims"]', '[class*="billing"]',
        ];

        let found = false;
        for (const sel of claimsNav) {
          try {
            await page.click(sel, { timeout: 3000 });
            found = true;
            break;
          } catch {}
        }

        if (!found) {
          const baseUrl = page.url().split('/').slice(0, 3).join('/');
          await page.goto(`${baseUrl}/claims`, { waitUntil: 'domcontentloaded' });
        }

        await page.waitForTimeout(3000);

        // Try to apply filter
        if (claimFilter !== 'all') {
          try {
            const filterSel = `[class*="filter"] option[value*="${claimFilter}"], button:has-text("${claimFilter}")`;
            await page.click(filterSel, { timeout: 3000 });
            await page.waitForTimeout(2000);
          } catch {
            // Filter might not exist — just read whatever is shown
          }
        }

        const content = await page.evaluate(() => {
          const main = document.querySelector('table, [class*="claims"], [class*="list"], main, .content');
          return main ? main.innerText : document.body.innerText;
        });

        const truncated = content.length > 30000 ? content.slice(0, 30000) + '\n...(truncated)' : content;

        return {
          content: [{ type: 'text', text: truncated }],
        };
      } catch (err) {
        const screenshotPath = await browser.screenshot(tabId, { filename: 'curve-claims-error.png' });
        return {
          content: [{ type: 'text', text: `Failed to get claims: ${err.message}. Screenshot: ${screenshotPath}` }],
          isError: true,
        };
      }
    }
  );
}
