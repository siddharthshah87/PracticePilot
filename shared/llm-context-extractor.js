// ============================================================
// PracticePilot — LLM Context Extractor
// ============================================================
// Replaces regex-based patient-context parsers + rule-based
// action engine with a single LLM call per meaningful page
// change.
//
// Key features:
//   - Content-hash gating: skips LLM if page hasn't changed
//   - Single unified call: extracts context + generates actions
//   - PMS-agnostic: works with Curve, Dentrix, Eaglesoft, etc.
//   - PHI-safe: redacts before sending, re-attaches locally
//   - Uses cheap model (Haiku) for extraction (~$0.002/call)
// ============================================================

(function () {
  var PracticePilot = window.PracticePilot || {};

  PracticePilot.llmContextExtractor = {

    // ── Configuration ──────────────────────────────────────

    // Use the cheapest capable model for structured extraction
    EXTRACTION_MODEL: "claude-3-5-haiku-latest",

    // Cache of hash → extracted result (in-memory, per session)
    _cache: new Map(),

    // Maximum cache entries (LRU eviction)
    MAX_CACHE: 50,

    // Minimum text length to bother extracting
    MIN_TEXT_LENGTH: 100,

    // ── Content Hash ───────────────────────────────────────
    // Fast hash to detect whether page content actually changed.
    // We normalize whitespace so minor DOM re-renders don't
    // trigger new LLM calls.

    async _hashText(text) {
      // Normalize: collapse whitespace, lowercase, strip numbers
      // that change frequently (timestamps, counters)
      const normalized = text
        .replace(/\d{1,2}:\d{2}\s*(?:AM|PM|am|pm)/g, "TIME")  // timestamps
        .replace(/\d{1,2}\/\d{1,2}\/\d{2,4}/g, "DATE")        // dates (for view-only changes)
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();

      // Use SubtleCrypto for a real hash (available in extension contexts)
      const encoder = new TextEncoder();
      const data = encoder.encode(normalized);
      const hashBuffer = await crypto.subtle.digest("SHA-256", data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
    },

    // ── Main Entry Point ───────────────────────────────────

    /**
     * Extract patient context and actions from page text.
     * Returns cached result if page content hasn't changed.
     *
     * @param {string} pageText - Raw page text from DOM
     * @param {Object|null} benefitCard - Cached benefit card if available
     * @returns {Object|null} { patientName, context, actions, hash, fromCache }
     */
    async extract(pageText, benefitCard = null) {
      if (!pageText || pageText.length < this.MIN_TEXT_LENGTH) return null;

      // 1. Hash the content
      const hash = await this._hashText(pageText);

      // 2. Check cache
      const cached = this._cache.get(hash);
      if (cached) {
        console.log("[PracticePilot] LLM context cache HIT — skipping API call");
        return { ...cached, fromCache: true };
      }

      console.log("[PracticePilot] LLM context cache MISS — calling API");

      // 3. Extract patient name locally (before redaction)
      const patientName = this._extractPatientName(pageText);
      if (!patientName) return null;

      // 4. Redact PHI
      const redacted = PracticePilot.phiRedactor.redact(pageText);
      let cleanText = redacted.redactedText;

      // 5. Preprocess — strip noise, collapse whitespace
      cleanText = this._preprocessText(cleanText);

      // 6. Truncate if huge (Haiku context is 200K but let's be practical)
      if (cleanText.length > 40000) {
        cleanText = cleanText.substring(0, 40000) + "\n\n[TEXT TRUNCATED]";
      }

      // 7. Call LLM
      const config = await PracticePilot.llmExtractor.getConfig();
      if (!config.apiKey) {
        console.warn("[PracticePilot] No API key — falling back to regex");
        return null; // caller should fall back to regex parsers
      }

      try {
        const llmResult = await this._callLLM(config, cleanText, benefitCard);
        const parsed = this._parseJSON(llmResult);

        // 8. Build result (preserve sectionsDetected from top-level JSON)
        const result = {
          patientName,
          context: parsed.context || {},
          actions: parsed.actions || [],
          sectionsDetected: parsed.sectionsDetected || [],
          hash,
          fromCache: false,
        };

        // 9. Cache it
        this._cacheResult(hash, result);

        return result;
      } catch (e) {
        console.error("[PracticePilot] LLM context extraction failed:", e);
        return null; // caller should fall back
      }
    },

    // ── LLM Call ───────────────────────────────────────────

    SYSTEM_PROMPT: `You are PracticePilot, a dental practice assistant. You receive page text from a dental practice management system (such as Curve Dental, Dentrix, Eaglesoft, or Open Dental). Patient identifiers have been redacted.

Your job: Extract structured patient data AND generate smart action items for the front desk / clinical team.

═══════════════════════════════════════════════════════════
INSTRUCTIONS
═══════════════════════════════════════════════════════════

EXTRACT whatever patient data is visible on this page. The page may show one or more of these sections:
• Profile: gender, age, DOB, phone, email, language, head of household
• Insurance: carrier, plan name, last verified date, coverage details
• Billing: account balance, aging (0-30, 31-60, 61-90, 90+), invoices, credits
• Claims: claim statuses, unsent claims, pending insurance, rejected claims
• Recare: recall schedule, next due date
• Charting: treatment plans, accepted/unscheduled procedures, CDT codes
• Forms: completed vs pending patient forms
• Appointments: scheduled, confirmed, new vs existing patient
• Perio: periodontal charting data

GENERATE ACTION ITEMS based on what you see. Actions must be:
• Specific and actionable (not vague)
• Relevant to TODAY's dental visit
• Prioritized: critical (must address now), action (should address), recommended (good practice), info (FYI)
• Cross-referenced: e.g., if billing shows overdue + insurance is unverified → critical
• Focus on items that require human attention — e.g., unsent claims, unverified insurance, overdue balance, missing forms
• Do NOT generate generic or obvious actions (e.g., "review patient profile") — only flag items that need attention

SECTION-SPECIFIC INSTRUCTIONS:
• Claims tab: count unsent, pending, rejected, paid claims. Flag any unsent claims as critical — they need to be submitted.
• Insurance tab: note carrier/plan. If no insurance info found, note as cash patient.
• Billing tab: parse the aging table. Flag any balance over 30 days.
• Charting: note unscheduled treatment with CDT codes if visible.

CATEGORY → ICON MAPPING:
  critical → 🚨, billing → 💰, insurance → 🔄, forms → 📝, recare → 📅,
  charting → 🗓️, clinical → 🦷, coverage → 💲, appointment → 🆕, system → 📂

IMPORTANT RULES:
• Only report what is EXPLICITLY visible — never guess or hallucinate
• If a section isn't visible on this page, set its fields to null
• For billing: parse the Account Summary aging table if present
• For actions: be dental-specific (mention CDT codes, coverage %, etc. when relevant)
• Keep action descriptions concise (1-2 sentences max)

═══════════════════════════════════════════════════════════
OUTPUT FORMAT — Return ONLY valid JSON, no markdown fences
═══════════════════════════════════════════════════════════

{
  "sectionsDetected": ["profile", "insurance", "billing", "claims", ...],
  "context": {
    "profile": {
      "gender": "string or null",
      "age": number_or_null,
      "dob": "string or null",
      "phone": "string or null",
      "email": "string or null",
      "language": "string or null",
      "hoh": "string or null",
      "relToHOH": "string or null"
    },
    "insurance": {
      "carrier": "string or null",
      "planName": "string or null",
      "lastVerified": "string or null",
      "hasMaxDeductInfo": true/false
    },
    "billing": {
      "balance": "dollar string or null",
      "hasBalance": true/false,
      "aging": {
        "past30": "dollar string or null",
        "days31_60": "dollar string or null",
        "days61_90": "dollar string or null",
        "over90": "dollar string or null",
        "total": "dollar string or null"
      },
      "hasOverdue": true/false,
      "owingInvoiceCount": number,
      "paidInvoiceCount": number,
      "hasOwingInvoices": true/false,
      "hasCredit": true/false,
      "creditAmount": "dollar string or null",
      "ppoAdjustedTotal": "dollar string or null"
    },
    "claims": {
      "totalClaims": number_or_null,
      "unsentClaims": number_or_null,
      "pendingInsurance": number_or_null,
      "rejectedClaims": number_or_null,
      "paidClaims": number_or_null,
      "claimsList": [
        {
          "claimNumber": "string or null",
          "status": "unsent|pending|paid|rejected|denied",
          "amount": "dollar string or null",
          "carrier": "string or null",
          "date": "string or null"
        }
      ]
    },
    "recare": {
      "noRecareFound": true/false,
      "nextDue": "string or null"
    },
    "charting": {
      "noVisits": true/false,
      "hasUnscheduledTx": true/false,
      "pendingCodes": ["D1234", ...] or null
    },
    "forms": {
      "completed": [{"name": "string", "completedDate": "string"}],
      "hasPendingForms": true/false
    },
    "todayAppt": {
      "startTime": "string or null",
      "endTime": "string or null",
      "type": "string or null",
      "isNewPatient": true/false,
      "codes": ["D0150", ...] or null
    },
    "perio": {
      "hasPerioData": true/false
    },
    "appointments": {
      "scheduledCount": number_or_null,
      "confirmedCount": number_or_null
    }
  },
  "actions": [
    {
      "priority": "critical|action|recommended|info",
      "icon": "emoji",
      "title": "Short title (5-8 words)",
      "detail": "1-2 sentence explanation with specifics",
      "category": "insurance|billing|forms|recare|charting|clinical|coverage|appointment|system"
    }
  ]
}`,

    async _callLLM(config, cleanText, benefitCard) {
      // Build user message with optional benefit card context
      let userMessage = `Extract patient data and generate action items from this dental practice management page.\n\n`;

      if (benefitCard) {
        const covSummary = (benefitCard.coverageTable || [])
          .filter(r => r.inNetwork != null)
          .map(r => `${r.category}: ${r.inNetwork}%`)
          .join(", ");
        userMessage += `KNOWN INSURANCE BENEFITS (already extracted):\n`;
        if (benefitCard.payer) userMessage += `Carrier: ${benefitCard.payer}\n`;
        if (benefitCard.deductible?.individual) userMessage += `Deductible: $${benefitCard.deductible.individual}\n`;
        if (benefitCard.annualMax?.individual) userMessage += `Annual Max: $${benefitCard.annualMax.individual}\n`;
        if (benefitCard.annualMax?.remaining) userMessage += `Remaining: $${benefitCard.annualMax.remaining}\n`;
        if (covSummary) userMessage += `Coverage: ${covSummary}\n`;
        userMessage += `\nUse this benefit info to cross-reference any scheduled procedures and generate coverage-related actions.\n\n`;
      }

      userMessage += `PAGE TEXT:\n---\n${cleanText}\n---\n\nReturn the JSON now.`;

      const url = "https://api.anthropic.com/v1/messages";

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": config.apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify({
          model: this.EXTRACTION_MODEL,
          max_tokens: 4096,
          temperature: 0,
          system: this.SYSTEM_PROMPT,
          messages: [{ role: "user", content: userMessage }],
        }),
      });

      if (!response.ok) {
        const err = await response.text();
        throw new Error(`Anthropic API error (${response.status}): ${err}`);
      }

      const data = await response.json();
      return data.content?.[0]?.text ?? "";
    },

    // ── Helpers ────────────────────────────────────────────

    _preprocessText(text) {
      let t = text;

      // Remove PracticePilot's own text if captured
      t = t.replace(/PracticePilot.*?(?=\n\n|\n[A-Z])/gs, "");
      t = t.replace(/⭐[^\n]*/g, "");

      // Remove common navigation noise
      const navPatterns = [
        /^(?:Home|Dashboard|Schedule|Patients|Reports|Settings|Help|Logout|Sign Out|Menu|Navigation)\s*$/gmi,
        /(?:Loading|Please wait|Searching)\.{2,}/gi,
        /Copyright\s*©.*/gi,
        /All\s+rights?\s+reserved\.?/gi,
      ];
      for (const p of navPatterns) t = t.replace(p, "");

      // Collapse excessive whitespace
      t = t.replace(/\n{3,}/g, "\n\n");
      t = t.replace(/[ \t]{4,}/g, "  ");
      t = t.split("\n").map(l => l.trim()).join("\n");
      return t.trim();
    },

    _extractPatientName(text) {
      // Delegate to the single canonical implementation
      return PracticePilot.patientContext._extractPatientName(text);
    },

    _parseJSON(responseText) {
      try { return JSON.parse(responseText); } catch (_) {}
      const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) try { return JSON.parse(jsonMatch[1]); } catch (_) {}
      const braceMatch = responseText.match(/\{[\s\S]*\}/);
      if (braceMatch) try { return JSON.parse(braceMatch[0]); } catch (_) {}
      throw new Error("Failed to parse LLM context response as JSON");
    },

    _cacheResult(hash, result) {
      // LRU eviction
      if (this._cache.size >= this.MAX_CACHE) {
        const oldest = this._cache.keys().next().value;
        this._cache.delete(oldest);
      }
      this._cache.set(hash, result);
    },

    /**
     * Invalidate cache for a specific patient (e.g., when switching patients)
     */
    clearCache() {
      this._cache.clear();
    },
  };

  window.PracticePilot = PracticePilot;
})();
