// Batch operation tools — compound workflows that loop over multiple patients/claims.

import { z } from 'zod';
import * as browser from '../browser.js';
import { getConfig } from '../config.js';

export function registerBatchTools(server) {

  server.tool(
    'batch_eligibility_check',
    'Run eligibility checks for a list of patients. Logs into Curve, gets the schedule, then checks each patient against their payer portal. Returns a structured report.',
    {
      date: z.string().optional().describe('Schedule date (YYYY-MM-DD). Default: today'),
      patients: z.array(z.object({
        name: z.string().describe('Patient name'),
        subscriberId: z.string().describe('Insurance member/subscriber ID'),
        payer: z.string().describe('Payer ID (e.g. delta_dental, cigna)'),
        dob: z.string().optional().describe('Date of birth (MM/DD/YYYY)'),
      })).optional().describe('Explicit patient list. If omitted, will attempt to pull from Curve schedule.'),
    },
    async ({ date, patients }) => {
      const results = [];
      const errors = [];

      try {
        await browser.launchBrowser();

        // If no patient list provided, we need the agent to get it from Curve first
        if (!patients || patients.length === 0) {
          return {
            content: [{ type: 'text', text: JSON.stringify({
              status: 'needs_patient_list',
              message: 'No patient list provided. Use curve_login + curve_get_schedule to get today\'s patients, then call batch_eligibility_check again with the patient list.',
              hint: 'Each patient needs: name, subscriberId, payer, and optionally dob',
            }, null, 2) }],
          };
        }

        // Group patients by payer to minimize logins
        const byPayer = {};
        for (const patient of patients) {
          if (!byPayer[patient.payer]) byPayer[patient.payer] = [];
          byPayer[patient.payer].push(patient);
        }

        const config = getConfig();

        for (const [payerId, payerPatients] of Object.entries(byPayer)) {
          const payerConfig = config.payers[payerId];
          if (!payerConfig) {
            errors.push({ payer: payerId, error: 'Unknown payer — not in config' });
            continue;
          }

          if (!payerConfig.username || !payerConfig.password) {
            errors.push({ payer: payerId, error: 'No credentials configured' });
            continue;
          }

          // Log into payer portal
          const tabId = await browser.newPage(payerConfig.label);
          const page = browser.getPage(tabId);

          try {
            await browser.navigate(tabId, payerConfig.url);
            await page.waitForTimeout(3000);

            // Generic login
            const usernameSelectors = [
              'input[type="email"]', 'input[name="username"]', 'input[name="email"]',
              'input[name="userId"]', 'input[id*="user" i]', 'input[id*="email" i]',
            ];
            for (const sel of usernameSelectors) {
              const field = await page.$(sel);
              if (field) { await field.fill(payerConfig.username); break; }
            }

            const passField = await page.$('input[type="password"]');
            if (passField) await passField.fill(payerConfig.password);

            await page.evaluate(() => {
              const btns = Array.from(document.querySelectorAll('button, input[type="submit"]'));
              const btn = btns.find(b => /log\s*in|sign\s*in|submit/i.test(b.textContent || b.value || ''));
              if (btn) btn.click();
            });
            await page.waitForTimeout(5000);

            // Check each patient
            for (const patient of payerPatients) {
              try {
                // Navigate to eligibility
                const eligNav = ['a:has-text("Eligibility")', 'a:has-text("Benefits")', 'a[href*="eligib"]'];
                for (const sel of eligNav) {
                  try { await page.click(sel, { timeout: 3000 }); break; } catch {}
                }
                await page.waitForTimeout(2000);

                // Fill subscriber ID
                const idSelectors = [
                  'input[name*="subscriber" i]', 'input[name*="member" i]',
                  'input[name*="id" i]', 'input[placeholder*="member" i]',
                ];
                for (const sel of idSelectors) {
                  const field = await page.$(sel);
                  if (field) { await field.fill(patient.subscriberId); break; }
                }

                if (patient.dob) {
                  const dobField = await page.$('input[name*="dob" i], input[name*="birth" i], input[type="date"]');
                  if (dobField) await dobField.fill(patient.dob);
                }

                // Submit
                await page.evaluate(() => {
                  const btns = Array.from(document.querySelectorAll('button, input[type="submit"]'));
                  const btn = btns.find(b => /submit|search|check|verify/i.test(b.textContent || b.value || ''));
                  if (btn) btn.click();
                });
                await page.waitForTimeout(6000);

                const content = await page.evaluate(() => {
                  const main = document.querySelector('[class*="result"], [class*="eligib"], [class*="benefit"], main');
                  return main ? main.innerText : document.body.innerText;
                });

                results.push({
                  patient: patient.name,
                  payer: payerId,
                  subscriberId: patient.subscriberId,
                  status: 'checked',
                  rawContent: content.slice(0, 5000),
                });
              } catch (err) {
                results.push({
                  patient: patient.name,
                  payer: payerId,
                  subscriberId: patient.subscriberId,
                  status: 'error',
                  error: err.message,
                });
              }
            }
          } catch (err) {
            errors.push({ payer: payerId, error: `Login failed: ${err.message}` });
          } finally {
            await browser.closePage(tabId);
          }
        }

        const report = {
          date: date || new Date().toISOString().split('T')[0],
          totalPatients: patients.length,
          checked: results.filter(r => r.status === 'checked').length,
          errored: results.filter(r => r.status === 'error').length,
          results,
          errors,
        };

        return { content: [{ type: 'text', text: JSON.stringify(report, null, 2) }] };

      } catch (err) {
        return {
          content: [{ type: 'text', text: `Batch eligibility failed: ${err.message}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    'batch_claims_followup',
    'Check status of all outstanding claims across payer portals. Provide a list of claims to check.',
    {
      claims: z.array(z.object({
        claimNumber: z.string().describe('Claim number'),
        payer: z.string().describe('Payer ID'),
        patientName: z.string().optional(),
        dateOfService: z.string().optional(),
        amount: z.string().optional(),
      })).describe('List of claims to follow up on'),
    },
    async ({ claims }) => {
      const results = [];
      const config = getConfig();

      await browser.launchBrowser();

      // Group by payer
      const byPayer = {};
      for (const claim of claims) {
        if (!byPayer[claim.payer]) byPayer[claim.payer] = [];
        byPayer[claim.payer].push(claim);
      }

      for (const [payerId, payerClaims] of Object.entries(byPayer)) {
        const payerConfig = config.payers[payerId];
        if (!payerConfig || !payerConfig.username) {
          results.push(...payerClaims.map(c => ({
            ...c, status: 'skipped', reason: 'No credentials',
          })));
          continue;
        }

        const tabId = await browser.newPage(payerConfig.label);
        const page = browser.getPage(tabId);

        try {
          await browser.navigate(tabId, payerConfig.url);
          await page.waitForTimeout(3000);

          // Login (same generic flow)
          const usernameSelectors = [
            'input[type="email"]', 'input[name="username"]', 'input[name="email"]',
            'input[id*="user" i]',
          ];
          for (const sel of usernameSelectors) {
            const field = await page.$(sel);
            if (field) { await field.fill(payerConfig.username); break; }
          }
          const passField = await page.$('input[type="password"]');
          if (passField) await passField.fill(payerConfig.password);

          await page.evaluate(() => {
            const btns = Array.from(document.querySelectorAll('button, input[type="submit"]'));
            const btn = btns.find(b => /log\s*in|sign\s*in|submit/i.test(b.textContent || b.value || ''));
            if (btn) btn.click();
          });
          await page.waitForTimeout(5000);

          // Check each claim
          for (const claim of payerClaims) {
            try {
              // Navigate to claims
              const claimNav = ['a:has-text("Claims")', 'a:has-text("Claim Status")', 'a[href*="claim"]'];
              for (const sel of claimNav) {
                try { await page.click(sel, { timeout: 3000 }); break; } catch {}
              }
              await page.waitForTimeout(2000);

              const claimField = await page.$('input[name*="claim" i], input[placeholder*="claim" i]');
              if (claimField) {
                await claimField.fill(claim.claimNumber);
                await page.keyboard.press('Enter');
                await page.waitForTimeout(5000);
              }

              const content = await page.evaluate(() => {
                const main = document.querySelector('[class*="result"], [class*="claim"], main');
                return main ? main.innerText : document.body.innerText;
              });

              results.push({
                ...claim,
                status: 'checked',
                rawContent: content.slice(0, 3000),
              });
            } catch (err) {
              results.push({ ...claim, status: 'error', error: err.message });
            }
          }
        } catch (err) {
          results.push(...payerClaims.map(c => ({
            ...c, status: 'error', error: `Payer login failed: ${err.message}`,
          })));
        } finally {
          await browser.closePage(tabId);
        }
      }

      const report = {
        totalClaims: claims.length,
        checked: results.filter(r => r.status === 'checked').length,
        errored: results.filter(r => r.status === 'error').length,
        skipped: results.filter(r => r.status === 'skipped').length,
        results,
      };

      return { content: [{ type: 'text', text: JSON.stringify(report, null, 2) }] };
    }
  );

  server.tool(
    'generate_morning_report',
    'Generate a morning pre-check report: pulls the schedule from Curve and summarizes what needs attention. Returns a structured report suitable for email.',
    {
      curveTabId: z.number().describe('Tab ID of the logged-in Curve session'),
      date: z.string().optional().describe('Date (YYYY-MM-DD). Default: today'),
    },
    async ({ curveTabId, date }) => {
      const page = browser.getPage(curveTabId);
      const reportDate = date || new Date().toISOString().split('T')[0];

      try {
        // Get schedule content (reusing the Curve page)
        const scheduleNav = ['a:has-text("Schedule")', 'a:has-text("Calendar")', 'a[href*="schedule"]'];
        for (const sel of scheduleNav) {
          try { await page.click(sel, { timeout: 3000 }); break; } catch {}
        }
        await page.waitForTimeout(3000);

        const scheduleContent = await page.evaluate(() => {
          const main = document.querySelector('[class*="schedule"], [class*="calendar"], main');
          return main ? main.innerText : document.body.innerText;
        });

        // Get outstanding claims
        const claimsNav = ['a:has-text("Claims")', 'a:has-text("Billing")', 'a[href*="claims"]'];
        for (const sel of claimsNav) {
          try { await page.click(sel, { timeout: 3000 }); break; } catch {}
        }
        await page.waitForTimeout(3000);

        const claimsContent = await page.evaluate(() => {
          const main = document.querySelector('[class*="claims"], table, main');
          return main ? main.innerText : '';
        });

        const report = {
          date: reportDate,
          generatedAt: new Date().toISOString(),
          schedule: scheduleContent.slice(0, 15000),
          outstandingClaims: claimsContent.slice(0, 10000),
          summary: 'Raw data collected. Ask the AI agent to analyze this report and highlight items needing attention.',
        };

        return { content: [{ type: 'text', text: JSON.stringify(report, null, 2) }] };
      } catch (err) {
        return {
          content: [{ type: 'text', text: `Morning report failed: ${err.message}` }],
          isError: true,
        };
      }
    }
  );
}
