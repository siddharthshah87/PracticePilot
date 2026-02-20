// ============================================================
// PracticePilot — Benefit Card Normalization
// ============================================================
// Normalizes raw extracted data into a consistent BenefitCard
// object that the rest of the extension consumes.
// ============================================================

const PracticePilot = window.PracticePilot || {};

PracticePilot.normalize = {

  /**
   * Takes raw extracted fields and returns a clean BenefitCard.
   * Missing fields default to null so downstream code can check presence.
   */
  benefitCard(raw) {
    return {
      capturedAt: new Date().toISOString(),
      sourceUrl: raw.sourceUrl ?? window.location.href,

      // Patient identity (captured locally, never sent to LLM)
      patientName: raw.patientName ?? null,

      // Plan identification
      payer:       raw.payer       ?? null,
      planName:    raw.planName    ?? null,
      planType:    raw.planType    ?? null,   // PPO / HMO / DHMO / Indemnity
      groupNumber: raw.groupNumber ?? null,
      subscriberId: raw.subscriberId ?? null,

      // Dates
      effective: {
        start: raw.effectiveStart ?? null,
        end:   raw.effectiveEnd   ?? null,
      },

      // Financial
      deductible: {
        individual:      raw.deductibleIndividual     ?? null,
        family:          raw.deductibleFamily         ?? null,
        remaining:       raw.deductibleRemaining      ?? null,
        appliesTo:       raw.deductibleAppliesTo      ?? null, // e.g. "Basic & Major"
      },
      annualMax: {
        individual:      raw.annualMaxIndividual      ?? null,
        family:          raw.annualMaxFamily           ?? null,
        remaining:       raw.annualMaxRemaining        ?? null,
      },

      // Coverage Table — CDT code range categories
      // Each row: { category, cdtRange, inNetwork, outOfNetwork }
      coverageTable: raw.coverageTable ?? [
        { category: "Diagnostic",                  cdtRange: "D0100-D0999", inNetwork: raw.coverageDiagnostic     ?? null, outOfNetwork: null },
        { category: "Preventive",                   cdtRange: "D1000-D1999", inNetwork: raw.coveragePreventive     ?? null, outOfNetwork: null },
        { category: "Restorative",                  cdtRange: "D2000-D2399", inNetwork: raw.coverageRestorative    ?? null, outOfNetwork: null },
        { category: "Crowns",                       cdtRange: "D2400-D2999", inNetwork: raw.coverageCrowns         ?? null, outOfNetwork: null },
        { category: "Endodontics",                  cdtRange: "D3000-D3999", inNetwork: raw.coverageEndodontics    ?? null, outOfNetwork: null },
        { category: "Periodontics",                 cdtRange: "D4000-D4999", inNetwork: raw.coveragePeriodontics   ?? null, outOfNetwork: null },
        { category: "Prosthodontics, Removable",    cdtRange: "D5000-D5899", inNetwork: raw.coverageProsthodonticsRemovable ?? null, outOfNetwork: null },
        { category: "Maxillofacial Prosthetics",    cdtRange: "D5900-D5999", inNetwork: raw.coverageMaxillofacial  ?? null, outOfNetwork: null },
        { category: "Implant Services",             cdtRange: "D6000-D6199", inNetwork: raw.coverageImplants       ?? null, outOfNetwork: null },
        { category: "Prosthodontics, Fixed",        cdtRange: "D6200-D6999", inNetwork: raw.coverageProsthodonticsFixed ?? null, outOfNetwork: null },
        { category: "Oral & Maxillofacial Surgery", cdtRange: "D7000-D7999", inNetwork: raw.coverageOralSurgery    ?? null, outOfNetwork: null },
        { category: "Orthodontics",                 cdtRange: "D8000-D8999", inNetwork: raw.coverageOrthodontics   ?? null, outOfNetwork: null },
        { category: "Adjunctive General Services",  cdtRange: "D9000-D9999", inNetwork: raw.coverageAdjunctive     ?? null, outOfNetwork: null },
      ],

      // Exceptions — procedures that differ from their category rate
      coverageExceptions: raw.coverageExceptions ?? [],

      // Legacy flat coverage (for quick access)
      coverage: {
        diagnostic:      raw.coverageDiagnostic       ?? null,
        preventive:      raw.coveragePreventive       ?? null,
        restorative:     raw.coverageRestorative       ?? null,
        crowns:          raw.coverageCrowns             ?? null,
        endodontics:     raw.coverageEndodontics       ?? null,
        periodontics:    raw.coveragePeriodontics      ?? null,
        oralSurgery:     raw.coverageOralSurgery       ?? null,
        prosthodonticsRem: raw.coverageProsthodonticsRemovable ?? null,
        maxillofacial:   raw.coverageMaxillofacial     ?? null,
        implants:        raw.coverageImplants           ?? null,
        prosthodonticsFix: raw.coverageProsthodonticsFixed ?? null,
        orthodontics:    raw.coverageOrthodontics       ?? null,
        adjunctive:      raw.coverageAdjunctive         ?? null,
      },

      // Frequencies
      frequencies: {
        prophy:   raw.freqProphy   ?? null,  // e.g. "2 per calendar year"
        exam:     raw.freqExam     ?? null,
        bwx:      raw.freqBwx      ?? null,
        fmx:     raw.freqFmx      ?? null,
        pano:    raw.freqPano     ?? null,
        sealants: raw.freqSealants ?? null,
        fluoride: raw.freqFluoride ?? null,
      },

      // Waiting periods
      waitingPeriods: raw.waitingPeriods ?? [],  // [{category, period}]

      // Special clauses / limitations
      notes: raw.notes ?? [],  // free-text array

      // Confidence flags — which fields came from reliable extraction vs guessing
      confidence: raw.confidence ?? {},
    };
  },

  /**
   * Returns an array of "missing / unverified" items for a BenefitCard.
   */
  missingItems(card) {
    const missing = [];

    if (!card.payer)                       missing.push("Carrier / payer name");
    if (!card.planType)                    missing.push("Plan type (PPO / HMO)");
    if (!card.groupNumber)                 missing.push("Group number");
    if (!card.subscriberId)                missing.push("Subscriber ID");
    if (!card.deductible.individual)       missing.push("Individual deductible");
    if (!card.annualMax.individual)        missing.push("Annual maximum");
    if (!card.coverage.preventive && card.coverage.preventive !== 0)
                                           missing.push("Preventive coverage %");
    if (!card.coverage.restorative && card.coverage.restorative !== 0)
                                           missing.push("Restorative coverage %");
    if (!card.coverage.crowns && card.coverage.crowns !== 0)
                                           missing.push("Crowns coverage %");
    if (!card.frequencies.prophy)           missing.push("Prophy frequency");
    if (!card.frequencies.exam)            missing.push("Exam frequency");
    if (!card.frequencies.bwx)             missing.push("BWX frequency");
    if (!card.effective.start)             missing.push("Effective date");

    return missing;
  },
};

window.PracticePilot = PracticePilot;
