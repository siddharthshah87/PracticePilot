// ============================================================
// PracticePilot — Local Storage Helpers
// ============================================================
// Uses chrome.storage.local to persist BenefitCards and settings.
// No PHI is stored — only task metadata, hashed refs, and cards.
// ============================================================

(function() {
var PracticePilot = window.PracticePilot || {};

PracticePilot.storage = {

  KEYS: {
    LAST_CARD: "pp:lastBenefitCard",
    CARD_HISTORY: "pp:cardHistory",
    CARD_CACHE: "pp:cardCache",       // patient-keyed cache
    SETTINGS: "pp:settings",
  },

  // ---- Patient Cache Key ----

  /**
   * Build a cache key from a BenefitCard's identifying info.
   * Priority: subscriberId+payer > patientName+payer > subscriberId > patientName
   * Returns null if no identifying info is available.
   */
  _cacheKey(card) {
    const subId = (card.subscriberId || "").trim().toLowerCase();
    const name = (card.patientName || "").trim().toLowerCase();
    const payer = (card.payer || "").trim().toLowerCase();

    if (subId && payer) return `sub:${subId}|pay:${payer}`;
    if (name && payer)  return `name:${name}|pay:${payer}`;
    if (subId)          return `sub:${subId}`;
    if (name)           return `name:${name}`;
    return null;
  },

  /**
   * Build a cache key from raw page identifiers (before extraction).
   * Used to check cache before calling the LLM.
   */
  cacheKeyFromIdentifiers(patientName, subscriberId, payer) {
    const subId = (subscriberId || "").trim().toLowerCase();
    const name = (patientName || "").trim().toLowerCase();
    const pay = (payer || "").trim().toLowerCase();

    if (subId && pay) return `sub:${subId}|pay:${pay}`;
    if (name && pay)  return `name:${name}|pay:${pay}`;
    if (subId)        return `sub:${subId}`;
    if (name)         return `name:${name}`;
    return null;
  },

  // ---- Patient Card Cache ----

  /**
   * Save a card to the patient-keyed cache.
   * Max 200 entries, evicts oldest on overflow.
   */
  async cacheCard(card) {
    const key = this._cacheKey(card);
    if (!key) return; // can't cache without identity

    const cache = await this._getCache();
    cache[key] = {
      card,
      cachedAt: new Date().toISOString(),
      sourceUrl: card.sourceUrl || null,
    };

    // Evict oldest if over 200 entries
    const keys = Object.keys(cache);
    if (keys.length > 200) {
      const sorted = keys.sort((a, b) =>
        new Date(cache[a].cachedAt) - new Date(cache[b].cachedAt)
      );
      const toRemove = sorted.slice(0, keys.length - 200);
      for (const k of toRemove) delete cache[k];
    }

    await chrome.storage.local.set({ [this.KEYS.CARD_CACHE]: cache });
  },

  /**
   * Look up a cached card by cache key.
   * Returns { card, cachedAt, sourceUrl } or null.
   */
  async getCachedCard(cacheKey) {
    if (!cacheKey) return null;
    const cache = await this._getCache();
    return cache[cacheKey] || null;
  },

  /**
   * Get all cached cards as an array, newest first.
   */
  async getAllCachedCards() {
    const cache = await this._getCache();
    return Object.values(cache)
      .sort((a, b) => new Date(b.cachedAt) - new Date(a.cachedAt));
  },

  /**
   * Remove a specific cached card by key.
   */
  async removeCachedCard(cacheKey) {
    if (!cacheKey) return;
    const cache = await this._getCache();
    delete cache[cacheKey];
    await chrome.storage.local.set({ [this.KEYS.CARD_CACHE]: cache });
  },

  /**
   * Clear entire card cache.
   */
  async clearCardCache() {
    await chrome.storage.local.remove(this.KEYS.CARD_CACHE);
  },

  async _getCache() {
    const result = await chrome.storage.local.get(this.KEYS.CARD_CACHE);
    return result[this.KEYS.CARD_CACHE] ?? {};
  },

  // ---- Benefit Card (last + history) ----

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
})();
