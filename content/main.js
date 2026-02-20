// ============================================================
// PracticePilot — Main Content Script Orchestrator
// ============================================================
// Ties together page detection, text capture, LLM extraction,
// and the sidebar panel UI. This is the glue.
//
// Auto-loaded on curvehero.com (Curve Dental). Injected on-demand on
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
  let cardFromCache = false;    // true when showing a cached (not fresh) card
  let currentPatientCtx = null; // patient context built incrementally
  let actionScanTimer = null;   // debounce for DOM change scans
  let lastPatientName = null;   // detect patient switches
  let isChatting = false;       // prevent concurrent chat calls

  // ── Drag-to-move state ──────────────────────────────────
  let isDragging = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let dragPanelStartX = 0;
  let dragPanelStartY = 0;
  const DRAG_THRESHOLD = 5; // px moved before it counts as drag (vs click)

  // ── Panel DOM Creation ──────────────────────────────────

  function createPanel() {
    if (document.getElementById("pp-panel")) {
      panelEl = document.getElementById("pp-panel");
      return;
    }

    panelEl = document.createElement("div");
    panelEl.id = "pp-panel";
    panelEl.innerHTML = buildPanelHTML("idle");
    panelEl.style.display = "block";  // ensure visible
    document.body.appendChild(panelEl);

    // Wire up header collapse toggle + drag-to-move
    panelEl.addEventListener("click", handlePanelClick);
    initDrag();

    // Wire CDT search if idle-state includes it (it won't, but guard)
    const cdtInput = panelEl.querySelector(".pp-cdt-search");
    if (cdtInput) {
      cdtInput.addEventListener("input", handleCDTSearchInput);
    }
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
        bodyContent = buildResultBody(extra.card, extra.missingItems, extra);
        break;
      case "error":
        bodyContent = buildErrorBody(extra.error);
        break;
      case "no-key":
        bodyContent = buildNoKeyBody();
        break;
      case "actions":
        bodyContent = buildActionsBody(extra.ctx, extra.actions);
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
        ${buildCDTLookupSection()}
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
        ${buildCDTLookupSection()}
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
      <div class="pp-section">
        <div class="pp-section-title">📂 Recent Patients</div>
        <div id="pp-recent-patients" class="pp-recent-list">
          <p style="font-size: 12px; color: var(--pp-gray-500);">Loading…</p>
        </div>
      </div>
      ${buildCDTLookupSection()}
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

  function buildResultBody(card, missingItems, extra = {}) {
    if (!card) return buildIdleBody();

    const note = PP.formatter.verificationNote(card);
    const summary = PP.formatter.compactSummary(card);
    const confidence = card.confidence?.overall || "medium";

    const confidenceBadge = {
      high: '<span class="pp-badge pp-badge-green">High Confidence</span>',
      medium: '<span class="pp-badge pp-badge-amber">Medium Confidence</span>',
      low: '<span class="pp-badge pp-badge-red">Low Confidence</span>',
    }[confidence] || "";

    // Cache indicator
    let cacheBar = "";
    if (extra.cached) {
      const cachedDate = extra.cachedAt
        ? new Date(extra.cachedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
        : "unknown date";
      const isStale = (extra.ageDays || 0) > 30;
      cacheBar = `
        <div class="pp-cache-bar ${isStale ? "pp-cache-stale" : ""}">
          <span class="pp-cache-label">
            ${isStale ? "⚠️" : "💾"} Loaded from cache — saved ${cachedDate}${isStale ? " (over 30 days old)" : ""}
          </span>
          <button class="pp-btn pp-btn-sm pp-btn-refresh" data-action="capture-page" title="Re-extract fresh data from page">
            🔄 Re-extract
          </button>
        </div>
      `;
    }

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
      <!-- Cache indicator -->
      ${cacheBar}

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
          ${card.patientName ? `<div class="pp-data-label">Patient</div><div class="pp-data-value" style="font-weight: 700;">${escapeHTML(card.patientName)}</div>` : ""}
          ${card.subscriberId ? `<div class="pp-data-label">Subscriber ID</div><div class="pp-data-value">${escapeHTML(card.subscriberId)}</div>` : ""}
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
          <button class="pp-btn pp-btn-sm" data-action="copy-curve" title="Copy formatted for Curve Dental entry">
            🖥️ Copy for Curve
          </button>
          ${missingItems?.length ? `
            <button class="pp-btn pp-btn-sm" data-action="copy-patient-msg" title="Copy patient info request">
              ✉️ Patient Message
            </button>
          ` : ""}
        </div>
      </div>

      <!-- CDT Code Lookup -->
      <div class="pp-section">
        <div class="pp-section-title">🦷 CDT Code Lookup</div>
        <div class="pp-cdt-lookup">
          <input type="text" class="pp-cdt-search" data-action="cdt-search" placeholder="Type code (D2740) or keyword (crown)…" autocomplete="off" />
          <div class="pp-cdt-results" id="pp-cdt-results"></div>
          <button class="pp-cdt-browse-btn" data-action="cdt-browse">Browse all codes by category</button>
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

  // ── Actions body (patient view) ─────────────────────────

  function buildActionsBody(ctx, actions) {
    if (!ctx) return buildIdleBody();

    const name = escapeHTML(ctx.patientName || "Patient");
    const scannedTabs = ctx.tabsScanned.map(t => t.charAt(0).toUpperCase() + t.slice(1));
    const scannedLabel = scannedTabs.length
      ? scannedTabs.join(", ")
      : "none yet";

    const priorityClasses = {
      1: "pp-action-critical",
      2: "pp-action-action",
      3: "pp-action-recommended",
      4: "pp-action-info",
    };

    // Only show CRITICAL and ACTION items up front; collapse lesser items
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

    // Benefit card link (compact)
    let benefitLink = "";
    if (currentCard && currentCard.patientName?.toLowerCase() === ctx.patientName?.toLowerCase()) {
      benefitLink = `<button class="pp-btn pp-btn-sm pp-btn-primary" data-action="show-benefits" style="width: 100%; margin-top: 6px;">📋 View Benefits</button>`;
    }

    return `
      <div class="pp-section">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
          <div class="pp-section-title" style="margin: 0;">📋 ${name}</div>
          <button class="pp-btn pp-btn-sm" data-action="rescan-patient" title="Re-scan page">🔄</button>
        </div>
        <div class="pp-scanned-tabs">
          Scanned: ${escapeHTML(scannedLabel)}
        </div>
      </div>

      <div class="pp-section">
        <div class="pp-actions-list">
          ${criticalHTML}
          ${otherHTML}
          ${noActions}
        </div>
        ${benefitLink}
      </div>

      ${buildChatSection()}
    `;
  }

  // ── Chat section (ask anything, rarely used) ───────────

  function buildChatSection() {
    return `
      <div class="pp-section pp-chat-section">
        <div class="pp-chat-log" id="pp-chat-log"></div>
        <div class="pp-chat-input-row">
          <input type="text" class="pp-chat-input" id="pp-chat-input"
            placeholder="Ask about this patient…" autocomplete="off" />
          <button class="pp-btn pp-btn-sm pp-btn-primary pp-chat-send" data-action="chat-send" title="Send">➤</button>
        </div>
      </div>
    `;
  }

  /** Handle chat send — calls Claude with patient context */
  async function handleChatSend() {
    const input = panelEl?.querySelector("#pp-chat-input");
    const log = panelEl?.querySelector("#pp-chat-log");
    if (!input || !log) return;

    const question = input.value.trim();
    if (!question || isChatting) return;

    // Show user's message
    log.innerHTML += `<div class="pp-chat-msg pp-chat-user">${escapeHTML(question)}</div>`;
    input.value = "";
    isChatting = true;

    // Show typing indicator
    log.innerHTML += '<div class="pp-chat-msg pp-chat-bot pp-chat-typing">Thinking…</div>';
    log.scrollTop = log.scrollHeight;

    try {
      const answer = await askClaude(question);
      // Replace typing indicator with answer
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

  /** Send a freeform question to Claude with patient context */
  async function askClaude(question) {
    const config = await PP.llmExtractor.getConfig();
    if (!config.apiKey) throw new Error("API key not set — open PracticePilot settings.");

    // Build concise context from what we know
    let contextParts = [];
    if (currentPatientCtx) {
      const c = currentPatientCtx;
      contextParts.push(`Patient: ${c.patientName || "unknown"}`);
      if (c.profile.age) contextParts.push(`Age: ${c.profile.age}`);
      if (c.profile.gender) contextParts.push(`Gender: ${c.profile.gender}`);
      if (c.insurance.carrier) contextParts.push(`Insurance: ${c.insurance.carrier}`);
      if (c.insurance.planName) contextParts.push(`Plan: ${c.insurance.planName}`);
      if (c.insurance.lastVerified) contextParts.push(`Last verified: ${c.insurance.lastVerified}`);
      if (c.todayAppt?.codes?.length) contextParts.push(`Today's scheduled codes: ${c.todayAppt.codes.join(", ")}`);
      if (c.todayAppt?.isNewPatient) contextParts.push("This is a NEW PATIENT visit");
      if (c.todayAppt?.startTime) contextParts.push(`Appt time: ${c.todayAppt.startTime}`);
      if (c.billing.hasBalance) contextParts.push(`Outstanding balance: $${c.billing.balance}`);
      if (c.billing.hasOwingInvoices) contextParts.push("Has owing invoices");
      if (c.recare.noRecareFound) contextParts.push("No recare schedule set up");
      if (c.recare.nextDue) contextParts.push(`Next recare due: ${c.recare.nextDue}`);
      if (c.charting.hasUnscheduledTx) contextParts.push("Has unscheduled accepted treatment");
      if (c.charting.pendingCodes?.length) contextParts.push(`Pending tx codes: ${c.charting.pendingCodes.join(", ")}`);
      if (c.forms.hasPendingForms) contextParts.push("Has incomplete patient forms");
      if (c.perio.hasPerioData) contextParts.push("Perio charting data on file");
      if (c.tabsScanned.length) contextParts.push(`Tabs reviewed: ${c.tabsScanned.join(", ")}`);
    }
    if (currentCard) {
      if (currentCard.annualMax?.individual) contextParts.push(`Annual max: $${currentCard.annualMax.individual}`);
      if (currentCard.annualMax?.remaining) contextParts.push(`Max remaining: $${currentCard.annualMax.remaining}`);
      if (currentCard.deductible?.individual) contextParts.push(`Deductible: $${currentCard.deductible.individual}`);
      if (currentCard.coverageTable?.length) {
        const covSummary = currentCard.coverageTable
          .filter(r => r.inNetwork != null)
          .map(r => `${r.category}: ${r.inNetwork}%`)
          .join(", ");
        if (covSummary) contextParts.push(`Coverage: ${covSummary}`);
      }
      if (currentCard.frequencies) {
        const freqs = Object.entries(currentCard.frequencies)
          .filter(([, v]) => v)
          .map(([k, v]) => `${k}: ${v}`)
          .join(", ");
        if (freqs) contextParts.push(`Frequencies: ${freqs}`);
      }
      if (currentCard.nonCovered?.length) contextParts.push(`Non-covered: ${currentCard.nonCovered.join(", ")}`);
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

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`API error (${response.status})`);
    }

    const data = await response.json();
    return data.content?.[0]?.text || "No response.";
  }

  // ── Patient view scan + action list ─────────────────────

  async function scanPatientAndShowActions() {
    if (!PP.patientContext) return;

    const pageText = getPageText();
    if (!pageText || pageText.length < 50) return;

    try {
      // Quick-check: did the patient change?
      const newName = PP.patientContext._extractPatientName(pageText);
      if (newName && lastPatientName && newName.toLowerCase() !== lastPatientName.toLowerCase()) {
        console.log(`[PracticePilot] Patient changed: ${lastPatientName} → ${newName}`);
        currentPatientCtx = null;
        currentCard = null;
        cardFromCache = false;
      }
      lastPatientName = newName || lastPatientName;

      const ctx = await PP.patientContext.scanAndMerge(pageText);
      if (!ctx) return;

      currentPatientCtx = ctx;

      // Look up cached benefit card for this patient
      let benefitCard = null;
      if (currentCard && currentCard.patientName?.toLowerCase() === ctx.patientName?.toLowerCase()) {
        benefitCard = currentCard;
      } else {
        // Try loading from cache
        const cacheKey = PP.storage.cacheKeyFromIdentifiers(
          ctx.patientName,
          null,
          ctx.insurance.carrier
        );
        const cached = await PP.storage.getCachedCard(cacheKey);
        if (cached) {
          benefitCard = cached.card;
          currentCard = cached.card;
          cardFromCache = true;
        }
      }

      // Generate actions
      const actions = PP.actionEngine.generate(ctx, benefitCard);

      updatePanel("actions", { ctx, actions });
    } catch (e) {
      console.warn("[PracticePilot] Patient scan error:", e);
    }
  }

  /** Debounced re-scan — triggers 800ms after DOM settles */
  function schedulePatientRescan() {
    if (actionScanTimer) clearTimeout(actionScanTimer);
    actionScanTimer = setTimeout(() => {
      if (currentPageType === PP.pageDetector?.PAGE_TYPES?.PATIENT_VIEW) {
        scanPatientAndShowActions();
      }
    }, 800);
  }

  // ── Event handling ──────────────────────────────────────

  // ── Drag-to-move ────────────────────────────────────────

  function initDrag() {
    const header = panelEl.querySelector(".pp-header");
    if (!header) return;

    header.addEventListener("mousedown", onDragStart);
    document.addEventListener("mousemove", onDragMove);
    document.addEventListener("mouseup", onDragEnd);
  }

  function onDragStart(e) {
    // Only left click, ignore buttons inside header
    if (e.button !== 0) return;
    if (e.target.closest(".pp-header-btn")) return;

    isDragging = false; // will become true if mouse moves past threshold
    dragStartX = e.clientX;
    dragStartY = e.clientY;

    const rect = panelEl.getBoundingClientRect();
    dragPanelStartX = rect.left;
    dragPanelStartY = rect.top;

    panelEl.classList.add("pp-dragging");
    e.preventDefault();
  }

  function onDragMove(e) {
    if (!panelEl.classList.contains("pp-dragging")) return;

    const dx = e.clientX - dragStartX;
    const dy = e.clientY - dragStartY;

    if (!isDragging && (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD)) {
      isDragging = true;
      // Switch from right-anchored to left-anchored positioning
      panelEl.style.right = "auto";
    }

    if (!isDragging) return;

    // Calculate new position, clamp to viewport
    let newLeft = dragPanelStartX + dx;
    let newTop  = dragPanelStartY + dy;

    const pw = panelEl.offsetWidth;
    const ph = panelEl.offsetHeight;
    newLeft = Math.max(0, Math.min(newLeft, window.innerWidth - pw));
    newTop  = Math.max(0, Math.min(newTop, window.innerHeight - 48)); // keep header visible

    panelEl.style.left = newLeft + "px";
    panelEl.style.top  = newTop  + "px";
  }

  function onDragEnd() {
    if (!panelEl.classList.contains("pp-dragging")) return;
    panelEl.classList.remove("pp-dragging");

    // If it was a real drag, suppress the click that follows mouseup
    if (isDragging) {
      panelEl.addEventListener("click", suppressClick, true);
    }
    isDragging = false;
  }

  function suppressClick(e) {
    e.stopPropagation();
    e.preventDefault();
    panelEl.removeEventListener("click", suppressClick, true);
  }

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

      case "copy-curve":
        copyToClipboard(target, PP.formatter.curveDataEntry(currentCard));
        break;

      case "cdt-browse":
        renderCDTBrowse();
        break;

      case "cdt-collapse": {
        const container = panelEl?.querySelector("#pp-cdt-results");
        if (container) container.innerHTML = "";
        const btn = panelEl?.querySelector('[data-action="cdt-collapse"]');
        if (btn) {
          btn.textContent = "Browse all codes by category";
          btn.dataset.action = "cdt-browse";
        }
        break;
      }

      case "load-cached": {
        const idx = parseInt(target.closest("[data-cache-index]")?.dataset?.cacheIndex, 10);
        const recentContainer = panelEl?.querySelector("#pp-recent-patients");
        const cachedCards = recentContainer?._cachedCards;
        if (cachedCards && cachedCards[idx]) {
          const entry = cachedCards[idx];
          currentCard = entry.card;
          cardFromCache = true;
          const ageMs = Date.now() - new Date(entry.cachedAt).getTime();
          const ageDays = Math.floor(ageMs / (1000 * 60 * 60 * 24));
          const missingItems = PP.normalize.missingItems(currentCard);
          updatePanel("result", {
            card: currentCard,
            missingItems,
            cached: true,
            cachedAt: entry.cachedAt,
            ageDays,
          });
          showToast(`Loaded saved benefits for ${currentCard.patientName || "patient"}`);
        }
        break;
      }

      case "clear-cache":
        PP.storage.clearCardCache().then(() => {
          showToast("All cached patient data cleared");
          if (!currentCard) updatePanel("idle");
        });
        break;

      case "rescan-patient":
        scanPatientAndShowActions();
        break;

      case "chat-send":
        handleChatSend();
        break;

      case "show-benefits":
        if (currentCard) {
          const missingItems = PP.normalize.missingItems(currentCard);
          updatePanel("result", { card: currentCard, missingItems, cached: cardFromCache });
        }
        break;
    }
  }

  // ── CDT Lookup Widget ─────────────────────────────────

  /** Reusable HTML block for the CDT lookup section */
  function buildCDTLookupSection() {
    // Pre-render starred codes so they show immediately
    const starred = PP.cdtCodes?.starredCodes?.() || [];
    const starredHTML = starred.map(r => buildCDTItemHTML(r)).join("");

    return `
      <div class="pp-section">
        <div class="pp-section-title">🦷 CDT Code Lookup</div>
        <div class="pp-cdt-lookup">
          <input type="text" class="pp-cdt-search" data-action="cdt-search" placeholder="Type code (D2740) or keyword (crown)…" autocomplete="off" />
          <div class="pp-cdt-results" id="pp-cdt-results">
            ${starredHTML ? `<div class="pp-cdt-section-heading">⭐ Common Codes</div>${starredHTML}` : ""}
          </div>
          <button class="pp-cdt-browse-btn" data-action="cdt-browse">Browse all codes by category</button>
        </div>
      </div>
    `;
  }

  /** Debounced search handler — wired via input event */
  let _cdtSearchTimer = null;

  function handleCDTSearchInput(e) {
    const query = e.target.value.trim();
    clearTimeout(_cdtSearchTimer);
    _cdtSearchTimer = setTimeout(() => renderCDTResults(query), 150);
  }

  /** Render search results in the CDT results container */
  function renderCDTResults(query) {
    const container = panelEl?.querySelector("#pp-cdt-results");
    if (!container) return;

    if (!query || query.length < 2) {
      // Show starred codes when search is cleared
      const starred = PP.cdtCodes?.starredCodes?.() || [];
      const starredHTML = starred.map(r => buildCDTItemHTML(r)).join("");
      container.innerHTML = starredHTML
        ? `<div class="pp-cdt-section-heading">⭐ Common Codes</div>${starredHTML}`
        : '<div class="pp-cdt-empty">Type at least 2 characters to search</div>';
      return;
    }

    const results = PP.cdtCodes.search(query, 15);

    if (!results.length) {
      container.innerHTML = `<div class="pp-cdt-empty">No codes matching "${escapeHTML(query)}"</div>`;
      return;
    }

    container.innerHTML = results.map(r => buildCDTItemHTML(r)).join("");
  }

  /** Build HTML for a single CDT result row */
  function buildCDTItemHTML(entry) {
    const cov = currentCard ? PP.cdtCodes.getCoverage(entry.code, currentCard) : null;
    const covClass = cov === null ? "pp-cov-none"
                   : cov >= 80   ? "pp-cov-high"
                   : cov >= 50   ? "pp-cov-mid"
                   :               "pp-cov-low";

    const tierClass = `pp-tier-${entry.tier || "basic"}`;
    const tierLabel = PP.cdtCodes.TIER_LABELS[entry.tier] || entry.tier || "";
    const starIcon = entry.starred ? '⭐ ' : '';

    return `
      <div class="pp-cdt-item${entry.starred ? ' pp-cdt-starred' : ''}">
        <div>
          <span class="pp-cdt-code">${entry.code}</span>
          <span class="pp-cdt-name">${starIcon}${escapeHTML(entry.aka || entry.name)}</span>
        </div>
        <div class="pp-cdt-meta">
          <span class="pp-cdt-tier ${tierClass}">${escapeHTML(tierLabel)}</span>
          <span>${escapeHTML(entry.category)} (${entry.cdtRange})</span>
          ${cov !== null ? `<span class="pp-cdt-coverage ${covClass}">${cov}%</span>` : '<span class="pp-cdt-coverage pp-cov-none">—</span>'}
        </div>
        ${entry.note ? `<div class="pp-cdt-note">${escapeHTML(entry.note)}</div>` : ""}
      </div>
    `;
  }

  /** Browse all codes grouped by section */
  function renderCDTBrowse() {
    const container = panelEl?.querySelector("#pp-cdt-results");
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

    // Swap browse button to "collapse" mode
    const browseBtn = panelEl?.querySelector('[data-action="cdt-browse"]');
    if (browseBtn) {
      browseBtn.textContent = "Collapse code list";
      browseBtn.dataset.action = "cdt-collapse";
    }
  }

  // ── Text Capture ────────────────────────────────────────

  /**
   * Capture page text with smart DOM targeting.
   * Tries to grab only the eligibility content area, falling back
   * to full body text if no specific container is found.
   */
  function getPageText() {
    // Exclude our own PracticePilot panel from capture
    const ppPanel = document.getElementById("pp-panel");

    // Curve Dental eligibility pages: try specific content selectors
    const contentSelectors = [
      "#eligibility-response",
      ".eligibility-response",
      '[id*="eligibility"]',
      "#content",
      ".content-area",
      "main",
      '[role="main"]',
      ".main-content",
      "#main-content",
    ];

    for (const sel of contentSelectors) {
      const el = document.querySelector(sel);
      if (el && el.innerText && el.innerText.length > 100) {
        return el.innerText;
      }
    }

    // Fallback: grab body but exclude nav, sidebar, footer, and our panel
    const excludeSelectors = [
      "nav", "header", "footer",
      '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]',
      ".sidebar", "#sidebar", ".nav", ".navbar", ".footer",
      ".header", "#header", "#footer",
      "#pp-panel",  // our own panel
    ];

    // Clone body, remove excluded elements, get text
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

  // ── Extraction pipeline ─────────────────────────────────

  /**
   * Try to load a cached card for the current page's patient.
   * Returns true if a cached card was loaded, false otherwise.
   */
  async function tryLoadFromCache() {
    try {
      const rawText = getPageText();
      if (!rawText || rawText.length < 50) return false;

      const patientName = PP.phiRedactor.extractPatientName(rawText);
      const subscriberId = PP.phiRedactor.extractSubscriberId(rawText);

      if (!patientName && !subscriberId) return false;

      // Try to detect payer from page text (simple heuristic)
      const payerHint = extractPayerHint(rawText);

      const cacheKey = PP.storage.cacheKeyFromIdentifiers(patientName, subscriberId, payerHint);
      if (!cacheKey) return false;

      const cached = await PP.storage.getCachedCard(cacheKey);
      if (!cached) return false;

      // Check age — cards older than 30 days get a warning but still load
      const ageMs = Date.now() - new Date(cached.cachedAt).getTime();
      const ageDays = Math.floor(ageMs / (1000 * 60 * 60 * 24));

      currentCard = cached.card;
      cardFromCache = true;
      const missingItems = PP.normalize.missingItems(currentCard);
      updatePanel("result", {
        card: currentCard,
        missingItems,
        cached: true,
        cachedAt: cached.cachedAt,
        ageDays,
      });

      console.log(`[PracticePilot] Loaded cached card for "${patientName || subscriberId}" (${ageDays} days old)`);
      return true;
    } catch (e) {
      console.warn("[PracticePilot] Cache lookup failed:", e);
      return false;
    }
  }

  /**
   * Try to extract payer name from raw page text (heuristic).
   */
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
      cardFromCache = false;

      // Save to local storage (last card + history)
      await PP.storage.setLastBenefitCard(currentCard);

      // Save to patient-keyed cache for instant reload next time
      await PP.storage.cacheCard(currentCard);

      // Show results
      const missingItems = PP.normalize.missingItems(currentCard);
      updatePanel("result", { card: currentCard, missingItems, cached: false });

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

    // Populate recent patients list (async, non-blocking)
    const recentContainer = panelEl.querySelector("#pp-recent-patients");
    if (recentContainer) {
      loadRecentPatients(recentContainer);
    }

    // Wire chat input — Enter to send
    const chatInput = panelEl.querySelector("#pp-chat-input");
    if (chatInput) {
      chatInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          handleChatSend();
        }
      });
    }
  }

  // ── Recent Patients ─────────────────────────────────────

  async function loadRecentPatients(container) {
    try {
      const cached = await PP.storage.getAllCachedCards();
      if (!cached.length) {
        container.innerHTML = '<p style="font-size: 12px; color: var(--pp-gray-500);">No saved patients yet. Extract a patient\'s benefits to save them here.</p>';
        return;
      }

      // Show up to 10 most recent
      const items = cached.slice(0, 10).map((entry, i) => {
        const card = entry.card;
        const name = card.patientName || "Unknown Patient";
        const payer = card.payer || "Unknown Carrier";
        const date = new Date(entry.cachedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" });
        const planType = card.planType || "";

        return `
          <div class="pp-recent-item" data-action="load-cached" data-cache-index="${i}" title="Click to load ${escapeHTML(name)}">
            <div class="pp-recent-name">${escapeHTML(name)}</div>
            <div class="pp-recent-detail">${escapeHTML(payer)}${planType ? " · " + escapeHTML(planType) : ""} · ${date}</div>
          </div>
        `;
      }).join("");

      const clearBtn = cached.length > 0
        ? '<button class="pp-btn pp-btn-sm" data-action="clear-cache" style="margin-top: 8px; font-size: 11px;">🗑️ Clear All Cached</button>'
        : "";

      container.innerHTML = items + clearBtn;

      // Store reference for click handler
      container._cachedCards = cached;
    } catch (e) {
      container.innerHTML = '<p style="font-size: 12px; color: var(--pp-gray-500);">Could not load recent patients.</p>';
    }

    // Wire CDT search input (if present in this state)
    const cdtInput = panelEl.querySelector(".pp-cdt-search");
    if (cdtInput) {
      cdtInput.addEventListener("input", handleCDTSearchInput);
    }
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
      [PP.pageDetector.PAGE_TYPES.PATIENT_VIEW]: "Patient",
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
    console.log("[PracticePilot] Initializing on:", window.location.href);

    // Create the panel
    createPanel();
    console.log("[PracticePilot] Panel created. Visible:", panelEl?.offsetParent !== null);

    // Start page detection
    if (PP.pageDetector) {
      cleanupDetector = PP.pageDetector.watch((pageType) => {
        const prevType = currentPageType;
        currentPageType = pageType;
        console.log("[PracticePilot] Page type detected:", pageType);

        if (pageType === PP.pageDetector.PAGE_TYPES.PATIENT_VIEW) {
          // Patient view — scan and show action list
          scanPatientAndShowActions();
        } else if (!currentCard && !isExtracting) {
          // Re-render panel idle state when page type changes
          updatePanel("idle");
        }
      });

      // Watch for DOM changes in patient view → re-scan on tab switches
      const domObserver = new MutationObserver(() => {
        if (currentPageType === PP.pageDetector?.PAGE_TYPES?.PATIENT_VIEW) {
          schedulePatientRescan();
        }
      });
      domObserver.observe(document.body, { childList: true, subtree: true });

    } else {
      console.warn("[PracticePilot] pageDetector not found!");
    }

    // Restore last card silently
    await restoreLastCard();

    // ── Auto-load from cache or extract on eligibility pages ──
    const isEligibility = currentPageType === PP.pageDetector?.PAGE_TYPES?.ELIGIBILITY;
    const isPatientView = currentPageType === PP.pageDetector?.PAGE_TYPES?.PATIENT_VIEW;
    console.log("[PracticePilot] Is eligibility page:", isEligibility, "| isPatientView:", isPatientView, "| currentPageType:", currentPageType);

    if (isPatientView) {
      // Patient view — auto-scan for action list
      scanPatientAndShowActions();
    } else if (isEligibility) {
      const config = await PP.llmExtractor.getConfig();
      console.log("[PracticePilot] API key present:", !!config.apiKey);

      // First try loading from patient cache (instant, no API call)
      const cachedLoaded = await tryLoadFromCache();
      if (cachedLoaded) {
        console.log("[PracticePilot] Showing cached card — no API call needed");
      } else if (config.apiKey) {
        // No cache hit — auto-extract from page
        setTimeout(() => {
          if (!currentCard && !isExtracting) {
            console.log("[PracticePilot] Auto-extracting eligibility page…");
            captureAndExtract("page");
          }
        }, 1200);
      } else {
        console.log("[PracticePilot] No API key — showing no-key state");
        updatePanel("no-key");
      }
    }

    console.log("[PracticePilot] Content script initialized. Page type:", currentPageType);
  }

  // Run on load
  init();

})();
