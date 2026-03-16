// Workflow Observer — watches you work in Curve and records everything.
// Captures: clicks, inputs, navigation, dropdown selections, screenshots.
// Outputs a structured JSONL log + periodic screenshots to workflows/<session>/
// Run: node observe.mjs [--url <start-url>]

import * as browser from './src/browser.js';
import { getConfig } from './src/config.js';
import { mkdirSync, appendFileSync, writeFileSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import * as readline from 'readline';

const __dirname = dirname(fileURLToPath(import.meta.url));
const config = getConfig();

// --- Session setup ---
const sessionId = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const sessionDir = join(__dirname, 'workflows', sessionId);
mkdirSync(sessionDir, { recursive: true });

const logPath = join(sessionDir, 'events.jsonl');
const summaryPath = join(sessionDir, 'summary.md');
let eventSeq = 0;
let screenshotSeq = 0;

function logEvent(event) {
  event.seq = ++eventSeq;
  event.ts = new Date().toISOString();
  appendFileSync(logPath, JSON.stringify(event) + '\n');

  // Pretty-print to console
  const icon = {
    click: '🖱️ ',
    input: '⌨️ ',
    navigation: '🔗',
    select: '📋',
    submit: '📤',
    scroll: '📜',
    screenshot: '📸',
    dom_change: '🔄',
    focus: '🎯',
    note: '📝',
  }[event.type] || '  ';
  const detail = event.text || event.value || event.url || event.note || '';
  console.log(`  ${icon} [${event.seq}] ${event.type}: ${event.selector || ''} ${detail}`.slice(0, 120));
}

async function takeScreenshot(page, label) {
  screenshotSeq++;
  const filename = `${String(screenshotSeq).padStart(3, '0')}-${label}.png`;
  const filepath = join(sessionDir, filename);
  await page.screenshot({ path: filepath, fullPage: false });
  logEvent({ type: 'screenshot', file: filename, label });
  return filename;
}

// --- Inject recorder into page ---
async function injectRecorder(page) {
  // Expose a function the page JS can call to send events back to Node
  try {
    await page.exposeFunction('__recordEvent', (event) => {
      logEvent(event);
    });
  } catch {
    // Already exposed (page reuse)
  }

  await page.evaluate(() => {
    if (window.__recorderInjected) return;
    window.__recorderInjected = true;

    // Build a CSS selector for an element
    function getSelector(el) {
      if (!el || el === document.body || el === document.documentElement) return 'body';
      if (el.id) return '#' + CSS.escape(el.id);
      
      // Try aria-label or role
      const aria = el.getAttribute('aria-label');
      if (aria) return `[aria-label="${CSS.escape(aria)}"]`;
      
      // Try unique class combo
      const tag = el.tagName.toLowerCase();
      const cls = Array.from(el.classList).filter(c => !c.startsWith('ng-') && !c.startsWith('cdk-')).slice(0, 2);
      
      // Build path from parent
      let path = tag;
      if (cls.length) path = tag + '.' + cls.join('.');
      
      const parent = el.parentElement;
      if (parent && parent !== document.body) {
        const siblings = Array.from(parent.children).filter(c => c.tagName === el.tagName);
        if (siblings.length > 1) {
          const idx = siblings.indexOf(el);
          path += `:nth-child(${idx + 1})`;
        }
        const parentSel = getSelector(parent);
        if (parentSel && parentSel !== 'body') {
          return parentSel + ' > ' + path;
        }
      }
      return path;
    }

    // Get context around an element
    function getContext(el) {
      const rect = el.getBoundingClientRect();
      const text = (el.innerText || el.textContent || '').trim().slice(0, 100);
      const tag = el.tagName.toLowerCase();
      const htmlType = el.getAttribute('type') || '';
      const placeholder = el.getAttribute('placeholder') || '';
      const name = el.getAttribute('name') || '';
      const role = el.getAttribute('role') || '';
      const cls = (el.className || '').toString().trim().slice(0, 80);
      const title = el.getAttribute('title') || '';
      
      // Parent context - what section/area is this in
      let section = '';
      let parent = el.closest('[id], .dijitTitlePane, [role="dialog"], mat-dialog-container, nav, header, main');
      if (parent) {
        section = parent.id || parent.getAttribute('role') || (parent.className || '').toString().slice(0, 40);
      }

      return { text, tag, htmlType, placeholder, name, role, cls, title, section, x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) };
    }

    // --- Click listener ---
    document.addEventListener('click', (e) => {
      const el = e.target;
      const ctx = getContext(el);
      window.__recordEvent({
        type: 'click',
        selector: getSelector(el),
        ...ctx,
      });
    }, true);

    // --- Input/change listener ---
    document.addEventListener('input', (e) => {
      const el = e.target;
      const ctx = getContext(el);
      // Redact potential PHI — check field type, name, placeholder, class
      const isSensitive = /password|ssn|dob|birth|phone|address|email/i.test(
        (ctx.htmlType || '') + (ctx.name || '') + (ctx.placeholder || '') + (ctx.cls || '')
      );
      window.__recordEvent({
        type: 'input',
        selector: getSelector(el),
        value: isSensitive ? '[REDACTED]' : (el.value || '').slice(0, 50),
        ...ctx,
      });
    }, true);

    // --- Select/change on dropdowns ---
    document.addEventListener('change', (e) => {
      const el = e.target;
      const ctx = getContext(el);
      window.__recordEvent({
        type: 'select',
        selector: getSelector(el),
        value: el.value || (el.textContent || '').trim().slice(0, 50),
        ...ctx,
      });
    }, true);

    // --- Form submit ---
    document.addEventListener('submit', (e) => {
      const form = e.target;
      window.__recordEvent({
        type: 'submit',
        selector: getSelector(form),
        action: form.action || '',
        method: form.method || '',
      });
    }, true);

    // --- Focus (track which fields are navigated to) ---
    document.addEventListener('focusin', (e) => {
      const el = e.target;
      if (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA' || el.getAttribute('contenteditable')) {
        const ctx = getContext(el);
        window.__recordEvent({
          type: 'focus',
          selector: getSelector(el),
          ...ctx,
        });
      }
    }, true);

    console.log('[Recorder] Injected — tracking clicks, inputs, selects, submits, focus');
  });
}

// --- Generate session summary ---
function generateSummary() {
  let events;
  try {
    events = readFileSync(logPath, 'utf-8').trim().split('\n').map(l => JSON.parse(l));
  } catch {
    return;
  }

  const clicks = events.filter(e => e.type === 'click');
  const inputs = events.filter(e => e.type === 'input');
  const navs = events.filter(e => e.type === 'navigation');
  const screenshots = events.filter(e => e.type === 'screenshot');

  // Group clicks by section to identify workflow steps
  const steps = [];
  let currentSection = '';
  for (const evt of events) {
    if (evt.type === 'screenshot' || evt.type === 'note') continue;
    const section = evt.section || 'unknown';
    if (section !== currentSection) {
      currentSection = section;
      steps.push({ section, events: [] });
    }
    steps[steps.length - 1].events.push(evt);
  }

  let md = `# Workflow Recording: ${sessionId}\n\n`;
  md += `**Date:** ${new Date().toLocaleDateString()}\n`;
  md += `**Total events:** ${events.length} (${clicks.length} clicks, ${inputs.length} inputs, ${navs.length} navigations)\n`;
  md += `**Screenshots:** ${screenshots.length}\n\n`;
  md += `## Event Timeline\n\n`;

  for (const evt of events) {
    if (evt.type === 'screenshot') {
      md += `\n![${evt.label}](${evt.file})\n\n`;
      continue;
    }
    if (evt.type === 'note') {
      md += `\n> **Note:** ${evt.note}\n\n`;
      continue;
    }
    const detail = evt.text || evt.value || evt.url || '';
    md += `${evt.seq}. **${evt.type}** \`${evt.selector || ''}\` — ${detail.slice(0, 80)}\n`;
  }

  md += `\n## Workflow Sections\n\n`;
  for (const step of steps) {
    md += `### ${step.section || 'Page'}\n`;
    for (const evt of step.events) {
      md += `- ${evt.type}: ${evt.text || evt.value || evt.url || ''}\n`.slice(0, 100);
    }
    md += '\n';
  }

  writeFileSync(summaryPath, md);
  console.log(`\n📝 Summary saved to ${summaryPath}`);
}

// --- Main ---
async function run() {
  console.log('╔═══════════════════════════════════════════╗');
  console.log('║  🔴 RECORDING — Workflow Observer         ║');
  console.log('║  Session: ' + sessionId + '              ║');
  console.log('╚═══════════════════════════════════════════╝');
  console.log(`\nLogs → ${sessionDir}`);
  console.log('Commands during recording:');
  console.log('  [s] Take screenshot');
  console.log('  [n] Add a note');
  console.log('  [q] Stop recording\n');

  // Launch browser
  await browser.launchBrowser({ headless: false });
  const tabId = await browser.newPage('observe');
  const page = browser.getPage(tabId);

  // Inject recorder
  await injectRecorder(page);

  // Re-inject on navigation (SPA re-renders or full page loads)
  page.on('load', async () => {
    logEvent({ type: 'navigation', url: page.url() });
    await takeScreenshot(page, 'page-load');
    await injectRecorder(page);
  });

  page.on('framenavigated', async (frame) => {
    if (frame === page.mainFrame()) {
      logEvent({ type: 'navigation', url: frame.url() });
      await injectRecorder(page).catch(() => {});
    }
  });

  // Navigate to Curve (or custom URL)
  const startUrl = process.argv.includes('--url')
    ? process.argv[process.argv.indexOf('--url') + 1]
    : config.curve.url;

  console.log(`Navigating to ${startUrl}...\n`);
  await browser.navigate(tabId, startUrl);
  await page.waitForTimeout(3000);

  // Check if login needed
  const url = page.url();
  if (url.includes('sso') || url.includes('login')) {
    console.log('Login required — filling credentials...');
    try {
      await page.fill('#username', config.curve.username);
      await page.fill('input[type="password"]', config.curve.password);
      await page.click('button[type="submit"]');
      await page.waitForLoadState('domcontentloaded', { timeout: 30000 });
      await page.waitForTimeout(5000);
    } catch (e) {
      console.log('Auto-login failed, please log in manually.');
    }
  }

  // Re-inject after login
  await injectRecorder(page);
  await takeScreenshot(page, 'start');
  logEvent({ type: 'note', note: 'Recording started at ' + page.url() });

  console.log('\n🔴 RECORDING... Do your work in Curve. Everything is being captured.\n');

  // Periodic screenshots (every 30 seconds)
  const screenshotInterval = setInterval(async () => {
    try {
      await takeScreenshot(page, 'periodic');
    } catch {}
  }, 30000);

  // Keyboard input loop for commands
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  const handleCommand = async (line) => {
    const cmd = line.trim().toLowerCase();
    if (cmd === 's') {
      await takeScreenshot(page, 'manual');
      console.log('  📸 Screenshot taken\n');
    } else if (cmd === 'n') {
      rl.question('  Note: ', (note) => {
        logEvent({ type: 'note', note });
        console.log('  📝 Note saved\n');
        rl.once('line', handleCommand);
      });
      return;
    } else if (cmd === 'q') {
      console.log('\n⏹️  Stopping recording...');
      clearInterval(screenshotInterval);
      await takeScreenshot(page, 'final');
      logEvent({ type: 'note', note: 'Recording ended at ' + page.url() });
      generateSummary();
      rl.close();
      await browser.closeBrowser();
      console.log('✓ Session saved to ' + sessionDir);
      process.exit(0);
      return;
    }
    rl.once('line', handleCommand);
  };

  rl.once('line', handleCommand);

  // Keep alive
  await new Promise(() => {});
}

try {
  await run();
} catch (err) {
  console.error('FATAL:', err.message);
  generateSummary();
  await browser.closeBrowser().catch(() => {});
  process.exit(1);
}
