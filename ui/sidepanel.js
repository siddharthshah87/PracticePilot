// ============================================================
// PracticePilot — Side Panel Controller
// ============================================================
// Runs inside the Chrome Side Panel. Receives page data from
// the content script and renders all UI: actions, benefits,
// chat, CDT lookup, settings.
// ============================================================

(function () {
  "use strict";

  const PP = window.PracticePilot;
  if (!PP) {
    console.error("[PracticePilot SidePanel] Shared modules not loaded.");
    return;
  }

  // ── State ───────────────────────────────────────────────

  let currentCard = null;
  let currentPageType = null;
  let currentPatientCtx = null;
  let lastPatientName = null;
  let cardFromCache = false;
  let isExtracting = false;
  let isChatting = false;
  let activeTabId = null;
  let isScanning = false;
  let pendingScanText = null;
  let lastSectionsDetected = [];

  // ── DOM refs ────────────────────────────────────────────

  const bodyEl = document.getElementById("pp-body");
  const badgeEl = document.getElementById("pp-page-badge");
  const settingsOverlay = document.getElementById("pp-settings-overlay");
  const patientBanner = document.getElementById("pp-patient-banner");
  const patientNameEl = document.getElementById("pp-patient-name");
  const patientSubEl = document.getElementById("pp-patient-sub");
  const patientAvatarEl = document.getElementById("pp-patient-avatar");
  const coveragePillsEl = document.getElementById("pp-coverage-pills");
  const chatLogEl = document.getElementById("pp-chat-log");
  const chatInputEl = document.getElementById("pp-chat-input");

  // ── Settings ────────────────────────────────────────────

  const STORAGE_KEY = "pp:llmConfig";
  const DEFAULTS = {
    anthropic: { model: "claude-sonnet-4-20250514", placeholder: "sk-ant-…" },
    openai: { model: "gpt-4o-mini", placeholder: "sk-…" },
    custom: { model: "", placeholder: "API key" },
  };

  function initSettings() {
    document.getElementById("pp-settings-btn").addEventListener("click", openSettings);
    document.getElementById("pp-settings-close").addEventListener("click", closeSettings);
    document.getElementById("pp-save-settings").addEventListener("click", saveSettings);
    document.getElementById("pp-test-connection").addEventListener("click", testConnection);
    document.getElementById("pp-provider").addEventListener("change", onProviderChange);
  }

  async function openSettings() {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    const config = result[STORAGE_KEY] || {};
    const provider = config.provider || "anthropic";

    document.getElementById("pp-provider").value = provider;
    document.getElementById("pp-api-key").value = config.apiKey || "";
    document.getElementById("pp-model").value = config.model || DEFAULTS[provider]?.model || "";
    document.getElementById("pp-base-url").value = config.baseUrl || "";
    document.getElementById("pp-base-url-field").style.display = provider === "custom" ? "" : "none";

    settingsOverlay.style.display = "flex";
  }

  function closeSettings() {
    settingsOverlay.style.display = "none";
  }

  function onProviderChange() {
    const provider = document.getElementById("pp-provider").value;
    const def = DEFAULTS[provider] || DEFAULTS.anthropic;
    document.getElementById("pp-model").value = def.model;
    document.getElementById("pp-api-key").placeholder = def.placeholder;
    document.getElementById("pp-base-url-field").style.display = provider === "custom" ? "" : "none";
  }

  async function saveSettings() {
    const config = {
      provider: document.getElementById("pp-provider").value,
      apiKey: document.getElementById("pp-api-key").value.trim(),
      model: document.getElementById("pp-model").value.trim(),
      baseUrl: document.getElementById("pp-base-url").value.trim(),
      maxTokens: 4096,
      temperature: 0,
    };
    if (!config.apiKey) { showSettingsMsg("error", "Please enter an API key."); return; }
    await chrome.storage.local.set({ [STORAGE_KEY]: config });
    showSettingsMsg("success", "Settings saved!");
  }

  async function testConnection() {
    const config = {
      provider: document.getElementById("pp-provider").value,
      apiKey: document.getElementById("pp-api-key").value.trim(),
      model: document.getElementById("pp-model").value.trim(),
      baseUrl: document.getElementById("pp-base-url").value.trim(),
    };
    if (!config.apiKey) { showSettingsMsg("error", "Enter an API key first."); return; }

    const btn = document.getElementById("pp-test-connection");
    btn.disabled = true;
    btn.textContent = "Testing…";
    try {
      const result = await chrome.runtime.sendMessage({ type: "PP_TEST_CONNECTION", config });
      if (result?.ok) {
        showSettingsMsg("success", "✓ Connection successful!");
      } else {
        showSettingsMsg("error", "Failed: " + (result?.error || "Unknown error"));
      }
    } catch (e) {
      showSettingsMsg("error", "Error: " + e.message);
    }
    btn.disabled = false;
    btn.textContent = "Test Connection";
  }

  function showSettingsMsg(type, text) {
    const el = document.getElementById("pp-settings-msg");
    el.className = "pp-settings-msg " + type;
    el.textContent = text;
    el.style.display = "block";
    setTimeout(() => { el.style.display = "none"; }, 4000);
  }

  // ── Patient Banner ──────────────────────────────────────

  function getInitials(name) {
    if (!name) return "?";
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    return parts[0][0]?.toUpperCase() || "?";
  }

  function updatePatientBanner(name, subtitle) {
    if (!name) {
      patientBanner.style.display = "none";
      return;
    }
    patientBanner.style.display = "";
    patientNameEl.textContent = name;
    patientSubEl.textContent = subtitle || "";
    patientAvatarEl.textContent = getInitials(name);
  }

  function updateCoveragePills(card) {
    if (!card) {
      coveragePillsEl.innerHTML = "";
      return;
    }

    let pills = [];

    // Deductible & Max as small info pills
    if (card.deductible?.individual) {
      pills.push(`<span class="pp-coverage-pill pp-pill-deductible">Ded: $${escapeHTML(card.deductible.individual)}</span>`);
    }
    if (card.annualMax?.individual) {
      pills.push(`<span class="pp-coverage-pill pp-pill-max">Max: $${escapeHTML(card.annualMax.individual)}</span>`);
    }
    if (card.annualMax?.remaining) {
      pills.push(`<span class="pp-coverage-pill pp-pill-max">Rem: $${escapeHTML(card.annualMax.remaining)}</span>`);
    }

    // Coverage category pills
    const categoryPillMap = {
      "preventive": "pp-pill-preventive",
      "diagnostic": "pp-pill-diagnostic",
      "basic": "pp-pill-basic",
      "major": "pp-pill-major",
      "orthodontics": "pp-pill-ortho",
      "ortho": "pp-pill-ortho",
      "endodontics": "pp-pill-endo",
      "endo": "pp-pill-endo",
      "periodontics": "pp-pill-perio",
      "perio": "pp-pill-perio",
      "prosthodontics": "pp-pill-prostho",
      "prostho": "pp-pill-prostho",
    };

    if (card.coverageTable?.length) {
      for (const row of card.coverageTable) {
        if (row.inNetwork == null) continue;
        const cat = (row.category || "").toLowerCase();
        const cls = categoryPillMap[cat] || "pp-pill-default";
        const label = row.category.charAt(0).toUpperCase() + row.category.slice(1);
        pills.push(`<span class="pp-coverage-pill ${cls}">${escapeHTML(label)} ${row.inNetwork}%</span>`);
      }
    }

    coveragePillsEl.innerHTML = pills.join("");
  }

  function clearBanner() {
    updatePatientBanner(null);
    updateCoveragePills(null);
  }

  // ── Message Handling ────────────────────────────────────

  // Receive page updates from content script (relayed via runtime)
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "PP_PAGE_UPDATE") {
      console.log("[PracticePilot SidePanel] Received PP_PAGE_UPDATE, pageType:", msg.pageType);
      handlePageUpdate(msg, sender.tab?.id);
    }
  });

  // Listen for tab switches
  chrome.tabs.onActivated.addListener(async ({ tabId }) => {
    activeTabId = tabId;
    requestPageData(tabId);
  });

  // Listen for URL changes within a tab
  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (tabId === activeTabId && (changeInfo.url || changeInfo.status === "complete")) {
      requestPageData(tabId);
    }
  });

  // ── Polling fallback ──────────────────────────────────────
  // Safety net: poll the active tab every 3 seconds in case
  // message-based updates don't reach the side panel.
  let _pollTimer = null;
  function startPolling() {
    if (_pollTimer) return;
    _pollTimer = setInterval(async () => {
      if (!activeTabId || isScanning) return;
      try {
        const response = await chrome.tabs.sendMessage(activeTabId, { type: "PP_GET_PAGE_DATA" });
        if (response?.pageType) {
          handlePageUpdate(response, activeTabId);
        }
      } catch (_) {
        // Content script not available on this tab — ignore
      }
    }, 3000);
  }
  startPolling();

  /** Request page data from the active tab's content script */
  async function requestPageData(tabId) {
    try {
      const response = await chrome.tabs.sendMessage(tabId, { type: "PP_GET_PAGE_DATA" });
      if (response) {
        handlePageUpdate(response, tabId);
      }
    } catch (e) {
      // Content script not injected on this tab — show idle
      currentPageType = null;
      updateBadge("");
      clearBanner();
      renderIdle();
    }
  }

  /** Handle incoming page data from content script */
  async function handlePageUpdate(data, tabId) {
    if (tabId) activeTabId = tabId;
    currentPageType = data.pageType || null;
    updateBadge(getPageLabel(currentPageType));

    const PT = {
      ELIGIBILITY: "eligibility",
      PATIENT_VIEW: "patient_view",
      INSURER_PORTAL: "insurer_portal",
    };

    if (currentPageType === PT.PATIENT_VIEW) {
      await scanPatientAndShowActions(data.pageText);
    } else if (currentPageType === PT.ELIGIBILITY) {
      await handleEligibilityPage(data.pageText);
    } else if (currentPageType === PT.INSURER_PORTAL) {
      renderInsurerPortal(data.insurerName);
    } else if (!currentCard && !isExtracting) {
      clearBanner();
      renderIdle();
    }
  }

  // ── Patient View: Scan + Actions ────────────────────────

  async function scanPatientAndShowActions(pageText) {
    if (!PP.patientContext || !pageText || pageText.length < 50) return;

    // ── Concurrency guard: if a scan is already running, queue this one
    if (isScanning) {
      pendingScanText = pageText;
      return;
    }
    isScanning = true;
    pendingScanText = null;

    try {
      const newName = PP.patientContext._extractPatientName(pageText);
      console.log("[PracticePilot SidePanel] Extracted name:", newName, "| last:", lastPatientName, "| isScanning:", isScanning);

      // ── Detect patient switch → immediately update UI
      const isPatientSwitch = newName && lastPatientName && newName.toLowerCase() !== lastPatientName.toLowerCase();
      if (isPatientSwitch) {
        currentPatientCtx = null;
        currentCard = null;
        cardFromCache = false;
        lastSectionsDetected = [];
        PP.llmContextExtractor?.clearCache();

        // Immediately show new patient banner with loading state
        updatePatientBanner(newName, "Loading…");
        updateCoveragePills(null);
        renderScanningState(newName);
      }
      lastPatientName = newName || lastPatientName;

      // Look up cached benefit card for this patient (needed for LLM cross-reference)
      let benefitCard = null;
      if (currentCard && currentCard.patientName?.toLowerCase() === newName?.toLowerCase()) {
        benefitCard = currentCard;
      } else if (newName) {
        const cacheKey = PP.storage.cacheKeyFromIdentifiers(newName, null, null);
        const cached = await PP.storage.getCachedCard(cacheKey);
        if (cached) {
          benefitCard = cached.card;
          currentCard = cached.card;
          cardFromCache = true;
        }
      }

      // scanAndMerge now returns { ctx, actions } — LLM-first, regex-fallback
      const result = await PP.patientContext.scanAndMerge(pageText, benefitCard);
      console.log("[PracticePilot SidePanel] scanAndMerge result:", result ? "OK" : "null", result?.ctx?.patientName);
      if (!result) {
        // If this was a patient switch and extraction failed, show empty state
        if (isPatientSwitch) {
          updatePatientBanner(newName, "Insurance unknown");
          renderActions(PP.patientContext._emptyContext(newName), []);
        }
        return;
      }

      const { ctx, actions, currentSections } = result;
      currentPatientCtx = ctx;
      lastSectionsDetected = currentSections || ctx.tabsScanned || [];

      // Try to get benefit card from insurance carrier if we didn't have one
      if (!benefitCard && ctx.insurance?.carrier) {
        const cacheKey = PP.storage.cacheKeyFromIdentifiers(ctx.patientName, null, ctx.insurance.carrier);
        const cached = await PP.storage.getCachedCard(cacheKey);
        if (cached) {
          benefitCard = cached.card;
          currentCard = cached.card;
          cardFromCache = true;
        }
      }

      // Update the persistent patient banner
      const insuranceLabel = [ctx.insurance?.carrier, ctx.insurance?.planName].filter(Boolean).join(" · ") || "Insurance unknown";
      updatePatientBanner(ctx.patientName, insuranceLabel);
      updateCoveragePills(benefitCard);

      renderActions(ctx, actions);
    } catch (e) {
      console.warn("[PracticePilot SidePanel] Patient scan error:", e);
    } finally {
      isScanning = false;
      // If a scan was queued while we were busy, process it now
      if (pendingScanText) {
        const queued = pendingScanText;
        pendingScanText = null;
        scanPatientAndShowActions(queued);
      }
    }
  }

  function renderScanningState(patientName) {
    bodyEl.innerHTML = `
      <div class="pp-section" style="text-align: center; padding: 20px 0;">
        <div style="font-size: 24px; margin-bottom: 8px;">⏳</div>
        <p style="font-weight: 600; margin: 0;">Scanning ${escapeHTML(patientName)}…</p>
        <p style="font-size: 12px; color: var(--pp-gray-500); margin: 4px 0 0;">
          Analyzing patient data
        </p>
      </div>
    `;
  }

  // ── Eligibility Page ────────────────────────────────────

  async function handleEligibilityPage(pageText) {
    // Try loading from cache first
    if (pageText) {
      const patientName = PP.phiRedactor.extractPatientName(pageText);
      const subscriberId = PP.phiRedactor.extractSubscriberId(pageText);
      if (patientName || subscriberId) {
        const payerHint = extractPayerHint(pageText);
        const cacheKey = PP.storage.cacheKeyFromIdentifiers(patientName, subscriberId, payerHint);
        if (cacheKey) {
          const cached = await PP.storage.getCachedCard(cacheKey);
          if (cached) {
            currentCard = cached.card;
            cardFromCache = true;
            const age = Math.floor((Date.now() - new Date(cached.cachedAt).getTime()) / 86400000);
            const missing = PP.normalize.missingItems(currentCard);
            renderResult(currentCard, missing, { cached: true, cachedAt: cached.cachedAt, ageDays: age });
            return;
          }
        }
      }
    }

    // No cache hit — show eligibility UI
    renderEligibility();

    // Auto-extract if key is set
    const config = await PP.llmExtractor.getConfig();
    if (config.apiKey && pageText && pageText.length > 50) {
      setTimeout(() => {
        if (!currentCard && !isExtracting) {
          captureAndExtract("page", pageText);
        }
      }, 1200);
    } else if (!config.apiKey) {
      renderNoKey();
    }
  }

  function extractPayerHint(text) {
    const patterns = [
      /(?:Carrier|Payer|Insurance\s*(?:Company|Carrier)?)\s*:\s*([^\n]+)/i,
      /(?:Payor)\s*:\s*([^\n]+)/i,
    ];
    for (const p of patterns) {
      const m = text.match(p);
      if (m?.[1]) return m[1].trim();
    }
    return null;
  }

  // ── Extraction Pipeline ─────────────────────────────────

  async function captureAndExtract(mode, providedText) {
    if (isExtracting) return;

    let rawText = providedText;

    // If no text provided, request from content script
    if (!rawText) {
      try {
        const response = await chrome.tabs.sendMessage(activeTabId, {
          type: mode === "selection" ? "PP_GET_SELECTION" : "PP_GET_PAGE_DATA",
        });
        rawText = mode === "selection" ? response?.selectionText : response?.pageText;
      } catch (e) {
        showToast("Cannot reach page — try reloading.");
        return;
      }
    }

    if (!rawText || rawText.length < 50) {
      showToast(mode === "selection"
        ? "Please select some eligibility text first."
        : "Not enough text found on this page.");
      return;
    }

    const config = await PP.llmExtractor.getConfig();
    if (!config.apiKey) {
      renderNoKey();
      return;
    }

    isExtracting = true;
    renderExtracting();

    try {
      const result = await PP.llmExtractor.extract(rawText);
      currentCard = result.card;
      cardFromCache = false;

      await PP.storage.setLastBenefitCard(currentCard);
      await PP.storage.cacheCard(currentCard);

      const missingItems = PP.normalize.missingItems(currentCard);
      renderResult(currentCard, missingItems, { cached: false });

      chrome.runtime.sendMessage({
        type: "PP_EXTRACTION_COMPLETE",
        summary: PP.formatter.compactSummary(currentCard),
        redactionInfo: result.redactionInfo,
      });

      showToast(`Benefits extracted! ${result.redactionInfo.redactionCount} PHI items redacted.`);
    } catch (err) {
      console.error("[PracticePilot] Extraction error:", err);
      renderError(err.message);
    } finally {
      isExtracting = false;
    }
  }

  // ── Chat ────────────────────────────────────────────────

  async function handleChatSend() {
    const input = chatInputEl;
    const log = chatLogEl;
    if (!input || !log) return;

    const question = input.value.trim();
    if (!question || isChatting) return;

    log.innerHTML += `<div class="pp-chat-msg pp-chat-user">${escapeHTML(question)}</div>`;
    input.value = "";
    isChatting = true;

    log.innerHTML += '<div class="pp-chat-msg pp-chat-bot pp-chat-typing">Thinking…</div>';
    log.scrollTop = log.scrollHeight;

    try {
      const answer = await askClaude(question);
      const typing = log.querySelector(".pp-chat-typing");
      if (typing) typing.remove();
      log.innerHTML += `<div class="pp-chat-msg pp-chat-bot">${escapeHTML(answer)}</div>`;
    } catch (e) {
      const typing = log.querySelector(".pp-chat-typing");
      if (typing) typing.remove();
      log.innerHTML += `<div class="pp-chat-msg pp-chat-bot pp-chat-error">Error: ${escapeHTML(e.message)}</div>`;
    }

    isChatting = false;
    log.scrollTop = log.scrollHeight;
  }

  async function askClaude(question) {
    const config = await PP.llmExtractor.getConfig();
    if (!config.apiKey) throw new Error("API key not set — open settings.");

    let contextParts = [];
    if (currentPatientCtx) {
      const c = currentPatientCtx;
      contextParts.push(`Patient: ${c.patientName || "unknown"}`);
      if (c.profile?.age) contextParts.push(`Age: ${c.profile.age}`);
      if (c.profile?.gender) contextParts.push(`Gender: ${c.profile.gender}`);
      if (c.insurance?.carrier) contextParts.push(`Insurance: ${c.insurance.carrier}`);
      if (c.insurance?.planName) contextParts.push(`Plan: ${c.insurance.planName}`);
      if (c.todayAppt?.codes?.length) contextParts.push(`Today's scheduled codes: ${c.todayAppt.codes.join(", ")}`);
      if (c.todayAppt?.isNewPatient) contextParts.push("This is a NEW PATIENT visit");
      if (c.billing?.hasBalance) contextParts.push(`Outstanding balance: $${c.billing.balance}`);
      if (c.billing?.aging) contextParts.push(`Aging: 0-30=$${c.billing.aging.past30}, 31-60=$${c.billing.aging.days31_60}, 61-90=$${c.billing.aging.days61_90}, 90+=$${c.billing.aging.over90}`);
      if (c.recare?.noRecareFound) contextParts.push("No recare schedule set up");
      if (c.recare?.nextDue) contextParts.push(`Next recare due: ${c.recare.nextDue}`);
      if (c.charting?.hasUnscheduledTx) contextParts.push("Has unscheduled accepted treatment");
      if (c.charting?.pendingCodes?.length) contextParts.push(`Pending CDT codes: ${c.charting.pendingCodes.join(", ")}`);
      if (c.forms?.hasPendingForms) contextParts.push("Has incomplete patient forms");
      if (c.perio?.hasPerioData) contextParts.push("Perio charting data on file");
      if (c.tabsScanned?.length) contextParts.push(`Tabs reviewed: ${c.tabsScanned.join(", ")}`);
    }
    if (currentCard) {
      if (currentCard.annualMax?.individual) contextParts.push(`Annual max: $${currentCard.annualMax.individual}`);
      if (currentCard.annualMax?.remaining) contextParts.push(`Max remaining: $${currentCard.annualMax.remaining}`);
      if (currentCard.deductible?.individual) contextParts.push(`Deductible: $${currentCard.deductible.individual}`);
      if (currentCard.coverageTable?.length) {
        const covSummary = currentCard.coverageTable
          .filter(r => r.inNetwork != null)
          .map(r => `${r.category}: ${r.inNetwork}%`).join(", ");
        if (covSummary) contextParts.push(`Coverage: ${covSummary}`);
      }
    }

    const systemMsg = `You are PracticePilot, a dental practice assistant for Merit Dental.
Answer briefly (1-3 sentences). Be specific and actionable.
Do NOT reveal PHI — keep answers clinical/operational.

Known context:
${contextParts.length ? contextParts.join("\n") : "No patient data scanned yet."}`;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": config.apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: config.model || "claude-sonnet-4-20250514",
        max_tokens: 300,
        temperature: 0.3,
        system: systemMsg,
        messages: [{ role: "user", content: question }],
      }),
    });

    if (!response.ok) throw new Error(`API error (${response.status})`);
    const data = await response.json();
    return data.content?.[0]?.text || "No response.";
  }

  // ── Render Functions ────────────────────────────────────

  function renderIdle() {
    bodyEl.innerHTML = `
      <div class="pp-empty">
        <div class="pp-empty-icon">🦷</div>
        <p><strong>PracticePilot</strong></p>
        <p>Navigate to an eligibility page in Curve or an insurance company portal to extract benefits.</p>
        <div class="pp-btn-group" style="justify-content: center; margin-top: 12px;">
          <button class="pp-btn" data-action="capture-selection">✂️ Capture Selection</button>
          <button class="pp-btn" data-action="capture-page">📄 Capture This Page</button>
        </div>
      </div>
      <div class="pp-section">
        <div class="pp-section-title">📂 Recent Patients</div>
        <div id="pp-recent-patients" class="pp-recent-list">
          <p style="font-size: 12px; color: var(--pp-gray-500);">Loading…</p>
        </div>
      </div>
      ${buildCDTLookupSection()}
    `;
    wireActions();
    loadRecentPatients();
  }

  function renderEligibility(insurerName) {
    const isInsurer = !!insurerName;
    bodyEl.innerHTML = `
      <div class="pp-capture-bar">
        <span class="pp-capture-text">${isInsurer ? "🏥 " + escapeHTML(insurerName) + " portal detected" : "Eligibility data detected on this page"}</span>
      </div>
      <div class="pp-section" style="margin-top: 12px;">
        <div class="pp-section-title">Extract Benefits</div>
        <p style="font-size: 12px; color: var(--pp-gray-500); margin: 0 0 10px;">
          ${isInsurer ? "Select the benefit details and click extract." : "Capture the eligibility text and extract structured benefit data using AI."}
        </p>
        <div class="pp-btn-group">
          <button class="pp-btn pp-btn-primary" data-action="${isInsurer ? "capture-selection" : "capture-page"}">
            ${isInsurer ? "✂️ Capture Selection" : "📄 Capture Full Page"}
          </button>
          <button class="pp-btn" data-action="${isInsurer ? "capture-page" : "capture-selection"}">
            ${isInsurer ? "📄 Capture Full Page" : "✂️ Capture Selection"}
          </button>
        </div>
      </div>
      ${buildCDTLookupSection()}
    `;
    wireActions();
  }

  function renderInsurerPortal(insurerName) {
    renderEligibility(insurerName);
  }

  function renderExtracting() {
    bodyEl.innerHTML = `
      <div class="pp-section" style="text-align: center; padding: 20px 0;">
        <div style="font-size: 24px; margin-bottom: 8px;">⏳</div>
        <p style="font-weight: 600; margin: 0;">Extracting benefits…</p>
        <p style="font-size: 12px; color: var(--pp-gray-500); margin: 4px 0 0;">
          Redacting PHI → sending to Claude → parsing response
        </p>
      </div>
    `;
  }

  function renderError(error) {
    bodyEl.innerHTML = `
      <div class="pp-section" style="text-align: center; padding: 16px 0;">
        <div style="font-size: 24px; margin-bottom: 8px;">❌</div>
        <p style="font-weight: 600; color: var(--pp-red); margin: 0;">Extraction Failed</p>
        <p style="font-size: 12px; color: var(--pp-gray-500); margin: 8px 0;">${escapeHTML(error || "Unknown error")}</p>
        <div class="pp-btn-group" style="justify-content: center; margin-top: 12px;">
          <button class="pp-btn pp-btn-primary pp-btn-sm" data-action="capture-page">Try Again</button>
        </div>
      </div>
    `;
    wireActions();
  }

  function renderNoKey() {
    bodyEl.innerHTML = `
      <div class="pp-section" style="text-align: center; padding: 16px 0;">
        <div style="font-size: 24px; margin-bottom: 8px;">🔑</div>
        <p style="font-weight: 600; margin: 0;">API Key Required</p>
        <p style="font-size: 12px; color: var(--pp-gray-500); margin: 8px 0;">
          Click the ⚙ icon above to configure your API key.
        </p>
      </div>
    `;
  }

  function renderActions(ctx, actions) {
    if (!ctx) { renderIdle(); return; }

    const scannedTabs = ctx.tabsScanned.map(t => t.charAt(0).toUpperCase() + t.slice(1));
    const scannedLabel = scannedTabs.length ? scannedTabs.join(", ") : "none yet";

    const priorityClasses = {
      1: "pp-action-critical",
      2: "pp-action-action",
      3: "pp-action-recommended",
      4: "pp-action-info",
    };

    const critical = (actions || []).filter(a => a.priority <= 2);
    const other = (actions || []).filter(a => a.priority > 2);

    const renderItem = (a) => `
      <div class="pp-action-item ${priorityClasses[a.priority] || ""}">
        <span class="pp-action-icon">${a.icon}</span>
        <div class="pp-action-content">
          <div class="pp-action-title">${escapeHTML(a.title)}</div>
          <div class="pp-action-detail">${escapeHTML(a.detail)}</div>
        </div>
      </div>
    `;

    const criticalHTML = critical.map(renderItem).join("");
    const otherHTML = other.length
      ? `<details class="pp-action-more"><summary>${other.length} more suggestion${other.length > 1 ? "s" : ""}…</summary>${other.map(renderItem).join("")}</details>`
      : "";

    const noActions = !actions?.length
      ? '<p style="font-size: 12px; color: var(--pp-gray-500); text-align: center; padding: 8px 0;">Open more tabs to build action list…</p>'
      : "";

    let benefitLink = "";
    if (currentCard && currentCard.patientName?.toLowerCase() === ctx.patientName?.toLowerCase()) {
      benefitLink = `<button class="pp-btn pp-btn-sm pp-btn-primary" data-action="show-benefits" style="width: 100%; margin-top: 6px;">📋 View Benefits</button>`;
    }

    // ── Tab-contextual sections ──────────────────────────
    const contextualSection = buildTabContextualSection(ctx);

    bodyEl.innerHTML = `
      ${contextualSection}
      <div class="pp-section">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
          <div class="pp-section-title" style="margin: 0;">⚡ Actions</div>
          <button class="pp-btn pp-btn-sm" data-action="rescan-patient" title="Re-scan page">🔄</button>
        </div>
        <div class="pp-scanned-tabs">Scanned: ${escapeHTML(scannedLabel)}</div>
      </div>
      <div class="pp-section">
        <div class="pp-actions-list">${criticalHTML}${otherHTML}${noActions}</div>
        ${benefitLink}
      </div>
      ${buildCDTLookupSection()}
    `;
    wireActions();
  }

  /**
   * Build a coverage summary section showing category percentages
   * if a benefit card is available for the current patient.
   */
  function buildCoverageSummarySection() {
    if (!currentCard) return "";

    const card = currentCard;
    const rows = (card.coverageTable || [])
      .filter(r => r.inNetwork !== null && r.inNetwork !== undefined);
    if (!rows.length) return "";

    const covHTML = rows.map(r => {
      const pct = r.inNetwork;
      const cls = pct >= 80 ? "pp-cov-high" : pct >= 50 ? "pp-cov-mid" : "pp-cov-low";
      return `<div class="pp-cov-row">
        <span class="pp-cov-category">${escapeHTML(r.category)}</span>
        <span class="pp-cov-bar-wrap"><span class="pp-cov-bar ${cls}" style="width:${Math.min(pct, 100)}%"></span></span>
        <span class="pp-cov-pct ${cls}">${pct}%</span>
      </div>`;
    }).join("");

    let deductMax = "";
    if (card.deductible?.individual || card.annualMax?.individual) {
      const parts = [];
      if (card.deductible?.individual) parts.push(`Ded: $${escapeHTML(card.deductible.individual)}`);
      if (card.annualMax?.individual) parts.push(`Max: $${escapeHTML(card.annualMax.individual)}`);
      if (card.annualMax?.remaining) parts.push(`Rem: $${escapeHTML(card.annualMax.remaining)}`);
      deductMax = `<div class="pp-cov-deduct-max">${parts.join(" · ")}</div>`;
    }

    return `
      <div class="pp-section">
        <div class="pp-section-title">📊 Coverage Summary</div>
        ${deductMax}
        <div class="pp-cov-grid">${covHTML}</div>
      </div>
    `;
  }

  /**
   * Decide which tab-contextual section to show based on the most
   * recently detected Curve tab. Priority: insurance → claims → billing.
   */
  function buildTabContextualSection(ctx) {
    // Determine what the user is CURRENTLY looking at
    // Use the latest sections detected (last scan) for current-tab context
    const latest = lastSectionsDetected;

    // Insurance tab → show coverage summary or "Cash Patient"
    if (latest.includes("insurance")) {
      return buildInsuranceContextSection(ctx);
    }

    // Claims tab → show claims status
    if (latest.includes("claims")) {
      return buildClaimsSummarySection(ctx);
    }

    // Billing tab → show billing summary
    if (latest.includes("billing")) {
      return buildBillingSummarySection(ctx);
    }

    // Default: show insurance status badge (Cash or carrier) + coverage if available
    return buildInsuranceStatusBadge(ctx) + buildCoverageSummarySection();
  }

  /**
   * Insurance tab context: full coverage summary or Cash Patient indicator.
   */
  function buildInsuranceContextSection(ctx) {
    const ins = ctx.insurance || {};
    const hasInsurance = ins.carrier || ins.planName;

    if (!hasInsurance) {
      return `
        <div class="pp-section pp-cash-patient">
          <div class="pp-cash-badge">
            <span class="pp-cash-icon">💵</span>
            <div>
              <div class="pp-cash-title">Cash Patient</div>
              <div class="pp-cash-detail">No insurance on file</div>
            </div>
          </div>
        </div>
      `;
    }

    // Has insurance — show carrier info + coverage summary
    const carrierLine = [ins.carrier, ins.planName].filter(Boolean).join(" · ");
    const verifiedLine = ins.lastVerified ? `Last verified: ${escapeHTML(ins.lastVerified)}` : "Not verified";

    return `
      <div class="pp-section">
        <div class="pp-section-title">🔄 Insurance</div>
        <div class="pp-ins-header">
          <div class="pp-ins-carrier">${escapeHTML(carrierLine)}</div>
          <div class="pp-ins-verified">${escapeHTML(verifiedLine)}</div>
        </div>
      </div>
      ${buildCoverageSummarySection()}
    `;
  }

  /**
   * Claims tab context: show claim counts by status.
   */
  function buildClaimsSummarySection(ctx) {
    const claims = ctx.claims || {};
    const billing = ctx.billing || {};

    // Pull numbers from both claims and billing sections
    const unsent = claims.unsentClaims ?? billing.pendingClaims ?? null;
    const pending = claims.pendingInsurance ?? null;
    const rejected = claims.rejectedClaims ?? null;
    const paid = claims.paidClaims ?? null;
    const total = claims.totalClaims ?? null;

    const hasAnyData = [unsent, pending, rejected, paid, total].some(v => v !== null);

    if (!hasAnyData) {
      return `
        <div class="pp-section">
          <div class="pp-section-title">📋 Claims</div>
          <p style="font-size: 12px; color: var(--pp-gray-500); text-align: center; padding: 8px 0;">
            Claims info will appear when you open the Claims tab in Curve
          </p>
        </div>
      `;
    }

    const statItems = [];
    if (unsent !== null && unsent > 0) {
      statItems.push(`<div class="pp-claim-stat pp-claim-urgent"><span class="pp-claim-count">${unsent}</span><span class="pp-claim-label">Unsent</span></div>`);
    }
    if (pending !== null && pending > 0) {
      statItems.push(`<div class="pp-claim-stat pp-claim-pending"><span class="pp-claim-count">${pending}</span><span class="pp-claim-label">Pending</span></div>`);
    }
    if (rejected !== null && rejected > 0) {
      statItems.push(`<div class="pp-claim-stat pp-claim-rejected"><span class="pp-claim-count">${rejected}</span><span class="pp-claim-label">Rejected</span></div>`);
    }
    if (paid !== null && paid > 0) {
      statItems.push(`<div class="pp-claim-stat pp-claim-paid"><span class="pp-claim-count">${paid}</span><span class="pp-claim-label">Paid</span></div>`);
    }

    // If everything is zero, show all-clear
    if (!statItems.length) {
      statItems.push(`<div class="pp-claim-stat pp-claim-clear"><span class="pp-claim-count">✓</span><span class="pp-claim-label">All Clear</span></div>`);
    }

    // Claims list detail (if LLM returned individual claims)
    let claimsList = "";
    if (claims.claimsList?.length) {
      const rows = claims.claimsList.slice(0, 8).map(c => {
        const statusCls = {
          unsent: "pp-claim-urgent",
          pending: "pp-claim-pending",
          rejected: "pp-claim-rejected",
          denied: "pp-claim-rejected",
          paid: "pp-claim-paid",
        }[c.status] || "";
        return `<div class="pp-claim-row">
          <span class="pp-claim-row-id">${escapeHTML(c.claimNumber || "—")}</span>
          <span class="pp-claim-row-status ${statusCls}">${escapeHTML(c.status || "—")}</span>
          <span class="pp-claim-row-amt">${escapeHTML(c.amount || "—")}</span>
        </div>`;
      }).join("");
      claimsList = `<div class="pp-claims-list">${rows}</div>`;
    }

    return `
      <div class="pp-section">
        <div class="pp-section-title">📋 Claims Status</div>
        <div class="pp-claims-grid">${statItems.join("")}</div>
        ${claimsList}
      </div>
    `;
  }

  /**
   * Billing tab context: show balance and aging summary.
   */
  function buildBillingSummarySection(ctx) {
    const billing = ctx.billing || {};

    if (!billing.balance && !billing.hasBalance && !billing.aging) {
      return `
        <div class="pp-section">
          <div class="pp-section-title">💰 Billing</div>
          <p style="font-size: 12px; color: var(--pp-gray-500); text-align: center; padding: 8px 0;">
            Billing info will appear when you open the Billing tab in Curve
          </p>
        </div>
      `;
    }

    let balanceHTML = "";
    if (billing.balance) {
      const balanceClass = billing.hasOverdue ? "pp-balance-overdue" : (billing.hasBalance ? "pp-balance-due" : "pp-balance-clear");
      balanceHTML = `<div class="pp-billing-balance ${balanceClass}">
        <span class="pp-billing-amount">$${escapeHTML(billing.balance)}</span>
        <span class="pp-billing-label">${billing.hasOverdue ? "Overdue Balance" : "Account Balance"}</span>
      </div>`;
    }

    let agingHTML = "";
    if (billing.aging) {
      const a = billing.aging;
      const agingItems = [
        { label: "0-30", value: a.past30 },
        { label: "31-60", value: a.days31_60 },
        { label: "61-90", value: a.days61_90 },
        { label: "90+",  value: a.over90 },
      ].filter(item => item.value && parseFloat(item.value.replace(/,/g, "")) > 0);

      if (agingItems.length) {
        agingHTML = `<div class="pp-aging-grid">${agingItems.map(item => `
          <div class="pp-aging-item">
            <span class="pp-aging-value">$${escapeHTML(item.value)}</span>
            <span class="pp-aging-label">${item.label} days</span>
          </div>
        `).join("")}</div>`;
      }
    }

    let creditHTML = "";
    if (billing.hasCredit && billing.creditAmount) {
      creditHTML = `<div class="pp-billing-credit">Credit: $${escapeHTML(billing.creditAmount)}</div>`;
    }

    return `
      <div class="pp-section">
        <div class="pp-section-title">💰 Billing Summary</div>
        ${balanceHTML}
        ${agingHTML}
        ${creditHTML}
      </div>
    `;
  }

  /**
   * Small insurance status badge for non-insurance/non-claims contexts.
   */
  function buildInsuranceStatusBadge(ctx) {
    const ins = ctx.insurance || {};
    const hasInsurance = ins.carrier || ins.planName;

    if (!hasInsurance) {
      return `<div class="pp-section pp-cash-patient-compact">
        <span class="pp-cash-icon">💵</span>
        <span class="pp-cash-title-sm">Cash Patient</span>
        <span class="pp-cash-detail-sm">No insurance on file</span>
      </div>`;
    }
    return "";
  }

  function renderResult(card, missingItems, extra = {}) {
    if (!card) { renderIdle(); return; }

    // Update banner with patient + plan info
    const subtitle = [card.payer, card.planName].filter(Boolean).join(" · ") || "";
    updatePatientBanner(card.patientName || currentPatientCtx?.patientName, subtitle || "Benefits extracted");
    updateCoveragePills(card);

    const summary = PP.formatter.compactSummary(card);
    const confidence = card.confidence?.overall || "medium";

    const confidenceBadge = {
      high: '<span class="pp-badge pp-badge-green">High Confidence</span>',
      medium: '<span class="pp-badge pp-badge-amber">Medium Confidence</span>',
      low: '<span class="pp-badge pp-badge-red">Low Confidence</span>',
    }[confidence] || "";

    let cacheBar = "";
    if (extra.cached) {
      const cachedDate = extra.cachedAt
        ? new Date(extra.cachedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
        : "unknown date";
      const isStale = (extra.ageDays || 0) > 30;
      cacheBar = `
        <div class="pp-cache-bar ${isStale ? "pp-cache-stale" : ""}">
          <span class="pp-cache-label">
            ${isStale ? "⚠️" : "💾"} Cached — ${cachedDate}${isStale ? " (stale)" : ""}
          </span>
          <button class="pp-btn pp-btn-sm pp-btn-refresh" data-action="capture-page" title="Re-extract">🔄 Re-extract</button>
        </div>
      `;
    }

    const covRows = (card.coverageTable || [])
      .filter(r => r.inNetwork !== null && r.inNetwork !== undefined)
      .map(r => `<div class="pp-data-label">${r.category}</div><div class="pp-data-value">${r.inNetwork}%</div>`).join("");

    const exRows = (card.coverageExceptions || []).map(ex =>
      `<div class="pp-data-label">${ex.description || ex.cdtCodes}</div><div class="pp-data-value">${ex.inNetwork}%${ex.note ? ` <small>(${ex.note})</small>` : ""}</div>`
    ).join("");

    const freqEntries = [
      ["Prophy", card.frequencies?.prophy],
      ["Exam", card.frequencies?.exam],
      ["BWX", card.frequencies?.bwx],
      ["FMX/Pano", card.frequencies?.fmx || card.frequencies?.pano],
      ["Fluoride", card.frequencies?.fluoride],
    ].filter(([, v]) => v);
    const freqRows = freqEntries.map(([label, val]) =>
      `<div class="pp-data-label">${label}</div><div class="pp-data-value">${val}</div>`
    ).join("");

    const missingHTML = missingItems?.length
      ? `<div class="pp-section"><div class="pp-section-title">⚠️ Missing / Unverified</div><ul class="pp-checklist">${missingItems.map(m => `<li>${m}</li>`).join("")}</ul></div>`
      : "";

    // Build benefit summary cards (deductible + max)
    const benefitCards = `
      <div class="pp-benefit-grid">
        <div class="pp-benefit-card">
          <div class="pp-benefit-card-label">Deductible</div>
          <div class="pp-benefit-card-value${!card.deductible?.individual ? ' pp-missing' : ''}">${card.deductible?.individual ? '$' + escapeHTML(card.deductible.individual) : '—'}</div>
        </div>
        <div class="pp-benefit-card">
          <div class="pp-benefit-card-label">Annual Max</div>
          <div class="pp-benefit-card-value${!card.annualMax?.individual ? ' pp-missing' : ''}">${card.annualMax?.individual ? '$' + escapeHTML(card.annualMax.individual) : '—'}</div>
        </div>
        ${card.annualMax?.remaining ? `<div class="pp-benefit-card"><div class="pp-benefit-card-label">Remaining</div><div class="pp-benefit-card-value">$${escapeHTML(card.annualMax.remaining)}</div></div>` : ''}
        ${card.annualMax?.used ? `<div class="pp-benefit-card"><div class="pp-benefit-card-label">Used</div><div class="pp-benefit-card-value">$${escapeHTML(card.annualMax.used)}</div></div>` : ''}
      </div>
    `;

    bodyEl.innerHTML = `
      ${cacheBar}
      <div class="pp-section">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
          <div class="pp-section-title" style="margin: 0;">Benefits Overview</div>
          ${confidenceBadge}
        </div>
        ${benefitCards}
      </div>
      <div class="pp-section">
        <div class="pp-section-title">Plan Details</div>
        <div class="pp-data-grid">
          ${card.subscriberId ? `<div class="pp-data-label">Subscriber ID</div><div class="pp-data-value">${escapeHTML(card.subscriberId)}</div>` : ""}
          ${card.payer ? `<div class="pp-data-label">Carrier</div><div class="pp-data-value">${escapeHTML(card.payer)}</div>` : ""}
          ${card.planName ? `<div class="pp-data-label">Plan</div><div class="pp-data-value">${escapeHTML(card.planName)}</div>` : ""}
          ${card.planType ? `<div class="pp-data-label">Type</div><div class="pp-data-value">${escapeHTML(card.planType)}</div>` : ""}
          ${card.groupNumber ? `<div class="pp-data-label">Group #</div><div class="pp-data-value">${escapeHTML(card.groupNumber)}</div>` : ""}
        </div>
      </div>
      ${covRows ? `<div class="pp-section"><div class="pp-section-title">Coverage Table (CDT)</div><div class="pp-data-grid">${covRows}</div></div>` : ""}
      ${exRows ? `<div class="pp-section"><div class="pp-section-title">Coverage Exceptions</div><div class="pp-data-grid">${exRows}</div></div>` : ""}
      ${freqRows ? `<div class="pp-section"><div class="pp-section-title">Frequencies</div><div class="pp-data-grid">${freqRows}</div></div>` : ""}
      ${card.waitingPeriods?.length ? `<div class="pp-section"><div class="pp-section-title">Waiting Periods</div><div class="pp-data-grid">${card.waitingPeriods.map(wp => `<div class="pp-data-label">${escapeHTML(wp.category)}</div><div class="pp-data-value">${escapeHTML(wp.period)}</div>`).join("")}</div></div>` : ""}
      ${card.notes?.length ? `<div class="pp-section"><div class="pp-section-title">Notes & Limitations</div><ul style="margin:0;padding-left:16px;font-size:12px;color:var(--pp-gray-700);">${card.notes.map(n => `<li>${escapeHTML(n)}</li>`).join("")}</ul></div>` : ""}
      ${missingHTML}
      <div class="pp-section">
        <div class="pp-section-title">Copy to Clipboard</div>
        <div class="pp-btn-group">
          <button class="pp-btn pp-btn-primary pp-btn-sm" data-action="copy-note">📋 Verification Note</button>
          <button class="pp-btn pp-btn-sm" data-action="copy-summary">📝 Summary</button>
          <button class="pp-btn pp-btn-sm" data-action="copy-checklist">✅ Checklist</button>
          <button class="pp-btn pp-btn-sm" data-action="copy-curve">🖥️ Copy for Curve</button>
          ${missingItems?.length ? '<button class="pp-btn pp-btn-sm" data-action="copy-patient-msg">✉️ Patient Message</button>' : ""}
        </div>
      </div>
      ${buildCDTLookupSection()}
      <div class="pp-section" style="text-align: center; border-top: 1px solid var(--pp-gray-200); padding-top: 12px;">
        <button class="pp-btn pp-btn-sm" data-action="capture-page">🔄 Re-extract Page</button>
        <button class="pp-btn pp-btn-sm" data-action="capture-selection">✂️ Re-extract Selection</button>
      </div>
    `;
    wireActions();
  }

  // ── CDT Lookup ──────────────────────────────────────────

  function buildCDTLookupSection() {
    return `
      <div class="pp-section">
        <div class="pp-section-title">🦷 CDT Code Lookup</div>
        <div class="pp-cdt-lookup">
          <input type="text" class="pp-cdt-search" data-action="cdt-search" placeholder="Type code (D2740) or keyword (crown)…" autocomplete="off" />
          <div class="pp-cdt-results" id="pp-cdt-results"></div>
        </div>
      </div>
    `;
  }

  function buildCDTItemHTML(entry) {
    const cov = currentCard ? PP.cdtCodes.getCoverage(entry.code, currentCard) : null;
    const covClass = cov === null ? "pp-cov-none" : cov >= 80 ? "pp-cov-high" : cov >= 50 ? "pp-cov-mid" : "pp-cov-low";
    const tierClass = `pp-tier-${entry.tier || "basic"}`;
    const tierLabel = PP.cdtCodes.TIER_LABELS[entry.tier] || entry.tier || "";
    const starIcon = entry.starred ? "⭐ " : "";
    return `
      <div class="pp-cdt-item${entry.starred ? " pp-cdt-starred" : ""}">
        <div><span class="pp-cdt-code">${entry.code}</span><span class="pp-cdt-name">${starIcon}${escapeHTML(entry.aka || entry.name)}</span></div>
        <div class="pp-cdt-meta">
          <span class="pp-cdt-tier ${tierClass}">${escapeHTML(tierLabel)}</span>
          <span>${escapeHTML(entry.category)} (${entry.cdtRange})</span>
          ${cov !== null ? `<span class="pp-cdt-coverage ${covClass}">${cov}%</span>` : '<span class="pp-cdt-coverage pp-cov-none">—</span>'}
        </div>
        ${entry.note ? `<div class="pp-cdt-note">${escapeHTML(entry.note)}</div>` : ""}
      </div>
    `;
  }

  let _cdtSearchTimer = null;
  function handleCDTSearchInput(e) {
    const query = e.target.value.trim();
    clearTimeout(_cdtSearchTimer);
    _cdtSearchTimer = setTimeout(() => renderCDTResults(query), 150);
  }

  function renderCDTResults(query) {
    const container = document.getElementById("pp-cdt-results");
    if (!container) return;
    if (!query || query.length < 2) {
      container.innerHTML = '<div class="pp-cdt-empty">Type at least 2 characters to search</div>';
      return;
    }
    const results = PP.cdtCodes.search(query, 15);
    if (!results.length) {
      container.innerHTML = `<div class="pp-cdt-empty">No codes matching "${escapeHTML(query)}"</div>`;
      return;
    }
    container.innerHTML = results.map(r => buildCDTItemHTML(r)).join("");
  }

  function renderCDTBrowse() {
    const container = document.getElementById("pp-cdt-results");
    if (!container) return;
    const sections = PP.cdtCodes.getSections();
    let html = "";
    for (const section of sections) {
      html += `<div class="pp-cdt-section-heading">${escapeHTML(section.heading)}</div>`;
      for (const code of section.codes) {
        const entry = PP.cdtCodes.lookup(code);
        if (entry) html += buildCDTItemHTML({ code, ...entry });
      }
    }
    container.innerHTML = html;
    const browseBtn = document.querySelector('[data-action="cdt-browse"]');
    if (browseBtn) { browseBtn.textContent = "Collapse code list"; browseBtn.dataset.action = "cdt-collapse"; }
  }

  // ── Recent Patients ─────────────────────────────────────

  let _cachedCards = [];
  async function loadRecentPatients() {
    const container = document.getElementById("pp-recent-patients");
    if (!container) return;

    try {
      _cachedCards = await PP.storage.getAllCachedCards();
      if (!_cachedCards.length) {
        container.innerHTML = '<p style="font-size: 12px; color: var(--pp-gray-500);">No saved patients yet.</p>';
        return;
      }
      const items = _cachedCards.slice(0, 10).map((entry, i) => {
        const card = entry.card;
        const name = card.patientName || "Unknown Patient";
        const payer = card.payer || "Unknown Carrier";
        const date = new Date(entry.cachedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" });
        return `
          <div class="pp-recent-item" data-action="load-cached" data-cache-index="${i}" title="Click to load ${escapeHTML(name)}">
            <div class="pp-recent-name">${escapeHTML(name)}</div>
            <div class="pp-recent-detail">${escapeHTML(payer)} · ${date}</div>
          </div>
        `;
      }).join("");
      container.innerHTML = items + '<button class="pp-btn pp-btn-sm" data-action="clear-cache" style="margin-top: 8px; font-size: 11px;">🗑️ Clear All Cached</button>';
    } catch (e) {
      container.innerHTML = '<p style="font-size: 12px; color: var(--pp-gray-500);">Could not load recent patients.</p>';
    }
  }

  // ── Action Wiring ───────────────────────────────────────

  function wireActions() {
    // Wire CDT search
    const cdtInput = document.querySelector(".pp-cdt-search");
    if (cdtInput) cdtInput.addEventListener("input", handleCDTSearchInput);
  }

  /** Wire the fixed chat bar (called once on init) */
  function wireChatBar() {
    if (chatInputEl) {
      chatInputEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleChatSend(); }
      });
    }
  }

  // Delegate all clicks on body
  document.addEventListener("click", (e) => {
    const target = e.target.closest("[data-action]");
    if (!target) return;

    const action = target.dataset.action;
    switch (action) {
      case "capture-page":
        captureAndExtract("page");
        break;
      case "capture-selection":
        captureAndExtract("selection");
        break;
      case "copy-note":
        copyToClipboard(target, PP.formatter.verificationNote(currentCard));
        break;
      case "copy-summary":
        copyToClipboard(target, PP.formatter.compactSummary(currentCard));
        break;
      case "copy-checklist": {
        const missing = PP.normalize.missingItems(currentCard);
        copyToClipboard(target, PP.formatter.staffChecklist(currentCard, missing));
        break;
      }
      case "copy-patient-msg": {
        const missing = PP.normalize.missingItems(currentCard);
        copyToClipboard(target, PP.formatter.patientInfoRequest(missing));
        break;
      }
      case "copy-curve":
        copyToClipboard(target, PP.formatter.curveDataEntry(currentCard));
        break;
      case "cdt-browse":
        renderCDTBrowse();
        break;
      case "cdt-collapse": {
        const container = document.getElementById("pp-cdt-results");
        if (container) container.innerHTML = "";
        target.textContent = "Browse all codes by category";
        target.dataset.action = "cdt-browse";
        break;
      }
      case "load-cached": {
        const idx = parseInt(target.closest("[data-cache-index]")?.dataset?.cacheIndex, 10);
        if (_cachedCards[idx]) {
          const entry = _cachedCards[idx];
          currentCard = entry.card;
          cardFromCache = true;
          const ageDays = Math.floor((Date.now() - new Date(entry.cachedAt).getTime()) / 86400000);
          const missingItems = PP.normalize.missingItems(currentCard);
          renderResult(currentCard, missingItems, { cached: true, cachedAt: entry.cachedAt, ageDays });
          showToast(`Loaded benefits for ${currentCard.patientName || "patient"}`);
        }
        break;
      }
      case "clear-cache":
        PP.storage.clearCardCache().then(() => {
          showToast("Cache cleared");
          if (!currentCard) renderIdle();
        });
        break;
      case "rescan-patient":
        requestPageData(activeTabId);
        break;
      case "chat-send":
        handleChatSend();
        break;
      case "show-benefits":
        if (currentCard) {
          const missingItems = PP.normalize.missingItems(currentCard);
          renderResult(currentCard, missingItems, { cached: cardFromCache });
        }
        break;
    }
  });

  // ── Helpers ─────────────────────────────────────────────

  function updateBadge(text) {
    badgeEl.textContent = text || "";
    badgeEl.style.display = text ? "" : "none";
  }

  function getPageLabel(pageType) {
    const labels = {
      eligibility: "Eligibility",
      insurer_portal: "Insurer Portal",
      patient_view: "Patient",
      schedule: "Schedule",
      patient_chart: "Patient",
      claims: "Claims",
    };
    return labels[pageType] || "";
  }

  function escapeHTML(str) {
    if (!str) return "";
    const div = document.createElement("div");
    div.textContent = String(str);
    return div.innerHTML;
  }

  async function copyToClipboard(buttonEl, text) {
    try {
      await navigator.clipboard.writeText(text);
      const originalHTML = buttonEl.innerHTML;
      buttonEl.classList.add("pp-copied");
      buttonEl.innerHTML = "✓ Copied!";
      setTimeout(() => { buttonEl.classList.remove("pp-copied"); buttonEl.innerHTML = originalHTML; }, 1500);
    } catch {
      showToast("Copy failed — try again");
    }
  }

  function showToast(message) {
    let toast = document.getElementById("pp-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "pp-toast";
      toast.className = "pp-toast";
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add("pp-toast-visible");
    setTimeout(() => toast.classList.remove("pp-toast-visible"), 3000);
  }

  // ── Initialize ──────────────────────────────────────────

  async function init() {
    console.log("[PracticePilot SidePanel] Initializing");
    initSettings();
    wireChatBar();

    // Get the active tab and request page data
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      activeTabId = tab.id;
      requestPageData(tab.id);
    } else {
      renderIdle();
    }
  }

  init();

})();
