#!/usr/bin/env bash
# ── AIScripter Python engine build script (Linux / macOS) ───────────────────
# Produces a PyInstaller one-folder bundle at dist/engine/
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DIST_DIR="${1:-$SCRIPT_DIR/dist}"

echo "=== Building AIScripter Python engine ==="
echo "Output: $DIST_DIR/engine"

cd "$SCRIPT_DIR"

if [ ! -d venv ]; then
    echo "Creating virtualenv..."
    python3 -m venv venv
fi

source venv/bin/activate
pip install --quiet --upgrade pip
pip install --quiet pyinstaller
if [ -f requirements.txt ]; then
    pip install --quiet -r requirements.txt
fi

pyinstaller \
    --onedir \
    --name engine \
    --distpath "$DIST_DIR" \
    --clean \
    engine.py

deactivate
echo "=== Done: $DIST_DIR/engine/ ==="
