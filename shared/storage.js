// ============================================================
// PracticePilot — Local Storage Helpers
// ============================================================
// Uses chrome.storage.local to persist BenefitCards and settings.
// No PHI is stored — only task metadata, hashed refs, and cards.
// ============================================================

var PracticePilot = window.PracticePilot || {};

PracticePilot.storage = {

  KEYS: {
    LAST_CARD: "pp:lastBenefitCard",
    CARD_HISTORY: "pp:cardHistory",
    SETTINGS: "pp:settings",
  },

  // ---- Benefit Card ----

  async setLastBenefitCard(card) {
    await chrome.storage.local.set({ [this.KEYS.LAST_CARD]: card });
    // Also append to history (keep last 50)
    const history = await this.getCardHistory();
    history.unshift(card);
    if (history.length > 50) history.length = 50;
    await chrome.storage.local.set({ [this.KEYS.CARD_HISTORY]: history });
  },

  async getLastBenefitCard() {
    const result = await chrome.storage.local.get(this.KEYS.LAST_CARD);
    return result[this.KEYS.LAST_CARD] ?? null;
  },

  async getCardHistory() {
    const result = await chrome.storage.local.get(this.KEYS.CARD_HISTORY);
    return result[this.KEYS.CARD_HISTORY] ?? [];
  },

  async clearCards() {
    await chrome.storage.local.remove([this.KEYS.LAST_CARD, this.KEYS.CARD_HISTORY]);
  },

  // ---- Settings ----

  async getSettings() {
    const result = await chrome.storage.local.get(this.KEYS.SETTINGS);
    return result[this.KEYS.SETTINGS] ?? {
      noteFormat: "standard",     // standard | compact | detailed
      autoDetect: true,           // auto-detect page types
      showOverlay: true,          // show sidebar overlay on supported pages
    };
  },

  async setSettings(settings) {
    await chrome.storage.local.set({ [this.KEYS.SETTINGS]: settings });
  },
};

window.PracticePilot = PracticePilot;
