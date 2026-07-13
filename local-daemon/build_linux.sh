#!/usr/bin/env bash
# ── AIScripter Linux build script ────────────────────────────────────────────
# Produces AIScripter-linux-x86_64.tar.gz via:
#   1. cargo build --release for x86_64-unknown-linux-gnu
#   2. PyInstaller freeze for the Python engine
#   3. tar.gz archive of daemon + engine bundle
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
DIST_DIR="$SCRIPT_DIR/dist"
ENGINE_DIR="$ROOT_DIR/ai-engine"
STAGE_DIR="$DIST_DIR/AIScripter-linux"

echo "=== AIScripter Linux Build ==="
echo

mkdir -p "$DIST_DIR" "$STAGE_DIR"

# ── Step 1: Rust binary ───────────────────────────────────────────────────────
echo "[1/3] Building Rust daemon for x86_64-unknown-linux-gnu..."
pushd "$SCRIPT_DIR"
rustup target add x86_64-unknown-linux-gnu 2>/dev/null || true
cargo build --release --target x86_64-unknown-linux-gnu
DAEMON_BIN="target/x86_64-unknown-linux-gnu/release/local-daemon"
cp "$DAEMON_BIN" "$STAGE_DIR/AIScripter"
chmod +x "$STAGE_DIR/AIScripter"
popd
echo "      Done: $STAGE_DIR/AIScripter"
echo

# ── Step 2: PyInstaller freeze for Python engine ──────────────────────────────
echo "[2/3] Freezing Python engine with PyInstaller..."
pushd "$ENGINE_DIR"
if [ ! -d venv ]; then
    python3 -m venv venv
    source venv/bin/activate
    pip install --quiet pyinstaller
    if [ -f requirements.txt ]; then
        pip install --quiet -r requirements.txt
    fi
else
    source venv/bin/activate
fi
pyinstaller --onedir --name engine --distpath "$DIST_DIR/engine_dist" engine.py
deactivate
popd
cp -R "$DIST_DIR/engine_dist/engine" "$STAGE_DIR/engine"
echo "      Done: $STAGE_DIR/engine/"
echo

# ── Step 3: Write launcher and create tarball ─────────────────────────────────
echo "[3/3] Creating tar.gz archive..."

# Launcher script so users can just run ./aiscripter.sh
cat > "$STAGE_DIR/aiscripter.sh" << 'LAUNCHER'
#!/usr/bin/env bash
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "$DIR/AIScripter" --engine "$DIR/engine/engine" "$@"
LAUNCHER
chmod +x "$STAGE_DIR/aiscripter.sh"

TARBALL="$DIST_DIR/AIScripter-linux-x86_64.tar.gz"
tar -czf "$TARBALL" -C "$DIST_DIR" AIScripter-linux

echo
echo "=== Build complete ==="
echo "Output: $TARBALL"
