#!/usr/bin/env python
"""
Smoke test for the three Windows PyInstaller builds:
  - HapticAI.exe          (RTX 30xx / 40xx, CUDA 12.8)
  - HapticAI-50series.exe (RTX 50xx, CUDA 12.9)
  - HapticAI-CPU.exe      (CPU-only)

Each binary is launched, then the test waits for the server to write its
port file and startup.log, confirms the HTTP server responds, and verifies
that Flask-SocketIO logged "async_mode=threading" and that no
"Invalid async_mode" crash occurred.

Usage (run from the hapticai-server directory after build_windows.bat):
    python smoke_test_windows_builds.py
"""

import os
import sys
import time
import urllib.request
import subprocess
from pathlib import Path

HERE = Path(__file__).parent

BUILDS = [
    {
        "name": "HapticAI (standard / CUDA 12.8)",
        "exe": HERE / "dist" / "HapticAI" / "HapticAI.exe",
    },
    {
        "name": "HapticAI-50series (CUDA 12.9)",
        "exe": HERE / "dist" / "HapticAI-50series" / "HapticAI-50series.exe",
    },
    {
        "name": "HapticAI-CPU (CPU-only)",
        "exe": HERE / "dist" / "HapticAI-CPU" / "HapticAI-CPU.exe",
    },
]

PORT_FILE = (
    Path(os.environ.get("LOCALAPPDATA", Path.home() / "AppData" / "Local"))
    / "HapticAI"
    / "hapticai_port.txt"
)
STARTUP_LOG = (
    Path(os.environ.get("APPDATA", Path.home() / "AppData" / "Roaming"))
    / "HapticAI"
    / "startup.log"
)
ERROR_LOG = (
    Path(os.environ.get("APPDATA", Path.home() / "AppData" / "Roaming"))
    / "HapticAI"
    / "error.log"
)

STARTUP_TIMEOUT_S = 30
LOG_SETTLE_S = 5
HTTP_TIMEOUT_S = 5
ASYNC_MODE_MARKER = "Flask-SocketIO initialised with async_mode=threading"
CRASH_MARKER = "ValueError: Invalid async_mode"


def _wait_for_file(path: Path, timeout: float) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if path.exists() and path.stat().st_size > 0:
            return True
        time.sleep(0.5)
    return False


def _read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ""


def _http_get(url: str) -> tuple:
    try:
        with urllib.request.urlopen(url, timeout=HTTP_TIMEOUT_S) as resp:
            return True, f"HTTP {resp.status}"
    except urllib.error.HTTPError as exc:
        return True, f"HTTP {exc.code}"
    except Exception as exc:
        return False, str(exc)


def run_smoke_test(build: dict) -> dict:
    name = build["name"]
    exe = build["exe"]

    result = {
        "name": name,
        "exe": str(exe),
        "passed": False,
        "notes": [],
    }

    if not exe.exists():
        result["notes"].append(f"FAIL — exe not found: {exe}")
        result["notes"].append("       Run build_windows.bat first, then re-run this script.")
        return result

    for f in (PORT_FILE, STARTUP_LOG, ERROR_LOG):
        try:
            f.unlink(missing_ok=True)
        except OSError:
            pass

    print(f"\n{'─'*60}")
    print(f"  Launching: {name}")
    print(f"  Path:      {exe}")

    proc = subprocess.Popen(
        [str(exe)],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0,
    )

    try:
        port_ok = _wait_for_file(PORT_FILE, STARTUP_TIMEOUT_S)
        if not port_ok:
            result["notes"].append(
                f"FAIL — port file never appeared within {STARTUP_TIMEOUT_S}s"
            )
            error_text = _read_text(ERROR_LOG)
            if CRASH_MARKER in error_text:
                result["notes"].append(f"FAIL — error log contains: '{CRASH_MARKER}'")
            elif error_text:
                result["notes"].append(
                    f"       error.log excerpt: {error_text[:300]}"
                )
            return result

        port_str = PORT_FILE.read_text(encoding="utf-8").strip()
        try:
            port = int(port_str)
        except ValueError:
            result["notes"].append(
                f"FAIL — port file contained unexpected value: {port_str!r}"
            )
            return result

        print(f"  Port:      {port}")

        _wait_for_file(STARTUP_LOG, LOG_SETTLE_S)

        startup_text = _read_text(STARTUP_LOG)
        error_text = _read_text(ERROR_LOG)

        if CRASH_MARKER in startup_text or CRASH_MARKER in error_text:
            result["notes"].append(f"FAIL — log contains: '{CRASH_MARKER}'")
            return result

        if ASYNC_MODE_MARKER in startup_text:
            result["notes"].append(
                f"OK   — startup.log confirms: '{ASYNC_MODE_MARKER}'"
            )
        else:
            result["notes"].append(
                f"FAIL — async_mode marker not found in startup.log"
            )
            result["notes"].append(
                f"       Expected: '{ASYNC_MODE_MARKER}'"
            )
            if startup_text:
                result["notes"].append(
                    f"       startup.log excerpt: {startup_text[:300]}"
                )
            return result

        http_ok, http_msg = _http_get(f"http://127.0.0.1:{port}/")
        if http_ok:
            result["notes"].append(f"OK   — HTTP server responded: {http_msg}")
            result["passed"] = True
        else:
            result["notes"].append(
                f"FAIL — HTTP server did not respond: {http_msg}"
            )

    finally:
        try:
            proc.terminate()
            proc.wait(timeout=5)
        except Exception:
            try:
                proc.kill()
            except Exception:
                pass

        for f in (PORT_FILE, STARTUP_LOG, ERROR_LOG):
            try:
                f.unlink(missing_ok=True)
            except OSError:
                pass

    return result


def main() -> int:
    print("=" * 60)
    print("  HapticAI Windows Build Smoke Tests")
    print("  Verifies all three .exe variants start without errors")
    print("=" * 60)

    missing = [b for b in BUILDS if not b["exe"].exists()]
    if missing:
        print("\n  ERROR: The following builds are missing. Run build_windows.bat first:")
        for b in missing:
            print(f"    {b['exe']}")
        return 1

    results = [run_smoke_test(b) for b in BUILDS]

    print(f"\n{'='*60}")
    print("  RESULTS")
    print(f"{'='*60}")

    passed = 0
    failed = 0

    for r in results:
        status = "PASS" if r["passed"] else "FAIL"
        if r["passed"]:
            passed += 1
        else:
            failed += 1

        print(f"\n  [{status}] {r['name']}")
        for note in r["notes"]:
            print(f"        {note}")

    print(f"\n{'─'*60}")
    print(f"  {passed} passed  |  {failed} failed  (out of {len(BUILDS)} builds)")
    print(f"{'─'*60}")

    if failed:
        print(
            "\n  One or more builds failed. See notes above, then re-run "
            "build_windows.bat and retry."
        )
        return 1

    print("\n  All three builds passed smoke tests.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
