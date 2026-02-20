# PracticePilot

**Chrome extension for dental practice optimization.** Reads Curve Dental pages and insurer portals, extracts structured benefit data via Claude (Anthropic), and provides actionable patient insights — all without storing PHI server-side.

Built for [Merit Dental](https://meritdental.curvehero.com) by Dhruv.

---

## What It Does

| Feature | Description |
|---------|-------------|
| **Eligibility Extraction** | Reads eligibility pages in Curve Dental or insurer portals (Humana, Cigna, etc.), sends de-identified text to Claude, returns structured benefit cards |
| **Patient Action List** | Scans open Curve tabs (Profile, Insurance, Billing, Recare, Charting, Forms, Perio) and generates a prioritized checklist of things to verify or act on |
| **Contextual Chat** | Ask questions about the current patient — Claude answers using all scanned context |
| **CDT Code Lookup** | Search 70+ CDT codes with coverage cross-referencing against the patient's plan |
| **Copy Helpers** | One-click copy: verification notes, compact summaries, staff checklists, Curve-formatted paste, patient messages |
| **Patient Cache** | Benefit cards cached per-patient in `chrome.storage.local` — instant recall, no redundant API calls |

---

## Tech Stack

- **Chrome Extension Manifest V3**
- **Anthropic Claude API** (`claude-sonnet-4-20250514`) — browser-direct calls, no backend
- **Vanilla JS** — no frameworks, no build step (IIFE-wrapped modules on `window.PracticePilot`)
- **Target domain:** `*.curvehero.com` (excludes `*.sso.curvehero.com`)

---

## Project Structure

```
PracticePilot/
├── manifest.json              # MV3 manifest — 11 content scripts, permissions
├── background.js              # Service worker: injection, message routing
├── key                        # Anthropic API key (gitignored)
├── build.sh                   # Package → dist/PracticePilot-v0.1.0.zip
│
├── content/                   # Content scripts (injected into web pages)
│   ├── main.js                # Orchestrator — panel, observers, chat, drag
│   ├── page-detector.js       # URL + DOM heuristics → page type classification
│   ├── eligibility-parser.js  # Pre-parse eligibility text
│   └── panel.css              # All sidebar panel styles
│
├── shared/                    # Shared modules (loaded before content scripts)
│   ├── phi-redactor.js        # Strip PHI before sending to Claude
│   ├── normalize.js           # BenefitCard normalization + missing-item check
│   ├── storage.js             # chrome.storage.local helpers, patient cache
│   ├── formatter.js           # Output formatting (notes, summaries, checklists)
│   ├── cdt-codes.js           # 70+ CDT codes with tiers, starred codes, search
│   ├── patient-context.js     # Incremental patient profile builder
│   ├── action-engine.js       # Priority-based action list generator
│   └── llm-extractor.js       # Claude API calls, prompt engineering
│
├── ui/                        # Extension popup
│   ├── popup.html             # Settings UI (API key, model config)
│   └── popup.js               # Popup logic
│
├── icons/                     # Extension icons (16, 48, 128px)
├── INSTALL.md                 # Team installation guide
├── docs/
│   ├── ARCHITECTURE.md        # Detailed system architecture
│   └── CONVENTIONS.md         # Coding conventions + AI context recovery
```

**~6,500 lines** across 15 source files.

---

## Quick Start

1. Clone the repo
2. Load as unpacked extension in `chrome://extensions` (Developer mode)
3. Click the PracticePilot toolbar icon → enter your Anthropic API key → Save
4. Navigate to [Merit Dental on Curve](https://meritdental.curvehero.com)
5. Open a patient → PracticePilot panel appears with actions
6. Navigate to Eligibility → auto-extracts benefits

See [INSTALL.md](INSTALL.md) for detailed setup instructions.

---

## How It Works (Summary)

1. **Page Detection** — `page-detector.js` classifies the current page (eligibility, insurer portal, patient view, etc.) using URL patterns and DOM markers
2. **Patient Context** — On patient views, `patient-context.js` incrementally scans visible Curve tabs and merges data into a per-patient profile stored in `chrome.storage.local`
3. **Action Engine** — `action-engine.js` takes the patient context + optional benefit card and generates a prioritized list (CRITICAL → ACTION → RECOMMENDED → INFO)
4. **Eligibility Extraction** — On eligibility pages, `phi-redactor.js` strips PHI, then `llm-extractor.js` sends the cleaned text to Claude for structured parsing into a BenefitCard
5. **Panel UI** — `main.js` renders everything in a draggable sidebar panel with state machine (idle → extracting → result/actions/error)

---

## Privacy

- **No PHI stored server-side** — everything stays in `chrome.storage.local`
- **PHI redacted** before any text is sent to Claude
- **No backend** — API calls go directly from the browser to Anthropic
- Extension only activates on `*.curvehero.com` (auto) and insurer portals (on-demand)

---

## Building & Distribution

```bash
chmod +x build.sh
./build.sh
# Output: dist/PracticePilot-v0.1.0.zip
```

---

## Architecture & Conventions

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — Detailed module docs, data flow, state management
- [docs/CONVENTIONS.md](docs/CONVENTIONS.md) — Coding patterns, known gotchas, AI context recovery
