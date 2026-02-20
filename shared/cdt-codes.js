// ============================================================
// PracticePilot — CDT Code Reference
// ============================================================
// Comprehensive look-up of CDT procedure codes used at
// Merit Dental, organized by ADA category.  Each entry stores
// the code, short name, plain-English description / clinical
// note, and the CDT range category it maps to on the coverage
// table (so we can show the patient's coverage % instantly).
//
// Source: Merit Dental internal reference sheet.
// ============================================================

(function() {
var PracticePilot = window.PracticePilot || {};

PracticePilot.cdtCodes = (() => {

  // ── Master code table ─────────────────────────────────

  const CODES = {

    // ─── Preventive / Diagnostic — Exams ────────────────
    D0120: {
      name: "Periodic Oral Evaluation",
      aka: "Oral Exam",
      note: "Routine check-up done on established patients.",
      category: "Diagnostic",
      cdtRange: "D0100-D0999",
      tier: "preventive",
      starred: true,
    },
    D0150: {
      name: "Comprehensive Oral Evaluation",
      aka: "Comp Exam",
      note: "New patients or when patient has new insurance. Check frequency limits.",
      category: "Diagnostic",
      cdtRange: "D0100-D0999",
      tier: "preventive",
      starred: true,
    },
    D0140: {
      name: "Limited Oral Evaluation — Problem Focused",
      aka: "Limited / Emergency Exam",
      note: "A specific area of the mouth — problem-focused visit.",
      category: "Diagnostic",
      cdtRange: "D0100-D0999",
      tier: "preventive",
    },

    // ─── X-rays ─────────────────────────────────────────
    D0210: {
      name: "Intraoral — Complete Series",
      aka: "Full Mouth X-rays (FMX)",
      note: "18 x-rays showing full mouth + roots. Usually covered 1x every 3-5 years.",
      category: "Diagnostic",
      cdtRange: "D0100-D0999",
      tier: "preventive",
      starred: true,
    },
    D0220: {
      name: "Intraoral — Periapical First Film",
      aka: "PA (first)",
      note: "Shows single tooth from top to root. Used with D0230 for additional PAs.",
      category: "Diagnostic",
      cdtRange: "D0100-D0999",
      tier: "preventive",
    },
    D0230: {
      name: "Intraoral — Periapical Each Additional Film",
      aka: "PA (additional)",
      note: "Each additional periapical image beyond the first.",
      category: "Diagnostic",
      cdtRange: "D0100-D0999",
      tier: "preventive",
    },
    D0270: {
      name: "Bitewing — Single Film",
      aka: "BWX (1 film)",
      note: "Shows upper and lower part of a couple of teeth.",
      category: "Diagnostic",
      cdtRange: "D0100-D0999",
      tier: "preventive",
    },
    D0272: {
      name: "Bitewings — Two Films",
      aka: "BWX (2 films)",
      note: "Two bitewing radiographs.",
      category: "Diagnostic",
      cdtRange: "D0100-D0999",
      tier: "preventive",
    },
    D0274: {
      name: "Bitewings — Four Films",
      aka: "BWX (4 films)",
      note: "Standard recall set. Check BWX frequency — usually 1x/year or 2x/year.",
      category: "Diagnostic",
      cdtRange: "D0100-D0999",
      tier: "preventive",
      starred: true,
    },
    D0330: {
      name: "Panoramic Radiographic Image",
      aka: "PANO",
      note: "Single wide-angle image of entire mouth showing upper and lower jaw bone.",
      category: "Diagnostic",
      cdtRange: "D0100-D0999",
      tier: "preventive",
    },

    // ─── Fluoride ───────────────────────────────────────
    D1206: {
      name: "Topical Application of Fluoride Varnish",
      aka: "Fluoride Varnish",
      note: "Applied after cleaning. ⚠️ Check age limits — some plans restrict to under 16/19. Verify coverage for adults.",
      category: "Preventive",
      cdtRange: "D1000-D1999",
      tier: "preventive",
      starred: true,
    },
    D1208: {
      name: "Topical Application of Fluoride",
      aka: "Fluoride Only",
      note: "Fluoride treatment without varnish.",
      category: "Preventive",
      cdtRange: "D1000-D1999",
      tier: "preventive",
    },

    // ─── Cleanings (Prophylaxis) ────────────────────────
    D1120: {
      name: "Prophylaxis — Child",
      aka: "Child Prophy",
      note: "Cleaning for patients under age 14.",
      category: "Preventive",
      cdtRange: "D1000-D1999",
      tier: "preventive",
    },
    D1110: {
      name: "Prophylaxis — Adult",
      aka: "Adult Prophy",
      note: "Cleaning for patients over age 14. Check frequency — usually 2x/year.",
      category: "Preventive",
      cdtRange: "D1000-D1999",
      tier: "preventive",
      starred: true,
    },

    // ─── Amalgam (Silver Fillings) ──────────────────────
    D2140: {
      name: "Amalgam — One Surface, Primary or Permanent",
      aka: "1-Surface Silver Filling",
      note: "Surfaces: M, B/F, I, O, L, D.",
      category: "Restorative",
      cdtRange: "D2000-D2399",
      tier: "basic",
    },
    D2150: {
      name: "Amalgam — Two Surfaces, Primary or Permanent",
      aka: "2-Surface Silver Filling",
      note: "",
      category: "Restorative",
      cdtRange: "D2000-D2399",
      tier: "basic",
    },
    D2160: {
      name: "Amalgam — Three Surfaces, Primary or Permanent",
      aka: "3-Surface Silver Filling",
      note: "",
      category: "Restorative",
      cdtRange: "D2000-D2399",
      tier: "basic",
    },
    D2161: {
      name: "Amalgam — Four or More Surfaces, Primary or Permanent",
      aka: "4+ Surface Silver Filling",
      note: "",
      category: "Restorative",
      cdtRange: "D2000-D2399",
      tier: "basic",
    },

    // ─── Composite (White Fillings) — Anterior ──────────
    D2330: {
      name: "Resin-Based Composite — One Surface, Anterior",
      aka: "1-Surface Front Filling",
      note: "Anterior teeth (front).",
      category: "Restorative",
      cdtRange: "D2000-D2399",
      tier: "basic",
    },
    D2331: {
      name: "Resin-Based Composite — Two Surfaces, Anterior",
      aka: "2-Surface Front Filling",
      note: "",
      category: "Restorative",
      cdtRange: "D2000-D2399",
      tier: "basic",
    },
    D2332: {
      name: "Resin-Based Composite — Three Surfaces, Anterior",
      aka: "3-Surface Front Filling",
      note: "",
      category: "Restorative",
      cdtRange: "D2000-D2399",
      tier: "basic",
    },
    D2335: {
      name: "Resin-Based Composite — Four or More Surfaces, Anterior",
      aka: "4+ Surface Front Filling",
      note: "Anterior (front) teeth.",
      category: "Restorative",
      cdtRange: "D2000-D2399",
      tier: "basic",
    },

    // ─── Composite (White Fillings) — Posterior ─────────
    D2391: {
      name: "Resin-Based Composite — One Surface, Posterior",
      aka: "1-Surface Back Filling",
      note: "Posterior teeth (back).",
      category: "Restorative",
      cdtRange: "D2000-D2399",
      tier: "basic",
    },
    D2392: {
      name: "Resin-Based Composite — Two Surfaces, Posterior",
      aka: "2-Surface Back Filling",
      note: "",
      category: "Restorative",
      cdtRange: "D2000-D2399",
      tier: "basic",
    },
    D2393: {
      name: "Resin-Based Composite — Three Surfaces, Posterior",
      aka: "3-Surface Back Filling",
      note: "",
      category: "Restorative",
      cdtRange: "D2000-D2399",
      tier: "basic",
    },
    D2394: {
      name: "Resin-Based Composite — Four or More Surfaces, Posterior",
      aka: "4+ Surface Back Filling",
      note: "Posterior (back) teeth.",
      category: "Restorative",
      cdtRange: "D2000-D2399",
      tier: "basic",
    },

    // ─── Crowns ─────────────────────────────────────────
    D2740: {
      name: "Crown — Porcelain/Ceramic Substrate",
      aka: "Porcelain/Ceramic Crown (No Metal)",
      note: "No metal substrate. Most common crown type. Check waiting periods.",
      category: "Crowns",
      cdtRange: "D2400-D2999",
      tier: "major",
      starred: true,
    },
    D2750: {
      name: "Crown — Porcelain Fused to High Noble Metal",
      aka: "PFM Crown",
      note: "Porcelain fused to high noble metal.",
      category: "Crowns",
      cdtRange: "D2400-D2999",
      tier: "major",
    },
    D2790: {
      name: "Crown — Full Cast High Noble Metal",
      aka: "Gold Crown",
      note: "Full cast high noble metal.",
      category: "Crowns",
      cdtRange: "D2400-D2999",
      tier: "major",
    },
    D2920: {
      name: "Recement or Rebond Crown",
      aka: "Re-cement Crown",
      note: "Re-cementation of an existing crown.",
      category: "Crowns",
      cdtRange: "D2400-D2999",
      tier: "basic",
    },
    D2950: {
      name: "Core Buildup, Including Any Pins",
      aka: "Core Build-Up (BU)",
      note: "Typically done with a crown. Usually billed same visit as crown.",
      category: "Crowns",
      cdtRange: "D2400-D2999",
      tier: "major",
      starred: true,
    },
    D2952: {
      name: "Post and Core in Addition to Crown",
      aka: "Post and Core",
      note: "Cast post and core in addition to crown — done with crown.",
      category: "Crowns",
      cdtRange: "D2400-D2999",
      tier: "major",
    },
    D2954: {
      name: "Prefabricated Post and Core",
      aka: "Prefab Post & Core",
      note: "Prefabricated post and core in addition to crown.",
      category: "Crowns",
      cdtRange: "D2400-D2999",
      tier: "major",
    },

    // ─── Root Canals (Endodontics) ──────────────────────
    D3310: {
      name: "Endodontic Therapy, Anterior Tooth",
      aka: "Anterior RCT",
      note: "Teeth #6-11 (upper) / #22-27 (lower). If RCT is done, a crown and BU are needed.",
      category: "Endodontics",
      cdtRange: "D3000-D3999",
      tier: "major",
    },
    D3320: {
      name: "Endodontic Therapy, Premolar Tooth",
      aka: "Premolar RCT",
      note: "Teeth #4-5, #12-13 (upper) / #20-21, #28-29 (lower). Crown + BU needed after.",
      category: "Endodontics",
      cdtRange: "D3000-D3999",
      tier: "major",
    },
    D3330: {
      name: "Endodontic Therapy, Molar Tooth",
      aka: "Molar RCT",
      note: "Teeth #1-3, #14-16 / #17-19, #30-32. ⚠️ Crown + BU needed after — quote together.",
      category: "Endodontics",
      cdtRange: "D3000-D3999",
      tier: "major",
      starred: true,
    },
    D3346: {
      name: "Retreatment of Previous Root Canal — Anterior",
      aka: "RCT Retreatment (Anterior)",
      note: "Retreatment to clean out and redo RCT again on anterior tooth.",
      category: "Endodontics",
      cdtRange: "D3000-D3999",
      tier: "major",
    },
    D3347: {
      name: "Retreatment of Previous Root Canal — Premolar",
      aka: "RCT Retreatment (Premolar)",
      note: "Retreatment to clean out and redo RCT again on premolar tooth.",
      category: "Endodontics",
      cdtRange: "D3000-D3999",
      tier: "major",
    },
    D3348: {
      name: "Retreatment of Previous Root Canal — Molar",
      aka: "RCT Retreatment (Molar)",
      note: "Retreatment to clean out and redo RCT again on molar tooth.",
      category: "Endodontics",
      cdtRange: "D3000-D3999",
      tier: "major",
    },

    // ─── Periodontics ───────────────────────────────────
    D4341: {
      name: "Periodontal Scaling and Root Planing — 4+ Teeth Per Quadrant",
      aka: "SRP (4+ teeth)",
      note: "4 or more teeth per quadrant. Check if plan requires perio charting first.",
      category: "Periodontics",
      cdtRange: "D4000-D4999",
      tier: "basic",
      starred: true,
    },
    D4342: {
      name: "Periodontal Scaling and Root Planing — 1-3 Teeth Per Quadrant",
      aka: "SRP (1-3 teeth)",
      note: "Scaling and root planing, 1 to 3 teeth per quadrant.",
      category: "Periodontics",
      cdtRange: "D4000-D4999",
      tier: "basic",
    },
    D4355: {
      name: "Full Mouth Debridement",
      aka: "FMD",
      note: "Full mouth debridement to enable comprehensive evaluation and diagnosis.",
      category: "Periodontics",
      cdtRange: "D4000-D4999",
      tier: "basic",
    },
    D4910: {
      name: "Periodontal Maintenance",
      aka: "Perio Maint / PM",
      note: "Following perio therapy. ⚠️ Replaces regular prophy — different frequency rules.",
      category: "Periodontics",
      cdtRange: "D4000-D4999",
      tier: "basic",
      starred: true,
    },
    D4381: {
      name: "Localized Delivery of Antimicrobial Agents",
      aka: "Arestin",
      note: "Localized delivery of antimicrobial agents via a controlled-release device.",
      category: "Periodontics",
      cdtRange: "D4000-D4999",
      tier: "basic",
    },

    // ─── Dentures (Removable Prosthodontics) ────────────
    D5110: {
      name: "Complete Denture — Maxillary",
      aka: "Full Upper Denture",
      note: "Complete denture for upper arch.",
      category: "Prosthodontics, Removable",
      cdtRange: "D5000-D5899",
      tier: "major",
    },
    D5120: {
      name: "Complete Denture — Mandibular",
      aka: "Full Lower Denture",
      note: "Complete denture for lower arch.",
      category: "Prosthodontics, Removable",
      cdtRange: "D5000-D5899",
      tier: "major",
    },
    D5130: {
      name: "Immediate Denture — Maxillary",
      aka: "Temporary Upper Denture",
      note: "Immediate / temporary upper denture placed at time of extraction.",
      category: "Prosthodontics, Removable",
      cdtRange: "D5000-D5899",
      tier: "major",
    },
    D5140: {
      name: "Immediate Denture — Mandibular",
      aka: "Temporary Lower Denture",
      note: "Immediate / temporary lower denture placed at time of extraction.",
      category: "Prosthodontics, Removable",
      cdtRange: "D5000-D5899",
      tier: "major",
    },
    D5211: {
      name: "Maxillary Partial Denture — Resin Base",
      aka: "Upper Partial (Resin)",
      note: "Upper partial denture with resin base.",
      category: "Prosthodontics, Removable",
      cdtRange: "D5000-D5899",
      tier: "major",
    },
    D5213: {
      name: "Mandibular Partial Denture — Resin Base",
      aka: "Lower Partial (Resin)",
      note: "Lower partial denture with resin base.",
      category: "Prosthodontics, Removable",
      cdtRange: "D5000-D5899",
      tier: "major",
    },
    D5221: {
      name: "Immediate Maxillary Partial Denture — Resin Base",
      aka: "Immediate Upper Partial (Resin)",
      note: "Immediate upper partial denture with resin base.",
      category: "Prosthodontics, Removable",
      cdtRange: "D5000-D5899",
      tier: "major",
    },
    D5222: {
      name: "Immediate Mandibular Partial Denture — Resin Base",
      aka: "Immediate Lower Partial (Resin)",
      note: "Immediate lower partial denture with resin base.",
      category: "Prosthodontics, Removable",
      cdtRange: "D5000-D5899",
      tier: "major",
    },
    D5820: {
      name: "Interim Partial Denture — Maxillary",
      aka: "StayPlate Upper",
      note: "Interim / temporary partial denture for upper arch.",
      category: "Prosthodontics, Removable",
      cdtRange: "D5000-D5899",
      tier: "major",
    },
    D5821: {
      name: "Interim Partial Denture — Mandibular",
      aka: "StayPlate Lower",
      note: "Interim / temporary partial denture for lower arch.",
      category: "Prosthodontics, Removable",
      cdtRange: "D5000-D5899",
      tier: "major",
    },

    // ─── Implant Restoration ────────────────────────────
    D6057: {
      name: "Custom Fabricated Abutment",
      aka: "Custom Abutment",
      note: "Custom fabricated abutment — includes placement.",
      category: "Implant Services",
      cdtRange: "D6000-D6199",
      tier: "major",
    },
    D6065: {
      name: "Implant Supported Porcelain/Ceramic Crown",
      aka: "Implant Crown",
      note: "Implant-supported porcelain/ceramic crown.",
      category: "Implant Services",
      cdtRange: "D6000-D6199",
      tier: "major",
    },

    // ─── Bridges (Fixed Prosthodontics) ─────────────────
    D6245: {
      name: "Pontic — Porcelain/Ceramic",
      aka: "Bridge Pontic (No Metal)",
      note: "Pontic porcelain/ceramic — no metal. Used in bridge construction.",
      category: "Prosthodontics, Fixed",
      cdtRange: "D6200-D6999",
      tier: "major",
    },
    D6740: {
      name: "Retainer Crown — Porcelain/Ceramic",
      aka: "Bridge Retainer Crown (No Metal)",
      note: "Retainer crown porcelain/ceramic — no metal. Anchor unit of a bridge.",
      category: "Prosthodontics, Fixed",
      cdtRange: "D6200-D6999",
      tier: "major",
    },
    D6242: {
      name: "Pontic — Porcelain Fused to Noble Metal",
      aka: "Bridge Pontic (PFM)",
      note: "Not commonly used at Merit Dental.",
      category: "Prosthodontics, Fixed",
      cdtRange: "D6200-D6999",
      tier: "major",
    },
    D6750: {
      name: "Retainer Crown — Porcelain Fused to High Noble Metal",
      aka: "Bridge Retainer Crown (PFM)",
      note: "Not commonly used at Merit Dental.",
      category: "Prosthodontics, Fixed",
      cdtRange: "D6200-D6999",
      tier: "major",
    },

    // ─── Extractions (Oral Surgery) ─────────────────────
    D7140: {
      name: "Extraction, Erupted Tooth or Exposed Root",
      aka: "Simple Extraction",
      note: "Forceps removal. Check if bone graft (D7953) needed for ridge preservation.",
      category: "Oral & Maxillofacial Surgery",
      cdtRange: "D7000-D7999",
      tier: "basic",
      starred: true,
    },
    D7210: {
      name: "Extraction, Erupted Tooth Requiring Removal of Bone/Sectioning",
      aka: "Surgical Extraction",
      note: "Erupted tooth requiring removal of bone and/or sectioning of tooth.",
      category: "Oral & Maxillofacial Surgery",
      cdtRange: "D7000-D7999",
      tier: "basic",
    },
    D7953: {
      name: "Bone Replacement Graft for Ridge Preservation — Per Site",
      aka: "Bone Graft (Ridge Preservation)",
      note: "Placed once tooth is removed to preserve ridge.",
      category: "Oral & Maxillofacial Surgery",
      cdtRange: "D7000-D7999",
      tier: "major",
    },

    // ─── Orthodontics ───────────────────────────────────
    D8090: {
      name: "Comprehensive Orthodontic Treatment — Adult",
      aka: "Adult Ortho",
      note: "Comprehensive orthodontic treatment of the adult dentition.",
      category: "Orthodontics",
      cdtRange: "D8000-D8999",
      tier: "ortho",
    },
    D8210: {
      name: "Removable Appliance Therapy",
      aka: "Retainers",
      note: "Removable appliance therapy (retainers).",
      category: "Orthodontics",
      cdtRange: "D8000-D8999",
      tier: "ortho",
    },

    // ─── Adjunctive General Services ────────────────────
    D9110: {
      name: "Palliative Treatment of Dental Pain — Minor Procedure",
      aka: "Palliative Treatment",
      note: "Emergency/palliative treatment for one specific area of dental pain.",
      category: "Adjunctive General Services",
      cdtRange: "D9000-D9999",
      tier: "basic",
    },
    D9944: {
      name: "Occlusal Guard — Hard Appliance, Full Arch",
      aka: "NightGuard",
      note: "⚠️ Usually upper arch. Check if plan covers — many plans exclude or limit to 1 per lifetime. May require prior auth.",
      category: "Adjunctive General Services",
      cdtRange: "D9000-D9999",
      tier: "major",
      starred: true,
    },
    D9951: {
      name: "Occlusal Adjustment — Limited",
      aka: "Bite Adjustment (1-3 teeth)",
      note: "Limited occlusal adjustment, 1-3 teeth. Corrects bite problems.",
      category: "Adjunctive General Services",
      cdtRange: "D9000-D9999",
      tier: "basic",
    },
    D9952: {
      name: "Occlusal Adjustment — Complete",
      aka: "Full Bite Adjustment",
      note: "Complete occlusal adjustment. Corrects bite problems.",
      category: "Adjunctive General Services",
      cdtRange: "D9000-D9999",
      tier: "basic",
    },
    D9630: {
      name: "Drugs or Medicaments Dispensed in Office",
      aka: "In-Office Medication (Remin Pro)",
      note: "Drugs or medication dispensed in the office, e.g. Remin Pro.",
      category: "Adjunctive General Services",
      cdtRange: "D9000-D9999",
      tier: "basic",
    },
  };

  // ── Coverage tier labels (Merit Dental convention) ────

  const TIER_LABELS = {
    preventive: "Preventive / Diagnostic",
    basic:      "Basic",
    major:      "Major",
    ortho:      "Orthodontic",
  };

  // ── Quick-access grouped by section (for browsing) ────

  const SECTIONS = [
    {
      heading: "Exams",
      codes: ["D0120", "D0150", "D0140"],
    },
    {
      heading: "X-Rays",
      codes: ["D0210", "D0220", "D0230", "D0270", "D0272", "D0274", "D0330"],
    },
    {
      heading: "Fluoride",
      codes: ["D1206", "D1208"],
    },
    {
      heading: "Cleanings",
      codes: ["D1110", "D1120"],
    },
    {
      heading: "Fillings — Amalgam (Silver)",
      codes: ["D2140", "D2150", "D2160", "D2161"],
    },
    {
      heading: "Fillings — Composite Anterior (Front)",
      codes: ["D2330", "D2331", "D2332", "D2335"],
    },
    {
      heading: "Fillings — Composite Posterior (Back)",
      codes: ["D2391", "D2392", "D2393", "D2394"],
    },
    {
      heading: "Crowns & Build-Ups",
      codes: ["D2740", "D2750", "D2790", "D2920", "D2950", "D2952", "D2954"],
    },
    {
      heading: "Root Canals",
      codes: ["D3310", "D3320", "D3330", "D3346", "D3347", "D3348"],
    },
    {
      heading: "Periodontics",
      codes: ["D4341", "D4342", "D4355", "D4910", "D4381"],
    },
    {
      heading: "Dentures",
      codes: ["D5110", "D5120", "D5130", "D5140", "D5211", "D5213", "D5221", "D5222", "D5820", "D5821"],
    },
    {
      heading: "Implant Restoration",
      codes: ["D6057", "D6065"],
    },
    {
      heading: "Bridges",
      codes: ["D6245", "D6740", "D6242", "D6750"],
    },
    {
      heading: "Extractions",
      codes: ["D7140", "D7210", "D7953"],
    },
    {
      heading: "Orthodontics",
      codes: ["D8090", "D8210"],
    },
    {
      heading: "Adjunctive Services",
      codes: ["D9110", "D9944", "D9951", "D9952", "D9630"],
    },
  ];

  // ── Public API ────────────────────────────────────────

  /**
   * Look up a single CDT code.  Accepts "D2740" or "d2740".
   * Returns the code object or null.
   */
  function lookup(code) {
    if (!code) return null;
    const key = code.toUpperCase().replace(/\s/g, "");
    return CODES[key] || null;
  }

  /**
   * Search codes by keyword against name, aka, note, category.
   * Returns an array of { code, ...entry } sorted by code.
   */
  function search(query, limit = 20) {
    if (!query || query.length < 2) return [];

    const q = query.toLowerCase();
    const results = [];

    for (const [code, entry] of Object.entries(CODES)) {
      const haystack = `${code} ${entry.name} ${entry.aka} ${entry.note} ${entry.category}`.toLowerCase();
      if (haystack.includes(q)) {
        results.push({ code, ...entry });
      }
      if (results.length >= limit) break;
    }

    results.sort((a, b) => a.code.localeCompare(b.code));
    return results;
  }

  /**
   * Given a CDT code and a BenefitCard, return the coverage %
   * from the card's coverage table for that code's category.
   * Returns null if no match found.
   */
  function getCoverage(code, card) {
    const entry = lookup(code);
    if (!entry || !card?.coverageTable) return null;

    const row = card.coverageTable.find(r => r.cdtRange === entry.cdtRange);
    return row?.inNetwork ?? null;
  }

  /**
   * Given a CDT code and a BenefitCard, return a human-readable
   * coverage string like "Crowns → 50% in-network".
   */
  function getCoverageSummary(code, card) {
    const entry = lookup(code);
    if (!entry) return null;

    const pct = getCoverage(code, card);
    const parts = [`${entry.aka || entry.name}`, `→ ${entry.category} (${entry.cdtRange})`];
    if (pct !== null && pct !== undefined) {
      parts.push(`→ ${pct}% in-network`);
    }
    return parts.join(" ");
  }

  /**
   * Return all procedure codes as an array of { code, ...entry }.
   */
  function allCodes() {
    return Object.entries(CODES).map(([code, entry]) => ({ code, ...entry }));
  }

  /**
   * Return all section groupings (for the browse panel).
   */
  function getSections() {
    return SECTIONS;
  }

  /**
   * Return starred/commonly-used codes as an array of { code, ...entry }.
   */
  function starredCodes() {
    return Object.entries(CODES)
      .filter(([, entry]) => entry.starred)
      .map(([code, entry]) => ({ code, ...entry }));
  }

  return {
    lookup,
    search,
    getCoverage,
    getCoverageSummary,
    allCodes,
    getSections,
    starredCodes,
    TIER_LABELS,
  };

})();

window.PracticePilot = PracticePilot;
})();
