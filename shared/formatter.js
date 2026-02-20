// ============================================================
// PracticePilot — Verification Note Formatter
// ============================================================
// Generates copy-ready text blocks from a BenefitCard.
// ============================================================

const PracticePilot = window.PracticePilot || {};

PracticePilot.formatter = {

  /**
   * Generates a standard verification note from a BenefitCard.
   */
  verificationNote(card) {
    const lines = [];
    const today = new Date().toLocaleDateString("en-US", {
      month: "2-digit", day: "2-digit", year: "numeric",
    });

    lines.push(`══════════════════════════════════`);
    lines.push(`INSURANCE VERIFICATION — ${today}`);
    lines.push(`══════════════════════════════════`);

    // Plan info
    if (card.payer)       lines.push(`Carrier:       ${card.payer}`);
    if (card.planName)    lines.push(`Plan:          ${card.planName}`);
    if (card.planType)    lines.push(`Type:          ${card.planType}`);
    if (card.groupNumber) lines.push(`Group #:       ${card.groupNumber}`);
    if (card.subscriberId) lines.push(`Subscriber ID: ${card.subscriberId}`);

    if (card.effective.start || card.effective.end) {
      const eff = [card.effective.start, card.effective.end].filter(Boolean).join(" — ");
      lines.push(`Effective:     ${eff}`);
    }

    lines.push("");

    // Deductible
    const ded = card.deductible;
    if (ded.individual || ded.family) {
      lines.push(`── Deductible ──`);
      if (ded.individual) lines.push(`  Individual:  $${ded.individual}`);
      if (ded.family)     lines.push(`  Family:      $${ded.family}`);
      if (ded.remaining)  lines.push(`  Remaining:   $${ded.remaining}`);
      if (ded.appliesTo)  lines.push(`  Applies to:  ${ded.appliesTo}`);
      lines.push("");
    }

    // Annual Max
    const max = card.annualMax;
    if (max.individual || max.family) {
      lines.push(`── Annual Maximum ──`);
      if (max.individual) lines.push(`  Individual:  $${max.individual}`);
      if (max.family)     lines.push(`  Family:      $${max.family}`);
      if (max.remaining)  lines.push(`  Remaining:   $${max.remaining}`);
      lines.push("");
    }

    // Coverage Table Summary (CDT code ranges)
    const covTable = card.coverageTable || [];
    const covRows = covTable.filter(r => r.inNetwork !== null && r.inNetwork !== undefined);

    if (covRows.length) {
      lines.push(`── Coverage Table Summary ──`);
      for (const row of covRows) {
        const label = `${row.category} (${row.cdtRange})`;
        lines.push(`  ${label.padEnd(48)} — ${row.inNetwork}%`);
      }
      lines.push("");
    }

    // Coverage Exceptions
    if (card.coverageExceptions?.length) {
      lines.push(`── Coverage Exceptions ──`);
      for (const ex of card.coverageExceptions) {
        const desc = ex.description || ex.cdtCodes;
        lines.push(`  ${desc}: ${ex.inNetwork}%${ex.note ? ` (${ex.note})` : ""}`);
      }
      lines.push("");
    }

    // Frequencies
    const freq = card.frequencies;
    const freqEntries = [
      ["Prophy",    freq.prophy],
      ["Exam",      freq.exam],
      ["BWX",       freq.bwx],
      ["FMX/Pano",  freq.fmx || freq.pano],
      ["Sealants",  freq.sealants],
      ["Fluoride",  freq.fluoride],
    ].filter(([_, v]) => v);

    if (freqEntries.length) {
      lines.push(`── Frequencies ──`);
      for (const [label, val] of freqEntries) {
        lines.push(`  ${label.padEnd(12)} ${val}`);
      }
      lines.push("");
    }

    // Waiting periods
    if (card.waitingPeriods?.length) {
      lines.push(`── Waiting Periods ──`);
      for (const wp of card.waitingPeriods) {
        lines.push(`  ${wp.category}: ${wp.period}`);
      }
      lines.push("");
    }

    // Notes
    if (card.notes?.length) {
      lines.push(`── Notes ──`);
      for (const n of card.notes) {
        lines.push(`  • ${n}`);
      }
      lines.push("");
    }

    lines.push(`══════════════════════════════════`);
    return lines.join("\n");
  },

  /**
   * Generates a compact one-liner summary for quick reference.
   */
  compactSummary(card) {
    const parts = [];
    if (card.payer)    parts.push(card.payer);
    if (card.planType) parts.push(card.planType);

    // Use coverageTable for compact summary
    const prev = card.coverageTable?.find(r => r.cdtRange === "D1000-D1999");
    const rest = card.coverageTable?.find(r => r.cdtRange === "D2000-D2399");
    const crown = card.coverageTable?.find(r => r.cdtRange === "D2400-D2999");
    if (prev?.inNetwork !== null && prev?.inNetwork !== undefined) parts.push(`Prev ${prev.inNetwork}%`);
    if (rest?.inNetwork !== null && rest?.inNetwork !== undefined) parts.push(`Rest ${rest.inNetwork}%`);
    if (crown?.inNetwork !== null && crown?.inNetwork !== undefined) parts.push(`Crown ${crown.inNetwork}%`);

    if (card.deductible.individual) parts.push(`Ded $${card.deductible.individual}`);
    if (card.annualMax.individual)  parts.push(`Max $${card.annualMax.individual}`);

    return parts.join(" | ");
  },

  /**
   * Generates a missing-info patient message template.
   */
  patientInfoRequest(missingItems) {
    const lines = [
      "Hello,",
      "",
      "We're preparing for your upcoming appointment and need a few items to verify your insurance coverage:",
      "",
    ];

    for (const item of missingItems) {
      lines.push(`  • ${item}`);
    }

    lines.push("");
    lines.push("You can reply to this message with the information, or bring your insurance card to your appointment.");
    lines.push("");
    lines.push("Thank you!");
    lines.push("Merit Dental");

    return lines.join("\n");
  },

  /**
   * Generates an internal checklist for staff.
   */
  staffChecklist(card, missingItems) {
    const lines = [];
    const today = new Date().toLocaleDateString("en-US");

    lines.push(`VERIFICATION CHECKLIST — ${today}`);
    lines.push("─".repeat(40));

    // What we have
    const have = [];
    if (card.payer)                   have.push(`✓ Carrier: ${card.payer}`);
    if (card.planType)                have.push(`✓ Plan type: ${card.planType}`);
    if (card.groupNumber)             have.push(`✓ Group #: ${card.groupNumber}`);
    if (card.deductible.individual)   have.push(`✓ Deductible: $${card.deductible.individual}`);
    if (card.annualMax.individual)    have.push(`✓ Annual max: $${card.annualMax.individual}`);
    if (card.coverage.preventive !== null) have.push(`✓ Preventive: ${card.coverage.preventive}%`);
    if (card.coverage.basic !== null)      have.push(`✓ Basic: ${card.coverage.basic}%`);
    if (card.coverage.major !== null)      have.push(`✓ Major: ${card.coverage.major}%`);

    if (have.length) {
      lines.push("\nCaptured:");
      lines.push(...have);
    }

    // What we need
    if (missingItems.length) {
      lines.push("\nStill needed:");
      for (const item of missingItems) {
        lines.push(`☐ ${item}`);
      }
    }

    // Action items
    lines.push("\nNext steps:");
    lines.push("☐ Confirm benefits are active");
    lines.push("☐ Check waiting periods");
    lines.push("☐ Verify frequencies (last prophy/BWX date)");
    lines.push("☐ Note any exclusions or limitations");
    lines.push("☐ Update patient record in Curve");

    return lines.join("\n");
  },
};

window.PracticePilot = PracticePilot;
