// Patient forms workflow tools.
// Checks form status in Curve and sends reminders via email/text.

import { z } from 'zod';
import * as browser from '../browser.js';

export function registerFormsTools(server) {

  server.tool(
    'curve_get_patient_forms',
    'Check patient intake form status in Curve. Opens a patient chart and reads their forms tab to see which forms are completed, pending, or not assigned.',
    {
      tabId: z.number().describe('Tab ID of the logged-in Curve session'),
      patientName: z.string().describe('Patient name to look up'),
    },
    async ({ tabId, patientName }) => {
      const page = browser.getPage(tabId);

      try {
        // Search for the patient
        const searchInput = await page.$('input[placeholder*="patient" i], input[placeholder*="search" i], input[class*="search"], #patient-search, #search');
        if (!searchInput) {
          // Try clicking search icon first
          const icon = await page.$('[class*="search-icon"], [class*="magnif"], button[aria-label*="search" i]');
          if (icon) await icon.click();
          await page.waitForTimeout(1000);
        }

        const field = await page.$('input[placeholder*="patient" i], input[placeholder*="search" i], input[class*="search"], #patient-search, #search');
        if (!field) {
          return { content: [{ type: 'text', text: 'Could not find patient search. Navigate to a page with patient search first.' }], isError: true };
        }

        await field.click({ clickCount: 3 });
        await field.fill(patientName);
        await page.waitForTimeout(2000);

        // Click the first matching result
        const results = await page.$$('[class*="search-result"] *, [class*="dropdown"] a, [class*="autocomplete"] li, .list-item');
        let clicked = false;
        for (const r of results) {
          const text = await r.innerText().catch(() => '');
          if (text.toLowerCase().includes(patientName.toLowerCase().split(' ')[0])) {
            await r.click();
            clicked = true;
            break;
          }
        }
        if (!clicked) await page.keyboard.press('Enter');
        await page.waitForTimeout(3000);

        // Navigate to Forms tab
        const formTabSelectors = [
          'a:has-text("Forms")', 'button:has-text("Forms")',
          '[class*="tab"]:has-text("Forms")', 'li:has-text("Forms")',
          'a:has-text("Intake")', 'button:has-text("Intake")',
          'a[href*="form"]', 'a[href*="intake"]',
        ];

        let foundTab = false;
        for (const sel of formTabSelectors) {
          try {
            await page.click(sel, { timeout: 3000 });
            foundTab = true;
            break;
          } catch {}
        }

        if (!foundTab) {
          // Might be under a "More" menu or similar
          try {
            await page.click('button:has-text("More"), a:has-text("More")', { timeout: 2000 });
            await page.waitForTimeout(1000);
            for (const sel of formTabSelectors) {
              try { await page.click(sel, { timeout: 2000 }); foundTab = true; break; } catch {}
            }
          } catch {}
        }

        await page.waitForTimeout(2000);

        // Read forms content from the page
        const formsData = await page.evaluate(() => {
          const body = document.body.innerText;
          // Look for form-related content areas
          const formsArea = document.querySelector(
            '[class*="form"], [class*="intake"], [class*="consent"], [class*="document"], main, .content'
          );
          return formsArea ? formsArea.innerText : body;
        });

        // Take a screenshot for reference
        const screenshotPath = await browser.screenshot(tabId, {
          filename: `forms-${patientName.replace(/\s+/g, '-').toLowerCase()}.png`
        });

        return {
          content: [{ type: 'text', text: JSON.stringify({
            patient: patientName,
            formsTabFound: foundTab,
            content: formsData.slice(0, 10000),
            screenshot: screenshotPath,
            url: page.url(),
          }, null, 2) }],
        };
      } catch (err) {
        const screenshotPath = await browser.screenshot(tabId, { filename: 'forms-error.png' });
        return {
          content: [{ type: 'text', text: `Failed to check forms for ${patientName}: ${err.message}. Screenshot: ${screenshotPath}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    'curve_assign_forms',
    'Assign intake forms to a patient in Curve. The patient chart should already be open.',
    {
      tabId: z.number().describe('Tab ID with patient chart open'),
      formNames: z.array(z.string()).optional().describe('Specific forms to assign (e.g. ["New Patient Form", "Medical History", "HIPAA Consent"]). If omitted, assigns default new-patient pack.'),
    },
    async ({ tabId, formNames }) => {
      const page = browser.getPage(tabId);

      try {
        // Look for "Assign Form" or "Add Form" or "Send Forms" button
        const assignBtnSelectors = [
          'button:has-text("Assign")', 'button:has-text("Add Form")',
          'button:has-text("Send Form")', 'a:has-text("Assign")',
          'button:has-text("New Form")', '[class*="assign"]',
          'button[aria-label*="assign" i]', 'button[aria-label*="add form" i]',
        ];

        let clicked = false;
        for (const sel of assignBtnSelectors) {
          try {
            await page.click(sel, { timeout: 3000 });
            clicked = true;
            break;
          } catch {}
        }

        if (!clicked) {
          return {
            content: [{ type: 'text', text: 'Could not find an Assign Forms button. Make sure you\'re on the patient\'s Forms tab.' }],
            isError: true,
          };
        }

        await page.waitForTimeout(2000);

        // If specific forms requested, select them; otherwise select all/default
        if (formNames && formNames.length > 0) {
          for (const formName of formNames) {
            // Try checkbox or list item selection
            const checkboxes = await page.$$('input[type="checkbox"], [class*="checkbox"]');
            for (const cb of checkboxes) {
              const label = await cb.evaluate(el => {
                const parent = el.closest('label, li, tr, div');
                return parent ? parent.innerText : '';
              }).catch(() => '');
              if (label.toLowerCase().includes(formName.toLowerCase())) {
                await cb.click();
                break;
              }
            }
          }
        } else {
          // Try "Select All" or just proceed with defaults
          try {
            await page.click('input[type="checkbox"][name*="all" i], label:has-text("Select All"), button:has-text("Select All")', { timeout: 2000 });
          } catch {}
        }

        await page.waitForTimeout(1000);

        // Confirm / Save the assignment
        const confirmBtns = [
          'button:has-text("Save")', 'button:has-text("Assign")',
          'button:has-text("Confirm")', 'button:has-text("Done")',
          'button:has-text("Submit")', 'button[type="submit"]',
        ];

        for (const sel of confirmBtns) {
          try { await page.click(sel, { timeout: 2000 }); break; } catch {}
        }

        await page.waitForTimeout(2000);

        const resultContent = await page.evaluate(() => {
          const main = document.querySelector('[class*="form"], [class*="intake"], main, .content');
          return main ? main.innerText : document.body.innerText;
        });

        return {
          content: [{ type: 'text', text: JSON.stringify({
            status: 'assigned',
            forms: formNames || ['default pack'],
            pageContent: resultContent.slice(0, 5000),
          }, null, 2) }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text', text: `Failed to assign forms: ${err.message}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    'curve_send_forms_reminder',
    'Send a forms reminder to a patient via Curve\'s built-in email/text messaging. Patient chart should be open.',
    {
      tabId: z.number().describe('Tab ID with patient chart open'),
      method: z.enum(['email', 'text', 'both']).optional().describe('How to send the reminder. Default: both'),
    },
    async ({ tabId, method }) => {
      const page = browser.getPage(tabId);
      const sendMethod = method || 'both';

      try {
        // Look for "Send" or "Resend" or "Remind" button in the forms area
        const sendBtnSelectors = [
          'button:has-text("Send")', 'button:has-text("Resend")',
          'button:has-text("Remind")', 'button:has-text("Notify")',
          'a:has-text("Send Forms")', 'a:has-text("Send Reminder")',
          'button:has-text("Email")', 'button:has-text("Text")',
        ];

        let sendClicked = false;
        for (const sel of sendBtnSelectors) {
          try {
            await page.click(sel, { timeout: 3000 });
            sendClicked = true;
            break;
          } catch {}
        }

        if (!sendClicked) {
          // Try the 3-dot menu or action dropdown
          try {
            await page.click('[class*="action"] button, [class*="menu"] button, button[class*="more"]', { timeout: 2000 });
            await page.waitForTimeout(1000);
            for (const sel of sendBtnSelectors) {
              try { await page.click(sel, { timeout: 2000 }); sendClicked = true; break; } catch {}
            }
          } catch {}
        }

        if (!sendClicked) {
          return {
            content: [{ type: 'text', text: 'Could not find a Send/Remind button. You may need to send from the forms tab manually.' }],
            isError: true,
          };
        }

        await page.waitForTimeout(2000);

        // Handle method selection dialog if it appears
        if (sendMethod === 'email' || sendMethod === 'both') {
          try {
            const emailCheckbox = await page.$('input[type="checkbox"][name*="email" i], label:has-text("Email") input[type="checkbox"]');
            if (emailCheckbox) {
              const checked = await emailCheckbox.isChecked();
              if (!checked) await emailCheckbox.click();
            }
          } catch {}
        }

        if (sendMethod === 'text' || sendMethod === 'both') {
          try {
            const textCheckbox = await page.$('input[type="checkbox"][name*="text" i], input[type="checkbox"][name*="sms" i], label:has-text("Text") input[type="checkbox"]');
            if (textCheckbox) {
              const checked = await textCheckbox.isChecked();
              if (!checked) await textCheckbox.click();
            }
          } catch {}
        }

        // Confirm send
        const confirmBtns = [
          'button:has-text("Send")', 'button:has-text("Confirm")',
          'button:has-text("OK")', 'button:has-text("Yes")',
          'button[type="submit"]',
        ];
        for (const sel of confirmBtns) {
          try { await page.click(sel, { timeout: 2000 }); break; } catch {}
        }

        await page.waitForTimeout(2000);

        const resultText = await page.evaluate(() => document.body.innerText).catch(() => '');

        // Check for success indicators
        const success = /sent|success|delivered|queued/i.test(resultText);

        return {
          content: [{ type: 'text', text: JSON.stringify({
            status: success ? 'sent' : 'attempted',
            method: sendMethod,
            pageContent: resultText.slice(0, 3000),
          }, null, 2) }],
        };
      } catch (err) {
        return {
          content: [{ type: 'text', text: `Failed to send reminder: ${err.message}` }],
          isError: true,
        };
      }
    }
  );

  server.tool(
    'forms_check_workflow',
    'End-to-end forms workflow: pull tomorrow\'s patients from Curve, check each patient\'s form status, and for anyone whose forms are assigned but incomplete, send email + text reminders via Curve. Returns a summary report.',
    {
      tabId: z.number().describe('Tab ID of the logged-in Curve session'),
      date: z.string().optional().describe('Date to check (YYYY-MM-DD). Default: tomorrow'),
      sendReminders: z.boolean().optional().describe('Actually send reminders, or just report. Default: false (dry run)'),
    },
    async ({ tabId, date, sendReminders }) => {
      const page = browser.getPage(tabId);
      const dryRun = !(sendReminders === true);
      const checkDate = date || (() => {
        const d = new Date();
        d.setDate(d.getDate() + 1);
        return d.toISOString().split('T')[0];
      })();

      const report = {
        date: checkDate,
        dryRun,
        patients: [],
        summary: { total: 0, formsDone: 0, formsAssigned: 0, formsNotAssigned: 0, remindersSent: 0 },
      };

      try {
        // Step 1: Navigate to Schedule
        console.log(`[forms-workflow] Getting schedule for ${checkDate}...`);
        const scheduleSelectors = [
          'a:has-text("Schedule")', 'a:has-text("Calendar")',
          'a[href*="schedule"]', 'nav a:has-text("Schedule")',
        ];

        for (const sel of scheduleSelectors) {
          try { await page.click(sel, { timeout: 3000 }); break; } catch {}
        }
        await page.waitForTimeout(3000);

        // Try to navigate to the requested date
        if (date) {
          const dateInput = await page.$('input[type="date"], input[class*="date"]');
          if (dateInput) {
            await dateInput.fill(date);
            await page.waitForTimeout(2000);
          }
        }

        // Step 2: Extract patient list from schedule
        const scheduleContent = await page.evaluate(() => {
          const area = document.querySelector('[class*="schedule"], [class*="calendar"], [class*="appointment"], main');
          return area ? area.innerText : document.body.innerText;
        });

        // Take screenshot of schedule
        await browser.screenshot(tabId, { filename: `forms-schedule-${checkDate}.png` });

        // Parse patient names from schedule text
        // Curve schedule typically shows "Time - Patient Name - Procedure" pattern
        const lines = scheduleContent.split('\n').filter(l => l.trim());
        const patientNames = [];
        for (const line of lines) {
          // Look for lines that contain time patterns + names
          const timeMatch = line.match(/(\d{1,2}:\d{2}\s*(AM|PM|am|pm)?)/);
          if (timeMatch) {
            // Extract the name part (often after the time)
            const afterTime = line.slice(line.indexOf(timeMatch[0]) + timeMatch[0].length).trim();
            // Split by common delimiters
            const parts = afterTime.split(/[-–|,]/).map(p => p.trim()).filter(p => p);
            if (parts.length > 0) {
              // First non-empty part is likely the patient name
              const name = parts[0].replace(/^\s*-\s*/, '').trim();
              if (name && name.length > 2 && name.length < 60 && !/^\d/.test(name)) {
                patientNames.push(name);
              }
            }
          }
        }

        report.summary.total = patientNames.length;

        if (patientNames.length === 0) {
          report.note = 'Could not parse patient names from schedule. Raw schedule content included for manual review.';
          report.rawSchedule = scheduleContent.slice(0, 10000);
          return { content: [{ type: 'text', text: JSON.stringify(report, null, 2) }] };
        }

        // Step 3: For each patient, check forms
        for (const name of patientNames) {
          const patientEntry = { name, formStatus: 'unknown', action: 'none' };

          try {
            // Search for patient
            const searchField = await page.$('input[placeholder*="patient" i], input[placeholder*="search" i], input[class*="search"], #patient-search');
            if (searchField) {
              await searchField.click({ clickCount: 3 });
              await searchField.fill(name);
              await page.waitForTimeout(2000);

              // Click first match
              const resultItems = await page.$$('[class*="search-result"] *, [class*="dropdown"] a, [class*="autocomplete"] li');
              let found = false;
              for (const item of resultItems) {
                const text = await item.innerText().catch(() => '');
                if (text.toLowerCase().includes(name.toLowerCase().split(' ')[0])) {
                  await item.click();
                  found = true;
                  break;
                }
              }
              if (!found) await page.keyboard.press('Enter');
              await page.waitForTimeout(3000);

              // Go to Forms tab
              const formTabs = [
                'a:has-text("Forms")', 'button:has-text("Forms")',
                '[class*="tab"]:has-text("Forms")', 'a[href*="form"]',
              ];
              for (const sel of formTabs) {
                try { await page.click(sel, { timeout: 2000 }); break; } catch {}
              }
              await page.waitForTimeout(2000);

              // Read forms content
              const formsContent = await page.evaluate(() => {
                const area = document.querySelector('[class*="form"], [class*="intake"], main, .content');
                return area ? area.innerText : '';
              });

              const lc = formsContent.toLowerCase();

              if (lc.includes('complete') || lc.includes('signed') || lc.includes('submitted')) {
                patientEntry.formStatus = 'done';
                patientEntry.action = 'none';
                report.summary.formsDone++;
              } else if (lc.includes('pending') || lc.includes('assigned') || lc.includes('sent') || lc.includes('waiting')) {
                patientEntry.formStatus = 'assigned_incomplete';
                report.summary.formsAssigned++;

                if (!dryRun) {
                  // Send reminder
                  const sendBtns = [
                    'button:has-text("Send")', 'button:has-text("Resend")',
                    'button:has-text("Remind")', 'a:has-text("Send")',
                  ];
                  for (const sel of sendBtns) {
                    try {
                      await page.click(sel, { timeout: 2000 });
                      await page.waitForTimeout(1000);
                      // Confirm if dialog pops up
                      try { await page.click('button:has-text("Send"), button:has-text("Confirm"), button:has-text("Yes")', { timeout: 2000 }); } catch {}
                      await page.waitForTimeout(2000);
                      patientEntry.action = 'reminder_sent';
                      report.summary.remindersSent++;
                      break;
                    } catch {}
                  }
                  if (patientEntry.action === 'none') patientEntry.action = 'reminder_failed';
                } else {
                  patientEntry.action = 'would_send_reminder';
                }
              } else {
                patientEntry.formStatus = 'not_assigned';
                patientEntry.action = 'needs_assignment';
                report.summary.formsNotAssigned++;
              }

              patientEntry.rawContent = formsContent.slice(0, 500);
            }
          } catch (err) {
            patientEntry.formStatus = 'error';
            patientEntry.error = err.message;
          }

          report.patients.push(patientEntry);
        }

        // Take final screenshot
        await browser.screenshot(tabId, { filename: `forms-report-${checkDate}.png` });

        return { content: [{ type: 'text', text: JSON.stringify(report, null, 2) }] };

      } catch (err) {
        const screenshotPath = await browser.screenshot(tabId, { filename: 'forms-workflow-error.png' });
        return {
          content: [{ type: 'text', text: `Forms workflow failed: ${err.message}. Screenshot: ${screenshotPath}` }],
          isError: true,
        };
      }
    }
  );
}
