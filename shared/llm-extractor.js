// ============================================================
// PracticePilot — LLM Benefit Extractor
// ============================================================
// Sends redacted eligibility text to an LLM and gets back a
// structured BenefitCard JSON.
//
// Supports: OpenAI, Anthropic, or any OpenAI-compatible API.
//
// Flow:
//   1. Raw page text → PHI redactor → clean text
//   2. Clean text + system prompt → LLM API
//   3. LLM returns structured JSON
//   4. JSON → normalize.benefitCard()
//
// The system prompt is the critical piece — it teaches the LLM
// how to interpret wildly different payer eligibility formats
// (Humana vs Cigna vs Delta vs MetLife etc.)
// ============================================================

var PracticePilot = window.PracticePilot || {};

PracticePilot.llmExtractor = {

  // ── System prompt: the "brain" of extraction ────────────

  SYSTEM_PROMPT: `You are a dental insurance benefits extraction specialist optimized for accuracy. You will receive cleaned eligibility/benefits response text — typically from Curve Dental (a practice management system) or a payer portal. Patient identifiers have been redacted.

Your job: extract EVERY piece of structured benefit information and return it as a JSON object with zero hallucination.

═══════════════════════════════════════════════════════════
EXTRACTION RULES (follow precisely)
═══════════════════════════════════════════════════════════

COVERAGE PERCENTAGES:
• Always report what INSURANCE pays (the "Ins%" column).
• "Pat% / Ins%" → e.g. "20% / 80%" means insurance pays 80 → report 80.
• "0% / 100%" → insurance pays 100 → report 100.
• "100% / 0%" → insurance pays 0 → report 0.
• If a page shows "COINSURANCE" as a single percentage, that IS the insurance-pays rate.

COINSURANCE SEQUENCES (Curve Dental specific):
• Seq#001 = Preventive/Diagnostic, Seq#002 = Basic, Seq#003 = Major
• Seq#004 is typically "COINSURANCE AFTER ANNUAL MAX" — SKIP this.
• Use only Seq#001 through Seq#003 for normal coverage rates.
• "BENEFIT PERIOD" sections show limits (annual max, deductible).

DEDUCTIBLE:
• Look for "Individual" deductible under "Benefit Period" or "Limitations and Maximums".
• Note whether preventive/diagnostic is exempt from deductible (common in PPO plans).
• If deductible is "$0" or listed as "waived" for preventive, set preventiveExempt: true.

ANNUAL MAXIMUM:
• Usually under "Limitations and Maximums" → "ANNUAL MAXIMUM" or "DENTAL CARE" maximum.
• Capture both the plan maximum and the remaining amount if shown.

CATEGORY MAPPING — MAP TO THESE EXACT 13 CDT CATEGORIES:
 1. Diagnostic (D0100-D0999): exams, x-rays, diagnostic tests, oral evaluations
 2. Preventive (D1000-D1999): prophy, fluoride, sealants, space maintainers
 3. Restorative (D2000-D2399): fillings/direct restorations ONLY
 4. Crowns (D2400-D2999): crowns, inlays, onlays, veneers, recementation
 5. Endodontics (D3000-D3999): root canals, pulpotomy, apicoectomy
 6. Periodontics (D4000-D4999): SRP, perio surgery, perio maintenance, full-mouth debridement
 7. Prosthodontics Removable (D5000-D5899): dentures, partials, relines
 8. Maxillofacial Prosthetics (D5900-D5999): maxfac prosthetics
 9. Implant Services (D6000-D6199): implant placement and implant prosthetics
10. Prosthodontics Fixed (D6200-D6999): bridges, fixed partials, pontics
11. Oral & Maxillofacial Surgery (D7000-D7999): extractions, oral surgery
12. Orthodontics (D8000-D8999): ortho treatment, comprehensive/limited
13. Adjunctive General Services (D9000-D9999): anesthesia, palliative, occlusal guards, nightguards

COMMON MAPPING PITFALLS — avoid these:
• "Diagnostic Dental" + "Diagnostic X-Ray" → combine into single "Diagnostic" category
• Inlays/onlays/veneers → "Crowns" (D2400-D2999), NOT "Restorative"
• Perio maintenance (D4910) → "Periodontics", even if listed under "Preventive" by some payers
• Simple extractions → "Oral & Maxillofacial Surgery"
• Nightguards / Occlusal guards → "Adjunctive General Services"

FREQUENCY / LIMITATIONS:
• Convert all frequencies to human-readable: "2 per calendar year", "1 per 36 months", "1 per 5 years"
• Capture age limits (e.g., "fluoride through age 18", "sealants through age 14")
• Note missing-tooth clauses explicitly
• Note pre-authorization / pre-determination requirements
• Capture any benefit substitution clauses (e.g., "resin on posterior teeth downgraded to amalgam")

REMAINING BENEFITS:
• If the page shows remaining visits or remaining dollar amounts, capture them.
• "Remaining" amounts tell the practice how much benefit is still available this year.

DATA QUALITY:
• Only extract what is EXPLICITLY stated — never guess or infer missing values.
• If a category isn't mentioned at all, set inNetwork to null (not 0).
• If a category is explicitly listed as "Not Covered" or "Excluded", set inNetwork to 0.
• For mixed-coverage categories, report the MOST COMMON rate and add exceptions.
• Set extractionConfidence based on data completeness: "high" if most fields found, "medium" if partial, "low" if sparse.

═══════════════════════════════════════════════════════════
OUTPUT FORMAT
═══════════════════════════════════════════════════════════

Return ONLY a valid JSON object with this exact structure (use null for unknown/missing fields):

{
  "payer": "string or null",
  "planName": "string or null",
  "planType": "PPO|HMO|DHMO|Indemnity|EPO|null",
  "groupNumber": "string or null",
  "groupName": "string or null",
  "effectiveStart": "MM/DD/YYYY or null",
  "effectiveEnd": "MM/DD/YYYY or null",
  "deductible": {
    "individual": "dollar amount as string or null",
    "family": "dollar amount as string or null",
    "appliesTo": "which categories it applies to, or null",
    "preventiveExempt": true/false/null
  },
  "annualMax": {
    "individual": "dollar amount as string or null",
    "family": "dollar amount as string or null",
    "remaining": "dollar amount as string or null",
    "notes": "string or null"
  },
  "orthodonticMax": {
    "lifetime": "dollar amount as string or null",
    "remaining": "dollar amount as string or null"
  },
  "coverageTable": [
    { "category": "Diagnostic",                  "cdtRange": "D0100-D0999", "inNetwork": number_or_null, "outOfNetwork": number_or_null },
    { "category": "Preventive",                   "cdtRange": "D1000-D1999", "inNetwork": number_or_null, "outOfNetwork": number_or_null },
    { "category": "Restorative",                  "cdtRange": "D2000-D2399", "inNetwork": number_or_null, "outOfNetwork": number_or_null },
    { "category": "Crowns",                       "cdtRange": "D2400-D2999", "inNetwork": number_or_null, "outOfNetwork": number_or_null },
    { "category": "Endodontics",                  "cdtRange": "D3000-D3999", "inNetwork": number_or_null, "outOfNetwork": number_or_null },
    { "category": "Periodontics",                 "cdtRange": "D4000-D4999", "inNetwork": number_or_null, "outOfNetwork": number_or_null },
    { "category": "Prosthodontics, Removable",    "cdtRange": "D5000-D5899", "inNetwork": number_or_null, "outOfNetwork": number_or_null },
    { "category": "Maxillofacial Prosthetics",    "cdtRange": "D5900-D5999", "inNetwork": number_or_null, "outOfNetwork": number_or_null },
    { "category": "Implant Services",             "cdtRange": "D6000-D6199", "inNetwork": number_or_null, "outOfNetwork": number_or_null },
    { "category": "Prosthodontics, Fixed",        "cdtRange": "D6200-D6999", "inNetwork": number_or_null, "outOfNetwork": number_or_null },
    { "category": "Oral & Maxillofacial Surgery", "cdtRange": "D7000-D7999", "inNetwork": number_or_null, "outOfNetwork": number_or_null },
    { "category": "Orthodontics",                 "cdtRange": "D8000-D8999", "inNetwork": number_or_null, "outOfNetwork": number_or_null },
    { "category": "Adjunctive General Services",  "cdtRange": "D9000-D9999", "inNetwork": number_or_null, "outOfNetwork": number_or_null }
  ],
  "coverageExceptions": [
    { "cdtCodes": "D-code or range", "description": "what", "inNetwork": number_or_null, "outOfNetwork": number_or_null, "note": "string" }
  ],
  "frequencies": {
    "prophy": "string or null",
    "perioMaintenance": "string or null",
    "exam": "string or null",
    "comprehensiveExam": "string or null",
    "perioExam": "string or null",
    "limitedExam": "string or null",
    "bitewings": "string or null",
    "fmxPano": "string or null",
    "fluoride": "string or null",
    "sealants": "string or null",
    "srp": "string or null",
    "crowns": "string or null",
    "dentures": "string or null",
    "rootCanal": "string or null"
  },
  "waitingPeriods": [
    { "category": "string", "period": "string" }
  ],
  "ageLimits": [
    { "service": "string", "limit": "string" }
  ],
  "limitations": [
    "string - each notable limitation, exclusion, or clause"
  ],
  "nonCovered": [
    "string - each non-covered service type"
  ],
  "remainingBenefits": {
    "prophyVisitsRemaining": "string or null",
    "perioVisitsRemaining": "string or null",
    "bwxRemaining": "string or null",
    "fmxPanoRemaining": "string or null",
    "fluorideRemaining": "string or null",
    "annualMaxRemaining": "dollar amount as string or null"
  },
  "notes": [
    "string - any important disclaimers, cross-reduction notes, benefit substitution clauses, or special conditions"
  ],
  "extractionConfidence": "high|medium|low"
}

Return ONLY the JSON object. No markdown fences, no explanation, no commentary.`,

  // ── API Configuration ───────────────────────────────────

  STORAGE_KEY: "pp:llmConfig",

  async getConfig() {
    const result = await chrome.storage.local.get(this.STORAGE_KEY);
    return result[this.STORAGE_KEY] ?? {
      provider: "anthropic",        // anthropic | openai | custom
      apiKey: "",
      model: "claude-sonnet-4-20250514",  // best balance of cost + quality for structured extraction
      baseUrl: "https://api.anthropic.com",
      maxTokens: 4096,
      temperature: 0,               // deterministic extraction
    };
  },

  async setConfig(config) {
    await chrome.storage.local.set({ [this.STORAGE_KEY]: config });
  },

  // ── Main extraction function ────────────────────────────

  /**
   * Extract benefits from raw page text using LLM.
   * 
   * @param {string} rawText - Raw page text (may contain PHI)
   * @returns {Object} { card: BenefitCard, raw: LLMResponse, redactionInfo }
   */
  /**
   * Preprocess raw page text to remove noise before sending to LLM.
   * Strips navigation, headers, footers, repetitive whitespace, and
   * PracticePilot's own sidebar text.
   */
  _preprocessText(rawText) {
    let text = rawText;

    // Remove PracticePilot sidebar text if captured
    text = text.replace(/PracticePilot.*?(?=\n\n|\n[A-Z])/gs, "");
    text = text.replace(/⭐[^\n]*/g, "");  // starred code labels from our panel

    // Remove common Curve Dental navigation/chrome text
    const navPatterns = [
      /^(?:Home|Dashboard|Schedule|Patients|Reports|Settings|Help|Logout|Sign Out|Menu|Navigation)\s*$/gmi,
      /(?:Loading|Please wait|Searching)\.{2,}/gi,
      /Copyright\s*©.*/gi,
      /All\s+rights?\s+reserved\.?/gi,
      /Powered\s+by\s+.*/gi,
      /Version\s+\d+\.\d+.*/gi,
      /^\s*(?:Back|Cancel|Close|Print|Save|Submit|Next|Previous)\s*$/gmi,
      /Cookie\s+(?:Policy|Notice|Consent).*/gi,
      /Privacy\s+Policy.*/gi,
      /Terms\s+(?:of\s+(?:Service|Use)).*/gi,
    ];

    for (const pattern of navPatterns) {
      text = text.replace(pattern, "");
    }

    // Collapse 3+ blank lines into 2
    text = text.replace(/\n{3,}/g, "\n\n");

    // Collapse runs of whitespace on a single line
    text = text.replace(/[ \t]{4,}/g, "  ");

    // Remove leading/trailing whitespace per line
    text = text.split("\n").map(l => l.trim()).join("\n");

    // Remove completely empty leading/trailing space
    text = text.trim();

    return text;
  },

  async extract(rawText) {
    // 0. Capture patient identity locally BEFORE redaction (never sent to LLM)
    const patientName = PracticePilot.phiRedactor.extractPatientName(rawText);
    const subscriberId = PracticePilot.phiRedactor.extractSubscriberId(rawText);

    // 1. Redact PHI
    const redactionResult = PracticePilot.phiRedactor.redact(rawText);
    let cleanText = redactionResult.redactedText;

    // 2. Preprocess: strip noise, collapse whitespace
    cleanText = this._preprocessText(cleanText);

    // 3. Truncate if needed (most models have context limits)
    const truncated = cleanText.length > 60000
      ? cleanText.substring(0, 60000) + "\n\n[TEXT TRUNCATED]"
      : cleanText;

    // 4. Call LLM
    const config = await this.getConfig();

    if (!config.apiKey) {
      throw new Error("LLM API key not configured. Open PracticePilot settings to add your API key.");
    }

    // Build context-rich user message
    const pageUrl = window.location?.href || "unknown";
    const isInsurer = !pageUrl.includes("curvehero.com");
    const sourceHint = isInsurer
      ? "This text is from an insurance payer portal."
      : "This text is from Curve Dental practice management system (eligibility response page).";

    const userMessage = `${sourceHint}

Extract ALL structured dental insurance benefits from the following eligibility text. Pay special attention to:
- Coverage percentages (Insurance pays %)
- Deductibles and annual maximums (including remaining amounts)
- Frequency limitations for prophy, exams, x-rays, fluoride
- Waiting periods and age limits
- Non-covered services and exclusions

ELIGIBILITY TEXT:
---
${truncated}
---

Return the JSON object now.`;

    let llmResponse;
    if (config.provider === "anthropic") {
      llmResponse = await this._callAnthropic(config, userMessage);
    } else {
      // OpenAI or OpenAI-compatible
      llmResponse = await this._callOpenAI(config, userMessage);
    }

    // 5. Parse JSON from response
    const extracted = this._parseJSON(llmResponse);

    // 6. Convert to BenefitCard format
    const card = this._toBenefitCard(extracted);

    // 7. Attach locally-captured patient identity (stays on device)
    card.patientName = patientName;
    card.subscriberId = subscriberId;

    return {
      card,
      llmRaw: extracted,
      redactionInfo: {
        redactionCount: redactionResult.redactionCount,
        originalLength: redactionResult.originalLength,
        redactedLength: redactionResult.redactedLength,
      },
    };
  },

  // ── API Callers ─────────────────────────────────────────

  async _callOpenAI(config, text) {
    const url = `${config.baseUrl}/chat/completions`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        temperature: config.temperature,
        max_tokens: config.maxTokens,
        messages: [
          { role: "system", content: this.SYSTEM_PROMPT },
          { role: "user", content: text },
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`OpenAI API error (${response.status}): ${err}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content ?? "";
  },

  async _callAnthropic(config, text) {
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
        model: config.model || "claude-sonnet-4-20250514",
        max_tokens: config.maxTokens,
        temperature: config.temperature,
        system: this.SYSTEM_PROMPT,
        messages: [
          { role: "user", content: text },
        ],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Anthropic API error (${response.status}): ${err}`);
    }

    const data = await response.json();
    return data.content?.[0]?.text ?? "";
  },

  // ── Response parsing ────────────────────────────────────

  _parseJSON(responseText) {
    // Try direct parse
    try {
      return JSON.parse(responseText);
    } catch (e) {
      // Try extracting JSON from markdown code blocks
      const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        try {
          return JSON.parse(jsonMatch[1]);
        } catch (e2) {
          // ignore
        }
      }

      // Try finding the first { ... } block
      const braceMatch = responseText.match(/\{[\s\S]*\}/);
      if (braceMatch) {
        try {
          return JSON.parse(braceMatch[0]);
        } catch (e3) {
          // ignore
        }
      }

      throw new Error("Failed to parse LLM response as JSON. Response: " + responseText.substring(0, 200));
    }
  },

  /**
   * Convert LLM extracted JSON to our BenefitCard format.
   */
  _toBenefitCard(extracted) {
    // Build coverage lookup from the new coverageTable array
    const covTable = extracted.coverageTable || [];
    const covLookup = {};
    for (const row of covTable) {
      const key = (row.category || "").toLowerCase().replace(/[^a-z]/g, "");
      covLookup[key] = row;
    }
    const getInNet = (key) => covLookup[key]?.inNetwork ?? null;

    const raw = {
      sourceUrl: window.location.href,
      payer: extracted.payer,
      planName: extracted.planName,
      planType: extracted.planType,
      groupNumber: extracted.groupNumber,
      subscriberId: null,  // redacted
      effectiveStart: extracted.effectiveStart,
      effectiveEnd: extracted.effectiveEnd,

      deductibleIndividual: extracted.deductible?.individual,
      deductibleFamily: extracted.deductible?.family,
      deductibleAppliesTo: extracted.deductible?.appliesTo,

      annualMaxIndividual: extracted.annualMax?.individual,
      annualMaxFamily: extracted.annualMax?.family,
      annualMaxRemaining: extracted.annualMax?.remaining ?? extracted.remainingBenefits?.annualMaxRemaining,

      // Map from coverageTable
      coverageDiagnostic:     getInNet("diagnostic"),
      coveragePreventive:     getInNet("preventive"),
      coverageRestorative:    getInNet("restorative"),
      coverageCrowns:         getInNet("crowns"),
      coverageEndodontics:    getInNet("endodontics"),
      coveragePeriodontics:   getInNet("periodontics"),
      coverageProsthodonticsRemovable: getInNet("prosthodonticsremovable"),
      coverageMaxillofacial:  getInNet("maxillofacialprosthetics"),
      coverageImplants:       getInNet("implantservices"),
      coverageProsthodonticsFixed: getInNet("prosthodonticsfixed"),
      coverageOralSurgery:    getInNet("oralmaxillofacialsurgery"),
      coverageOrthodontics:   getInNet("orthodontics"),
      coverageAdjunctive:     getInNet("adjunctivegeneralservices"),

      // Keep the full table for display
      coverageTable: covTable,
      coverageExceptions: extracted.coverageExceptions || [],

      freqProphy: extracted.frequencies?.prophy,
      freqExam: extracted.frequencies?.exam,
      freqBwx: extracted.frequencies?.bitewings,
      freqFmx: extracted.frequencies?.fmxPano,
      freqPano: extracted.frequencies?.fmxPano,
      freqSealants: extracted.frequencies?.sealants,
      freqFluoride: extracted.frequencies?.fluoride,

      waitingPeriods: extracted.waitingPeriods || [],
      ageLimits: extracted.ageLimits || [],
      remainingBenefits: extracted.remainingBenefits || {},
      nonCovered: extracted.nonCovered || [],
      notes: [
        ...(extracted.limitations || []),
        ...(extracted.notes || []),
      ],

      confidence: {
        overall: extracted.extractionConfidence || "medium",
      },
    };

    // Store the full LLM output for the detailed view
    raw._llmFull = extracted;

    return PracticePilot.normalize.benefitCard(raw);
  },

  // ── Health check ────────────────────────────────────────

  async testConnection() {
    const config = await this.getConfig();
    if (!config.apiKey) {
      return { ok: false, error: "No API key configured" };
    }

    try {
      const testPrompt = "Return this exact JSON: {\"status\": \"ok\"}";

      let result;
      if (config.provider === "anthropic") {
        result = await this._callAnthropic(
          { ...config, maxTokens: 50 },
          testPrompt
        );
      } else {
        result = await this._callOpenAI(
          { ...config, maxTokens: 50 },
          testPrompt
        );
      }

      return { ok: true, response: result };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  },
};

window.PracticePilot = PracticePilot;
