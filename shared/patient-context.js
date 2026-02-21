// ============================================================
// PracticePilot — Patient Context Builder
// ============================================================
// Manages patient context: merges LLM-extracted data into a
// persistent patient profile cached in chrome.storage.local.
//
// Flow (NEW — LLM-powered):
//   1. Page text captured → hash checked (skip if unchanged)
//   2. If new content: LLM extracts context + actions
//   3. Extracted data merged into persisted patient context
//   4. Actions returned directly (no separate action engine)
//
// Flow (FALLBACK — regex):
//   If no API key or LLM call fails, falls back to regex.
// ============================================================

(function() {
var PracticePilot = window.PracticePilot || {};

PracticePilot.patientContext = {

  STORAGE_KEY: "pp:patientContexts",

  // ── Main entry: LLM-first, regex-fallback ────────────────

  /**
   * Scan page text and return { ctx, actions }.
   * Uses LLM if available, falls back to regex parsers.
   */
  async scanAndMerge(pageText, benefitCard = null) {
    if (!pageText || pageText.length < 100) return null;

    // Try LLM extraction first
    const extractor = PracticePilot.llmContextExtractor;
    if (extractor) {
      const llmResult = await extractor.extract(pageText, benefitCard);
      if (llmResult) {
        return this._mergeFromLLM(llmResult);
      }
    }

    // Fallback: regex-based extraction
    return this._regexFallback(pageText);
  },

  // ── LLM result merger ───────────────────────────────────

  async _mergeFromLLM(llmResult) {
    const { patientName, context, actions, hash, fromCache } = llmResult;
    if (!patientName) return null;

    // Load or create patient context
    let ctx = await this.load(patientName) || this._emptyContext(patientName);

    // Merge LLM-extracted sections into persistent context
    const sections = llmResult.context || {};

    // Deep merge each section (LLM data wins over old data for non-null values)
    for (const section of ["profile", "insurance", "billing", "recare", "charting", "perio", "appointments"]) {
      if (sections[section]) {
        ctx[section] = this._deepMerge(ctx[section] || {}, sections[section]);
      }
    }

    // Forms: merge completed list
    if (sections.forms) {
      if (sections.forms.completed?.length) {
        ctx.forms.completed = sections.forms.completed;
      }
      if (sections.forms.hasPendingForms !== undefined) {
        ctx.forms.hasPendingForms = sections.forms.hasPendingForms;
      }
    }

    // Today's appointment
    if (sections.todayAppt) {
      ctx.todayAppt = sections.todayAppt;
    }

    // Track which sections the LLM detected
    // sectionsDetected lives at top level of LLM JSON, passed through as llmResult.sectionsDetected
    const topDetected = llmResult.sectionsDetected || llmResult.context?.sectionsDetected || [];
    for (const s of topDetected) {
      if (!ctx.tabsScanned.includes(s)) {
        ctx.tabsScanned.push(s);
      }
    }

    ctx.lastUpdated = new Date().toISOString();
    ctx._lastHash = hash;
    ctx._fromCache = fromCache;

    await this.save(ctx);

    // Map LLM priority strings to numeric priorities
    const PRIORITY_MAP = { critical: 1, action: 2, recommended: 3, info: 4 };
    const mappedActions = (actions || []).map((a, i) => ({
      id: i + 1,
      priority: PRIORITY_MAP[a.priority] || 4,
      icon: a.icon || "📋",
      title: a.title,
      detail: a.detail,
      category: a.category,
    }));

    return { ctx, actions: mappedActions };
  },

  /**
   * Deep merge source into target. Source values win unless null/undefined.
   */
  _deepMerge(target, source) {
    const result = { ...target };
    for (const [key, value] of Object.entries(source)) {
      if (value === null || value === undefined) continue;
      if (typeof value === "object" && !Array.isArray(value) && typeof result[key] === "object" && result[key] !== null) {
        result[key] = this._deepMerge(result[key], value);
      } else {
        result[key] = value;
      }
    }
    return result;
  },

  // ── Regex Fallback ──────────────────────────────────────
  // Used when LLM is unavailable (no API key, network error)

  async _regexFallback(pageText) {
    const patientName = this._extractPatientName(pageText);
    if (!patientName) return null;

    let ctx = await this.load(patientName) || this._emptyContext(patientName);

    const sections = this._detectVisibleSections(pageText);
    for (const section of sections) {
      const parser = this._parsers[section];
      if (parser) {
        try {
          parser.call(this, pageText, ctx);
          if (!ctx.tabsScanned.includes(section)) {
            ctx.tabsScanned.push(section);
          }
        } catch (e) {
          console.warn(`[PracticePilot] Regex fallback: failed to parse ${section}:`, e);
        }
      }
    }

    ctx.lastUpdated = new Date().toISOString();
    await this.save(ctx);

    // Generate actions via old action engine (if available)
    const actions = PracticePilot.actionEngine?.generate(ctx) || [];
    return { ctx, actions };
  },

  // ── Section detection (for regex fallback) ───────────────

  SECTIONS: {
    profile:     { markers: ["Date of Birth", "Gender", "Cell phone", "Address"] },
    insurance:   { markers: ["Plan Name:", "Carrier Name:", "Policy Details", "Maximums and Deductibles"] },
    billing:     { markers: ["Account Holder", "Invoice #", "Running Balance"] },
    recare:      { markers: ["Recare For", "No recare found", "Recare Due"] },
    charting:    { markers: ["Accepted, Unscheduled", "Filter Visits", "Treatment Plan"] },
    forms:       { markers: ["Health History", "Consent Form", "Filter Forms", "Add Form"] },
    perio:       { markers: ["Perio Charting", "Probing Depths", "Bleeding"] },
  },

  _detectVisibleSections(text) {
    const found = [];
    for (const [section, config] of Object.entries(this.SECTIONS)) {
      const hits = config.markers.filter(m => text.includes(m)).length;
      if (hits >= 1) found.push(section);
    }
    return found;
  },

  // ── Regex parsers (fallback only) ────────────────────────

  _parsers: {
    profile(text, ctx) {
      const gender = text.match(/Gender\s*:\s*\n?\s*(Male|Female|Other|Non-binary)/i);
      if (gender) ctx.profile.gender = gender[1].trim();

      const age = text.match(/Age\s*:\s*(\d+)\s*years?\s*old/i);
      if (age) ctx.profile.age = parseInt(age[1], 10);

      const dob = text.match(/Date of Birth\s*:\s*\n?\s*(\S+)/i);
      if (dob) ctx.profile.dob = dob[1].trim();

      const phone = text.match(/Cell phone\s*:\s*\(?\d{3}\)?\s*[\-\s]?\d{3}[\-\s]?\d{4}/i);
      if (phone) ctx.profile.phone = phone[0].replace(/Cell phone\s*:\s*/i, "").trim();

      const email = text.match(/Email\s*:\s*(\S+@\S+)/i);
      if (email) ctx.profile.email = email[1].trim();
    },

    insurance(text, ctx) {
      const plan = text.match(/Plan Name:\s*([^\n]+)/i);
      if (plan) ctx.insurance.planName = plan[1].trim();

      const carrier = text.match(/Carrier Name:\s*([^\n]+)/i);
      if (carrier) ctx.insurance.carrier = carrier[1].trim();

      const lastUpdated = text.match(/Plan Last Updated:\s*\n?\s*([^\n]+)/i);
      if (lastUpdated) ctx.insurance.lastVerified = lastUpdated[1].trim();

      if (text.includes("Maximums and Deductibles remaining")) {
        ctx.insurance.hasMaxDeductInfo = true;
      }
    },

    billing(text, ctx) {
      const acctHolder = text.match(
        /Account Holder\s+\$([\d,]+\.\d{2})\s+\$([\d,]+\.\d{2})\s+\$([\d,]+\.\d{2})\s+\$([\d,]+\.\d{2})\s+\$([\d,]+\.\d{2})/i
      );
      if (acctHolder) {
        const p = (s) => parseFloat(s.replace(/,/g, ""));
        ctx.billing.aging = {
          past30: acctHolder[1], days31_60: acctHolder[2],
          days61_90: acctHolder[3], over90: acctHolder[4], total: acctHolder[5],
        };
        ctx.billing.balance = acctHolder[5];
        ctx.billing.hasBalance = p(acctHolder[5]) > 0;
        ctx.billing.hasOverdue = p(acctHolder[2]) > 0 || p(acctHolder[3]) > 0 || p(acctHolder[4]) > 0;
      }
    },

    recare(text, ctx) {
      ctx.recare.noRecareFound = text.includes("No recare found");
    },

    charting(text, ctx) {
      ctx.charting.hasUnscheduledTx = text.includes("Accepted, Unscheduled");
      const txCodes = [...text.matchAll(/\b(D\d{4})\b/g)].map(m => m[1]);
      if (txCodes.length > 0) ctx.charting.pendingCodes = [...new Set(txCodes)];
    },

    forms(text, ctx) {
      ctx.forms.hasPendingForms = text.includes("Incomplete") || text.includes("Not Started");
    },

    perio(text, ctx) {
      ctx.perio.hasPerioData = text.includes("Probing Depths") || text.includes("Perio Charting");
    },
  },

  // ── Patient name extraction ──────────────────────────────

  _extractPatientName(text) {
    const UI_LABELS = new Set([
      "summary", "gender", "appointment", "appointments", "insurance",
      "billing", "charting", "forms", "claims", "schedule", "recare",
      "perio", "profile", "settings", "filter", "search", "dashboard",
      "overview", "history", "notes", "treatment", "patient", "clinical",
    ]);

    const curvePattern = text.match(/arrow_drop_down\s*\n\s*([A-Z][a-zA-Z'\-]+(?:\s+[A-Z][a-zA-Z'\-]+){1,3})\s*\n\s*Profile/i);
    if (curvePattern) {
      const candidate = curvePattern[1].trim();
      const words = candidate.toLowerCase().split(/\s+/);
      const isUILabel = words.every(w => UI_LABELS.has(w));
      if (!isUILabel) return candidate;
    }

    return PracticePilot.phiRedactor?.extractPatientName(text) || null;
  },

  // ── Empty context template ───────────────────────────────

  _emptyContext(patientName) {
    return {
      patientName,
      profile: {},
      insurance: {},
      billing: {},
      recare: {},
      charting: {},
      forms: { completed: [], hasPendingForms: false },
      claims: {},
      todayAppt: null,
      perio: {},
      appointments: {},
      tabsScanned: [],
      lastUpdated: null,
      createdAt: new Date().toISOString(),
    };
  },

  // ── Storage ──────────────────────────────────────────────

  async save(ctx) {
    const all = await this._loadAll();
    all[ctx.patientName.toLowerCase()] = ctx;

    const keys = Object.keys(all);
    if (keys.length > 100) {
      const sorted = keys.sort((a, b) =>
        new Date(all[a].lastUpdated) - new Date(all[b].lastUpdated)
      );
      for (const k of sorted.slice(0, keys.length - 100)) delete all[k];
    }

    await chrome.storage.local.set({ [this.STORAGE_KEY]: all });
  },

  async load(patientName) {
    const all = await this._loadAll();
    return all[patientName.toLowerCase()] || null;
  },

  async _loadAll() {
    const result = await chrome.storage.local.get(this.STORAGE_KEY);
    return result[this.STORAGE_KEY] ?? {};
  },

  async clearAll() {
    await chrome.storage.local.remove(this.STORAGE_KEY);
  },
};

window.PracticePilot = PracticePilot;
})();
