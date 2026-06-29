#!/usr/bin/env bash
# check_installer_urls.sh
#
# Extracts every INSTALLER_URL defined in install.sh and install.bat, then
# verifies each one returns HTTP 200.  Exit code 0 = all OK, 1 = any failure.
#
# Variable references such as ${INSTALLER_TAG} (shell) and !INSTALLER_TAG!
# (batch) are resolved by reading the INSTALLER_TAG assignment from each file
# before the URL is checked.
#
# NOTE: All regex patterns that contain literal " characters are stored in
# variables rather than written inline.  Inline " inside [[ =~ ]] triggers
# bash quoting and makes the captured group a literal string, breaking
# extraction.  Variable-form patterns bypass that interpretation.
#
# Usage:
#   bash artifacts/hapticai-server/check_installer_urls.sh
#
# Run automatically via the "Check installer URLs" GitHub Actions workflow, or
# locally before committing changes to the installer scripts.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

INSTALL_SH="$SCRIPT_DIR/install.sh"
INSTALL_BAT="$SCRIPT_DIR/install.bat"

# ---------------------------------------------------------------------------
# Regex patterns — stored in variables so bash does not apply quote-removal
# to the " characters inside [[ =~ ]], which would treat the captured-group
# syntax as a literal string rather than a regex.
# ---------------------------------------------------------------------------
# Shell-script form:  INSTALLER_TAG="v1.0.0"
PAT_SH_TAG='INSTALLER_TAG[[:space:]]*=[[:space:]]*"([^"]+)"'
# Shell-script form:  INSTALLER_URL="https://..."
PAT_SH_URL='INSTALLER_URL[[:space:]]*=[[:space:]]*"([^"]+)"'
# Batch form:  set "INSTALLER_TAG=v1.0.0"
PAT_BAT_TAG='[Ss][Ee][Tt][[:space:]]+"INSTALLER_TAG=([^"]+)"'
# Batch form:  set "INSTALLER_URL=https://..."
PAT_BAT_URL='[Ss][Ee][Tt][[:space:]]+"INSTALLER_URL=([^"]+)"'
# Batch bare form:  INSTALLER_URL=https://...  (no surrounding quotes)
PAT_BAT_BARE='^[[:space:]]*INSTALLER_URL=([^[:space:]"]+)'

declare -a URLS=()
declare -a SOURCES=()

# ---------------------------------------------------------------------------
# Helper: substitute a known tag value into a URL template that may still
# contain ${INSTALLER_TAG} (shell form) or !INSTALLER_TAG! (batch form).
# ---------------------------------------------------------------------------
expand_installer_tag() {
    local url="$1"
    local tag="$2"
    # Replace shell-style reference
    url="${url//\$\{INSTALLER_TAG\}/$tag}"
    # Replace batch-style reference
    url="${url//!INSTALLER_TAG!/$tag}"
    echo "$url"
}

# --- Extract INSTALLER_TAG and INSTALLER_URL from install.sh ---
if [ -f "$INSTALL_SH" ]; then
    SH_TAG=""
    while IFS= read -r line; do
        if [[ "$line" =~ $PAT_SH_TAG ]]; then
            SH_TAG="${BASH_REMATCH[1]}"
        fi
        if [[ "$line" =~ $PAT_SH_URL ]]; then
            raw_url="${BASH_REMATCH[1]}"
            expanded="$(expand_installer_tag "$raw_url" "${SH_TAG:-}")"
            URLS+=("$expanded")
            SOURCES+=("install.sh")
        fi
    done < "$INSTALL_SH"
else
    echo "[WARN] install.sh not found at $INSTALL_SH"
fi

# --- Extract INSTALLER_TAG and INSTALLER_URL from install.bat ---
if [ -f "$INSTALL_BAT" ]; then
    BAT_TAG=""
    while IFS= read -r line; do
        # Strip Windows CR if present
        line="${line%$'\r'}"

        if [[ "$line" =~ $PAT_BAT_TAG ]]; then
            BAT_TAG="${BASH_REMATCH[1]}"
        fi

        if [[ "$line" =~ $PAT_BAT_URL ]]; then
            raw_url="${BASH_REMATCH[1]}"
            expanded="$(expand_installer_tag "$raw_url" "${BAT_TAG:-}")"
            URLS+=("$expanded")
            SOURCES+=("install.bat")
        elif [[ "$line" =~ $PAT_BAT_BARE ]]; then
            raw_url="${BASH_REMATCH[1]}"
            expanded="$(expand_installer_tag "$raw_url" "${BAT_TAG:-}")"
            URLS+=("$expanded")
            SOURCES+=("install.bat")
        fi
    done < "$INSTALL_BAT"
else
    echo "[WARN] install.bat not found at $INSTALL_BAT"
fi

if [ ${#URLS[@]} -eq 0 ]; then
    echo "[ERROR] No INSTALLER_URL definitions found in install.sh or install.bat."
    exit 1
fi

# --- De-duplicate (same URL appearing in both files is only checked once) ---
declare -a UNIQUE_URLS=()
declare -a UNIQUE_SOURCES=()

for i in "${!URLS[@]}"; do
    url="${URLS[$i]}"
    already=false
    for seen in "${UNIQUE_URLS[@]+"${UNIQUE_URLS[@]}"}"; do
        if [ "$seen" = "$url" ]; then
            already=true
            break
        fi
    done
    if ! $already; then
        UNIQUE_URLS+=("$url")
        UNIQUE_SOURCES+=("${SOURCES[$i]}")
    fi
done

# --- Check each URL ---
FAILED=0

for i in "${!UNIQUE_URLS[@]}"; do
    url="${UNIQUE_URLS[$i]}"
    src="${UNIQUE_SOURCES[$i]}"

    printf "Checking %-60s (from %s) ... " "$url" "$src"

    HTTP_STATUS=$(curl --silent --output /dev/null --write-out "%{http_code}" \
        --max-time 15 --location "$url") || HTTP_STATUS="000"

    if [ "$HTTP_STATUS" = "200" ]; then
        echo "OK ($HTTP_STATUS)"
    else
        echo "FAIL ($HTTP_STATUS)"
        FAILED=$((FAILED + 1))
    fi
done

echo ""
if [ "$FAILED" -eq 0 ]; then
    echo "All installer URLs are reachable."
    exit 0
else
    echo "[ERROR] $FAILED installer URL(s) did not return HTTP 200. Fix the URL(s) before merging."
    exit 1
fi
