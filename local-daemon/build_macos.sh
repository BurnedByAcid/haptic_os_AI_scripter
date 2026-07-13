#!/usr/bin/env bash
# ── AIScripter macOS build script ────────────────────────────────────────────
# Produces AIScripter.dmg via:
#   1. cargo build --release for x86_64 and aarch64
#   2. lipo to create a universal binary
#   3. PyInstaller freeze for Python engine
#   4. hdiutil to create the DMG
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
DIST_DIR="$SCRIPT_DIR/dist"
ENGINE_DIR="$ROOT_DIR/ai-engine"
STAGE_DIR="$DIST_DIR/stage"
APP_DIR="$STAGE_DIR/AIScripter.app"
CONTENTS_DIR="$APP_DIR/Contents/MacOS"

echo "=== AIScripter macOS Build ==="
echo

mkdir -p "$DIST_DIR" "$STAGE_DIR" "$CONTENTS_DIR"

# ── Step 1: Rust universal binary ────────────────────────────────────────────
echo "[1/4] Building Rust daemon for x86_64 and arm64..."
pushd "$SCRIPT_DIR"
rustup target add x86_64-apple-darwin aarch64-apple-darwin 2>/dev/null || true
cargo build --release --target x86_64-apple-darwin
cargo build --release --target aarch64-apple-darwin
echo "      Merging with lipo..."
lipo -create \
    target/x86_64-apple-darwin/release/local-daemon \
    target/aarch64-apple-darwin/release/local-daemon \
    -output "$DIST_DIR/AIScripter-universal"
popd
echo "      Done: $DIST_DIR/AIScripter-universal"
echo

# ── Step 2: PyInstaller freeze for Python engine ─────────────────────────────
echo "[2/4] Freezing Python engine with PyInstaller..."
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
echo "      Done: $DIST_DIR/engine_dist/engine/"
echo

# ── Step 3: Assemble .app bundle ─────────────────────────────────────────────
echo "[3/4] Assembling .app bundle..."
cp "$DIST_DIR/AIScripter-universal" "$CONTENTS_DIR/AIScripter"
chmod +x "$CONTENTS_DIR/AIScripter"
cp -R "$DIST_DIR/engine_dist/engine" "$CONTENTS_DIR/engine"

# Minimal Info.plist
cat > "$APP_DIR/Contents/Info.plist" << 'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleExecutable</key>
    <string>AIScripter</string>
    <key>CFBundleIdentifier</key>
    <string>org.hapticos.aiscripter</string>
    <key>CFBundleName</key>
    <string>AIScripter</string>
    <key>CFBundleVersion</key>
    <string>1.0</string>
    <key>CFBundleShortVersionString</key>
    <string>1.0</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>LSMinimumSystemVersion</key>
    <string>11.0</string>
    <key>NSHighResolutionCapable</key>
    <true/>
</dict>
</plist>
PLIST

echo "      Done: $APP_DIR"
echo

# ── Step 4: Create DMG ───────────────────────────────────────────────────────
echo "[4/4] Creating DMG..."
DMG_PATH="$DIST_DIR/AIScripter.dmg"
hdiutil create \
    -volname "AIScripter" \
    -srcfolder "$STAGE_DIR" \
    -ov \
    -format UDZO \
    "$DMG_PATH"

echo
echo "=== Build complete ==="
echo "Output: $DMG_PATH"
