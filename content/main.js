// ============================================================
// PracticePilot — Main Content Script Orchestrator
// ============================================================
// Ties together page detection, text capture, LLM extraction,
// and the sidebar panel UI. This is the glue.
//
// Auto-loaded on curvedental.com. Injected on-demand on
// insurance company portals (Humana, Cigna, etc.).
// ============================================================

(function () {
  "use strict";

  const PP = window.PracticePilot;
  if (!PP) {
    console.error("[PracticePilot] Shared modules not loaded.");
    return;
  }

  // ── State ───────────────────────────────────────────────

  let panelEl = null;
  let currentCard = null;
  let currentPageType = null;
  let isExtracting = false;
  let cleanupDetector = null;

  // ── Panel DOM Creation ──────────────────────────────────

  function createPanel() {
    if (document.getElementById("pp-panel")) {
      panelEl = document.getElementById("pp-panel");
      return;
    }

    panelEl = document.createElement("div");
    panelEl.id = "pp-panel";
    panelEl.innerHTML = buildPanelHTML("idle");
    document.body.appendChild(panelEl);

    // Wire up header collapse toggle
    panelEl.addEventListener("click", handlePanelClick);
  }

  function buildPanelHTML(state, extra = {}) {
    const pageLabel = getPageLabel(currentPageType);

    let bodyContent = "";

    switch (state) {
      case "idle":
        bodyContent = buildIdleBody();
        break;
      case "extracting":
        bodyContent = buildExtractingBody();
        break;
      case "result":
        bodyContent = buildResultBody(extra.card, extra.missingItems);
        break;
      case "error":
        bodyContent = buildErrorBody(extra.error);
        break;
      case "no-key":
        bodyContent = buildNoKeyBody();
        break;
      default:
        bodyContent = buildIdleBody();
    }

    return `
      <div class="pp-header" data-action="toggle">
        <div>
          <span class="pp-header-title">PracticePilot</span>
          ${pageLabel ? `<span class="pp-header-badge">${pageLabel}</span>` : ""}
        </div>
        <div class="pp-header-actions">
          <button class="pp-header-btn" data-action="toggle" title="Minimize">
            <span class="pp-caret">▼</span>
          </button>
          <button class="pp-header-btn" data-action="close" title="Close">✕</button>
        </div>
      </div>
      <div class="pp-body">
        ${bodyContent}
      </div>
    `;
  }

  // ── Body builders ───────────────────────────────────────

  function buildIdleBody() {
    const isEligibility = currentPageType === PP.pageDetector.PAGE_TYPES.ELIGIBILITY;
    const isInsurerPortal = currentPageType === PP.pageDetector.PAGE_TYPES.INSURER_PORTAL;
    const insurerName = PP.pageDetector.getInsurerName?.() || null;

    if (isEligibility) {
      return `
        <div class="pp-capture-bar">
          <span class="pp-capture-text">Eligibility data detected on this page</span>
        </div>
        <div class="pp-section" style="margin-top: 12px;">
          <div class="pp-section-title">Extract Benefits</div>
          <p style="font-size: 12px; color: var(--pp-gray-500); margin: 0 0 10px;">
            Capture the eligibility text on this page and extract structured benefit data using AI.
          </p>
          <div class="pp-btn-group">
            <button class="pp-btn pp-btn-primary" data-action="capture-page">
              📄 Capture Full Page
            </button>
            <button class="pp-btn" data-action="capture-selection">
              ✂️ Capture Selection
            </button>
          </div>
          <p style="font-size: 11px; color: var(--pp-gray-500); margin: 8px 0 0;">
            Tip: Select the eligibility response text first, then click "Capture Selection" for best results.
          </p>
        </div>
      `;
    }

    if (isInsurerPortal) {
      return `
        <div class="pp-capture-bar">
          <span class="pp-capture-text">🏥 ${insurerName ? insurerName + " portal" : "Insurance portal"} detected</span>
        </div>
        <div class="pp-section" style="margin-top: 12px;">
          <div class="pp-section-title">Extract Benefits</div>
          <p style="font-size: 12px; color: var(--pp-gray-500); margin: 0 0 10px;">
            Navigate to the eligibility/benefits page, then select the benefit details and click extract.
          </p>
          <div class="pp-btn-group">
            <button class="pp-btn pp-btn-primary" data-action="capture-selection">
              ✂️ Capture Selection
            </button>
            <button class="pp-btn" data-action="capture-page">
              📄 Capture Full Page
            </button>
          </div>
          <p style="font-size: 11px; color: var(--pp-gray-500); margin: 8px 0 0;">
            Tip: On insurer portals, selecting just the benefits section works better than full page capture.
          </p>
        </div>
      `;
    }

    return `
      <div class="pp-empty">
        <div class="pp-empty-icon">🦷</div>
        <p><strong>PracticePilot</strong></p>
        <p>Navigate to an eligibility page in Curve or an insurance company portal to extract benefits.</p>
        <div class="pp-btn-group" style="justify-content: center; margin-top: 12px;">
          <button class="pp-btn" data-action="capture-selection">
            ✂️ Capture Selection
          </button>
          <button class="pp-btn" data-action="capture-page">
            📄 Capture This Page
          </button>
        </div>
      </div>
    `;
  }

  function buildExtractingBody() {
    return `
      <div class="pp-section" style="text-align: center; padding: 20px 0;">
        <div style="font-size: 24px; margin-bottom: 8px;">⏳</div>
        <p style="font-weight: 600; margin: 0;">Extracting benefits…</p>
        <p style="font-size: 12px; color: var(--pp-gray-500); margin: 4px 0 0;">
          Redacting PHI → sending to Claude → parsing response
        </p>
      </div>
    `;
  }

  function buildResultBody(card, missingItems) {
    if (!card) return buildIdleBody();

    const note = PP.formatter.verificationNote(card);
    const summary = PP.formatter.compactSummary(card);
    const confidence = card.confidence?.overall || "medium";

    const confidenceBadge = {
      high: '<span class="pp-badge pp-badge-green">High Confidence</span>',
      medium: '<span class="pp-badge pp-badge-amber">Medium Confidence</span>',
      low: '<span class="pp-badge pp-badge-red">Low Confidence</span>',
    }[confidence] || "";

    // Coverage table rows
    const covRows = (card.coverageTable || [])
      .filter(r => r.inNetwork !== null && r.inNetwork !== undefined)
      .map(r => `
        <div class="pp-data-label">${r.category}</div>
        <div class="pp-data-value">${r.inNetwork}%</div>
      `).join("");

    // Exceptions
    const exRows = (card.coverageExceptions || []).map(ex => `
      <div class="pp-data-label">${ex.description || ex.cdtCodes}</div>
      <div class="pp-data-value">${ex.inNetwork}%${ex.note ? ` <small>(${ex.note})</small>` : ""}</div>
    `).join("");

    // Frequencies
    const freqEntries = [
      ["Prophy", card.frequencies?.prophy],
      ["Exam", card.frequencies?.exam],
      ["BWX", card.frequencies?.bwx],
      ["FMX/Pano", card.frequencies?.fmx || card.frequencies?.pano],
      ["Fluoride", card.frequencies?.fluoride],
    ].filter(([, v]) => v);

    const freqRows = freqEntries.map(([label, val]) => `
      <div class="pp-data-label">${label}</div>
      <div class="pp-data-value">${val}</div>
    `).join("");

    // Missing items
    const missingHTML = missingItems?.length
      ? `<div class="pp-section">
           <div class="pp-section-title">⚠️ Missing / Unverified</div>
           <ul class="pp-checklist">
             ${missingItems.map(m => `<li>${m}</li>`).join("")}
           </ul>
         </div>`
      : "";

    return `
      <!-- Summary bar -->
      <div class="pp-section">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
          <div class="pp-section-title" style="margin: 0;">Quick Summary</div>
          ${confidenceBadge}
        </div>
        <div class="pp-card">
          <pre>${escapeHTML(summary)}</pre>
        </div>
      </div>

      <!-- Plan Info -->
      <div class="pp-section">
        <div class="pp-section-title">Plan Information</div>
        <div class="pp-data-grid">
          ${card.payer ? `<div class="pp-data-label">Carrier</div><div class="pp-data-value">${escapeHTML(card.payer)}</div>` : ""}
          ${card.planName ? `<div class="pp-data-label">Plan</div><div class="pp-data-value">${escapeHTML(card.planName)}</div>` : ""}
          ${card.planType ? `<div class="pp-data-label">Type</div><div class="pp-data-value">${escapeHTML(card.planType)}</div>` : ""}
          ${card.groupNumber ? `<div class="pp-data-label">Group #</div><div class="pp-data-value">${escapeHTML(card.groupNumber)}</div>` : ""}
        </div>
      </div>

      <!-- Financial -->
      <div class="pp-section">
        <div class="pp-section-title">Deductible & Maximum</div>
        <div class="pp-data-grid">
          <div class="pp-data-label">Deductible</div>
          <div class="pp-data-value${!card.deductible?.individual ? " pp-missing" : ""}">
            ${card.deductible?.individual ? "$" + escapeHTML(card.deductible.individual) : "Not found"}
          </div>
          <div class="pp-data-label">Annual Max</div>
          <div class="pp-data-value${!card.annualMax?.individual ? " pp-missing" : ""}">
            ${card.annualMax?.individual ? "$" + escapeHTML(card.annualMax.individual) : "Not found"}
          </div>
          ${card.annualMax?.remaining ? `
            <div class="pp-data-label">Max Remaining</div>
            <div class="pp-data-value">$${escapeHTML(card.annualMax.remaining)}</div>
          ` : ""}
        </div>
      </div>

      <!-- Coverage Table -->
      ${covRows ? `
        <div class="pp-section">
          <div class="pp-section-title">Coverage Table (CDT)</div>
          <div class="pp-data-grid">
            ${covRows}
          </div>
        </div>
      ` : ""}

      <!-- Coverage Exceptions -->
      ${exRows ? `
        <div class="pp-section">
          <div class="pp-section-title">Coverage Exceptions</div>
          <div class="pp-data-grid">
            ${exRows}
          </div>
        </div>
      ` : ""}

      <!-- Frequencies -->
      ${freqRows ? `
        <div class="pp-section">
          <div class="pp-section-title">Frequencies</div>
          <div class="pp-data-grid">
            ${freqRows}
          </div>
        </div>
      ` : ""}

      <!-- Waiting Periods -->
      ${card.waitingPeriods?.length ? `
        <div class="pp-section">
          <div class="pp-section-title">Waiting Periods</div>
          <div class="pp-data-grid">
            ${card.waitingPeriods.map(wp => `
              <div class="pp-data-label">${escapeHTML(wp.category)}</div>
              <div class="pp-data-value">${escapeHTML(wp.period)}</div>
            `).join("")}
          </div>
        </div>
      ` : ""}

      <!-- Notes -->
      ${card.notes?.length ? `
        <div class="pp-section">
          <div class="pp-section-title">Notes & Limitations</div>
          <ul style="margin: 0; padding-left: 16px; font-size: 12px; color: var(--pp-gray-700);">
            ${card.notes.map(n => `<li>${escapeHTML(n)}</li>`).join("")}
          </ul>
        </div>
      ` : ""}

      <!-- Missing Items -->
      ${missingHTML}

      <!-- Action Buttons -->
      <div class="pp-section">
        <div class="pp-section-title">Copy to Clipboard</div>
        <div class="pp-btn-group">
          <button class="pp-btn pp-btn-primary pp-btn-sm" data-action="copy-note" title="Copy full verification note">
            📋 Verification Note
          </button>
          <button class="pp-btn pp-btn-sm" data-action="copy-summary" title="Copy compact summary">
            📝 Summary
          </button>
          <button class="pp-btn pp-btn-sm" data-action="copy-checklist" title="Copy staff checklist">
            ✅ Checklist
          </button>
          ${missingItems?.length ? `
            <button class="pp-btn pp-btn-sm" data-action="copy-patient-msg" title="Copy patient info request">
              ✉️ Patient Message
            </button>
          ` : ""}
        </div>
      </div>

      <!-- Re-extract -->
      <div class="pp-section" style="text-align: center; border-top: 1px solid var(--pp-gray-200); padding-top: 12px;">
        <button class="pp-btn pp-btn-sm" data-action="capture-page">🔄 Re-extract Page</button>
        <button class="pp-btn pp-btn-sm" data-action="capture-selection">✂️ Re-extract Selection</button>
      </div>
    `;
  }

  function buildErrorBody(error) {
    return `
      <div class="pp-section" style="text-align: center; padding: 16px 0;">
        <div style="font-size: 24px; margin-bottom: 8px;">❌</div>
        <p style="font-weight: 600; color: var(--pp-red); margin: 0;">Extraction Failed</p>
        <p style="font-size: 12px; color: var(--pp-gray-500); margin: 8px 0;">
          ${escapeHTML(error || "Unknown error")}
        </p>
        <div class="pp-btn-group" style="justify-content: center; margin-top: 12px;">
          <button class="pp-btn pp-btn-primary pp-btn-sm" data-action="capture-page">Try Again</button>
        </div>
      </div>
    `;
  }

  function buildNoKeyBody() {
    return `
      <div class="pp-section" style="text-align: center; padding: 16px 0;">
        <div style="font-size: 24px; margin-bottom: 8px;">🔑</div>
        <p style="font-weight: 600; margin: 0;">API Key Required</p>
        <p style="font-size: 12px; color: var(--pp-gray-500); margin: 8px 0;">
          Click the PracticePilot icon in your toolbar to set up your Claude API key.
        </p>
      </div>
    `;
  }

  // ── Event handling ──────────────────────────────────────

  function handlePanelClick(e) {
    const target = e.target.closest("[data-action]");
    if (!target) return;

    const action = target.dataset.action;

    switch (action) {
      case "toggle":
        panelEl.classList.toggle("pp-collapsed");
        break;

      case "close":
        panelEl.style.display = "none";
        break;

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
    }
  }

  // ── Text Capture ────────────────────────────────────────

  function getPageText() {
    return document.body?.innerText || "";
  }

  function getSelectionText() {
    const sel = window.getSelection();
    return sel ? sel.toString().trim() : "";
  }

  // ── Extraction pipeline ─────────────────────────────────

  async function captureAndExtract(mode) {
    if (isExtracting) return;

    // Get text based on mode
    let rawText;
    if (mode === "selection") {
      rawText = getSelectionText();
      if (!rawText || rawText.length < 50) {
        showToast("Please select some eligibility text first (at least a few lines).");
        return;
      }
    } else {
      rawText = getPageText();
      if (!rawText || rawText.length < 50) {
        showToast("Not enough text found on this page.");
        return;
      }
    }

    // Check for API key
    const config = await PP.llmExtractor.getConfig();
    if (!config.apiKey) {
      updatePanel("no-key");
      return;
    }

    // Show extracting state
    isExtracting = true;
    updatePanel("extracting");

    try {
      const result = await PP.llmExtractor.extract(rawText);
      currentCard = result.card;

      // Save to local storage
      await PP.storage.setLastBenefitCard(currentCard);

      // Show results
      const missingItems = PP.normalize.missingItems(currentCard);
      updatePanel("result", { card: currentCard, missingItems });

      // Notify background
      chrome.runtime.sendMessage({
        type: "PP_EXTRACTION_COMPLETE",
        summary: PP.formatter.compactSummary(currentCard),
        redactionInfo: result.redactionInfo,
      });

      showToast(`Benefits extracted! ${result.redactionInfo.redactionCount} PHI items redacted.`);
    } catch (err) {
      console.error("[PracticePilot] Extraction error:", err);
      updatePanel("error", { error: err.message });
    } finally {
      isExtracting = false;
    }
  }

  // ── Panel updates ───────────────────────────────────────

  function updatePanel(state, extra = {}) {
    if (!panelEl) return;
    panelEl.innerHTML = buildPanelHTML(state, extra);
  }

  // ── Clipboard helper ────────────────────────────────────

  async function copyToClipboard(buttonEl, text) {
    try {
      await navigator.clipboard.writeText(text);

      // Visual feedback
      const originalHTML = buttonEl.innerHTML;
      buttonEl.classList.add("pp-copied");
      buttonEl.innerHTML = "✓ Copied!";

      setTimeout(() => {
        buttonEl.classList.remove("pp-copied");
        buttonEl.innerHTML = originalHTML;
      }, 1500);
    } catch (err) {
      // Fallback: textarea copy
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);

      showToast("Copied to clipboard!");
    }
  }

  // ── Toast notification ──────────────────────────────────

  function showToast(message, duration = 3000) {
    let toast = document.getElementById("pp-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "pp-toast";
      toast.className = "pp-toast";
      document.body.appendChild(toast);
    }

    toast.textContent = message;
    toast.classList.add("pp-toast-visible");

    setTimeout(() => {
      toast.classList.remove("pp-toast-visible");
    }, duration);
  }

  // ── Helpers ─────────────────────────────────────────────

  function getPageLabel(pageType) {
    if (!pageType || !PP.pageDetector) return "";
    const labels = {
      [PP.pageDetector.PAGE_TYPES.ELIGIBILITY]: "Eligibility",
      [PP.pageDetector.PAGE_TYPES.INSURANCE_MODAL]: "Insurance",
      [PP.pageDetector.PAGE_TYPES.INSURER_PORTAL]: PP.pageDetector.getInsurerName?.() || "Insurer Portal",
      [PP.pageDetector.PAGE_TYPES.SCHEDULE]: "Schedule",
      [PP.pageDetector.PAGE_TYPES.PATIENT_CHART]: "Patient",
      [PP.pageDetector.PAGE_TYPES.CLAIMS]: "Claims",
    };
    return labels[pageType] || "";
  }

  function escapeHTML(str) {
    if (!str) return "";
    const div = document.createElement("div");
    div.textContent = String(str);
    return div.innerHTML;
  }

  // ── Listen for messages from background / popup ─────────

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    switch (msg.type) {
      case "PP_SHOW_PANEL":
        if (panelEl) {
          panelEl.style.display = "";
          panelEl.classList.remove("pp-collapsed");
        }
        sendResponse({ ok: true });
        break;

      case "PP_HIDE_PANEL":
        if (panelEl) panelEl.style.display = "none";
        sendResponse({ ok: true });
        break;

      case "PP_EXTRACT":
        captureAndExtract(msg.mode || "page");
        sendResponse({ ok: true });
        break;

      case "PP_GET_STATUS":
        sendResponse({
          pageType: currentPageType,
          hasCard: !!currentCard,
          isExtracting,
          injected: true,
        });
        break;

      case "PP_PING":
        sendResponse({ ok: true, injected: true });
        break;
    }

    return true; // async response
  });

  // ── Restore last card if available ──────────────────────

  async function restoreLastCard() {
    try {
      const lastCard = await PP.storage.getLastBenefitCard();
      if (lastCard) {
        currentCard = lastCard;
        // Don't auto-show — let user decide
      }
    } catch (e) {
      // ignore
    }
  }

  // ── Initialize ──────────────────────────────────────────

  async function init() {
    // Create the panel
    createPanel();

    // Start page detection
    if (PP.pageDetector) {
      cleanupDetector = PP.pageDetector.watch((pageType) => {
        currentPageType = pageType;
        // Re-render panel idle state when page type changes
        if (!currentCard && !isExtracting) {
          updatePanel("idle");
        }
      });
    }

    // Restore last card silently
    await restoreLastCard();

    console.log("[PracticePilot] Content script initialized. Page type:", currentPageType);
  }

  // Run on load
  init();

})();
