// ============================================================
// PracticePilot — Action Engine
// ============================================================
// Takes a patient context (built incrementally from Curve tabs)
// and generates a smart, prioritized action list.
//
// Rules:
//   - Only surface ACTIONABLE items (not data already visible)
//   - Prioritize: critical > recommended > informational
//   - Cross-reference insurance coverage with scheduled codes
//   - Flag gaps, risks, and missing setup
// ============================================================

var PracticePilot = window.PracticePilot || {};

PracticePilot.actionEngine = {

  PRIORITY: { CRITICAL: 1, ACTION: 2, RECOMMENDED: 3, INFO: 4 },

  PRIORITY_LABELS: {
    1: "critical",
    2: "action",
    3: "recommended",
    4: "info",
  },

  /**
   * Generate prioritized action list from patient context.
   * @param {Object} ctx - Patient context from patientContext.scanAndMerge()
   * @param {Object} [benefitCard] - Cached benefit card (if available)
   * @returns {Array<{id, priority, icon, title, detail, category}>}
   */
  generate(ctx, benefitCard = null) {
    if (!ctx) return [];

    const actions = [];
    let id = 1;

    const add = (priority, icon, title, detail, category) => {
      actions.push({ id: id++, priority, icon, title, detail, category });
    };

    // ── Insurance checks ─────────────────────────────────

    if (ctx.tabsScanned.includes("insurance")) {
      if (!ctx.insurance.carrier) {
        add(this.PRIORITY.CRITICAL, "🚨", "No insurance on file",
          "Add insurance information before treatment.",
          "insurance");
      } else {
        // Check verification recency
        if (ctx.insurance.lastVerified) {
          const verifiedDate = this._parseLooseDate(ctx.insurance.lastVerified);
          if (verifiedDate) {
            const daysSince = Math.floor((Date.now() - verifiedDate.getTime()) / 86400000);
            if (daysSince > 30) {
              add(this.PRIORITY.ACTION, "🔄", "Insurance not verified recently",
                `Last verified ${daysSince} days ago. Re-verify before treatment.`,
                "insurance");
            }
          }
        }

        if (!benefitCard && !ctx.insurance.hasMaxDeductInfo) {
          add(this.PRIORITY.RECOMMENDED, "📋", "Run eligibility check",
            `Verify ${ctx.insurance.carrier} benefits — no detailed breakdown cached.`,
            "insurance");
        }
      }
    } else {
      add(this.PRIORITY.RECOMMENDED, "👁️", "Review Insurance tab",
        "Open Insurance tab to check coverage status.",
        "insurance");
    }

    // ── Billing checks ───────────────────────────────────

    if (ctx.tabsScanned.includes("billing")) {
      if (ctx.billing.hasBalance) {
        add(this.PRIORITY.ACTION, "💰", "Outstanding balance",
          `Patient owes $${ctx.billing.balance}. Discuss before treatment.`,
          "billing");
      }
      if (ctx.billing.hasOwingInvoices) {
        add(this.PRIORITY.ACTION, "📄", "Unpaid invoices on file",
          "Review and collect on owing invoices.",
          "billing");
      }
      // No balance = good, no action needed (don't show "balance is $0" — that's duplicative)
    }

    // ── Recare checks ────────────────────────────────────

    if (ctx.tabsScanned.includes("recare")) {
      if (ctx.recare.noRecareFound) {
        add(this.PRIORITY.RECOMMENDED, "📅", "Set up recare schedule",
          "No recall appointments configured. Set 6-month recare after today's visit.",
          "recare");
      }
    }

    // ── Forms checks ─────────────────────────────────────

    if (ctx.tabsScanned.includes("forms")) {
      if (ctx.forms.hasPendingForms) {
        add(this.PRIORITY.ACTION, "📝", "Incomplete patient forms",
          "Have patient complete outstanding forms before treatment.",
          "forms");
      }
      // Completed forms = good, don't duplicate (Curve shows the green checks)
    }

    // ── Today's appointment ──────────────────────────────

    if (ctx.todayAppt) {
      const appt = ctx.todayAppt;

      if (appt.isNewPatient) {
        add(this.PRIORITY.INFO, "🆕", "New patient visit",
          "Ensure comprehensive exam (D0150), health history review, and full mouth series.",
          "appointment");
      }

      // Cross-reference scheduled codes with insurance
      if (appt.codes?.length && benefitCard) {
        const coverageIssues = this._checkCodeCoverage(appt.codes, benefitCard, ctx.profile?.age);
        for (const issue of coverageIssues) {
          add(issue.priority, issue.icon, issue.title, issue.detail, "coverage");
        }
      } else if (appt.codes?.length && !benefitCard) {
        add(this.PRIORITY.RECOMMENDED, "🔍", "Verify coverage for today's codes",
          `Scheduled: ${appt.codes.join(", ")} — run eligibility to confirm coverage.`,
          "coverage");
      }
    }

    // ── Charting checks ──────────────────────────────────

    if (ctx.tabsScanned.includes("charting")) {
      if (ctx.charting.hasUnscheduledTx && !ctx.charting.noVisits) {
        add(this.PRIORITY.RECOMMENDED, "🗓️", "Unscheduled treatment pending",
          "Patient has accepted treatment that hasn't been scheduled yet.",
          "charting");
      }
    }

    // ── Age-based clinical reminders ─────────────────────

    if (ctx.profile.age !== undefined) {
      const age = ctx.profile.age;

      if (age <= 18) {
        add(this.PRIORITY.INFO, "👶", "Pediatric/adolescent patient",
          "Check sealant eligibility and fluoride coverage age limits.",
          "clinical");
      }

      if (age >= 18 && this._codesInclude(ctx.todayAppt?.codes, "D1206")) {
        // Fluoride for adults — many plans don't cover over 18
        if (benefitCard) {
          const freqFluoride = benefitCard.frequencies?.fluoride || "";
          const ageLimits = benefitCard.ageLimits || [];
          const fluorideLimit = ageLimits.find(a =>
            /fluoride/i.test(a.service)
          );
          if (fluorideLimit) {
            add(this.PRIORITY.ACTION, "⚠️", "Fluoride age limit",
              `Plan limits fluoride: ${fluorideLimit.limit}. Patient is ${age}.`,
              "coverage");
          }
        } else {
          add(this.PRIORITY.RECOMMENDED, "⚠️", "Verify fluoride coverage",
            `Patient is ${age} — many plans limit fluoride to age 18 or under.`,
            "coverage");
        }
      }

      if (age >= 65) {
        add(this.PRIORITY.INFO, "📋", "Senior patient considerations",
          "Check for Medicare dental coverage, dry mouth assessment, perio risk.",
          "clinical");
        }
    }

    // ── Perio checks ─────────────────────────────────────

    if (ctx.tabsScanned.includes("perio") && ctx.perio.hasPerioData) {
      add(this.PRIORITY.INFO, "🦷", "Perio data on file",
        "Review perio charting for maintenance interval — does prophy vs. perio maint apply?",
        "clinical");
    }

    // ── Data completeness ────────────────────────────────

    const importantTabs = ["profile", "insurance", "billing", "recare", "forms"];
    const missing = importantTabs.filter(t => !ctx.tabsScanned.includes(t));
    if (missing.length > 0 && missing.length < importantTabs.length) {
      add(this.PRIORITY.INFO, "📂", "More tabs to scan",
        `Open these tabs to build a complete picture: ${missing.join(", ")}.`,
        "system");
    }

    // Sort by priority
    actions.sort((a, b) => a.priority - b.priority);

    return actions;
  },

  // ── Coverage cross-reference ───────────────────────────

  _checkCodeCoverage(codes, card, patientAge) {
    const issues = [];

    for (const code of codes) {
      const cdtEntry = PracticePilot.cdtCodes?.lookup(code);
      if (!cdtEntry) continue;

      const covPct = PracticePilot.cdtCodes?.getCoverage(code, card);

      if (covPct === 0) {
        issues.push({
          priority: this.PRIORITY.CRITICAL,
          icon: "🚫",
          title: `${code} not covered`,
          detail: `${cdtEntry.name} — insurance pays 0%. Discuss cost with patient.`,
        });
      } else if (covPct !== null && covPct < 80) {
        issues.push({
          priority: this.PRIORITY.ACTION,
          icon: "💲",
          title: `${code} only ${covPct}% covered`,
          detail: `${cdtEntry.name} — patient pays ${100 - covPct}%. Confirm patient is aware.`,
        });
      }

      // Check non-covered list
      if (card.nonCovered?.length) {
        const category = cdtEntry.section || "";
        const isExcluded = card.nonCovered.some(nc =>
          category.toLowerCase().includes(nc.toLowerCase()) ||
          nc.toLowerCase().includes(code.toLowerCase())
        );
        if (isExcluded) {
          issues.push({
            priority: this.PRIORITY.CRITICAL,
            icon: "🚫",
            title: `${code} may be excluded`,
            detail: `${cdtEntry.name} appears in non-covered services list.`,
          });
        }
      }
    }

    return issues;
  },

  // ── Helpers ────────────────────────────────────────────

  _codesInclude(codes, target) {
    return codes?.includes(target) || false;
  },

  _parseLooseDate(str) {
    // "Feb 19, 2026 at 3:24PM by Eesha Vora" → Date
    const cleaned = str.replace(/\s+at\s+.*/i, "").replace(/\s+by\s+.*/i, "").trim();
    const d = new Date(cleaned);
    return isNaN(d.getTime()) ? null : d;
  },
};

window.PracticePilot = PracticePilot;
