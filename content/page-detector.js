// ============================================================
// PracticePilot — Page Detector
// ============================================================
// Detects which Curve page type the user is currently viewing.
// Returns a page type string used to activate the right behavior.
// ============================================================

const PracticePilot = window.PracticePilot || {};

PracticePilot.pageDetector = {

  // Page types we support
  PAGE_TYPES: {
    ELIGIBILITY:     "eligibility",
    INSURANCE_MODAL: "insurance_modal",
    SCHEDULE:        "schedule",
    PATIENT_CHART:   "patient_chart",
    CLAIMS:          "claims",
    UNKNOWN:         "unknown",
  },

  /**
   * Detect the current page type.
   * Uses URL patterns + DOM content heuristics.
   */
  detect() {
    const url = window.location.href.toLowerCase();
    const bodyText = document.body?.innerText || "";

    // 1. Eligibility / Benefits page
    if (this._isEligibilityPage(url, bodyText)) {
      return this.PAGE_TYPES.ELIGIBILITY;
    }

    // 2. Edit Insurance Plan modal (from the screenshot)
    if (this._isInsuranceModal(bodyText)) {
      return this.PAGE_TYPES.INSURANCE_MODAL;
    }

    // 3. Daily schedule
    if (this._isSchedulePage(url, bodyText)) {
      return this.PAGE_TYPES.SCHEDULE;
    }

    // 4. Patient chart
    if (this._isPatientChart(url, bodyText)) {
      return this.PAGE_TYPES.PATIENT_CHART;
    }

    // 5. Claims
    if (this._isClaimsPage(url, bodyText)) {
      return this.PAGE_TYPES.CLAIMS;
    }

    return this.PAGE_TYPES.UNKNOWN;
  },

  _isEligibilityPage(url, text) {
    // URL heuristics
    if (/eligib|e&b|benefit.*check/i.test(url)) return true;

    // DOM heuristics — look for eligibility-specific content
    const markers = [
      "Eligibility Begin Date",
      "Benefit Level Information",
      "Coverage Level",
      "Eligibility and Benefit",
      "E&B Response",
      "Subscriber Eligibility",
      "Benefit Plan Coverage",
    ];
    return markers.some(m => text.includes(m));
  },

  _isInsuranceModal(text) {
    // The modal from the screenshot has these markers
    return (
      text.includes("Edit Insurance Plan") &&
      (text.includes("Coverage Table Summary") || text.includes("Plan Information"))
    );
  },

  _isSchedulePage(url, text) {
    if (/schedule|appointment|calendar/i.test(url)) return true;
    return text.includes("Today's Schedule") || text.includes("Appointment List");
  },

  _isPatientChart(url, text) {
    if (/patient.*chart|chart.*patient/i.test(url)) return true;
    return text.includes("Patient Chart") || text.includes("Treatment Plan");
  },

  _isClaimsPage(url, text) {
    if (/claim|billing/i.test(url)) return true;
    return text.includes("Claims Aging") || text.includes("Claim Status");
  },

  /**
   * Watch for page / SPA navigation changes and re-detect.
   * Calls the callback with the new page type.
   */
  watch(callback) {
    // Initial detection
    let lastType = this.detect();
    callback(lastType);

    // MutationObserver for SPA navigation (modals opening, content changes)
    const observer = new MutationObserver(() => {
      const newType = this.detect();
      if (newType !== lastType) {
        lastType = newType;
        callback(newType);
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    // Also watch for URL changes (pushState/popState)
    let lastUrl = window.location.href;
    const urlCheck = setInterval(() => {
      if (window.location.href !== lastUrl) {
        lastUrl = window.location.href;
        const newType = this.detect();
        if (newType !== lastType) {
          lastType = newType;
          callback(newType);
        }
      }
    }, 1000);

    // Return cleanup function
    return () => {
      observer.disconnect();
      clearInterval(urlCheck);
    };
  },
};

window.PracticePilot = PracticePilot;
