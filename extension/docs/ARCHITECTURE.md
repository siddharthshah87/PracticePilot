# PracticePilot — Architecture

Detailed module-by-module documentation for developers and AI assistants.

---

## High-Level Data Flow

```
Curve Dental page (or insurer portal)
        │
        ▼
  page-detector.js ──→ classifies page type
        │
        ├─ PATIENT_VIEW ──→ patient-context.js ──→ action-engine.js ──→ panel (actions)
        │                        │
        │                    scanAndMerge()          generate()
        │                        │                      │
        │                    chrome.storage          prioritized list
        │
        ├─ ELIGIBILITY ──→ phi-redactor.js ──→ llm-extractor.js ──→ panel (result)
        │                      │                     │
        │                  redact PHI            Claude API call
        │                      │                     │
        │                  cleaned text          BenefitCard JSON
        │
        └─ OTHER ──→ panel (idle)
```

---

## Module Reference

### `manifest.json` (58 lines)

Chrome MV3 manifest. Key details:
- **Permissions:** `storage`, `activeTab`, `scripting`
- **Host permissions:** `https://*.curvehero.com/*`
- **Content scripts:** 11 JS files loaded in order (shared/ first, then content/)
- **`exclude_matches`:** `https://*.sso.curvehero.com/*` — prevents injection on SSO login pages
- **`run_at`:** `document_idle`

Script load order matters — shared modules populate `window.PracticePilot` before content scripts read it.

---

### `background.js` (322 lines) — Service Worker

Responsibilities:
- **On-demand injection** on insurer portals (Humana, Cigna, Delta, etc.) via `chrome.scripting.executeScript`
- **Message routing** between popup ↔ content scripts
- **Tab management** — listens for `chrome.action.onClicked`, `chrome.tabs.onUpdated`
- **Welcome page** on install

Key patterns:
- Uses `chrome.scripting.executeScript` with `files` array to inject all 11 scripts + CSS
- Maintains a `Set` of already-injected tab IDs to avoid double-injection
- Handles `"getConfig"`, `"setConfig"`, `"showPanel"`, `"activateOnPage"` messages

---

### `content/main.js` (~1520 lines) — Main Orchestrator

The largest and most complex file. Manages:

**State variables:**
- `panelEl` — DOM reference to `#pp-panel`
- `currentCard` — current BenefitCard (from extraction or cache)
- `currentPageType` — page classification from page-detector
- `currentPatientCtx` — patient context built by patient-context.js
- `lastPatientName` — tracks patient switches
- `isExtracting`, `isScanning`, `isChatting` — mutex flags
- `isUpdatingPanel` — suppresses MutationObserver during our own writes
- `extensionDead` — kill switch when extension context is invalidated
- `isDragging`, `dragStartX/Y`, etc. — drag-to-move state
- `urlPollInterval`, `domObserverRef` — stored for cleanup

**Panel state machine:** `buildPanelHTML(state, extra)` renders based on:
- `idle` — capture buttons, recent patients, CDT lookup
- `extracting` — spinner
- `result` — full BenefitCard display with coverage tables
- `error` — error message + retry
- `no-key` — API key prompt
- `actions` — patient action list + chat

**Key functions:**
- `createPanel()` — creates `#pp-panel` div, wires click handler + drag
- `updatePanel(state, extra)` — sets innerHTML inside `requestAnimationFrame` with `isUpdatingPanel` guard
- `scanPatientAndShowActions()` — incremental patient scan with `isScanning` mutex
- `schedulePatientRescan()` — debounced (800ms) DOM-change triggered rescan
- `captureAndExtract(mode)` — full extraction pipeline (capture → redact → extract → normalize → cache → display)
- `handleChatSend()` / `askClaude(question)` — contextual chat with patient data injection
- `initDrag()` / `onDragStart/Move/End` — drag-to-move with click-vs-drag threshold (5px)
- `teardownEverything()` — kills all intervals/observers/timers when extension context dies

**Observer setup (in `init()`):**
- `PP.pageDetector.watch()` — page type change callback
- `MutationObserver` on `document.body` — triggers rescan on external DOM changes (excludes `#pp-panel`)
- `setInterval` (1s) — URL polling for SPA navigation
- Both stored as `domObserverRef` / `urlPollInterval` for cleanup

---

### `content/page-detector.js` (245 lines)

Classifies the current page into one of:

| Type | Detection Method |
|------|-----------------|
| `ELIGIBILITY` | URL contains `eligibility` or DOM has eligibility markers |
| `INSURANCE_MODAL` | Modal with insurance-related content |
| `INSURER_PORTAL` | Non-curvehero domain with insurance terms (Humana, Cigna, etc.) |
| `PATIENT_VIEW` | ≥4 of [Profile, Insurance, Claims, Billing, Recare, Charting, Perio] on curvehero.com |
| `SCHEDULE` | Scheduler URL or DOM markers |
| `PATIENT_CHART` | Chart-specific markers |
| `CLAIMS` | Claims listing markers |
| `UNKNOWN` | Default |

**Important:** `detect()` temporarily hides `#pp-panel` before reading `document.body.innerText` to prevent false PATIENT_VIEW detection from panel text containing marker words.

`watch(callback)` returns a cleanup function. Uses its own MutationObserver that skips mutations inside `#pp-panel`.

---

### `content/eligibility-parser.js` (308 lines)

Pre-processes raw eligibility text before sending to Claude:
- Detects payer format (Curve native, Humana, Cigna, Delta, etc.)
- Cleans whitespace, strips headers/footers
- Extracts structured sections when format is recognized
- Returns cleaned text + format hint for the LLM prompt

---

### `content/panel.css` (782 lines)

All styles for the sidebar panel:
- Fixed positioning (top-right), 380px wide
- CSS custom properties for theming (`--pp-*`)
- Drag states: `.pp-dragging` class, `grab`/`grabbing` cursors
- Chat section: bubbles, input row, typing indicator
- Action items: 4 priority-level color variants (critical=red, action=amber, recommended=blue, info=gray)
- `<details>` collapse for lesser suggestions
- Cache bar (stale indicator)
- CDT lookup results
- Responsive collapse (`.pp-collapsed`)

---

### `shared/phi-redactor.js` (187 lines)

Strips PHI from text before sending to Claude:
- SSN patterns (`XXX-XX-XXXX`)
- Phone numbers
- Email addresses
- Date of birth patterns
- Street addresses
- Patient name replacement (if known)
- Returns redacted text + count of redactions

---

### `shared/normalize.js` (139 lines)

Post-processes the BenefitCard from Claude:
- Normalizes percentage formats (`80` vs `80%`)
- Fills missing category defaults
- `missingItems(card)` — returns array of missing/unverified fields for staff checklist

---

### `shared/storage.js` (168 lines)

`chrome.storage.local` helpers:
- **Patient card cache:** keyed by `subscriberId+payer` or `patientName+payer`, max 200 entries with LRU eviction
- `cacheCard(card)` — save with timestamp
- `getCachedCard(key)` — retrieve
- `getAllCachedCards()` — for recent patients list
- `cacheKeyFromIdentifiers(name, subId, payer)` — build cache key from component parts
- Settings: API key, model preference

---

### `shared/formatter.js` (345 lines)

Output formatters for copy-to-clipboard:
- `verificationNote(card)` — full multi-line verification note
- `compactSummary(card)` — brief summary for quick reference
- `staffChecklist(card, missing)` — ✅/❌ checklist for front desk
- `patientInfoRequest(missing)` — template message to patient
- `curveDataEntry(card)` — formatted for pasting into Curve Dental fields

---

### `shared/cdt-codes.js` (806 lines)

CDT code reference database:
- 70+ codes with: `code`, `name`, `aka` (friendly name), `category`, `cdtRange`, `tier`, `note`
- 14 starred codes (common Merit Dental procedures) with clinical tips
- `search(query, limit)` — fuzzy search by code or keyword
- `lookup(code)` — exact lookup
- `getCoverage(code, card)` — cross-reference code tier with patient's coverage table
- `starredCodes()` — return starred subset
- `getSections()` — grouped by CDT range for browse view
- **Tiers:** `preventive`, `basic`, `major`, `prosthodontics`, `orthodontics`, `adjunctive`
- **TIER_LABELS:** human-readable tier names

---

### `shared/patient-context.js` (313 lines)

Incrementally builds patient profile from Curve Dental tabs:

**Section parsers** (10 sections):
`profile`, `insurance`, `billing`, `recare`, `charting`, `forms`, `claims`, `schedule`, `perio`, `appointments`

Each section has `markers` (strings to detect in page text) and a parser function.

**Key functions:**
- `scanAndMerge(pageText)` — detect visible sections → parse → merge into stored context → cache
- `_extractPatientName(pageText)` — uses Curve's `arrow_drop_down\n{Name}\nProfile` pattern
- `detectVisibleSections(text)` — returns array of detected section names

**Storage:** `chrome.storage.local` key `pp:patientContexts`, max 100 patients with eviction.

**Context shape:**
```js
{
  patientName: "John Smith",
  tabsScanned: ["profile", "insurance", "billing"],
  profile: { age, gender, phone, ... },
  insurance: { carrier, planName, lastVerified, ... },
  billing: { hasBalance, balance, hasOwingInvoices, ... },
  recare: { nextDue, noRecareFound, ... },
  charting: { hasUnscheduledTx, pendingCodes, ... },
  forms: { hasPendingForms, ... },
  perio: { hasPerioData, ... },
  todayAppt: { codes, isNewPatient, startTime, ... },
  lastUpdated: timestamp
}
```

---

### `shared/action-engine.js` (273 lines)

Generates prioritized actions from patient context + optional benefit card:

**Priority levels:**
1. `CRITICAL` (red) — missing insurance, expired eligibility, large balance
2. `ACTION` (amber) — unscheduled treatment, incomplete forms, no recare
3. `RECOMMENDED` (blue) — coverage optimization, frequency reminders
4. `INFO` (gray) — FYI items, data completeness

**Check categories:**
- Insurance/eligibility status
- Billing/balance alerts
- Recare scheduling gaps
- Incomplete forms
- Unscheduled treatment plans
- Appointment preparation
- Charting reminders
- Clinical flags (perio)
- CDT code × coverage cross-reference (flags procedures with low/no coverage)

Each action: `{ priority, icon, title, detail }`

---

### `shared/llm-extractor.js` (542 lines)

Claude API integration for eligibility extraction:

- `SYSTEM_PROMPT` — detailed instructions for extracting BenefitCard JSON from eligibility text
- `_preprocessText(text)` — clean + truncate to fit context window
- `_callAnthropic(text, config)` — direct browser fetch to `api.anthropic.com` with `anthropic-dangerous-direct-browser-access: true` header
- `extract(text, options)` — full pipeline: preprocess → call API → parse JSON → return card
- `getConfig()` / `setConfig(config)` — API key + model from storage

**BenefitCard schema** (returned by Claude):
```js
{
  patientName, subscriberId, payer, planName, planType, groupNumber,
  deductible: { individual, family },
  annualMax: { individual, family, remaining },
  coverageTable: [{ category, inNetwork, outOfNetwork }],
  coverageExceptions: [{ cdtCodes, description, inNetwork, note }],
  frequencies: { prophy, exam, bwx, fmx, pano, fluoride },
  waitingPeriods: [{ category, period }],
  nonCovered: [...],
  notes: [...],
  confidence: { overall: "high"|"medium"|"low" }
}
```

---

### `ui/popup.html` (317 lines) + `ui/popup.js` (294 lines)

Extension popup (toolbar icon):
- API key input + save
- Model selector
- Test connection button
- Show/activate panel on current tab
- Status indicators

---

## Key Architectural Decisions

1. **No backend** — API calls go browser → Anthropic directly. Simplest HIPAA-light path.
2. **IIFE wrapping** — all files use `(function() { var PracticePilot = ... })()` to avoid `const` redeclaration crashes from Chrome's double-injection behavior.
3. **`var` not `const`** for namespace — `var PracticePilot = window.PracticePilot || {}` allows re-declaration without error.
4. **Panel state machine** — single `buildPanelHTML(state)` controls all rendering, avoiding scattered DOM manipulation.
5. **Observer exclusion** — all MutationObservers skip mutations inside `#pp-panel` to prevent infinite loops.
6. **Graceful death** — `extensionDead` flag + `teardownEverything()` kills all activity when extension context is invalidated (extension reload/update).
7. **Drag delegation** — mousedown listener on `panelEl` (stable) rather than `.pp-header` (destroyed on re-render), with `_dragPending` flag to prevent click/drag conflicts.
