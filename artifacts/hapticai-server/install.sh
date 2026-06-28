#!/bin/bash
# HapticAI Universal Bootstrap Installer for Linux/macOS
# Version: 1.0.2
# This script requires ZERO dependencies - only uses POSIX shell built-ins
# Downloads and runs the full Python installer

set -e  # Exit on any error

BOOTSTRAP_VERSION="1.0.2"

# Check for help or common invalid flags
for arg in "$@"; do
    case $arg in
        -h|--help)
            echo "HapticAI Bootstrap Installer"
            echo "Usage: $0 [options]"
            echo ""
            echo "This script downloads and installs HapticAI automatically."
            echo "All options are passed to the universal installer."
            echo ""
            echo "Common options:"
            echo "  --force     Force reinstallation"
            echo "  --uninstall Run uninstaller instead"
            echo "  --help      Show this help"
            echo ""
            exit 0
            ;;
        -u)
            echo "ERROR: '-u' is not a valid option."
            echo "Did you mean '--uninstall' or '--force'?"
            echo "Run '$0 --help' for available options."
            exit 1
            ;;
    esac
done

echo "=========================================="
echo "     HapticAI Bootstrap Installer"
echo "            v${BOOTSTRAP_VERSION}"
echo "=========================================="
echo ""
echo "This installer will download and install everything needed:"
echo "  - Python 3.11 (Miniconda)"
echo "  - Git"
echo "  - FFmpeg/FFprobe"
echo "  - HapticAI AI and all dependencies"
echo ""
echo "Note: You may be prompted for your password to install system packages"
echo "      (Git, FFmpeg) via your system's package manager."
echo ""

# Detect OS and architecture
OS=$(uname -s)
ARCH=$(uname -m)

# On macOS, detect ACTUAL hardware (not just the running process architecture)
# This is important because the script might be running under Rosetta on Apple Silicon
if [ "$OS" = "Darwin" ]; then
    if sysctl -n hw.optional.arm64 2>/dev/null | grep -q 1; then
        HARDWARE_ARCH="arm64"
        if [ "$ARCH" = "x86_64" ]; then
            echo "NOTE: Detected Apple Silicon hardware, but running under Rosetta (x86_64)"
            echo "      Will install ARM64 native Miniconda for best performance"
            echo ""
        fi
        ARCH="arm64"  # Override to install native ARM64 version
    else
        HARDWARE_ARCH="x86_64"
    fi
fi

case $OS in
    Linux*)
        PLATFORM="Linux"
        PYTHON_URL="https://repo.anaconda.com/miniconda/Miniconda3-latest-Linux-x86_64.sh"
        if [ "$ARCH" = "aarch64" ] || [ "$ARCH" = "arm64" ]; then
            PYTHON_URL="https://repo.anaconda.com/miniconda/Miniconda3-latest-Linux-aarch64.sh"
        fi
        ;;
    Darwin*)
        PLATFORM="macOS"
        PYTHON_URL="https://repo.anaconda.com/miniconda/Miniconda3-latest-MacOSX-x86_64.sh"
        if [ "$ARCH" = "arm64" ]; then
            PYTHON_URL="https://repo.anaconda.com/miniconda/Miniconda3-latest-MacOSX-arm64.sh"
            echo "NOTE: Installing ARM64 native Miniconda for Apple Silicon"
            echo ""
        fi
        ;;
    *)
        echo "ERROR: Unsupported operating system: $OS"
        exit 1
        ;;
esac

echo "Detected: $PLATFORM ($ARCH)"
echo ""

# Create temp directory
TEMP_DIR=$(mktemp -d)
trap "rm -rf $TEMP_DIR" EXIT

# Configuration
# RELEASE: Pin to a specific tag so installs are reproducible and won't break
# silently when main changes. Update INSTALLER_TAG and INSTALLER_SHA256 each
# time a new installer is published.
INSTALLER_TAG="v1.0.0"
# INSTALLER_URL points to the API server's /api/hapticai/install.py route.
# The fallback is the Replit dev-domain URL (always reachable during development).
# Set HAPTICAI_BASE_URL to your production / custom domain to override it.
INSTALLER_URL="https://1496e5f1-f302-402a-b2dd-cd25d95f85b5-00-3k43daw6ksczj-pzce384d.riker.replit.dev/api/hapticai/install.py"
# Allow override via HAPTICAI_BASE_URL for production / custom-domain deployments.
# Unquoted RHS keeps check_installer_urls.sh from treating the unexpanded
# variable reference as a URL to validate (its regex requires "..." around the value).
if [ -n "${HAPTICAI_BASE_URL:-}" ]; then
    INSTALLER_URL=${HAPTICAI_BASE_URL}/api/hapticai/install.py
fi
# SHA-256 of install.py at the pinned tag above.
# Run: sha256sum install.py  (Linux) or  shasum -a 256 install.py  (macOS)
# Replace this value whenever INSTALLER_TAG is bumped.
INSTALLER_SHA256="PLACEHOLDER_REPLACE_WITH_SHA256_OF_install.py_AT_${INSTALLER_TAG}"
PYTHON_INSTALLER="$TEMP_DIR/miniconda-installer.sh"
UNIVERSAL_INSTALLER="$TEMP_DIR/install.py"
MINICONDA_PATH="$HOME/miniconda3"

# Function to download files (tries multiple methods)
download_file() {
    local url=$1
    local output=$2
    local description=$3
    
    echo "  Downloading $description..."
    
    # Try curl first (most common)
    if command -v curl >/dev/null 2>&1; then
        curl -fsSL "$url" -o "$output"
        return $?
    fi
    
    # Try wget as fallback
    if command -v wget >/dev/null 2>&1; then
        wget -q "$url" -O "$output"
        return $?
    fi
    
    # Try python if available (unlikely but possible)
    if command -v python3 >/dev/null 2>&1; then
        python3 -c "
import urllib.request
urllib.request.urlretrieve('$url', '$output')
"
        return $?
    fi
    
    echo "ERROR: No download tool available (curl, wget, or python3)"
    return 1
}

# Function to handle interactive package installations
handle_interactive_install() {
    local cmd=("$@")
    echo "  Note: This installation may require your interaction (password, agreement acceptance)"
    echo "  Running: ${cmd[*]}"
    if ! "${cmd[@]}"; then
        echo "  Installation failed. You may need to run this command manually:"
        echo "    sudo ${cmd[*]}"
        return 1
    fi
    return 0
}

echo "[1/4] Checking Python installation..."

# Check if existing miniconda is the wrong architecture
WRONG_ARCH=0
if [ -d "$MINICONDA_PATH" ] && [ -f "$MINICONDA_PATH/bin/python" ]; then
    INSTALLED_ARCH=$(file "$MINICONDA_PATH/bin/python" | grep -o "x86_64\|arm64" | head -1)
    if [ "$ARCH" = "arm64" ] && [ "$INSTALLED_ARCH" = "x86_64" ]; then
        echo "    WARNING: Found x86_64 (Intel) Miniconda on Apple Silicon Mac!"
        echo "    This will cause performance issues and prevent CoreML model conversion."
        echo "    Would you like to reinstall with ARM64 (native) Miniconda? [y/N]"
        read -r response
        if [ "$response" = "y" ] || [ "$response" = "Y" ]; then
            echo "    Backing up old Miniconda to $HOME/miniconda3.x86_64.backup..."
            mv "$MINICONDA_PATH" "$HOME/miniconda3.x86_64.backup"
            WRONG_ARCH=1
        else
            echo "    Continuing with x86_64 Miniconda (running under Rosetta 2)..."
            echo "    Note: CoreML model conversion will not work."
        fi
    fi
fi

if [ -d "$MINICONDA_PATH" ] && [ "$WRONG_ARCH" -eq 0 ]; then
    echo "    Miniconda already installed, skipping download..."
else
    echo "    Downloading Miniconda installer..."
    if ! download_file "$PYTHON_URL" "$PYTHON_INSTALLER" "Miniconda"; then
        echo "ERROR: Failed to download Miniconda installer"
        exit 1
    fi
    echo "    Miniconda installer downloaded successfully"
fi

echo ""
echo "[2/4] Installing Miniconda..."
if [ -d "$MINICONDA_PATH" ] && [ "$WRONG_ARCH" -eq 0 ]; then
    echo "    Miniconda already installed at $MINICONDA_PATH"
    echo "    Using existing installation..."
else
    echo "    This may take a few minutes..."
    chmod +x "$PYTHON_INSTALLER"
    "$PYTHON_INSTALLER" -b -p "$MINICONDA_PATH"
    if [ $? -ne 0 ]; then
        echo "ERROR: Miniconda installation failed"
        exit 1
    fi
    echo "    Miniconda installed successfully"
fi

# Add conda to PATH for this session
export PATH="$MINICONDA_PATH/bin:$PATH"

echo ""
echo "[3/4] Downloading HapticAI universal installer..."
if ! download_file "$INSTALLER_URL" "$UNIVERSAL_INSTALLER" "HapticAI universal installer"; then
    echo "ERROR: Failed to download universal installer"
    exit 1
fi
echo "    Universal installer downloaded successfully"

# Verify SHA-256 checksum so a tampered or partial download is caught early.
# Skip verification only if the placeholder has not been replaced yet.
if [[ "$INSTALLER_SHA256" != PLACEHOLDER_* ]]; then
    echo "    Verifying checksum..."
    if command -v sha256sum >/dev/null 2>&1; then
        ACTUAL_SHA256=$(sha256sum "$UNIVERSAL_INSTALLER" | awk '{print $1}')
    elif command -v shasum >/dev/null 2>&1; then
        ACTUAL_SHA256=$(shasum -a 256 "$UNIVERSAL_INSTALLER" | awk '{print $1}')
    else
        echo "    WARNING: No sha256sum/shasum tool found — skipping checksum verification"
        ACTUAL_SHA256="$INSTALLER_SHA256"
    fi
    if [ "$ACTUAL_SHA256" != "$INSTALLER_SHA256" ]; then
        echo "ERROR: Checksum mismatch for install.py"
        echo "  Expected: $INSTALLER_SHA256"
        echo "  Got:      $ACTUAL_SHA256"
        echo "  The downloaded file may be corrupt or tampered with."
        echo "  Please re-run this script or download install.py manually."
        exit 1
    fi
    echo "    Checksum verified"
else
    echo "    WARNING: Checksum placeholder not replaced — skipping verification."
    echo "             Update INSTALLER_SHA256 in this script for a secure install."
fi

echo ""
echo "[4/4] Running HapticAI universal installer..."
echo "    The universal installer will now handle the complete setup..."
echo ""

# Pass through any command line arguments to the universal installer
# Use the conda python explicitly to avoid system python issues
CONDA_PYTHON="$MINICONDA_PATH/bin/python"
if [ ! -f "$CONDA_PYTHON" ]; then
    echo "WARNING: Conda python not found at $CONDA_PYTHON"
    echo "         Falling back to PATH python"
    CONDA_PYTHON="python"
fi

if [ $# -gt 0 ]; then
    echo "    Passing arguments: $@"
    "$CONDA_PYTHON" "$UNIVERSAL_INSTALLER" --dir "$(pwd)" --bootstrap-version "$BOOTSTRAP_VERSION" "$@"
else
    "$CONDA_PYTHON" "$UNIVERSAL_INSTALLER" --dir "$(pwd)" --bootstrap-version "$BOOTSTRAP_VERSION"
fi
INSTALL_RESULT=$?

if [ $INSTALL_RESULT -eq 0 ]; then
    echo ""
    echo "=========================================="
    echo "    Bootstrap Installation Complete!"
    echo "=========================================="
    echo ""
    echo "HapticAI has been successfully installed."
    echo "Check above for launcher instructions."
else
    echo ""
    echo "=========================================="
    echo "      Installation Failed"
    echo "=========================================="
    echo ""
    echo "Please check the error messages above."
    if [ "$PLATFORM" = "macOS" ]; then
        echo "You may need to install Xcode Command Line Tools:"
        echo "  xcode-select --install"
        echo ""
        echo "For Apple Silicon systems, you may need Rosetta 2:"
        echo "  softwareupdate --install-rosetta"
    fi
fi

exit $INSTALL_RESULT