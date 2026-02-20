// ============================================================
// PracticePilot — Background Service Worker
// ============================================================
// Handles:
//   - Extension icon badge updates
//   - Message routing between popup ↔ content scripts
//   - Extension install / update events
// ============================================================

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
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]?.id) {
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
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]?.id) {
          chrome.tabs.sendMessage(tabs[0].id, {
            type: msg.show ? "PP_SHOW_PANEL" : "PP_HIDE_PANEL",
          });
        }
      });
      sendResponse({ ok: true });
      break;

    // Popup requests status from the active tab's content script
    case "PP_GET_TAB_STATUS":
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]?.id) {
          chrome.tabs.sendMessage(tabs[0].id, { type: "PP_GET_STATUS" }, (response) => {
            sendResponse(response || { pageType: "unknown", hasCard: false });
          });
        } else {
          sendResponse({ pageType: "unknown", hasCard: false });
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

// ── Tab activation: check if on Curve to show badge hint ──

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab.url && tab.url.includes("curvedental.com")) {
      chrome.action.setBadgeText({ text: "●", tabId });
      chrome.action.setBadgeBackgroundColor({ color: "#2563EB", tabId });
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
    } else {
      chrome.action.setBadgeText({ text: "", tabId });
    }
  }
});
