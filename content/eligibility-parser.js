// ============================================================
// PracticePilot — Eligibility Page Parser
// ============================================================
// Extracts benefit/eligibility data from the visible page.
//
// Strategy:
//   1. Look for known DOM patterns (tables, labels, key text)
//   2. Fall back to full-text regex extraction
//   3. Return raw fields that normalize.js turns into a BenefitCard
//
// This parser is intentionally broad — it uses heuristics to
// find benefit data regardless of exact page layout.
// Once we see the real Curve eligibility page, we can add
// targeted selectors for higher accuracy.
// ============================================================

var PracticePilot = window.PracticePilot || {};

PracticePilot.eligibilityParser = {

  /**
   * Main entry: extract everything we can from the current page.
   * Returns a raw object suitable for PracticePilot.normalize.benefitCard().
   */
  extractFromPage() {
    const raw = {};
    raw.sourceUrl = window.location.href;
    raw.confidence = {};

    // Try table-based extraction first (most structured)
    const tableData = this._extractFromTables();

    // Then try text-based extraction (catches labels + values)
    const textData = this._extractFromText();

    // Merge: table data wins where present, text fills gaps
    return this._merge(tableData, textData, raw);
  },

  // ── Table-based extraction ──────────────────────────────

  _extractFromTables() {
    const data = {};
    const tables = document.querySelectorAll("table");

    for (const table of tables) {
      const rows = table.querySelectorAll("tr");
      for (const row of rows) {
        const cells = Array.from(row.querySelectorAll("td, th"))
          .map(c => c.innerText.trim());

        if (cells.length < 2) continue;

        const label = cells[0].toLowerCase();
        const value = cells[1];

        // Coverage percentages
        this._matchCoverage(data, label, value);

        // Deductible
        this._matchDeductible(data, label, value);

        // Annual max
        this._matchAnnualMax(data, label, value);

        // Frequencies
        this._matchFrequency(data, label, value);

        // Plan info
        this._matchPlanInfo(data, label, value);
      }
    }

    return data;
  },

  // ── Text-based extraction (regex over innerText) ────────

  _extractFromText() {
    const text = document.body?.innerText || "";
    const data = {};

    // Plan type
    if (/\bPPO\b/i.test(text))           data.planType = "PPO";
    else if (/\bHMO\b/i.test(text))      data.planType = "HMO";
    else if (/\bDHMO\b/i.test(text))     data.planType = "DHMO";
    else if (/\bIndemnity\b/i.test(text)) data.planType = "Indemnity";

    // Payer / carrier
    const payers = [
      "Humana", "Cigna", "Delta Dental", "MetLife", "Aetna", "United Healthcare",
      "UHC", "Guardian", "Anthem", "BCBS", "Blue Cross", "Blue Shield",
      "Principal", "Sun Life", "Lincoln Financial", "Ameritas", "Assurant",
      "Connection Dental", "GEHA", "Standard", "United Concordia",
    ];
    for (const p of payers) {
      if (text.includes(p)) {
        data.payer = p;
        break;
      }
    }

    // Money amounts
    const moneyMatch = (pattern) => {
      const re = new RegExp(pattern + "\\s*:?\\s*\\$?([0-9,]+(?:\\.[0-9]{2})?)", "i");
      const m = text.match(re);
      return m ? m[1].replace(/,/g, "") : null;
    };

    // Deductible
    data.deductibleIndividual = data.deductibleIndividual
      || moneyMatch("(?:individual|ind\\.?)\\s*deductible")
      || moneyMatch("deductible\\s*(?:individual|ind\\.?)");

    if (!data.deductibleIndividual) {
      data.deductibleIndividual = moneyMatch("deductible");
    }

    data.deductibleFamily = data.deductibleFamily
      || moneyMatch("(?:family|fam\\.?)\\s*deductible")
      || moneyMatch("deductible\\s*(?:family|fam\\.?)");

    // Annual max
    data.annualMaxIndividual = data.annualMaxIndividual
      || moneyMatch("annual\\s*max(?:imum)?")
      || moneyMatch("calendar\\s*year\\s*max(?:imum)?")
      || moneyMatch("max(?:imum)?\\s*benefit");

    // Coverage percentages
    const pctMatch = (pattern) => {
      const re = new RegExp(pattern + "\\s*:?\\s*([0-9]{1,3})\\s*%", "i");
      const m = text.match(re);
      return m ? Number(m[1]) : null;
    };

    data.coveragePreventive   = data.coveragePreventive   ?? pctMatch("preventive");
    data.coverageDiagnostic   = data.coverageDiagnostic   ?? pctMatch("diagnostic");
    data.coverageBasic        = data.coverageBasic        ?? pctMatch("basic");
    data.coverageMajor        = data.coverageMajor        ?? pctMatch("major");
    data.coverageEndodontics  = data.coverageEndodontics  ?? pctMatch("endodontic");
    data.coveragePeriodontics = data.coveragePeriodontics ?? pctMatch("periodontic");
    data.coverageOralSurgery  = data.coverageOralSurgery  ?? pctMatch("oral\\s*surgery");
    data.coverageProsthodontics = data.coverageProsthodontics ?? pctMatch("prosthodontic");
    data.coverageImplants     = data.coverageImplants     ?? pctMatch("implant");
    data.coverageOrthodontics = data.coverageOrthodontics ?? pctMatch("orthodontic|ortho");

    // Frequencies
    const freqMatch = (pattern) => {
      const re = new RegExp(pattern + "\\s*:?\\s*(.{5,40}?)(?:\\n|$)", "i");
      const m = text.match(re);
      return m ? m[1].trim() : null;
    };

    data.freqProphy   = data.freqProphy   ?? this._parseFrequencyText(text, "prophy|prophylaxis|cleaning");
    data.freqExam     = data.freqExam     ?? this._parseFrequencyText(text, "exam|examination");
    data.freqBwx      = data.freqBwx      ?? this._parseFrequencyText(text, "bitewing|BWX|bw");
    data.freqFmx      = data.freqFmx      ?? this._parseFrequencyText(text, "FMX|full\\s*mouth");
    data.freqPano     = data.freqPano     ?? this._parseFrequencyText(text, "panoramic|pano");

    // Group number
    const groupMatch = text.match(/group\s*(?:#|number|no\.?)\s*:?\s*([A-Za-z0-9\-]+)/i);
    if (groupMatch) data.groupNumber = groupMatch[1];

    // Subscriber ID
    const subMatch = text.match(/subscriber\s*(?:id|#|number)\s*:?\s*([A-Za-z0-9\-]+)/i);
    if (subMatch) data.subscriberId = subMatch[1];

    // Effective date
    const effMatch = text.match(/effective\s*(?:date)?\s*:?\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i);
    if (effMatch) data.effectiveStart = effMatch[1];

    // Waiting periods (best-effort)
    const wpMatches = text.matchAll(/waiting\s*period\s*:?\s*(.{5,60}?)(?:\n|$)/gi);
    data.waitingPeriods = [];
    for (const wpm of wpMatches) {
      data.waitingPeriods.push({ category: "General", period: wpm[1].trim() });
    }

    // Collect notes-like lines (limitations, exclusions, missing tooth clause)
    data.notes = [];
    const notePatterns = [
      /missing\s*tooth\s*clause[:\s]*(.{5,80})/i,
      /limitation[s]?\s*:?\s*(.{5,100})/i,
      /exclusion[s]?\s*:?\s*(.{5,100})/i,
      /downgrade[s]?\s*:?\s*(.{5,80})/i,
      /pre[- ]?authorization[:\s]*(.{5,80})/i,
      /pre[- ]?determination[:\s]*(.{5,80})/i,
    ];
    for (const pat of notePatterns) {
      const m = text.match(pat);
      if (m) data.notes.push(m[0].trim());
    }

    return data;
  },

  /**
   * Try to find a frequency value near a keyword.
   */
  _parseFrequencyText(text, keywordPattern) {
    const re = new RegExp(
      `(?:${keywordPattern})\\s*(?:[:\\-–])?\\s*` +
      `(\\d+\\s*(?:per|every|each|times|x)?\\s*(?:calendar|benefit)?\\s*(?:year|yr|months?|mo|mos)?)`,
      "i"
    );
    const m = text.match(re);
    return m ? m[1].trim() : null;
  },

  // ── Matcher helpers for table cells ─────────────────────

  _matchCoverage(data, label, value) {
    const pct = this._extractPct(value);
    if (pct === null) return;

    const map = {
      diagnostic:    /diagnostic/i,
      preventive:    /preventive/i,
      basic:         /basic/i,
      major:         /major/i,
      endodontics:   /endodontic/i,
      periodontics:  /periodontic/i,
      oralSurgery:   /oral\s*surgery/i,
      prosthodontics: /prosthodontic/i,
      implants:      /implant/i,
      orthodontics:  /orthodontic|ortho/i,
    };

    for (const [key, regex] of Object.entries(map)) {
      if (regex.test(label)) {
        data[`coverage${key.charAt(0).toUpperCase() + key.slice(1)}`] = pct;
      }
    }
  },

  _matchDeductible(data, label, value) {
    if (!/deductible/i.test(label)) return;
    const amt = this._extractMoney(value);
    if (!amt) return;

    if (/family|fam/i.test(label)) {
      data.deductibleFamily = amt;
    } else {
      data.deductibleIndividual = amt;
    }
  },

  _matchAnnualMax(data, label, value) {
    if (!/annual|max|maximum|calendar\s*year/i.test(label)) return;
    const amt = this._extractMoney(value);
    if (!amt) return;

    if (/family|fam/i.test(label)) {
      data.annualMaxFamily = amt;
    } else {
      data.annualMaxIndividual = amt;
    }
  },

  _matchFrequency(data, label, value) {
    const map = {
      prophy: /prophy|prophylaxis|cleaning/i,
      exam:   /exam|examination/i,
      bwx:    /bitewing|bwx/i,
      fmx:    /fmx|full\s*mouth/i,
      pano:   /panoramic|pano/i,
    };
    for (const [key, regex] of Object.entries(map)) {
      if (regex.test(label) && value) {
        data[`freq${key.charAt(0).toUpperCase() + key.slice(1)}`] = value;
      }
    }
  },

  _matchPlanInfo(data, label, value) {
    if (/carrier|payer|insurance\s*co/i.test(label) && value) {
      data.payer = value;
    }
    if (/plan\s*(?:name|type)/i.test(label) && value) {
      if (/PPO|HMO|DHMO|Indemnity/i.test(value)) {
        data.planType = value.match(/PPO|HMO|DHMO|Indemnity/i)?.[0]?.toUpperCase();
      }
      data.planName = value;
    }
    if (/group\s*(?:#|num|no)/i.test(label) && value) {
      data.groupNumber = value;
    }
    if (/subscriber\s*(?:id|#|num)/i.test(label) && value) {
      data.subscriberId = value;
    }
  },

  // ── Utility ─────────────────────────────────────────────

  _extractPct(str) {
    const m = String(str).match(/(\d{1,3})\s*%/);
    return m ? Number(m[1]) : null;
  },

  _extractMoney(str) {
    const m = String(str).match(/\$?\s*([0-9,]+(?:\.\d{2})?)/);
    return m ? m[1].replace(/,/g, "") : null;
  },
};

window.PracticePilot = PracticePilot;
