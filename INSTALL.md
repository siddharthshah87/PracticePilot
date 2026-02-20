# PracticePilot — Installation Guide

## For Team Members (Quick Install)

### Step 1: Get the Extension
- Download or receive the `PracticePilot-v*.zip` file
- Unzip it to a folder on your computer (e.g., `Desktop/PracticePilot`)

### Step 2: Load in Chrome
1. Open Chrome and go to `chrome://extensions`
2. Turn on **Developer mode** (toggle in the top-right corner)
3. Click **"Load unpacked"**
4. Select the unzipped `PracticePilot` folder
5. The PracticePilot icon will appear in your toolbar

### Step 3: Configure API Key
1. Click the PracticePilot icon in the toolbar
2. Enter the Anthropic API key (ask Dhruv for the key)
3. Click **Save**
4. Click **Test Connection** to verify it works

### Step 4: Start Using
1. Navigate to [Merit Dental on Curve](https://meritdental.curvehero.com)
2. Open any patient's **Eligibility** page
3. PracticePilot will automatically:
   - Detect the eligibility page
   - Open the sidebar panel
   - Extract and display structured benefits

---

## Features at a Glance

| Feature | How to Use |
|---------|-----------|
| **Auto-Extract** | Just open an eligibility page — it starts automatically |
| **Manual Extract** | Click "Extract from Page" button in the sidebar |
| **Selection Extract** | Select specific text, then click "Extract from Selection" |
| **CDT Code Lookup** | Use the search box in the sidebar to find any CDT code |
| **Starred Codes** | Common Merit Dental codes shown by default with clinical tips |
| **Copy for Curve** | Click "Copy for Curve" to get formatted text for pasting |
| **Verification Note** | Click "Copy Verification Note" for ready-to-use notes |

---

## Updating the Extension

When you receive a new version:
1. Unzip the new file to the **same folder** (overwrite old files)
2. Go to `chrome://extensions`
3. Click the **refresh icon** (↻) on the PracticePilot card
4. Reload any open Curve Dental tabs

---

## Troubleshooting

### Extension not showing on Curve pages
- Make sure you're on `meritdental.curvehero.com`
- Try reloading the page (Ctrl+R)
- Check that the extension is enabled in `chrome://extensions`

### "API key not configured" error
- Click the PracticePilot toolbar icon
- Enter your API key and click Save

### "Anthropic API error" messages
- Click **Test Connection** in the popup to verify the key works
- Check your internet connection
- The API key may have expired — contact Dhruv for a new one

### Panel not visible
- Click the PracticePilot toolbar icon → **Show Panel**
- Or click **Activate on This Page** if shown

### Data looks wrong or incomplete
- Try clicking **Extract from Page** again
- Select just the eligibility section and use **Extract from Selection**
- Some payer formats are complex — check the raw data for accuracy

---

## Privacy & Security

- **No patient data is stored on any server** — all PHI stays in your browser
- Patient names and IDs are extracted locally and **never sent** to the AI
- Only de-identified benefit text is sent to Anthropic's API for parsing
- All data is stored in Chrome's local storage on your machine
- The extension only runs on `*.curvehero.com` pages

---

## Building from Source

For developers who want to build the extension:

```bash
git clone <repo-url>
cd PracticePilot
./build.sh
```

The built zip will be in `dist/PracticePilot-v*.zip`.
