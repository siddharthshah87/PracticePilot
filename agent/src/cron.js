#!/usr/bin/env node

// Cron scheduler for PracticePilot Agent.
// Runs scheduled tasks independently of MCP — just start with: node src/cron.js
//
// This is a standalone runner. Scheduled tasks use the browser automation
// layer directly (not through MCP). For complex AI-driven workflows,
// the cron triggers a simple data-collection pass and emails the results.

import cron from 'node-cron';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createTransport } from 'nodemailer';
import * as browser from './browser.js';
import { getConfig } from './config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const reportsDir = join(__dirname, '..', 'reports');

function log(msg) {
  const ts = new Date().toISOString();
  console.error(`[${ts}] ${msg}`);
}

function ensureReportsDir() {
  if (!existsSync(reportsDir)) mkdirSync(reportsDir, { recursive: true });
}

async function sendEmail(subject, body) {
  const config = getConfig();
  const to = config.email?.to || 'info@meritdental.care';

  // Always save locally
  ensureReportsDir();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const localPath = join(reportsDir, `cron-${timestamp}.txt`);
  writeFileSync(localPath, `Subject: ${subject}\nTo: ${to}\n\n${body}`);
  log(`Report saved: ${localPath}`);

  if (!config.email?.smtp?.host) {
    log('SMTP not configured — skipping email send.');
    return;
  }

  try {
    const transporter = createTransport(config.email.smtp);
    await transporter.sendMail({
      from: config.email.from || 'agent@meritdental.care',
      to,
      subject,
      text: body,
    });
    log(`Email sent to ${to}`);
  } catch (err) {
    log(`Email error: ${err.message}`);
  }
}

async function loginCurve() {
  const config = getConfig();
  if (!config.curve.username || !config.curve.password) {
    throw new Error('Curve credentials not configured');
  }

  await browser.launchBrowser();
  const tabId = await browser.newPage('curve-cron');
  const page = browser.getPage(tabId);

  await browser.navigate(tabId, config.curve.url);
  await page.waitForTimeout(3000);

  // Generic login
  const userSelectors = [
    'input[type="email"]', 'input[name="username"]', 'input[name="email"]', '#username',
  ];
  for (const sel of userSelectors) {
    const field = await page.$(sel);
    if (field) { await field.fill(config.curve.username); break; }
  }

  const passField = await page.$('input[type="password"]');
  if (passField) await passField.fill(config.curve.password);

  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button, input[type="submit"]'));
    const btn = btns.find(b => /log\s*in|sign\s*in|submit/i.test(b.textContent || b.value || ''));
    if (btn) btn.click();
  });

  await page.waitForLoadState('domcontentloaded', { timeout: 30000 });
  await page.waitForTimeout(5000);

  return tabId;
}

// ---- Scheduled Tasks ----

async function morningReport() {
  log('Starting morning report...');
  try {
    const tabId = await loginCurve();
    const page = browser.getPage(tabId);

    // Get schedule
    const scheduleNav = ['a:has-text("Schedule")', 'a[href*="schedule"]'];
    for (const sel of scheduleNav) {
      try { await page.click(sel, { timeout: 5000 }); break; } catch {}
    }
    await page.waitForTimeout(3000);

    const schedule = await page.evaluate(() => {
      const main = document.querySelector('[class*="schedule"], [class*="calendar"], main');
      return main ? main.innerText : document.body.innerText;
    });

    // Get claims
    const claimsNav = ['a:has-text("Claims")', 'a[href*="claims"]'];
    for (const sel of claimsNav) {
      try { await page.click(sel, { timeout: 5000 }); break; } catch {}
    }
    await page.waitForTimeout(3000);

    const claims = await page.evaluate(() => {
      const main = document.querySelector('[class*="claims"], table, main');
      return main ? main.innerText : '';
    });

    await browser.closeBrowser();

    const today = new Date().toISOString().split('T')[0];
    const report = [
      `MERIT DENTAL — MORNING REPORT`,
      `Date: ${today}`,
      `Generated: ${new Date().toISOString()}`,
      `${'='.repeat(60)}`,
      '',
      'TODAY\'S SCHEDULE:',
      '-'.repeat(40),
      schedule.slice(0, 15000),
      '',
      'OUTSTANDING CLAIMS:',
      '-'.repeat(40),
      claims.slice(0, 10000) || '(none found)',
    ].join('\n');

    await sendEmail(`Morning Report — ${today}`, report);
    log('Morning report complete.');
  } catch (err) {
    log(`Morning report error: ${err.message}`);
    await browser.closeBrowser();
    await sendEmail('Morning Report — ERROR', `Failed: ${err.message}`);
  }
}

async function batchEligibility() {
  log('Starting batch eligibility check...');
  // This collects schedule data. Full eligibility checking across payer
  // portals is complex and best driven by the AI agent via MCP tools.
  // The cron job collects the patient list and sends a reminder.
  try {
    const tabId = await loginCurve();
    const page = browser.getPage(tabId);

    const scheduleNav = ['a:has-text("Schedule")', 'a[href*="schedule"]'];
    for (const sel of scheduleNav) {
      try { await page.click(sel, { timeout: 5000 }); break; } catch {}
    }
    await page.waitForTimeout(3000);

    const schedule = await page.evaluate(() => {
      const main = document.querySelector('[class*="schedule"], [class*="calendar"], main');
      return main ? main.innerText : document.body.innerText;
    });

    await browser.closeBrowser();

    const today = new Date().toISOString().split('T')[0];
    const report = [
      `ELIGIBILITY PRE-CHECK — PATIENT LIST`,
      `Date: ${today}`,
      `${'='.repeat(60)}`,
      '',
      'Patients scheduled today (verify eligibility):',
      '-'.repeat(40),
      schedule.slice(0, 20000),
      '',
      'Action: Use the MCP agent with batch_eligibility_check to verify each patient against their payer portal.',
    ].join('\n');

    await sendEmail(`Eligibility Pre-Check — ${today}`, report);
    log('Batch eligibility pre-check complete.');
  } catch (err) {
    log(`Batch eligibility error: ${err.message}`);
    await browser.closeBrowser();
  }
}

async function claimsFollowup() {
  log('Starting claims follow-up...');
  try {
    const tabId = await loginCurve();
    const page = browser.getPage(tabId);

    const claimsNav = ['a:has-text("Claims")', 'a[href*="claims"]'];
    for (const sel of claimsNav) {
      try { await page.click(sel, { timeout: 5000 }); break; } catch {}
    }
    await page.waitForTimeout(3000);

    // Try to filter for outstanding/denied
    try {
      await page.click('button:has-text("Outstanding"), [class*="filter"]:has-text("Outstanding")', { timeout: 3000 });
      await page.waitForTimeout(2000);
    } catch {}

    const claims = await page.evaluate(() => {
      const main = document.querySelector('[class*="claims"], table, main');
      return main ? main.innerText : document.body.innerText;
    });

    await browser.closeBrowser();

    const today = new Date().toISOString().split('T')[0];
    const report = [
      `WEEKLY CLAIMS FOLLOW-UP`,
      `Date: ${today}`,
      `${'='.repeat(60)}`,
      '',
      'Outstanding/Denied Claims:',
      '-'.repeat(40),
      claims.slice(0, 20000) || '(none found)',
      '',
      'Action: Review and follow up with payers. Use the MCP agent with batch_claims_followup to check statuses automatically.',
    ].join('\n');

    await sendEmail(`Claims Follow-Up — ${today}`, report);
    log('Claims follow-up complete.');
  } catch (err) {
    log(`Claims follow-up error: ${err.message}`);
    await browser.closeBrowser();
  }
}

// ---- Schedule Setup ----

const config = getConfig();

if (config.cron.morningReport?.enabled) {
  cron.schedule(config.cron.morningReport.schedule, morningReport);
  log(`Morning report scheduled: ${config.cron.morningReport.schedule}`);
}

if (config.cron.batchEligibility?.enabled) {
  cron.schedule(config.cron.batchEligibility.schedule, batchEligibility);
  log(`Batch eligibility scheduled: ${config.cron.batchEligibility.schedule}`);
}

if (config.cron.claimsFollowup?.enabled) {
  cron.schedule(config.cron.claimsFollowup.schedule, claimsFollowup);
  log(`Claims follow-up scheduled: ${config.cron.claimsFollowup.schedule}`);
}

const enabledCount = [
  config.cron.morningReport?.enabled,
  config.cron.batchEligibility?.enabled,
  config.cron.claimsFollowup?.enabled,
].filter(Boolean).length;

if (enabledCount === 0) {
  log('No cron jobs enabled. Set enabled: true in config.json cron section.');
  log('Running morning report once as a test...');
  morningReport().then(() => process.exit(0));
} else {
  log(`${enabledCount} cron job(s) scheduled. Running...`);
}

// Cleanup
process.on('SIGINT', async () => {
  log('Shutting down...');
  await browser.closeBrowser();
  process.exit(0);
});
