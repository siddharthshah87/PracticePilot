# PracticePilot — Conventions & AI Context Recovery

This document exists so that **if AI context is lost**, a new session can read this file and understand exactly how to work with the codebase. It captures every pattern, gotcha, and decision that has caused bugs in the past.

---

## 1. Namespace Pattern

All shared modules attach to a single global namespace:

```js
(function() {
var PracticePilot = window.PracticePilot || {};

PracticePilot.moduleName = {
  // module code
};

window.PracticePilot = PracticePilot;
})();
```

**Rules:**
- **Always `var`**, never `const` or `let` for the namespace declaration. Chrome sometimes double-injects content scripts; `const` redeclaration crashes the extension.
- **Always wrap in an IIFE** — `(function() { ... })()` — to isolate scope and prevent redeclaration errors.
- Content scripts (`main.js`, `page-detector.js`, `eligibility-parser.js`) read the namespace as `const PP = window.PracticePilot` internally (inside their IIFE, so no conflict).

**Bug history:** Commit `a83a7b3` fixed `const → var`. Commit `0632929` added IIFE wrapping after Chrome's double-injection still caused crashes.

---

## 2. Panel DOM — The #pp-panel Problem

The sidebar panel (`#pp-panel`) is a `div` appended to `document.body`. It creates several recurring issues:

### 2a. MutationObserver Infinite Loops

**Problem:** Our `updatePanel()` changes `innerHTML` → triggers MutationObserver → triggers `schedulePatientRescan()` → triggers `scanPatientAndShowActions()` → calls `updatePanel()` → loop.

**Solution (3 layers):**
1. `isUpdatingPanel` flag — set `true` before `innerHTML` write, cleared after `requestAnimationFrame`
2. MutationObserver callback checks `if (isUpdatingPanel) return`
3. Observer checks `node.id !== "pp-panel" && !node.closest?.("#pp-panel")` to skip panel-internal mutations

### 2b. Page Detector False Positives

**Problem:** `page-detector.js` reads `document.body.innerText` to classify the page. Our panel text contains words like "Profile", "Insurance", "Billing" — triggering false `PATIENT_VIEW` detection.

**Solution:** `detect()` temporarily hides `#pp-panel` (`display:none`) before reading body text, then restores it.

### 2c. Drag Handler Survives Re-render

**Problem:** Attaching `mousedown` to `.pp-header` breaks when `updatePanel()` replaces innerHTML (destroying the header element and its listener).

**Solution:** Attach `mousedown` to `panelEl` (the stable container), then check `e.target.closest(".pp-header")` inside the handler. `panelEl` never gets destroyed.

### 2d. Click vs Drag Conflict

**Problem:** `mousedown` on header starts drag tracking, but if user doesn't move enough, `mouseup` fires and the `click` event toggles panel collapse.

**Solution:**
- `_dragPending` flag on `panelEl` — set on `mousedown`, cleared on `mouseup`
- `handlePanelClick` checks `if (panelEl._dragPending) return`
- Real drag (past `DRAG_THRESHOLD=5px`) sets `isDragging=true` → `mouseup` installs one-shot `suppressClick` capture listener

---

## 3. Extension Context Invalidation

When the extension is reloaded or updated, old content scripts become orphaned. Any `chrome.storage` or `chrome.runtime` call throws `"Extension context invalidated"`.

**Problem:** The URL poll interval (`setInterval`, 1s) and MutationObserver keep firing, repeatedly calling `scanPatientAndShowActions()` which hits `chrome.storage` → error spam.

**Solution:** `teardownEverything()` function + `extensionDead` flag:
- Set `extensionDead = true` on first "context invalidated" error
- Clear `actionScanTimer`, `urlPollInterval`, disconnect `domObserverRef`
- Call `cleanupDetector()` (page-detector's observer)
- Remove the stale `#pp-panel` from DOM
- All recurring callbacks (`schedulePatientRescan`, `scanPatientAndShowActions`, `handleChatSend`, `captureAndExtract`) bail immediately if `extensionDead`

**Important:** Store interval/observer references at module level (`urlPollInterval`, `domObserverRef`) so `teardownEverything()` can access them.

---

## 4. Content Script Load Order

Defined in `manifest.json` `content_scripts[0].js` array. **Order matters** — later scripts depend on earlier ones having populated `window.PracticePilot`:

```
1. shared/phi-redactor.js
2. shared/normalize.js
3. shared/storage.js
4. shared/formatter.js
5. shared/cdt-codes.js
6. shared/patient-context.js
7. shared/action-engine.js
8. shared/llm-extractor.js
9. content/page-detector.js
10. content/eligibility-parser.js
11. content/main.js          ← must be LAST (reads all modules)
```

---

## 5. Patient Context Merging

`patient-context.js` builds context incrementally:
- Each time a Curve tab is visible, its data is parsed and **merged** (not replaced)
- `tabsScanned` array tracks which sections have been processed
- Stored per-patient in `chrome.storage.local` (key: `pp:patientContexts`)
- Max 100 patients with oldest-first eviction

**Patient name extraction pattern** (Curve-specific):
```
arrow_drop_down
{Patient Name}
Profile
```
Regex: `/arrow_drop_down\s*\n\s*(.+?)\s*\n\s*Profile/`

**Patient switch detection:** Compare `newName.toLowerCase()` against `lastPatientName.toLowerCase()`. On mismatch, clear `currentPatientCtx`, `currentCard`, `cardFromCache`.

---

## 6. Claude API Calls

Direct browser → Anthropic (no backend):

```js
fetch("https://api.anthropic.com/v1/messages", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "x-api-key": config.apiKey,
    "anthropic-version": "2023-06-01",
    "anthropic-dangerous-direct-browser-access": "true",  // REQUIRED
  },
  body: JSON.stringify({
    model: "claude-sonnet-4-20250514",
    max_tokens: ...,
    system: ...,
    messages: [...],
  }),
});
```

**The `anthropic-dangerous-direct-browser-access: true` header is mandatory.** Without it, Anthropic rejects browser-origin requests with a CORS error.

---

## 7. Panel State Machine

`buildPanelHTML(state, extra)` — single function that renders the entire panel body:

| State | When | Content |
|-------|------|---------|
| `idle` | Default, non-patient pages | Capture buttons, recent patients, CDT lookup |
| `extracting` | During Claude API call | Spinner |
| `result` | After successful extraction | Full BenefitCard display |
| `error` | Extraction failed | Error message + retry |
| `no-key` | No API key configured | Setup prompt |
| `actions` | Patient view detected | Action list + chat input |

`updatePanel(state, extra)` wraps the innerHTML write in `requestAnimationFrame` with `isUpdatingPanel` guard.

---

## 8. Action Engine Priority Levels

```js
PRIORITY: { CRITICAL: 1, ACTION: 2, RECOMMENDED: 3, INFO: 4 }
```

- **CRITICAL (1)** — red, always shown: missing insurance, expired eligibility, large balance
- **ACTION (2)** — amber, always shown: unscheduled tx, incomplete forms, no recare
- **RECOMMENDED (3)** — blue, collapsed in `<details>`: coverage optimization
- **INFO (4)** — gray, collapsed: FYI items

Only CRITICAL and ACTION items show upfront. RECOMMENDED and INFO are collapsed in a `<details>` element.

---

## 9. Storage Keys

```js
"pp:lastBenefitCard"    // most recent BenefitCard
"pp:cardHistory"        // array of past cards
"pp:cardCache"          // patient-keyed cache (max 200, LRU)
"pp:settings"           // { apiKey, model }
"pp:patientContexts"    // patient-keyed contexts (max 100)
```

---

## 10. Domain & URL Rules

- **Auto-inject on:** `https://*.curvehero.com/*`
- **Exclude:** `https://*.sso.curvehero.com/*` (SSO login pages cause errors)
- **On-demand inject on:** Insurer portals (Humana, Cigna, Delta, etc.) via background.js
- **SPA navigation:** Curve is a single-page app — URL changes don't trigger page loads. We poll `window.location.href` every 1s to detect navigation.

---

## 11. CSS Naming

All classes prefixed with `pp-` to avoid conflicts with host page styles:
- `pp-panel`, `pp-header`, `pp-body`, `pp-section`
- `pp-btn`, `pp-btn-primary`, `pp-btn-sm`
- `pp-action-item`, `pp-action-critical`, `pp-action-action`, etc.
- `pp-chat-*`, `pp-cdt-*`, `pp-cache-*`

---

## 12. Common Gotchas for AI Assistants

1. **Never use `const` for `PracticePilot` namespace** — use `var` inside IIFE
2. **Never attach listeners to `.pp-header` directly** — it gets destroyed on re-render; delegate from `panelEl`
3. **Always guard MutationObserver callbacks** with `isUpdatingPanel` check AND `#pp-panel` exclusion
4. **Always check `extensionDead`** before any `chrome.*` API call or recurring callback
5. **Hide `#pp-panel`** before reading `document.body.innerText` for page classification
6. **Load order in manifest.json matters** — `main.js` must be last
7. **API calls need `anthropic-dangerous-direct-browser-access: true`** header
8. **Patient name comparison must be case-insensitive** (`.toLowerCase()`)
9. **Panel state machine** — don't manipulate DOM directly; use `updatePanel(state, extra)`
10. **`requestAnimationFrame`** — always wrap innerHTML writes to batch with browser paint cycle
11. **No PHI to Claude** — always go through `phi-redactor.js` first
12. **`exclude_matches`** for SSO — without it, injection on SSO pages throws errors

---

## 13. Git History Reference

Key commits for understanding bug fixes:
- `a83a7b3` — `const → var` for namespace
- `0632929` — IIFE wrapping + SSO exclusion
- `5f28df8` — Infinite rescan loop fix + drag re-render fix
- `bbb5e85` — Drag/click conflict fix + page detector panel exclusion + URL polling
- Latest — `teardownEverything()` for context invalidation cleanup
