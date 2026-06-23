#!/usr/bin/env bash
# check_installer_urls.sh
#
# Extracts every INSTALLER_URL defined in install.sh and install.bat, then
# verifies each one returns HTTP 200.  Exit code 0 = all OK, 1 = any failure.
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

declare -a URLS=()
declare -a SOURCES=()

# --- Extract URL from install.sh ---
# Matches lines like:  INSTALLER_URL="https://..."
if [ -f "$INSTALL_SH" ]; then
    while IFS= read -r line; do
        if [[ "$line" =~ INSTALLER_URL[[:space:]]*=[[:space:]]*\"([^\"]+)\" ]]; then
            URLS+=("${BASH_REMATCH[1]}")
            SOURCES+=("install.sh")
        fi
    done < "$INSTALL_SH"
else
    echo "[WARN] install.sh not found at $INSTALL_SH"
fi

# --- Extract URL from install.bat ---
# Matches lines like:  set "INSTALLER_URL=https://..."
# The key=value pair is inside the outer quotes, e.g.:
#   set "INSTALLER_URL=https://raw.githubusercontent.com/..."
if [ -f "$INSTALL_BAT" ]; then
    while IFS= read -r line; do
        # Strip Windows CR if present
        line="${line%$'\r'}"

        # Match:  set "INSTALLER_URL=<url>"
        if [[ "$line" =~ [Ss][Ee][Tt][[:space:]]+\"INSTALLER_URL=([^\"]+)\" ]]; then
            URLS+=("${BASH_REMATCH[1]}")
            SOURCES+=("install.bat")
        # Also match bare:  INSTALLER_URL=https://...  (no surrounding quotes)
        elif [[ "$line" =~ ^[[:space:]]*INSTALLER_URL=([^[:space:]\"]+) ]]; then
            URLS+=("${BASH_REMATCH[1]}")
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
