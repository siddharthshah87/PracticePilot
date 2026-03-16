// Browser automation layer wrapping Playwright.
// Manages a single browser instance with multiple pages (tabs).

import { chromium } from 'playwright';
import { readFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const configPath = join(__dirname, '..', 'config.json');
const config = JSON.parse(readFileSync(configPath, 'utf-8'));

let browser = null;
let context = null;
const pages = new Map(); // id -> { page, label }
let pageCounter = 0;
const userDataDir = join(__dirname, '..', '.browser-data');

export async function launchBrowser(opts = {}) {
  if (context) return; // already running (persistent context acts as both browser+context)
  if (browser && browser.isConnected()) return;

  const headless = opts.headless ?? config.browser.headless;
  const slowMo = opts.slowMo ?? config.browser.slowMo;

  // Use persistent context so cookies, localStorage, and "remember device" tokens survive across runs
  context = await chromium.launchPersistentContext(userDataDir, {
    headless,
    slowMo,
    viewport: { width: 1280, height: 900 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    args: [
      '--disable-session-crashed-bubble',
      '--disable-infobars',
      '--no-default-browser-check',
      '--hide-crash-restore-bubble',
      '--disable-save-password-bubble',
    ],
    ignoreDefaultArgs: ['--enable-automation'],
  });
  browser = null; // persistent context manages its own browser
}

export async function closeBrowser() {
  for (const [id] of pages) {
    try { await pages.get(id).page.close(); } catch {}
  }
  pages.clear();
  pageCounter = 0;
  if (context) {
    await context.close();
    context = null;
  }
  if (browser) {
    await browser.close();
    browser = null;
  }
}

export async function newPage(label = '') {
  await launchBrowser();
  const page = await context.newPage();
  page.setDefaultTimeout(config.browser.timeout);
  const id = ++pageCounter;
  pages.set(id, { page, label: label || `tab-${id}` });
  return id;
}

export async function closePage(id) {
  const entry = pages.get(id);
  if (!entry) throw new Error(`No tab with id ${id}`);
  await entry.page.close();
  pages.delete(id);
}

export function getPage(id) {
  const entry = pages.get(id);
  if (!entry) throw new Error(`No tab with id ${id}`);
  return entry.page;
}

export function listPages() {
  const result = [];
  for (const [id, { page, label }] of pages) {
    result.push({ id, label, url: page.url(), title: '' });
  }
  return result;
}

export async function navigate(id, url) {
  const page = getPage(id);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: config.browser.timeout });
  return { url: page.url(), title: await page.title() };
}

export async function click(id, selector) {
  const page = getPage(id);
  await page.click(selector, { timeout: 10000 });
}

export async function fill(id, selector, value) {
  const page = getPage(id);
  await page.fill(selector, value, { timeout: 10000 });
}

export async function typeText(id, selector, text, opts = {}) {
  const page = getPage(id);
  await page.click(selector, { timeout: 10000 });
  await page.keyboard.type(text, { delay: opts.delay ?? 50 });
}

export async function pressKey(id, key) {
  const page = getPage(id);
  await page.keyboard.press(key);
}

export async function getPageContent(id, opts = {}) {
  const page = getPage(id);
  if (opts.selector) {
    const el = await page.$(opts.selector);
    if (!el) return '(element not found)';
    return await el.innerText();
  }
  return await page.innerText('body');
}

export async function getPageHtml(id, selector = 'body') {
  const page = getPage(id);
  const el = await page.$(selector);
  if (!el) return '(element not found)';
  return await el.innerHTML();
}

export async function screenshot(id, opts = {}) {
  const page = getPage(id);
  const screenshotDir = config.screenshots?.dir
    ? join(__dirname, '..', config.screenshots.dir)
    : join(__dirname, '..', 'screenshots');
  if (!existsSync(screenshotDir)) mkdirSync(screenshotDir, { recursive: true });
  const filename = opts.filename || `tab-${id}-${Date.now()}.png`;
  const fullPath = join(screenshotDir, filename);
  await page.screenshot({ path: fullPath, fullPage: opts.fullPage ?? false });
  return fullPath;
}

export async function evaluateJs(id, expression) {
  const page = getPage(id);
  const result = await page.evaluate(expression);
  return result;
}

export async function waitForSelector(id, selector, opts = {}) {
  const page = getPage(id);
  await page.waitForSelector(selector, {
    state: opts.state ?? 'visible',
    timeout: opts.timeout ?? 15000,
  });
}

export async function waitForNavigation(id, opts = {}) {
  const page = getPage(id);
  await page.waitForLoadState(opts.state ?? 'domcontentloaded', {
    timeout: opts.timeout ?? 30000,
  });
}

export async function selectOption(id, selector, value) {
  const page = getPage(id);
  await page.selectOption(selector, value);
}

export async function getElementAttribute(id, selector, attribute) {
  const page = getPage(id);
  return await page.getAttribute(selector, attribute);
}

export async function getElements(id, selector) {
  const page = getPage(id);
  const elements = await page.$$(selector);
  const results = [];
  for (const el of elements) {
    results.push({
      text: await el.innerText().catch(() => ''),
      tag: await el.evaluate(e => e.tagName.toLowerCase()),
      visible: await el.isVisible(),
    });
  }
  return results;
}
