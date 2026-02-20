// ============================================================
// PracticePilot — Background Service Worker
// ============================================================
// Handles:
//   - Extension icon badge updates
//   - Message routing between popup ↔ content scripts
//   - On-demand injection into non-Curve pages (insurer portals)
//   - Extension install / update events
// ============================================================

// ── Content script file list (injection order matters) ────

const CONTENT_SCRIPTS = [
  "shared/phi-redactor.js",
  "shared/normalize.js",
  "shared/storage.js",
  "shared/formatter.js",
  "shared/llm-extractor.js",
  "content/page-detector.js",
  "content/eligibility-parser.js",
  "content/main.js",
];

const CONTENT_CSS = ["content/panel.css"];

// Known insurer portal domains (for badge hint + auto-suggestions)
const INSURER_DOMAINS = [
  "humana.com", "cigna.com", "deltadental.com", "metlife.com",
  "aetna.com", "uhc.com", "unitedhealthcare.com", "myuhc.com",
  "guardiandirect.com", "guardianlife.com", "anthem.com",
  "bcbs.com", "bluecrossblueshift.com", "principal.com",
  "sunlife.com", "lincolnfinancial.com", "ameritas.com",
  "connectiondental.com", "geha.com", "unitedconcordia.com",
  "dentalxchange.com", "nea.availity.com", "availity.com",
  "trellis.com", "dentalplans.com", "dearborn.com",
  "standard.com", "reliancestandard.com",
];

// ── Install / Update ──────────────────────────────────────

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    console.log("[PracticePilot] Extension installed.");
    // Set default badge
    chrome.action.setBadgeBackgroundColor({ color: "#2563EB" });
  } else if (details.reason === "update") {
    console.log("[PracticePilot] Extension updated to", chrome.runtime.getManifest().version);
  }
});

// ── Message handling ──────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.type) {

    // Content script reports extraction complete
    case "PP_EXTRACTION_COMPLETE":
      chrome.action.setBadgeText({ text: "✓", tabId: sender.tab?.id });
      chrome.action.setBadgeBackgroundColor({ color: "#059669", tabId: sender.tab?.id });
      // Clear badge after 5 seconds
      setTimeout(() => {
        chrome.action.setBadgeText({ text: "", tabId: sender.tab?.id });
      }, 5000);
      sendResponse({ ok: true });
      break;

    // Popup wants to trigger extraction on the active tab
    case "PP_TRIGGER_EXTRACT":
      chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
        if (tabs[0]?.id) {
          // Ensure scripts are injected first (no-op on Curve, needed for insurer portals)
          await ensureInjected(tabs[0].id);
          chrome.tabs.sendMessage(tabs[0].id, {
            type: "PP_EXTRACT",
            mode: msg.mode || "page",
          });
        }
      });
      sendResponse({ ok: true });
      break;

    // Popup wants to show/hide the panel on the active tab
    case "PP_TOGGLE_PANEL":
      chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
        if (tabs[0]?.id) {
          await ensureInjected(tabs[0].id);
          chrome.tabs.sendMessage(tabs[0].id, {
            type: msg.show ? "PP_SHOW_PANEL" : "PP_HIDE_PANEL",
          });
        }
      });
      sendResponse({ ok: true });
      break;

    // Inject PracticePilot into the current non-Curve page on demand
    case "PP_INJECT_AND_SHOW":
      chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
        if (tabs[0]?.id) {
          const injected = await ensureInjected(tabs[0].id);
          sendResponse({ ok: true, injected });
        } else {
          sendResponse({ ok: false, error: "No active tab" });
        }
      });
      return true; // async sendResponse

    // Popup requests status from the active tab's content script
    case "PP_GET_TAB_STATUS":
      chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
        if (tabs[0]?.id) {
          try {
            const response = await chrome.tabs.sendMessage(tabs[0].id, { type: "PP_GET_STATUS" });
            sendResponse(response || { pageType: "unknown", hasCard: false, injected: true });
          } catch (e) {
            // Content script not injected on this page
            const isInsurer = isInsurerPortal(tabs[0].url);
            sendResponse({
              pageType: "unknown",
              hasCard: false,
              injected: false,
              isInsurerPortal: isInsurer,
              url: tabs[0].url,
            });
          }
        } else {
          sendResponse({ pageType: "unknown", hasCard: false, injected: false });
        }
      });
      return true; // async sendResponse

    // Test API connection (forwarded from popup)
    case "PP_TEST_CONNECTION":
      handleTestConnection(msg.config).then(sendResponse);
      return true; // async sendResponse
  }

  return true;
});

// ── On-demand injection for non-Curve pages ──────────────

// Track which tabs already have scripts injected
const injectedTabs = new Set();

/**
 * Inject all PracticePilot content scripts + CSS into a tab.
 * Uses activeTab permission (granted when user clicks the extension icon).
 * No-op if already injected on that tab.
 */
async function ensureInjected(tabId) {
  if (injectedTabs.has(tabId)) return false;

  try {
    // Check if content script is already running (auto-injected on Curve)
    await chrome.tabs.sendMessage(tabId, { type: "PP_PING" });
    injectedTabs.add(tabId);
    return false; // already there
  } catch (e) {
    // Not injected yet — inject now
  }

  try {
    // Inject CSS first
    await chrome.scripting.insertCSS({
      target: { tabId },
      files: CONTENT_CSS,
    });

    // Inject JS files in order
    await chrome.scripting.executeScript({
      target: { tabId },
      files: CONTENT_SCRIPTS,
    });

    injectedTabs.add(tabId);
    console.log(`[PracticePilot] Injected into tab ${tabId}`);
    return true;
  } catch (e) {
    console.error(`[PracticePilot] Injection failed for tab ${tabId}:`, e.message);
    return false;
  }
}

// Clean up tracking when tabs close or navigate
chrome.tabs.onRemoved.addListener((tabId) => {
  injectedTabs.delete(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading") {
    injectedTabs.delete(tabId); // Page is reloading, scripts will be gone
  }
});

// ── Insurer portal detection ─────────────────────────────

function isInsurerPortal(url) {
  if (!url) return false;
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return INSURER_DOMAINS.some(d => hostname.includes(d));
  } catch {
    return false;
  }
}

function isSupportedPage(url) {
  if (!url) return false;
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return hostname.includes("curvedental.com") || INSURER_DOMAINS.some(d => hostname.includes(d));
  } catch {
    return false;
  }
}

// ── API connection test (runs in service worker context) ──

async function handleTestConnection(config) {
  if (!config?.apiKey) {
    return { ok: false, error: "No API key provided" };
  }

  try {
    const testPrompt = 'Return this exact JSON: {"status": "ok"}';

    if (config.provider === "anthropic") {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": config.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: config.model || "claude-sonnet-4-20250514",
          max_tokens: 50,
          temperature: 0,
          messages: [{ role: "user", content: testPrompt }],
        }),
      });

      if (!response.ok) {
        const err = await response.text();
        return { ok: false, error: `API error (${response.status}): ${err.substring(0, 200)}` };
      }

      return { ok: true };
    } else {
      // OpenAI or compatible
      const baseUrl = config.baseUrl || "https://api.openai.com/v1";
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.model || "gpt-4o-mini",
          max_tokens: 50,
          temperature: 0,
          messages: [
            { role: "system", content: "You are a test assistant." },
            { role: "user", content: testPrompt },
          ],
        }),
      });

      if (!response.ok) {
        const err = await response.text();
        return { ok: false, error: `API error (${response.status}): ${err.substring(0, 200)}` };
      }

      return { ok: true };
    }
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ── Tab activation: show badge hint on supported pages ───

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab.url && tab.url.includes("curvedental.com")) {
      chrome.action.setBadgeText({ text: "●", tabId });
      chrome.action.setBadgeBackgroundColor({ color: "#2563EB", tabId });
    } else if (isInsurerPortal(tab.url)) {
      chrome.action.setBadgeText({ text: "◆", tabId });
      chrome.action.setBadgeBackgroundColor({ color: "#D97706", tabId });
    } else {
      chrome.action.setBadgeText({ text: "", tabId });
    }
  } catch (e) {
    // Tab may not exist
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && tab.url) {
    if (tab.url.includes("curvedental.com")) {
      chrome.action.setBadgeText({ text: "●", tabId });
      chrome.action.setBadgeBackgroundColor({ color: "#2563EB", tabId });
    } else if (isInsurerPortal(tab.url)) {
      chrome.action.setBadgeText({ text: "◆", tabId });
      chrome.action.setBadgeBackgroundColor({ color: "#D97706", tabId });
    } else {
      chrome.action.setBadgeText({ text: "", tabId });
    }
  }
});
