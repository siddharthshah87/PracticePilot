// ============================================================
// PracticePilot — Page Detector
// ============================================================
// Detects which page type the user is currently viewing.
// Works on Curve Dental AND insurance company portals.
// Returns a page type string used to activate the right behavior.
// ============================================================

const PracticePilot = window.PracticePilot || {};

PracticePilot.pageDetector = {

  // Page types we support
  PAGE_TYPES: {
    ELIGIBILITY:      "eligibility",
    INSURANCE_MODAL:  "insurance_modal",
    INSURER_PORTAL:   "insurer_portal",
    SCHEDULE:         "schedule",
    PATIENT_CHART:    "patient_chart",
    CLAIMS:           "claims",
    UNKNOWN:          "unknown",
  },

  // Known insurer portal domains
  INSURER_DOMAINS: [
    "humana.com", "cigna.com", "deltadental.com", "metlife.com",
    "aetna.com", "uhc.com", "unitedhealthcare.com", "myuhc.com",
    "guardiandirect.com", "guardianlife.com", "anthem.com",
    "bcbs.com", "principal.com", "sunlife.com",
    "lincolnfinancial.com", "ameritas.com", "connectiondental.com",
    "geha.com", "unitedconcordia.com", "dentalxchange.com",
    "availity.com", "trellis.com", "standard.com",
    "reliancestandard.com",
  ],

  /**
   * Detect the current page type.
   * Uses URL patterns + DOM content heuristics.
   */
  detect() {
    const url = window.location.href.toLowerCase();
    const bodyText = document.body?.innerText || "";

    // 1. Eligibility / Benefits page (Curve or any site)
    if (this._isEligibilityPage(url, bodyText)) {
      return this.PAGE_TYPES.ELIGIBILITY;
    }

    // 2. Edit Insurance Plan modal (Curve-specific)
    if (this._isInsuranceModal(bodyText)) {
      return this.PAGE_TYPES.INSURANCE_MODAL;
    }

    // 3. Insurance company portal (Humana, Cigna, etc.)
    if (this._isInsurerPortal(url, bodyText)) {
      return this.PAGE_TYPES.INSURER_PORTAL;
    }

    // 4. Daily schedule (Curve)
    if (this._isSchedulePage(url, bodyText)) {
      return this.PAGE_TYPES.SCHEDULE;
    }

    // 5. Patient chart (Curve)
    if (this._isPatientChart(url, bodyText)) {
      return this.PAGE_TYPES.PATIENT_CHART;
    }

    // 6. Claims (Curve)
    if (this._isClaimsPage(url, bodyText)) {
      return this.PAGE_TYPES.CLAIMS;
    }

    return this.PAGE_TYPES.UNKNOWN;
  },

  _isEligibilityPage(url, text) {
    // URL heuristics
    if (/eligib|e&b|benefit.*check|benefit.*inquiry/i.test(url)) return true;

    // DOM heuristics — look for eligibility-specific content
    const markers = [
      "Eligibility Begin Date",
      "Benefit Level Information",
      "Coverage Level",
      "Eligibility and Benefit",
      "E&B Response",
      "Subscriber Eligibility",
      "Benefit Plan Coverage",
      "Plan Benefits",
      "Benefit Summary",
      "Coverage Summary",
      "In Network Benefits",
      "Out of Network Benefits",
      "Deductible Amount",
      "Annual Maximum",
      "Coinsurance",
    ];
    // Require at least 2 markers for non-Curve pages (avoid false positives)
    const matchCount = markers.filter(m => text.includes(m)).length;
    return matchCount >= 2 || markers.slice(0, 7).some(m => text.includes(m));
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

  _isInsurerPortal(url, text) {
    try {
      const hostname = new URL(url).hostname.toLowerCase();
      return this.INSURER_DOMAINS.some(d => hostname.includes(d));
    } catch {
      return false;
    }
  },

  /**
   * Identify which insurer portal we're on (for display).
   */
  getInsurerName() {
    const url = window.location.href.toLowerCase();
    const hostname = new URL(url).hostname;
    const mappings = {
      "humana":         "Humana",
      "cigna":          "Cigna",
      "deltadental":    "Delta Dental",
      "metlife":        "MetLife",
      "aetna":          "Aetna",
      "uhc":            "UHC",
      "unitedhealthcare": "United Healthcare",
      "myuhc":          "UHC",
      "guardian":        "Guardian",
      "anthem":         "Anthem",
      "bcbs":           "BCBS",
      "principal":       "Principal",
      "sunlife":        "Sun Life",
      "lincoln":        "Lincoln Financial",
      "ameritas":       "Ameritas",
      "geha":           "GEHA",
      "unitedconcordia": "United Concordia",
      "availity":       "Availity",
      "dentalxchange":  "DentalXChange",
      "standard":       "The Standard",
    };
    for (const [key, name] of Object.entries(mappings)) {
      if (hostname.includes(key)) return name;
    }
    return null;
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
