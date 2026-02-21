// ============================================================
// PracticePilot — Content Script (Data Relay)
// ============================================================
// Thin content script that runs on web pages. Detects the
// page type, captures text from the DOM, and relays data to
// the Chrome Side Panel via chrome.runtime messaging.
//
// All UI rendering, extraction, chat, and CDT lookup live in
// ui/sidepanel.js — NOT here.
// ============================================================

(function () {
  "use strict";

  const PP = window.PracticePilot;
  if (!PP) {
    console.error("[PracticePilot] page-detector not loaded.");
    return;
  }

  // ── State ───────────────────────────────────────────────

  let currentPageType = null;
  let extensionDead = false;
  let cleanupDetector = null;
  let urlPollInterval = null;
  let domObserverRef = null;
  let updateTimer = null;

  /** Check if the extension context is still valid */
  function isContextValid() {
    try {
      return !!chrome.runtime?.id;
    } catch (_) {
      return false;
    }
  }

  function guardContext() {
    if (extensionDead) return false;
    if (!isContextValid()) {
      teardownEverything();
      return false;
    }
    return true;
  }

  function teardownEverything() {
    if (extensionDead) return;
    extensionDead = true;
    console.log("[PracticePilot] Extension reloaded — tearing down old content script.");
    if (updateTimer) clearTimeout(updateTimer);
    if (urlPollInterval) clearInterval(urlPollInterval);
    if (domObserverRef) domObserverRef.disconnect();
    if (cleanupDetector) { cleanupDetector(); cleanupDetector = null; }
  }

  // ── Text Capture ────────────────────────────────────────

  function getPageText() {
    const contentSelectors = [
      "#eligibility-response", ".eligibility-response",
      '[id*="eligibility"]', "#content", ".content-area",
      "main", '[role="main"]', ".main-content", "#main-content",
    ];

    for (const sel of contentSelectors) {
      const el = document.querySelector(sel);
      if (el && el.innerText && el.innerText.length > 100) {
        return el.innerText;
      }
    }

    // Fallback: clone body, remove noise
    const excludeSelectors = [
      "nav", "header", "footer",
      '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]',
      ".sidebar", "#sidebar", ".nav", ".navbar", ".footer",
      ".header", "#header", "#footer",
    ];

    const clone = document.body.cloneNode(true);
    for (const sel of excludeSelectors) {
      clone.querySelectorAll(sel).forEach(el => el.remove());
    }

    return clone.innerText || document.body?.innerText || "";
  }

  function getSelectionText() {
    const sel = window.getSelection();
    return sel ? sel.toString().trim() : "";
  }

  // ── Send page data to the side panel ────────────────────

  function sendPageUpdate() {
    if (!guardContext()) return;

    const pageType = PP.pageDetector?.detect() || "unknown";
    currentPageType = pageType;
    const pageText = getPageText();
    const insurerName = PP.pageDetector.getInsurerName?.() || null;

    try {
      chrome.runtime.sendMessage({
        type: "PP_PAGE_UPDATE",
        pageType,
        pageText,
        insurerName,
        url: window.location.href,
      });
    } catch (e) {
      if (/context invalidated/i.test(e.message)) {
        teardownEverything();
      }
    }
  }

  /** Debounced page update — 500ms after DOM settles */
  function scheduleUpdate() {
    if (!guardContext()) return;
    if (updateTimer) clearTimeout(updateTimer);
    updateTimer = setTimeout(sendPageUpdate, 500);
  }

  // ── Listen for requests from side panel / background ────

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!guardContext()) return;

    switch (msg.type) {
      case "PP_GET_PAGE_DATA":
        sendResponse({
          pageType: currentPageType || PP.pageDetector?.detect() || "unknown",
          pageText: getPageText(),
          insurerName: PP.pageDetector.getInsurerName?.() || null,
          url: window.location.href,
        });
        break;

      case "PP_GET_SELECTION":
        sendResponse({
          selectionText: getSelectionText(),
        });
        break;

      case "PP_PING":
        sendResponse({ ok: true, injected: true });
        break;
    }

    return true;
  });

  // ── Initialize ──────────────────────────────────────────

  function init() {
    console.log("[PracticePilot] Content script loaded on:", window.location.href);

    // Initial page detection + send
    sendPageUpdate();

    // Watch for page type changes via page-detector
    if (PP.pageDetector?.watch) {
      cleanupDetector = PP.pageDetector.watch((pageType) => {
        if (!guardContext()) return;
        currentPageType = pageType;
        sendPageUpdate();
      });
    }

    // Watch for DOM changes (tab switches in Curve SPA)
    domObserverRef = new MutationObserver((mutations) => {
      if (!guardContext()) return;
      const isExternal = mutations.some(m => {
        const node = m.target;
        return node && !node.closest?.("#pp-panel");
      });
      if (isExternal) {
        scheduleUpdate();
      }
    });
    domObserverRef.observe(document.body, { childList: true, subtree: true });

    // URL polling for SPA navigation
    let lastUrl = window.location.href;
    urlPollInterval = setInterval(() => {
      if (!guardContext()) return;
      const currentUrl = window.location.href;
      if (currentUrl !== lastUrl) {
        lastUrl = currentUrl;
        console.log("[PracticePilot] URL changed, sending update...");
        scheduleUpdate();
      }
    }, 1000);
  }

  init();

})();
