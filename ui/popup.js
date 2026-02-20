// ============================================================
// PracticePilot — Popup Settings Script
// ============================================================
// Manages the popup UI for API key configuration, connection
// testing, and quick actions.
// ============================================================

(function () {
  "use strict";

  const STORAGE_KEY = "pp:llmConfig";

  // ── DOM refs ────────────────────────────────────────────

  const els = {
    provider:     document.getElementById("provider"),
    apiKey:       document.getElementById("apiKey"),
    model:        document.getElementById("model"),
    baseUrl:      document.getElementById("baseUrl"),
    baseUrlField: document.getElementById("baseUrlField"),
    saveBtn:      document.getElementById("saveBtn"),
    testBtn:      document.getElementById("testBtn"),
    saveMsg:      document.getElementById("saveMsg"),
    statusDot:    document.getElementById("statusDot"),
    statusText:   document.getElementById("statusText"),
    showPanelBtn: document.getElementById("showPanelBtn"),
    extractBtn:   document.getElementById("extractBtn"),
    clearBtn:     document.getElementById("clearBtn"),
    version:      document.getElementById("version"),
  };

  // ── Defaults ────────────────────────────────────────────

  const DEFAULTS = {
    anthropic: {
      model: "claude-sonnet-4-20250514",
      baseUrl: "https://api.anthropic.com",
      placeholder: "sk-ant-…",
    },
    openai: {
      model: "gpt-4o-mini",
      baseUrl: "https://api.openai.com/v1",
      placeholder: "sk-…",
    },
    custom: {
      model: "",
      baseUrl: "",
      placeholder: "API key",
    },
  };

  // ── Initialize ──────────────────────────────────────────

  async function init() {
    // Set version
    const manifest = chrome.runtime.getManifest();
    els.version.textContent = `v${manifest.version}`;

    // Load saved config
    const result = await chrome.storage.local.get(STORAGE_KEY);
    const config = result[STORAGE_KEY] || {};

    if (config.provider) els.provider.value = config.provider;
    if (config.apiKey)   els.apiKey.value = config.apiKey;
    if (config.model)    els.model.value = config.model;
    if (config.baseUrl)  els.baseUrl.value = config.baseUrl;

    // Apply provider defaults for empty fields
    applyProviderDefaults(els.provider.value, config);

    // Update UI
    updateProviderUI();

    // Check connection status
    checkStatus(config);

    // Wire events
    els.provider.addEventListener("change", onProviderChange);
    els.saveBtn.addEventListener("click", onSave);
    els.testBtn.addEventListener("click", onTest);
    els.showPanelBtn.addEventListener("click", onShowPanel);
    els.extractBtn.addEventListener("click", onExtract);
    els.clearBtn.addEventListener("click", onClear);
  }

  function applyProviderDefaults(provider, config) {
    const defaults = DEFAULTS[provider] || DEFAULTS.anthropic;
    if (!config.model) els.model.value = defaults.model;
    els.model.placeholder = defaults.model;
    els.apiKey.placeholder = defaults.placeholder;
    if (!config.baseUrl) els.baseUrl.value = defaults.baseUrl;
  }

  function updateProviderUI() {
    const provider = els.provider.value;
    els.baseUrlField.style.display = provider === "custom" ? "" : "none";

    const defaults = DEFAULTS[provider] || DEFAULTS.anthropic;
    els.model.placeholder = defaults.model;
    els.apiKey.placeholder = defaults.placeholder;
  }

  // ── Events ──────────────────────────────────────────────

  function onProviderChange() {
    const provider = els.provider.value;
    const defaults = DEFAULTS[provider];

    // Update model to default unless user has customized it
    if (defaults) {
      els.model.value = defaults.model;
      els.baseUrl.value = defaults.baseUrl;
    }

    updateProviderUI();
  }

  async function onSave() {
    const config = getFormConfig();

    // Validate
    if (!config.apiKey) {
      showMessage("error", "Please enter an API key.");
      return;
    }

    // Save
    await chrome.storage.local.set({ [STORAGE_KEY]: config });
    showMessage("success", "Settings saved!");

    // Re-check status
    checkStatus(config);
  }

  async function onTest() {
    const config = getFormConfig();

    if (!config.apiKey) {
      showMessage("error", "Please enter an API key first.");
      return;
    }

    // Show loading
    els.testBtn.disabled = true;
    const original = els.testBtn.innerHTML;
    els.testBtn.innerHTML = '<span class="spinner"></span> Testing…';

    try {
      const result = await chrome.runtime.sendMessage({
        type: "PP_TEST_CONNECTION",
        config,
      });

      if (result?.ok) {
        showMessage("success", "✓ Connection successful! Claude is ready.");
        setStatus("connected", "Connected to " + getProviderName(config.provider));
      } else {
        showMessage("error", "Connection failed: " + (result?.error || "Unknown error"));
        setStatus("disconnected", "Connection failed");
      }
    } catch (e) {
      showMessage("error", "Test error: " + e.message);
      setStatus("disconnected", "Error");
    } finally {
      els.testBtn.disabled = false;
      els.testBtn.innerHTML = original;
    }
  }

  function onShowPanel() {
    chrome.runtime.sendMessage({ type: "PP_TOGGLE_PANEL", show: true });
    window.close();
  }

  function onExtract() {
    chrome.runtime.sendMessage({ type: "PP_TRIGGER_EXTRACT", mode: "page" });
    window.close();
  }

  async function onClear() {
    await chrome.storage.local.remove(["pp:lastBenefitCard", "pp:cardHistory"]);
    showMessage("success", "History cleared.");
  }

  // ── Helpers ─────────────────────────────────────────────

  function getFormConfig() {
    return {
      provider: els.provider.value,
      apiKey: els.apiKey.value.trim(),
      model: els.model.value.trim() || DEFAULTS[els.provider.value]?.model || "",
      baseUrl: els.baseUrl.value.trim() || DEFAULTS[els.provider.value]?.baseUrl || "",
      maxTokens: 4096,
      temperature: 0,
    };
  }

  async function checkStatus(config) {
    if (!config?.apiKey) {
      setStatus("unknown", "No API key configured");
      return;
    }

    setStatus("unknown", "API key set — click Test to verify");
  }

  function setStatus(state, text) {
    els.statusDot.className = "status-dot " + state;
    els.statusText.textContent = text;
  }

  function showMessage(type, text) {
    els.saveMsg.className = "msg " + type;
    els.saveMsg.textContent = text;
    els.saveMsg.style.display = "block";

    setTimeout(() => {
      els.saveMsg.style.display = "none";
    }, 4000);
  }

  function getProviderName(provider) {
    const names = {
      anthropic: "Anthropic (Claude)",
      openai: "OpenAI",
      custom: "Custom Provider",
    };
    return names[provider] || provider;
  }

  // ── Go ──────────────────────────────────────────────────

  init();

})();
