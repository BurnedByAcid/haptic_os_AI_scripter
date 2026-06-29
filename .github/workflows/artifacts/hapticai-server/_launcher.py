"""
HapticAI bootstrap launcher.

This module is the PyInstaller entry point.  It sets up an early crash
handler *before* importing web_app, so any failure — including missing
hidden imports or a bad SocketIO async_mode at module level — produces
a visible error dialog rather than a silent exit.

Flow
----
1. Set up the error-log path (pure stdlib, cannot fail).
2. Try to run web_app as __main__ via runpy (works in frozen builds).
3. On any unexpected exception: write the traceback to error.log, show
   a Windows MessageBox (or stderr fallback on other platforms), and
   exit with code 1.
"""

import os
import sys
import traceback
from pathlib import Path

_log_dir = Path(os.environ.get("APPDATA", str(Path.home()))) / "HapticAI"
try:
    _log_dir.mkdir(parents=True, exist_ok=True)
except Exception:
    _log_dir = Path.home()
_error_log = _log_dir / "error.log"


def _show_crash_dialog(tb: str) -> None:
    _short = tb.strip().splitlines()[-1] if tb.strip() else "Unknown error"
    _msg = (
        "HapticAI failed to start.\n\n"
        f"{_short}\n\n"
        f"Full details have been saved to:\n{_error_log}\n\n"
        "Please attach that file when reporting this issue."
    )

    _shown = False
    if sys.platform == "win32":
        try:
            import ctypes as _ctypes
            _ctypes.windll.user32.MessageBoxW(
                0, _msg, "HapticAI \u2013 Startup Error",
                0x10010,  # MB_OK | MB_ICONERROR | MB_SETFOREGROUND
            )
            _shown = True
        except Exception:
            pass

    if not _shown:
        print("\n" + "=" * 60, file=sys.stderr)
        print("HapticAI STARTUP ERROR", file=sys.stderr)
        print("=" * 60, file=sys.stderr)
        print(_msg, file=sys.stderr)
        print("=" * 60 + "\n", file=sys.stderr)


try:
    import runpy as _runpy
    _runpy.run_module("web_app", run_name="__main__", alter_sys=True)

except SystemExit:
    raise

except Exception:
    _tb = traceback.format_exc()
    try:
        _error_log.write_text(_tb, encoding="utf-8")
    except Exception:
        pass
    _show_crash_dialog(_tb)
    sys.exit(1)
