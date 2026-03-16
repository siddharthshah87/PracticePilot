# PracticePilot Agent

MCP server for dental office browser automation. Lets any AI agent (Claude Desktop, VS Code Copilot, Cursor) drive Chrome to interact with Curve Dental and insurance payer portals.

## What it does

**Two modes:**

1. **MCP Server** — Connect from any MCP client. The AI agent gets browser automation tools + dental-specific workflow tools. You tell it what to do in natural language.

2. **Cron Scheduler** — Runs on a schedule. Pulls data from Curve, emails reports to info@meritdental.care.

## Available Tools (30+)

### Browser Control
| Tool | Description |
|------|-------------|
| `launch_browser` | Start Chrome |
| `close_browser` | Stop Chrome |
| `new_tab` / `close_tab` / `list_tabs` | Manage tabs |
| `navigate` | Go to URL |
| `click` / `fill` / `type_text` / `press_key` | Interact with page |
| `select_option` | Dropdown selection |
| `get_page_content` / `get_page_html` | Read page |
| `get_elements` / `get_element_attribute` | Query DOM |
| `screenshot` | Capture page |
| `evaluate_js` | Run JavaScript |
| `wait_for_element` / `wait_for_page_load` | Wait |

### Curve Dental
| Tool | Description |
|------|-------------|
| `curve_login` | Log into Curve Hero |
| `curve_get_schedule` | Pull day's schedule |
| `curve_open_patient` | Search and open patient chart |
| `curve_get_patient_info` | Read profile/insurance/billing/claims tabs |
| `curve_get_claims` | Get outstanding/denied claims |

### Insurance Payers
| Tool | Description |
|------|-------------|
| `list_payers` | Show configured payers |
| `payer_login` | Log into any payer portal |
| `payer_check_eligibility` | Verify patient benefits |
| `payer_get_claim_status` | Check claim status |
| `payer_download_eob` | Find EOB downloads |

### Batch Operations
| Tool | Description |
|------|-------------|
| `batch_eligibility_check` | Verify insurance for multiple patients |
| `batch_claims_followup` | Check all outstanding claims |
| `generate_morning_report` | Pre-day summary |

### Reporting
| Tool | Description |
|------|-------------|
| `send_email_report` | Email report to info@meritdental.care |
| `save_report` | Save report locally |
| `format_eligibility_report` | Format raw data into readable report |

## Supported Payers

Delta Dental, Cigna, MetLife, Aetna, Humana, UnitedHealthcare, Anthem BCBS, Guardian, BCBS

## Setup

### 1. Install

```bash
cd PracticePilot-Agent
npm install
npm run install-browsers    # downloads Chromium for Playwright
```

### 2. Configure

```bash
cp config.example.json config.json
```

Edit `config.json` with your credentials:

```json
{
  "curve": {
    "url": "https://www.curvehero.com",
    "username": "your-curve-username",
    "password": "your-curve-password"
  },
  "payers": {
    "delta_dental": {
      "username": "your-delta-username",
      "password": "your-delta-password"
    }
  },
  "email": {
    "to": "info@meritdental.care",
    "smtp": {
      "host": "smtp.gmail.com",
      "port": 587,
      "auth": {
        "user": "your-email",
        "pass": "your-app-password"
      }
    }
  }
}
```

### 3. Connect to Claude Desktop

Add to your Claude Desktop config (`~/.config/Claude/claude_desktop_config.json` on Linux):

```json
{
  "mcpServers": {
    "practicepilot": {
      "command": "node",
      "args": ["/absolute/path/to/PracticePilot-Agent/src/server.js"]
    }
  }
}
```

Restart Claude Desktop. You'll see the PracticePilot tools in the toolbox.

### 4. Run Cron Jobs (optional)

Enable schedules in `config.json`:

```json
{
  "cron": {
    "morningReport": { "schedule": "0 6 * * 1-5", "enabled": true },
    "batchEligibility": { "schedule": "0 5 * * 1-5", "enabled": true },
    "claimsFollowup": { "schedule": "0 7 * * 1", "enabled": true }
  }
}
```

```bash
npm run cron
```

For production, run with systemd or pm2:

```bash
pm2 start src/cron.js --name practicepilot-cron
```

## Example Conversations

### "Check tomorrow's schedule"
> You: "What patients do we have tomorrow?"
> Agent: *uses curve_login → curve_get_schedule → returns formatted schedule*

### "Verify insurance for John Smith"
> You: "Check if John Smith's Delta Dental is active, member ID 12345678"
> Agent: *uses payer_login(delta_dental) → payer_check_eligibility → returns benefits*

### "Run eligibility for all of tomorrow's patients"
> You: "Verify eligibility for everyone on tomorrow's schedule"
> Agent: *uses curve_login → curve_get_schedule → batch_eligibility_check → send_email_report*

### "Follow up on denied claims"
> You: "What claims are denied and check their status"
> Agent: *uses curve_get_claims(denied) → batch_claims_followup → formats report*

## Architecture

```
PracticePilot-Agent/
├── src/
│   ├── server.js              # MCP server entry point (stdio)
│   ├── cron.js                # Standalone cron scheduler
│   ├── browser.js             # Playwright browser automation layer
│   ├── config.js              # Config loader
│   └── tools/
│       ├── browser-tools.js   # Low-level browser control (20 tools)
│       ├── curve-tools.js     # Curve Dental workflows (5 tools)
│       ├── payer-tools.js     # Payer portal workflows (5 tools)
│       ├── batch-tools.js     # Batch operations (3 tools)
│       └── report-tools.js    # Email + reporting (3 tools)
├── config.json                # Your credentials (gitignored)
├── config.example.json        # Template
├── reports/                   # Saved reports (gitignored)
└── screenshots/               # Browser screenshots (gitignored)
```

## Security Notes

- **config.json** is gitignored — never commit credentials
- Browser runs locally — your sessions, your cookies
- No data sent anywhere except SMTP (your email server) and the payer/Curve sites themselves
- Headless by default — set `browser.headless: false` to watch it work
- Screenshots saved locally for debugging

## Platform Support

Runs on Linux, macOS, and Windows — anywhere Node.js + Chromium runs.
