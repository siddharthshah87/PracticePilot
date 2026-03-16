// Core browser control tools exposed via MCP.
// These are general-purpose — any agent can use them to drive Chrome.

import { z } from 'zod';
import * as browser from '../browser.js';

export function registerBrowserTools(server) {

  // --- Lifecycle ---

  server.tool(
    'launch_browser',
    'Launch a Chrome browser instance. Must be called before any other browser tool.',
    { headless: z.boolean().optional().describe('Run headless (no visible window). Default: true') },
    async ({ headless }) => {
      await browser.launchBrowser({ headless });
      return { content: [{ type: 'text', text: 'Browser launched.' }] };
    }
  );

  server.tool(
    'close_browser',
    'Close the browser and all tabs.',
    {},
    async () => {
      await browser.closeBrowser();
      return { content: [{ type: 'text', text: 'Browser closed.' }] };
    }
  );

  // --- Tab management ---

  server.tool(
    'new_tab',
    'Open a new browser tab. Returns the tab ID.',
    { label: z.string().optional().describe('Friendly label for this tab') },
    async ({ label }) => {
      const id = await browser.newPage(label);
      return { content: [{ type: 'text', text: JSON.stringify({ tabId: id }) }] };
    }
  );

  server.tool(
    'close_tab',
    'Close a browser tab by ID.',
    { tabId: z.number().describe('The tab ID to close') },
    async ({ tabId }) => {
      await browser.closePage(tabId);
      return { content: [{ type: 'text', text: `Tab ${tabId} closed.` }] };
    }
  );

  server.tool(
    'list_tabs',
    'List all open browser tabs with their IDs, labels, and URLs.',
    {},
    async () => {
      const tabs = browser.listPages();
      return { content: [{ type: 'text', text: JSON.stringify(tabs, null, 2) }] };
    }
  );

  // --- Navigation ---

  server.tool(
    'navigate',
    'Navigate a tab to a URL. Returns the final URL and page title.',
    {
      tabId: z.number().describe('Tab ID'),
      url: z.string().describe('URL to navigate to'),
    },
    async ({ tabId, url }) => {
      const result = await browser.navigate(tabId, url);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );

  // --- Interaction ---

  server.tool(
    'click',
    'Click an element on the page by CSS selector.',
    {
      tabId: z.number().describe('Tab ID'),
      selector: z.string().describe('CSS selector of the element to click'),
    },
    async ({ tabId, selector }) => {
      await browser.click(tabId, selector);
      return { content: [{ type: 'text', text: `Clicked: ${selector}` }] };
    }
  );

  server.tool(
    'fill',
    'Fill an input field with text (clears existing value first).',
    {
      tabId: z.number().describe('Tab ID'),
      selector: z.string().describe('CSS selector of the input'),
      value: z.string().describe('Text to fill'),
    },
    async ({ tabId, selector, value }) => {
      await browser.fill(tabId, selector, value);
      return { content: [{ type: 'text', text: `Filled ${selector}` }] };
    }
  );

  server.tool(
    'type_text',
    'Type text character-by-character into a focused element (simulates real typing).',
    {
      tabId: z.number().describe('Tab ID'),
      selector: z.string().describe('CSS selector to click before typing'),
      text: z.string().describe('Text to type'),
      delay: z.number().optional().describe('Delay between keystrokes in ms. Default: 50'),
    },
    async ({ tabId, selector, text, delay }) => {
      await browser.typeText(tabId, selector, text, { delay });
      return { content: [{ type: 'text', text: `Typed ${text.length} chars into ${selector}` }] };
    }
  );

  server.tool(
    'press_key',
    'Press a keyboard key (e.g. Enter, Tab, Escape, ArrowDown).',
    {
      tabId: z.number().describe('Tab ID'),
      key: z.string().describe('Key to press (e.g. "Enter", "Tab", "Escape")'),
    },
    async ({ tabId, key }) => {
      await browser.pressKey(tabId, key);
      return { content: [{ type: 'text', text: `Pressed: ${key}` }] };
    }
  );

  server.tool(
    'select_option',
    'Select an option from a <select> dropdown.',
    {
      tabId: z.number().describe('Tab ID'),
      selector: z.string().describe('CSS selector of the <select> element'),
      value: z.string().describe('Value or label to select'),
    },
    async ({ tabId, selector, value }) => {
      await browser.selectOption(tabId, selector, value);
      return { content: [{ type: 'text', text: `Selected "${value}" in ${selector}` }] };
    }
  );

  // --- Reading ---

  server.tool(
    'get_page_content',
    'Get the visible text content of the page or a specific element.',
    {
      tabId: z.number().describe('Tab ID'),
      selector: z.string().optional().describe('CSS selector to read. Omit for full page body text.'),
    },
    async ({ tabId, selector }) => {
      const text = await browser.getPageContent(tabId, { selector });
      // Truncate to avoid overwhelming context
      const truncated = text.length > 50000 ? text.slice(0, 50000) + '\n...(truncated)' : text;
      return { content: [{ type: 'text', text: truncated }] };
    }
  );

  server.tool(
    'get_page_html',
    'Get the inner HTML of an element (for structure analysis).',
    {
      tabId: z.number().describe('Tab ID'),
      selector: z.string().optional().describe('CSS selector. Default: body'),
    },
    async ({ tabId, selector }) => {
      const html = await browser.getPageHtml(tabId, selector || 'body');
      const truncated = html.length > 50000 ? html.slice(0, 50000) + '\n...(truncated)' : html;
      return { content: [{ type: 'text', text: truncated }] };
    }
  );

  server.tool(
    'get_elements',
    'Query all elements matching a selector. Returns text, tag, and visibility for each.',
    {
      tabId: z.number().describe('Tab ID'),
      selector: z.string().describe('CSS selector'),
    },
    async ({ tabId, selector }) => {
      const elements = await browser.getElements(tabId, selector);
      return { content: [{ type: 'text', text: JSON.stringify(elements, null, 2) }] };
    }
  );

  server.tool(
    'get_element_attribute',
    'Get a specific attribute of an element.',
    {
      tabId: z.number().describe('Tab ID'),
      selector: z.string().describe('CSS selector'),
      attribute: z.string().describe('Attribute name (e.g. "href", "value", "class")'),
    },
    async ({ tabId, selector, attribute }) => {
      const val = await browser.getElementAttribute(tabId, selector, attribute);
      return { content: [{ type: 'text', text: val ?? '(null)' }] };
    }
  );

  // --- Screenshot ---

  server.tool(
    'screenshot',
    'Take a screenshot of the current page.',
    {
      tabId: z.number().describe('Tab ID'),
      fullPage: z.boolean().optional().describe('Capture full scrollable page. Default: false'),
      filename: z.string().optional().describe('Custom filename'),
    },
    async ({ tabId, fullPage, filename }) => {
      const path = await browser.screenshot(tabId, { fullPage, filename });
      return { content: [{ type: 'text', text: `Screenshot saved: ${path}` }] };
    }
  );

  // --- JavaScript ---

  server.tool(
    'evaluate_js',
    'Execute JavaScript in the page context and return the result. The expression should be a function body or value expression.',
    {
      tabId: z.number().describe('Tab ID'),
      expression: z.string().describe('JavaScript expression to evaluate'),
    },
    async ({ tabId, expression }) => {
      const result = await browser.evaluateJs(tabId, expression);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) ?? '(undefined)' }] };
    }
  );

  // --- Waiting ---

  server.tool(
    'wait_for_element',
    'Wait for an element to appear on the page.',
    {
      tabId: z.number().describe('Tab ID'),
      selector: z.string().describe('CSS selector to wait for'),
      timeout: z.number().optional().describe('Max wait time in ms. Default: 15000'),
    },
    async ({ tabId, selector, timeout }) => {
      await browser.waitForSelector(tabId, selector, { timeout });
      return { content: [{ type: 'text', text: `Element found: ${selector}` }] };
    }
  );

  server.tool(
    'wait_for_page_load',
    'Wait for the page to finish loading.',
    {
      tabId: z.number().describe('Tab ID'),
      timeout: z.number().optional().describe('Max wait time in ms. Default: 30000'),
    },
    async ({ tabId, timeout }) => {
      await browser.waitForNavigation(tabId, { timeout });
      return { content: [{ type: 'text', text: 'Page loaded.' }] };
    }
  );
}
