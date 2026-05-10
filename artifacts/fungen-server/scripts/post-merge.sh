#!/bin/bash
set -e

echo "==> Post-merge setup: verifying Python environment..."

python - <<'PYCHECK'
import sys
import importlib

required = ["flask", "flask_socketio", "cv2", "numpy", "PIL"]
missing = []
for mod in required:
    try:
        importlib.import_module(mod)
    except ImportError:
        missing.append(mod)

if missing:
    print(f"WARNING: missing packages: {missing}", file=sys.stderr)
    # Non-fatal: the workflow will surface real errors at startup
else:
    print("All core packages available.")
PYCHECK

echo "==> Post-merge setup complete."
