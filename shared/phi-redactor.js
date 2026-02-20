// ============================================================
// PracticePilot — PHI Redactor
// ============================================================
// Strips Protected Health Information from page text BEFORE
// sending to any LLM API. This is a critical safety layer.
//
// What we redact:
//   - Patient names (detected via "Patient Name:" labels)
//   - SSN / Subscriber IDs
//   - Dates of birth
//   - Phone numbers
//   - Email addresses
//   - Street addresses (best-effort)
//
// What we KEEP (needed for extraction):
//   - Payer name (Humana, Cigna, etc.)
//   - Group name / number
//   - Plan type, coverage percentages
//   - Deductibles, maximums, frequencies
//   - CDT codes
//   - Service types
// ============================================================

const PracticePilot = window.PracticePilot || {};

PracticePilot.phiRedactor = {

  /**
   * Redact PHI from raw eligibility text before sending to LLM.
   * Returns { redactedText, redactions[] } so we can restore if needed.
   */
  redact(text) {
    const redactions = [];
    let result = text;

    // Order matters: do specific patterns first, then broad ones.

    // 1. Patient name (appears as "Patient Name: FIRSTNAME LASTNAME" or similar)
    result = this._redactPattern(result, redactions,
      /Patient\s+Name\s*:\s*([A-Z][A-Za-z'\-]+(?:\s+[A-Z][A-Za-z'\-]+){1,3})/gi,
      "Patient Name: [REDACTED_NAME]",
      "patient_name"
    );

    // 2. SS# / ID# / Subscriber ID patterns
    result = this._redactPattern(result, redactions,
      /SS#\s*\/?\s*ID#\s*:\s*([A-Za-z0-9\-]+)/gi,
      "SS# / ID#: [REDACTED_ID]",
      "ssn_id"
    );

    result = this._redactPattern(result, redactions,
      /Subscriber\s*(?:ID|#|Number)\s*:\s*([A-Za-z0-9\-]+)/gi,
      "Subscriber ID: [REDACTED_ID]",
      "subscriber_id"
    );

    result = this._redactPattern(result, redactions,
      /Member\s*(?:ID|#|Number)\s*:\s*([A-Za-z0-9\-]+)/gi,
      "Member ID: [REDACTED_ID]",
      "member_id"
    );

    // 3. SSN patterns (XXX-XX-XXXX or XXXXXXXXX)
    result = this._redactPattern(result, redactions,
      /\b\d{3}[\-\s]?\d{2}[\-\s]?\d{4}\b/g,
      "[REDACTED_SSN]",
      "ssn"
    );

    // 4. Date of birth patterns
    result = this._redactPattern(result, redactions,
      /(?:DOB|Date\s*of\s*Birth|Birth\s*Date)\s*:\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/gi,
      "DOB: [REDACTED_DOB]",
      "dob"
    );

    // 5. Phone numbers
    result = this._redactPattern(result, redactions,
      /(?:Phone|Tel|Fax|Cell|Mobile)\s*(?:#|:)?\s*\(?\d{3}\)?[\s\-\.]?\d{3}[\s\-\.]?\d{4}/gi,
      "[REDACTED_PHONE]",
      "phone"
    );
    // Standalone phone number patterns (with area code)
    result = this._redactPattern(result, redactions,
      /\b\(?\d{3}\)?[\s\-\.]\d{3}[\s\-\.]\d{4}\b/g,
      "[REDACTED_PHONE]",
      "phone"
    );

    // 6. Email addresses
    result = this._redactPattern(result, redactions,
      /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g,
      "[REDACTED_EMAIL]",
      "email"
    );

    // 7. Street addresses (best-effort: number + street name patterns)
    result = this._redactPattern(result, redactions,
      /\b\d{1,5}\s+[A-Za-z]+\s+(?:St|Street|Ave|Avenue|Blvd|Boulevard|Dr|Drive|Ln|Lane|Rd|Road|Way|Ct|Court|Pl|Place|Cir|Circle)\b\.?(?:\s*(?:#|Apt|Suite|Ste|Unit)\s*\w+)?/gi,
      "[REDACTED_ADDRESS]",
      "address"
    );

    return {
      redactedText: result,
      redactions,
      originalLength: text.length,
      redactedLength: result.length,
      redactionCount: redactions.length,
    };
  },

  /**
   * Apply a single redaction pattern.
   */
  _redactPattern(text, redactions, pattern, replacement, type) {
    return text.replace(pattern, (match) => {
      redactions.push({
        type,
        position: text.indexOf(match),
        length: match.length,
        // Do NOT store the actual value — that defeats the purpose
      });
      return replacement;
    });
  },

  /**
   * Extract patient name from raw text BEFORE redaction.
   * This stays local — never sent to the LLM.
   * Returns the name string or null.
   */
  extractPatientName(text) {
    // "Patient Name: FIRSTNAME LASTNAME" or "Patient: ..."
    const patterns = [
      /Patient\s+Name\s*:\s*([A-Z][A-Za-z'\-]+(?:\s+[A-Z][A-Za-z'\-]+){1,3})/i,
      /Patient\s*:\s*([A-Z][A-Za-z'\-]+(?:\s+[A-Z][A-Za-z'\-]+){1,3})/i,
      /Name\s*:\s*([A-Z][A-Za-z'\-]+,\s*[A-Z][A-Za-z'\-]+)/i, // Last, First
      /Subscriber\s+Name\s*:\s*([A-Z][A-Za-z'\-]+(?:\s+[A-Z][A-Za-z'\-]+){1,3})/i,
      /Member\s+Name\s*:\s*([A-Z][A-Za-z'\-]+(?:\s+[A-Z][A-Za-z'\-]+){1,3})/i,
      /Insured\s+Name\s*:\s*([A-Z][A-Za-z'\-]+(?:\s+[A-Z][A-Za-z'\-]+){1,3})/i,
    ];
    for (const p of patterns) {
      const match = text.match(p);
      if (match?.[1]) return match[1].trim();
    }
    return null;
  },

  /**
   * Extract subscriber/member ID from raw text BEFORE redaction.
   * This stays local — never sent to the LLM.
   */
  extractSubscriberId(text) {
    const patterns = [
      /SS#\s*\/?\s*ID#\s*:\s*([A-Za-z0-9\-]+)/i,
      /Subscriber\s*(?:ID|#|Number)\s*:\s*([A-Za-z0-9\-]+)/i,
      /Member\s*(?:ID|#|Number)\s*:\s*([A-Za-z0-9\-]+)/i,
    ];
    for (const p of patterns) {
      const match = text.match(p);
      if (match?.[1]) return match[1].trim();
    }
    return null;
  },

  /**
   * Quick check: does the text appear to contain PHI?
   * Useful for warning the user before they manually copy.
   */
  containsPHI(text) {
    const patterns = [
      /Patient\s+Name\s*:/i,
      /SS#/i,
      /\bDOB\b/i,
      /Subscriber\s*ID/i,
      /Member\s*ID/i,
      /\b\d{3}[\-]\d{2}[\-]\d{4}\b/,
    ];
    return patterns.some(p => p.test(text));
  },
};

window.PracticePilot = PracticePilot;
