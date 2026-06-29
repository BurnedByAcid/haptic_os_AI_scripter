# build_windows.bat — Known Errors & Warnings

This file documents every warning or error that appears during a normal
`build_windows.bat` run, whether it is safe to ignore, and what was done
(or must be done) to address it.

---

## ✅ Safe to ignore

### `ModuleNotFoundError: No module named 'tensorboard'`
- **Where**: Stage 4 / 7 / 10 — PyInstaller analysis of `torch.utils.tensorboard`
- **Message**: `WARNING: Failed to collect submodules for 'torch.utils.tensorboard'`
- **Why**: TensorBoard is not installed in the build venv (not needed). PyInstaller warns when a hook tries to collect a missing optional module.
- **Impact**: None — TensorBoard is not used by HapticAI.

### `DeprecationWarning: torch.distributed._sharding_spec will be deprecated …`
- **Where**: Stage 4 / 7 / 10 — PyInstaller torch hook
- **Why**: PyInstaller imports every torch sub-module during analysis, triggering PyTorch's own deprecation warnings for internal APIs.
- **Impact**: None — these are warnings inside torch itself, not errors.

### `DeprecationWarning: torch.distributed._sharded_tensor will be deprecated …`
- Same as above. Safe to ignore.

### `DeprecationWarning: torch.distributed._shard.checkpoint will be deprecated …`
- Same as above. Safe to ignore.

### `NOTE: Redirects are currently not supported in Windows or MacOs.`
- **Where**: Stage 4 / 7 / 10 — torch.distributed.elastic import
- **Why**: PyTorch's elastic training redirects aren't supported on Windows; informational only.
- **Impact**: None.

---

## ⚠️ Expected conflicts — fixed by the script

### `ultralytics 8.3.78 requires numpy<=2.1.1,>=1.23.0, but you have numpy 2.4.4`
- **Where**: Stage 9 — after CPU PyTorch install
- **Why**: `torchvision`'s `--force-reinstall` pulls in the latest numpy (2.4.4), overriding the pin from Stage 3.
- **Fix applied**: `build_windows.bat` re-pins numpy immediately after the CPU install with `pip install "numpy>=1.23.0,<=2.1.1" --force-reinstall`.
- **Status**: Resolved automatically before Stage 10 runs.

### `torchaudio X.X.X+cuXXX requires torch==X.X.X+cuXXX, but you have torch Y.Y.Y+cpu`
- **Where**: Stage 9 — after CPU PyTorch install
- **Why**: torchaudio from the 50-series CUDA build (Stage 6) lingers in the venv. CPU torch is a different version so torchaudio conflicts.
- **Fix applied**: `build_windows.bat` runs `pip uninstall torchaudio -y` right after the CPU install. torchaudio is not needed for the CPU build.
- **Status**: Resolved automatically before Stage 10 runs.

---

## ⚠️ Expected auto-installs — fixed by requirements

### `ultralytics: requirements: ['lap>=0.5.12'] not found, attempting AutoUpdate…`
- **Where**: Stage 4 — first PyInstaller run
- **Why**: `lap` is a dependency of ultralytics' tracker. If it isn't in the venv before PyInstaller starts, ultralytics auto-installs it mid-run. PyInstaller has already begun analysis so `lap` is NOT bundled in the resulting binary.
- **Fix applied**: `lap>=0.5.12` is now listed in `core.requirements.txt` so it is installed in Stage 3, before any PyInstaller run.
- **Status**: Should not appear any more. If it reappears, re-check `core.requirements.txt`.

---

## ❌ Real errors — must be fixed before the build can succeed

### `ERROR: PyInstaller standard/50-series/CPU build failed`
- **Where**: Stages 4, 7, or 10
- **Why**: PyInstaller exited non-zero. Check the PyInstaller output above the error line for the root cause.
- **Common causes**:
  - Missing source file or data directory listed in the `.spec`
  - Import error during analysis (look for `ModuleNotFoundError` or `ImportError` in the log)
  - Out-of-disk-space during the large torch bundle

### `ERROR: Inno Setup standard/50-series/CPU build failed`
- **Where**: Stages 5, 8, or 11
- **Why**: ISCC exited non-zero.
- **Common causes**:
  - `dist\HapticAI\` folder missing (PyInstaller stage before it also failed)
  - Inno Setup 6 not installed, or `ISCC` not in PATH

### `ValueError: Invalid async_mode specified` (runtime — not a build error)
- **Where**: Inside the packaged `.exe` at startup
- **Why**: Old spec files listed `engineio.async_threading` / `socketio.async_threading` — module paths from python-engineio 3.x. Current 4.x+ packages moved the drivers to `engineio.async_drivers.threading`.
- **Fix applied**: All three `.spec` files now list `engineio.async_drivers.threading` and `socketio.async_drivers.threading` as hidden imports.
- **Status**: Resolved. If it reappears after a package update, check the engineio version.

---

## Notes on dependency pinning

| Package | Pin | Reason |
|---|---|---|
| `numpy` | `>=1.23.0,<=2.1.1` | ultralytics 8.3.78 hard cap |
| `lap` | `>=0.5.12` | ultralytics tracker; must be pre-installed before PyInstaller |
| `scipy` | `>=1.15.1,<1.16` | avoids meson-python build failures on Python 3.11 |
| `pillow` | `>=11.2.1,<12` | pillow 12 drops Python 3.11 support |
| `imgui` | `<3` | imgui 3+ requires Python 3.12 |
| `meson-python` | `<0.18` (build constraint) | 0.18+ requires Python 3.12; set via `PIP_CONSTRAINT` |
