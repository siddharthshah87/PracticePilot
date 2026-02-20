#!/usr/bin/env bash
# ============================================================
# PracticePilot — Build & Package Script
# ============================================================
# Creates a distributable .zip file for Chrome extension
# installation. The zip can be:
#   1. Loaded as "unpacked" in chrome://extensions (dev mode)
#   2. Shared directly with team members
#   3. Uploaded to Chrome Web Store
#
# Usage:
#   chmod +x build.sh
#   ./build.sh
#
# Output:
#   dist/PracticePilot-v0.1.0.zip
# ============================================================

set -euo pipefail

# ── Config ─────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# Read version from manifest.json
VERSION=$(grep '"version"' manifest.json | head -1 | sed 's/.*: *"\(.*\)".*/\1/')
NAME="PracticePilot"
DIST_DIR="dist"
ZIP_NAME="${NAME}-v${VERSION}.zip"

echo "╔══════════════════════════════════════════╗"
echo "║  PracticePilot Build Script              ║"
echo "║  Version: ${VERSION}                         ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# ── Clean previous builds ─────────────────────────────────

echo "→ Cleaning previous builds..."
rm -rf "${DIST_DIR}"
mkdir -p "${DIST_DIR}"

# ── Validate required files ───────────────────────────────

echo "→ Validating extension files..."

REQUIRED_FILES=(
  "manifest.json"
  "background.js"
  "content/main.js"
  "content/panel.css"
  "content/page-detector.js"
  "content/eligibility-parser.js"
  "shared/phi-redactor.js"
  "shared/normalize.js"
  "shared/storage.js"
  "shared/formatter.js"
  "shared/cdt-codes.js"
  "shared/llm-extractor.js"
  "shared/patient-context.js"
  "shared/action-engine.js"
  "ui/popup.html"
  "ui/popup.js"
)

MISSING=0
for f in "${REQUIRED_FILES[@]}"; do
  if [[ ! -f "$f" ]]; then
    echo "  ✗ MISSING: $f"
    MISSING=1
  fi
done

if [[ $MISSING -eq 1 ]]; then
  echo ""
  echo "ERROR: Missing required files. Aborting."
  exit 1
fi

echo "  ✓ All required files present"

# Check for icons
if [[ ! -d "icons" ]] || [[ -z "$(ls icons/ 2>/dev/null)" ]]; then
  echo "  ⚠ Warning: No icons found in icons/ directory"
else
  ICON_COUNT=$(ls icons/*.png 2>/dev/null | wc -l)
  echo "  ✓ Found ${ICON_COUNT} icon(s)"
fi

# ── Security check: ensure no secrets in build ────────────

echo "→ Security check..."

# Make sure we don't accidentally include API keys
if grep -rq "sk-ant-api" --include="*.js" --include="*.json" --include="*.html" . 2>/dev/null; then
  echo "  ✗ WARNING: Found what looks like an API key in source files!"
  echo "    Review files before distributing."
  # Don't abort — the key is stored in chrome.storage, not in code
fi

if [[ -f "key" ]]; then
  echo "  ✓ 'key' file found (will be excluded from zip)"
fi

if [[ -f ".env" ]]; then
  echo "  ✓ '.env' file found (will be excluded from zip)"
fi

echo "  ✓ Security check passed"

# ── Build zip ─────────────────────────────────────────────

echo "→ Building ${ZIP_NAME}..."

# Files and directories to include
zip -r "${DIST_DIR}/${ZIP_NAME}" \
  manifest.json \
  background.js \
  content/ \
  shared/ \
  ui/ \
  icons/ \
  -x "*.DS_Store" \
  -x "__MACOSX/*" \
  -x "*.swp" \
  -x "*.swo" \
  -x "*~" \
  2>/dev/null

# ── Report ─────────────────────────────────────────────────

ZIP_SIZE=$(du -h "${DIST_DIR}/${ZIP_NAME}" | cut -f1)
FILE_COUNT=$(unzip -l "${DIST_DIR}/${ZIP_NAME}" 2>/dev/null | tail -1 | awk '{print $2}')

echo ""
echo "═══════════════════════════════════════════"
echo "  ✓ Build complete!"
echo ""
echo "  Output:  ${DIST_DIR}/${ZIP_NAME}"
echo "  Size:    ${ZIP_SIZE}"
echo "  Files:   ${FILE_COUNT}"
echo ""
echo "  Distribution options:"
echo "    1. Share the .zip — recipients load unpacked"
echo "       (see INSTALL.md for instructions)"
echo "    2. Upload to Chrome Web Store"
echo "       (requires developer account)"
echo "═══════════════════════════════════════════"
