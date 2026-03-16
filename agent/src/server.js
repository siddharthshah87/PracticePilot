#!/usr/bin/env node

// PracticePilot MCP Agent — main entry point.
// Exposes browser automation + dental workflow tools over MCP stdio transport.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerBrowserTools } from './tools/browser-tools.js';
import { registerCurveTools } from './tools/curve-tools.js';
import { registerPayerTools } from './tools/payer-tools.js';
import { registerBatchTools } from './tools/batch-tools.js';
import { registerReportTools } from './tools/report-tools.js';
import { registerFormsTools } from './tools/forms-tools.js';

const server = new McpServer({
  name: 'practicepilot-agent',
  version: '1.0.0',
});

// Register all tool groups
registerBrowserTools(server);
registerCurveTools(server);
registerPayerTools(server);
registerBatchTools(server);
registerReportTools(server);
registerFormsTools(server);

// Connect via stdio
const transport = new StdioServerTransport();
await server.connect(transport);

// Cleanup on exit
process.on('SIGINT', async () => {
  const { closeBrowser } = await import('./browser.js');
  await closeBrowser();
  process.exit(0);
});
