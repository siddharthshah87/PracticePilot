// ============================================================
// PracticePilot — Patient Context Builder
// ============================================================
// Incrementally builds a patient profile as Curve Hero tabs
// are opened. Each tab scan adds data without duplicating.
// Cached in chrome.storage.local keyed by patient name.
//
// Flow:
//   1. Page text captured on each Curve tab/view
//   2. Parser identifies which Curve section is visible
//   3. Relevant data extracted and merged into context
//   4. Context cached — persists across page loads
// ============================================================

(function() {
var PracticePilot = window.PracticePilot || {};

PracticePilot.patientContext = {

  STORAGE_KEY: "pp:patientContexts",

  // ── Section detectors + parsers ──────────────────────────

  SECTIONS: {
    profile:     { markers: ["Date of Birth", "Gender", "Rel. to HOH", "Cell phone", "Address"] },
    insurance:   { markers: ["Plan Name:", "Carrier Name:", "Policy Details", "Maximums and Deductibles"] },
    billing:     { markers: ["credit balance", "Owing Invoice", "Patient\tInsurance\tTotal"] },
    recare:      { markers: ["Recare For", "No recare found", "Recare Due"] },
    charting:    { markers: ["Accepted, Unscheduled", "Filter Visits", "Treatment Plan"] },
    forms:       { markers: ["Health History", "Consent Form", "Filter Forms", "Add Form"] },
    claims:      { markers: ["Filtering for All claims", "Eligibility\tProcessed"] },
    schedule:    { markers: ["New Patient", "Existing Patient", "am -", "pm -"] },
    perio:       { markers: ["Perio Charting", "Probing Depths", "Bleeding"] },
    appointments:{ markers: ["Appointments", "Scheduled", "Confirmed"] },
  },

  /**
   * Detect which Curve Hero sections are visible in the page text.
   */
  detectVisibleSections(text) {
    const found = [];
    for (const [section, config] of Object.entries(this.SECTIONS)) {
      const hits = config.markers.filter(m => text.includes(m)).length;
      if (hits >= 1) found.push(section);
    }
    return found;
  },

  // ── Main extraction: scan page text, merge into context ──

  /**
   * Scan current page text and merge extracted data into patient context.
   * Returns the updated context.
   */
  async scanAndMerge(pageText) {
    // 1. Try to identify the patient
    const patientName = this._extractPatientName(pageText);
    if (!patientName) return null;

    // 2. Load existing context or create new
    let ctx = await this.load(patientName) || this._emptyContext(patientName);

    // 3. Detect which sections are visible
    const sections = this.detectVisibleSections(pageText);

    // 4. Extract data from each visible section
    for (const section of sections) {
      const parser = this._parsers[section];
      if (parser) {
        try {
          parser.call(this, pageText, ctx);
          if (!ctx.tabsScanned.includes(section)) {
            ctx.tabsScanned.push(section);
          }
        } catch (e) {
          console.warn(`[PracticePilot] Failed to parse ${section}:`, e);
        }
      }
    }

    // 5. Update timestamp and save
    ctx.lastUpdated = new Date().toISOString();
    await this.save(ctx);

    return ctx;
  },

  // ── Section parsers ──────────────────────────────────────

  _parsers: {
    profile(text, ctx) {
      // Gender
      const gender = text.match(/Gender\s*:\s*\n?\s*(Male|Female|Other|Non-binary)/i);
      if (gender) ctx.profile.gender = gender[1].trim();

      // Age
      const age = text.match(/Age\s*:\s*(\d+)\s*years?\s*old/i);
      if (age) ctx.profile.age = parseInt(age[1], 10);

      // DOB
      const dob = text.match(/Date of Birth\s*:\s*\n?\s*(\S+)/i);
      if (dob) ctx.profile.dob = dob[1].trim();

      // Phone
      const phone = text.match(/Cell phone\s*:\s*\(?\d{3}\)?\s*[\-\s]?\d{3}[\-\s]?\d{4}/i);
      if (phone) ctx.profile.phone = phone[0].replace(/Cell phone\s*:\s*/i, "").trim();

      // Email
      const email = text.match(/Email\s*:\s*(\S+@\S+)/i);
      if (email) ctx.profile.email = email[1].trim();

      // HOH
      const hoh = text.match(/HOH\s*:\s*([^\n]+)/i);
      if (hoh) ctx.profile.hoh = hoh[1].trim();

      // Rel to HOH
      const rel = text.match(/Rel\.\s*to\s*HOH\s*:\s*\n?\s*(\S+)/i);
      if (rel) ctx.profile.relToHOH = rel[1].trim();

      // Language
      const lang = text.match(/Language\s*:\s*\n?\s*(\w+)/i);
      if (lang) ctx.profile.language = lang[1].trim();
    },

    insurance(text, ctx) {
      const plan = text.match(/Plan Name:\s*([^\n]+)/i);
      if (plan) ctx.insurance.planName = plan[1].trim();

      const carrier = text.match(/Carrier Name:\s*([^\n]+)/i);
      if (carrier) ctx.insurance.carrier = carrier[1].trim();

      const lastUpdated = text.match(/Plan Last Updated:\s*\n?\s*([^\n]+)/i);
      if (lastUpdated) ctx.insurance.lastVerified = lastUpdated[1].trim();

      // Check if maximums/deductibles info is present
      if (text.includes("Maximums and Deductibles remaining")) {
        ctx.insurance.hasMaxDeductInfo = true;
      }
    },

    billing(text, ctx) {
      const balance = text.match(/(?:credit )?balance of\s*\$?([\d,]+\.\d{2})/i);
      if (balance) {
        ctx.billing.balance = balance[1];
        ctx.billing.hasBalance = parseFloat(balance[1].replace(",", "")) > 0;
      }

      ctx.billing.hasOwingInvoices = !text.includes("no owing invoices");

      // Parse totals
      const totals = text.match(/Total\s+\$([\d,]+\.\d{2})\s+\$([\d,]+\.\d{2})\s+\$([\d,]+\.\d{2})/i);
      if (totals) {
        ctx.billing.patientTotal = totals[1];
        ctx.billing.insuranceTotal = totals[2];
        ctx.billing.grandTotal = totals[3];
      }
    },

    recare(text, ctx) {
      ctx.recare.noRecareFound = text.includes("No recare found");
      if (!ctx.recare.noRecareFound) {
        // Try to extract recare info
        const recareDue = text.match(/Recare\s*(?:Due|Next)\s*:?\s*([^\n]+)/i);
        if (recareDue) ctx.recare.nextDue = recareDue[1].trim();
      }
    },

    charting(text, ctx) {
      ctx.charting.noVisits = text.includes("No visits to display");
      ctx.charting.hasUnscheduledTx = text.includes("Accepted, Unscheduled");

      // Look for treatment plan items — CDT codes
      const txCodes = [...text.matchAll(/\b(D\d{4})\b/g)].map(m => m[1]);
      if (txCodes.length > 0) {
        // Deduplicate
        ctx.charting.pendingCodes = [...new Set(txCodes)];
      }
    },

    forms(text, ctx) {
      // Extract completed forms
      const formPattern = /keyboard_arrow_right\s*\n?\s*([^\n]+)\s*\n?\s*Completed:\s*([^\n]+)/gi;
      const forms = [];
      let match;
      while ((match = formPattern.exec(text)) !== null) {
        forms.push({
          name: match[1].trim(),
          completedDate: match[2].trim(),
        });
      }
      if (forms.length > 0) {
        ctx.forms.completed = forms;
      }

      // Check for pending/incomplete forms
      ctx.forms.hasPendingForms = text.includes("Incomplete") || text.includes("Not Started");
    },

    claims(text, ctx) {
      // Check for recent eligibility check
      const eligCheck = text.match(/(\d{4}-\d{2}-\d{2})\s+(\w+)\s*\n?\s*Eligibility\s+Processed/i);
      if (eligCheck) {
        ctx.claims.lastEligibilityCheck = {
          date: eligCheck[1],
          carrier: eligCheck[2],
        };
      }
    },

    schedule(text, ctx) {
      // Parse today's appointments for this patient
      // Look for appointment blocks with CDT codes
      const apptPattern = /(\d{1,2}:\d{2}\s*[ap]m)\s*-\s*(\d{1,2}:\d{2}\s*[ap]m)\s*\*?\s*\n?\s*([^\n]*(?:NP)?[^\n]*)\s*\n?\s*((?:New|Existing)\s+Patient[^\n]*)/gi;
      let apptMatch;
      while ((apptMatch = apptPattern.exec(text)) !== null) {
        const apptName = apptMatch[3].trim();
        const apptDetail = apptMatch[4].trim();

        // Extract CDT codes from the detail line
        const codes = [...apptDetail.matchAll(/\b(D\d{4})\b/g)].map(m => m[1]);

        ctx.todayAppt = {
          startTime: apptMatch[1].trim(),
          endTime: apptMatch[2].trim(),
          type: apptDetail.split(".")[0].trim(),
          isNewPatient: /\(NP\)|New Patient/i.test(apptName + " " + apptDetail),
          codes: [...new Set(codes)],
          raw: apptDetail,
        };
      }
    },

    perio(text, ctx) {
      ctx.perio.hasPerioData = text.includes("Probing Depths") || text.includes("Perio Charting");
    },

    appointments(text, ctx) {
      // Count upcoming appointments
      const scheduled = (text.match(/Scheduled/gi) || []).length;
      const confirmed = (text.match(/Confirmed/gi) || []).length;
      ctx.appointments.scheduledCount = scheduled;
      ctx.appointments.confirmedCount = confirmed;
    },
  },

  // ── Patient name extraction ──────────────────────────────

  _extractPatientName(text) {
    // Known Curve UI labels that can appear before "Profile" and look like names
    const UI_LABELS = new Set([
      "summary", "gender", "appointment", "appointments", "insurance",
      "billing", "charting", "forms", "claims", "schedule", "recare",
      "perio", "profile", "settings", "filter", "search", "dashboard",
      "overview", "history", "notes", "treatment", "patient", "clinical",
    ]);

    // Curve sidebar shows patient name prominently after queue/search
    // Pattern: "arrow_drop_down\n{PatientName}\nProfile"
    const curvePattern = text.match(/arrow_drop_down\s*\n\s*([A-Z][a-zA-Z'\-]+(?:\s+[A-Z][a-zA-Z'\-]+){1,3})\s*\n\s*Profile/i);
    if (curvePattern) {
      const candidate = curvePattern[1].trim();
      const words = candidate.toLowerCase().split(/\s+/);
      const isUILabel = words.every(w => UI_LABELS.has(w));
      if (!isUILabel) return candidate;
    }

    // Fallback: PHI redactor's extractor
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

    // Keep max 100 patient contexts, evict oldest
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
