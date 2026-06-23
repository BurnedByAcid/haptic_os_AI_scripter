#!/usr/bin/env bash
set -euo pipefail

echo "============================================================"
echo " HapticAI (Beta) macOS Build Script"
echo "============================================================"

# Check Python 3.10+
PYTHON=$(command -v python3.11 || command -v python3.10 || command -v python3)
if [ -z "$PYTHON" ]; then
    echo "ERROR: Python 3.10 or 3.11 required. Install via Homebrew: brew install python@3.11"
    exit 1
fi

PY_VERSION=$("$PYTHON" -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')")
echo "Using Python $PY_VERSION at $PYTHON"

# Create venv
echo "[1/5] Creating virtual environment..."
rm -rf build_venv
"$PYTHON" -m venv build_venv
# shellcheck disable=SC1091
source build_venv/bin/activate

# Install build tools
echo "[2/5] Installing build tools..."
pip install --upgrade pip wheel pyinstaller

# Install HapticAI dependencies from official requirements files
echo "[3/5] Installing HapticAI dependencies..."

# Core requirements (imgui/glfw/moderngl install fine on macOS headless build hosts)
pip install -r core.requirements.txt --ignore-requires-python

# Web-mode and CORS deps
pip install -r web.requirements.txt

# Override: use headless OpenCV (no window-system dependency for server process)
pip install opencv-python-headless --upgrade flask-cors

# CPU/MPS torch from cpu.requirements.txt
ARCH=$(uname -m)
if [ "$ARCH" = "arm64" ]; then
    echo "  Detected Apple Silicon — installing MPS-compatible torch..."
    pip install -r cpu.requirements.txt
else
    echo "  Detected Intel Mac — installing CPU torch..."
    pip install -r cpu.requirements.txt --index-url https://download.pytorch.org/whl/cpu
fi

# Build
echo "[4/5] Running PyInstaller..."
pyinstaller hapticai_macos.spec --clean --noconfirm

# Check result
BUNDLE="dist/HapticAI.app"
BINARY="dist/HapticAI"

if [ -d "$BUNDLE" ]; then
    echo "[5/5] Done! macOS app bundle:"
    echo "  $BUNDLE"
    du -sh "$BUNDLE"
elif [ -f "$BINARY" ]; then
    echo "[5/5] Done! macOS binary:"
    echo "  $BINARY"
    du -sh "$BINARY"
else
    echo "ERROR: Build failed. Check output above."
    deactivate
    exit 1
fi

deactivate

echo ""
echo "To test:  $BINARY"
echo "HapticAI reads the port from hapticai_port.txt (created at startup)."
