# PracticePilot

Dental office automation for Merit Dental — insurance eligibility, patient workflows, and practice management tools.

## Two Products, One Repo

| | Extension | Agent |
|---|---|---|
| **What** | Chrome extension | MCP server + cron worker |
| **How** | Side panel inside Chrome | AI agent drives a browser |
| **When** | During your workday (real-time assist) | On-demand or scheduled (batch worker) |
| **Where** | [extension/](extension/) | [agent/](agent/) |

### Extension — Real-time Co-pilot

A Chrome extension that lives in your browser's side panel while you work in Curve Dental. Reads patient charts, interprets insurance eligibility from any payer, generates action checklists, and answers questions — all in real time.

- Auto-detects eligibility pages across 15+ payer portals
- Extracts structured benefits via Claude AI
- PHI-redacted before anything leaves the browser
- Zero backend — direct-to-Anthropic, local-only storage

**Setup:** See [extension/INSTALL.md](extension/INSTALL.md)

### Agent — Automated Worker

An MCP server that gives any AI agent (Claude Desktop, VS Code Copilot, Cursor) full browser control + dental-specific workflow tools. Plus a cron scheduler for unattended tasks.

- 36 tools: browser control, Curve workflows, payer portals, batch ops, email reporting
- Batch eligibility verification for tomorrow's patients
- Weekly claims follow-up across all payers
- Morning reports emailed to info@meritdental.care
- Runs on Linux, macOS, Windows

**Setup:** See [agent/README.md](agent/README.md)

## Quick Start

```bash
# Extension
cd extension
# Load as unpacked extension in Chrome → chrome://extensions

# Agent
cd agent
npm install
npm run install-browsers
cp config.example.json config.json
# Edit config.json with credentials
# Connect from Claude Desktop or run: npm run cron
```

## Architecture

```
PracticePilot/
├── extension/              # Chrome extension
│   ├── manifest.json
│   ├── background.js
│   ├── content/            # Content scripts (page detection, parsing)
│   ├── shared/             # Shared logic (LLM, formatting, storage)
│   ├── ui/                 # Side panel UI
│   └── docs/               # Architecture docs
├── agent/                  # MCP server + cron
│   ├── src/
│   │   ├── server.js       # MCP entry point
│   │   ├── cron.js         # Scheduled tasks
│   │   ├── browser.js      # Playwright automation
│   │   └── tools/          # Tool modules (browser, curve, payer, batch, report)
│   └── config.json         # Credentials (gitignored)
└── README.md               # This file
```
