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

const PracticePilot = window.PracticePilot || {};

PracticePilot.llmExtractor = {

  // ── System prompt: the "brain" of extraction ────────────

  SYSTEM_PROMPT: `You are a dental insurance benefits extraction specialist. You will receive raw eligibility/benefits response text from a dental practice management system. This text has been redacted of patient identifiers for privacy.

Your job: extract structured benefit information and return it as a JSON object.

CRITICAL RULES:
1. Only extract what is explicitly stated. Never guess or infer values not present.
2. For coverage percentages, use the INSURANCE pays percentage (the "Ins%" from "Pat% / Ins%" format).
3. When multiple coinsurance levels exist for the same category (e.g., Seq#001 vs Seq#002), use the PRIMARY benefit level (usually Seq#001 or Seq#002, NOT "COINSURANCE AFTER ANNUAL MAX" which is Seq#004).
4. Focus on IN-NETWORK benefits (most dental practices care about in-network first).
5. For frequencies, convert to a human-readable format like "2 per calendar year" or "1 per 5 years".
6. The annual maximum is usually found under "Limitations and Maximums" or "Dental Care" with "ANNUAL MAXIMUM" label.
7. Deductible: look for "Individual" deductible amounts. Different service types may share the same deductible.
8. Map all coverage into the standard ADA CDT code range categories listed below.
9. For categories with mixed coverage (e.g., some procedures at 80%, some at 50%), report the MOST COMMON rate for that category, and note exceptions in the exceptions array.
10. Combine separate "Diagnostic Dental" and "Diagnostic X-Ray" categories into Diagnostic.

COVERAGE TABLE — MAP TO THESE EXACT CDT CATEGORIES:
- Diagnostic (D0100-D0999): exams, x-rays, diagnostic tests
- Preventive (D1000-D1999): prophy, fluoride, sealants, space maintainers
- Restorative (D2000-D2399): fillings, direct restorations
- Crowns (D2400-D2999): crowns, inlays, onlays, veneers, recementation
- Endodontics (D3000-D3999): root canals, pulpotomy, apicoectomy
- Periodontics (D4000-D4999): SRP, perio surgery, perio maintenance
- Prosthodontics Removable (D5000-D5899): dentures, partials, relines
- Maxillofacial Prosthetics (D5900-D5999): maxfac prosthetics
- Implant Services (D6000-D6199): implant placement, implant prosthetics
- Prosthodontics Fixed (D6200-D6999): bridges, fixed partials
- Oral & Maxillofacial Surgery (D7000-D7999): extractions, oral surgery
- Orthodontics (D8000-D8999): ortho treatment
- Adjunctive General Services (D9000-D9999): anesthesia, palliative, occlusal guards

Return ONLY a valid JSON object with this exact structure (use null for missing fields):

{
  "payer": "string or null",
  "planName": "string or null",
  "planType": "PPO|HMO|DHMO|Indemnity|null",
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
    "prophy": "human-readable string or null",
    "perioMaintenance": "human-readable string or null",
    "exam": "human-readable string or null",
    "comprehensiveExam": "human-readable string or null",
    "perioExam": "human-readable string or null",
    "limitedExam": "human-readable string or null",
    "bitewings": "human-readable string or null",
    "fmxPano": "human-readable string or null",
    "fluoride": "human-readable string or null",
    "sealants": "human-readable string or null",
    "srp": "human-readable string or null",
    "crowns": "human-readable string or null",
    "dentures": "human-readable string or null",
    "rootCanal": "human-readable string or null"
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
    "string - any important disclaimers, cross-reduction notes, or special clauses"
  ],
  "extractionConfidence": "high|medium|low"
}

IMPORTANT:
- Coverage percentages should be what INSURANCE pays (e.g., if "20% / 80%" means patient pays 20%, insurance pays 80%, report 80)
- If you see "0% / 100%", that means insurance pays 100%
- Some plans list Seq#001 (preventive), Seq#002 (basic/major), Seq#003 (maximums), Seq#004 (after-max coinsurance) — use Seq#001 and Seq#002 for normal coverage
- Use coverageExceptions for procedures that differ from their category rate (e.g., inlays at 50% when Restorative is 80%)
- Watch for cross-reduction notes (e.g., "cleaning" and "perio maintenance" sharing frequencies)
- Note missing tooth clauses, replacement limitations, and pre-authorization requirements in limitations array
- If a category is explicitly listed as non-covered, set inNetwork to 0
- For "Restorative" (D2000-D2399) = fillings only. Crowns/inlays/onlays/veneers go in "Crowns" (D2400-D2999)

Return ONLY the JSON object, no markdown, no explanation.`,

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
  async extract(rawText) {
    // 0. Capture patient identity locally BEFORE redaction (never sent to LLM)
    const patientName = PracticePilot.phiRedactor.extractPatientName(rawText);
    const subscriberId = PracticePilot.phiRedactor.extractSubscriberId(rawText);

    // 1. Redact PHI
    const redactionResult = PracticePilot.phiRedactor.redact(rawText);
    const cleanText = redactionResult.redactedText;

    // 2. Truncate if needed (most models have context limits)
    const truncated = cleanText.length > 60000
      ? cleanText.substring(0, 60000) + "\n\n[TEXT TRUNCATED]"
      : cleanText;

    // 3. Call LLM
    const config = await this.getConfig();

    if (!config.apiKey) {
      throw new Error("LLM API key not configured. Open PracticePilot settings to add your API key.");
    }

    let llmResponse;
    if (config.provider === "anthropic") {
      llmResponse = await this._callAnthropic(config, truncated);
    } else {
      // OpenAI or OpenAI-compatible
      llmResponse = await this._callOpenAI(config, truncated);
    }

    // 4. Parse JSON from response
    const extracted = this._parseJSON(llmResponse);

    // 5. Convert to BenefitCard format
    const card = this._toBenefitCard(extracted);

    // 6. Attach locally-captured patient identity (stays on device)
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
          { role: "user", content: `Extract structured dental insurance benefits from this eligibility response:\n\n${text}` },
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
          { role: "user", content: `Extract structured dental insurance benefits from this eligibility response:\n\n${text}` },
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
