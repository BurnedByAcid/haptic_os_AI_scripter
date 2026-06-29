@echo off
setlocal EnableDelayedExpansion
title HapticAI (Beta) Windows Build

:: Always run from the directory containing this script, regardless of how it was launched
cd /d "%~dp0"

:: ── Self-logging: pipe all output to build_output.log AND the console ────────
:: The inner invocation sets HAPTICAI_LOGGED=1 so it skips this block.
if defined HAPTICAI_LOGGED goto :build_start
set "HAPTICAI_LOGGED=1"
set "BUILD_LOG=%~dp0build_output.log"
del "%BUILD_LOG%" >nul 2>&1
powershell -NoProfile -Command "& { cmd.exe /d /c \"%~f0\" } 2>&1 | Tee-Object -FilePath '%BUILD_LOG%' -Encoding UTF8"
exit /b %ERRORLEVEL%

:build_start

echo ============================================================
echo  HapticAI (Beta) Windows Build Script
echo  Builds THREE installers:
echo    HapticAI-Setup.exe         (RTX 30xx / 40xx, CUDA 12.8)
echo    HapticAI-Setup-50series.exe   (RTX 50xx, CUDA 12.9)
echo    HapticAI-Setup-CPU.exe        (No GPU required, CPU-only)
echo ============================================================

:: ── Python ───────────────────────────────────────────────────────────────────
set "PYTHON_CMD=py -3.11"
for /f "tokens=2" %%V in ('py -3.11 --version 2^>^&1') do echo  Using Python %%V.

:: ── Extract app version from config/constants.py ─────────────────────────
for /f "delims=" %%V in ('py -3.11 get_version.py 2^>^&1') do set "APP_VERSION=%%V"
if "!APP_VERSION!"=="" set "APP_VERSION=0.0.0"
echo  App version: !APP_VERSION!

:: ── Find Inno Setup (64-bit ISCC — handles large PyTorch/CUDA bundles) ───────
set "ISCC=ISCC"
ISCC /? >nul 2>&1
if not errorlevel 1 goto :iscc_found
if exist "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" goto :iscc_x86
if exist "C:\Program Files\Inno Setup 6\ISCC.exe" goto :iscc_x64
echo.
echo ERROR: Inno Setup 6 not found.
echo.
echo   NSIS cannot build installers this large ^(32-bit limit^).
echo   Download and install Inno Setup 6 from:
echo     https://jrsoftware.org/isdl.php
echo   Then re-run this script.
echo.
pause & exit /b 1

:iscc_x86
set "ISCC=C:\Program Files (x86)\Inno Setup 6\ISCC.exe"
echo  Found Inno Setup 6 at Program Files ^(x86^).
goto :iscc_found

:iscc_x64
set "ISCC=C:\Program Files\Inno Setup 6\ISCC.exe"
echo  Found Inno Setup 6 at Program Files.

:iscc_found

:: ── [1/12] Virtual environment ──────────────────────────────────────────────
echo.
echo [1/12] Creating virtual environment using !PYTHON_CMD!...
if exist build_venv rmdir /s /q build_venv
!PYTHON_CMD! -m venv build_venv
call build_venv\Scripts\activate.bat

:: ── [2/12] Build tools ──────────────────────────────────────────────────────
echo [2/12] Installing build tools...
python -m pip install --upgrade pip wheel "pyinstaller<7"

:: Cap meson-python so any source-build uses a Python 3.11 compatible version.
:: PIP_CONSTRAINT propagates into pip's isolated build environments, preventing
:: meson-python >= 0.18 (requires Python 3.12) from being pulled in automatically.
set "PIP_CONSTRAINT=%~dp0build_constraints.txt"

:: ── [3/12] Standard deps (CUDA 12.8 — RTX 30xx / 40xx) ─────────────────────
echo [3/12] Installing standard deps ^(CUDA 12.8 for RTX 30xx/40xx^)...
pip install -r core.requirements.txt --ignore-requires-python
pip install -r cuda.requirements.txt
pip install -r web.requirements.txt
pip install opencv-python-headless --upgrade flask-cors

:: ── [4/12] PyInstaller — standard build ─────────────────────────────────────
echo [4/12] Running PyInstaller ^(standard^)...
pyinstaller hapticai_windows.spec --clean --noconfirm

if not exist dist\HapticAI\HapticAI.exe (
    echo.
    echo ERROR: PyInstaller standard build failed. Check output above.
    call build_venv\Scripts\deactivate.bat
    pause & exit /b 1
)

:: ── [5/12] Inno Setup — standard installer ───────────────────────────────────
echo [5/12] Building standard installer ^(Inno Setup^)...
"!ISCC!" /DAPP_VERSION=!APP_VERSION! installer.iss

if not exist dist\HapticAI-Setup.exe (
    echo.
    echo ERROR: Inno Setup standard build failed. Check output above.
    call build_venv\Scripts\deactivate.bat
    pause & exit /b 1
)

echo  Standard installer OK: dist\HapticAI-Setup.exe
for %%F in (dist\HapticAI-Setup.exe) do echo  Size: %%~zF bytes

:: ── [6/12] Upgrade to 50-series deps (CUDA 12.9 — RTX 50xx) ────────────────
echo.
echo [6/12] Installing 50-series deps ^(CUDA 12.9 for RTX 50xx^)...
pip install -r cuda.50series.requirements.txt --force-reinstall

:: ── [7/12] PyInstaller — 50-series build ────────────────────────────────────
echo [7/12] Running PyInstaller ^(50-series^)...
pyinstaller hapticai_windows_50series.spec --clean --noconfirm

if not exist dist\HapticAI-50series\HapticAI-50series.exe (
    echo.
    echo ERROR: PyInstaller 50-series build failed. Check output above.
    call build_venv\Scripts\deactivate.bat
    pause & exit /b 1
)

:: ── [8/12] Inno Setup — 50-series installer ──────────────────────────────────
echo [8/12] Building 50-series installer ^(Inno Setup^)...
"!ISCC!" /DAPP_VERSION=!APP_VERSION! /DGPU_VARIANT=50series installer.iss

if not exist dist\HapticAI-Setup-50series.exe (
    echo.
    echo ERROR: Inno Setup 50-series build failed. Check output above.
    call build_venv\Scripts\deactivate.bat
    pause & exit /b 1
)

echo  50-series installer OK: dist\HapticAI-Setup-50series.exe
for %%F in (dist\HapticAI-Setup-50series.exe) do echo  Size: %%~zF bytes

:: ── [9/12] Swap to CPU-only PyTorch ─────────────────────────────────────────
echo.
echo [9/12] Installing CPU-only PyTorch ^(no GPU required^)...
pip install -r cpu.requirements.txt --force-reinstall
:: torchaudio is CUDA-only; remove it so it doesn't conflict with CPU torch.
pip uninstall torchaudio -y >nul 2>&1
:: torchvision's force-reinstall pulls in the latest numpy, violating the
:: ultralytics cap.  Re-pin it now so PyInstaller bundles the right version.
pip install "numpy>=1.23.0,<=2.1.1" --force-reinstall

:: ── [10/12] PyInstaller — CPU build ─────────────────────────────────────────
echo [10/12] Running PyInstaller ^(CPU^)...
pyinstaller hapticai_windows_cpu.spec --clean --noconfirm

if not exist dist\HapticAI-CPU\HapticAI-CPU.exe (
    echo.
    echo ERROR: PyInstaller CPU build failed. Check output above.
    call build_venv\Scripts\deactivate.bat
    pause & exit /b 1
)

:: ── [11/12] Inno Setup — CPU installer ───────────────────────────────────────
echo [11/12] Building CPU installer ^(Inno Setup^)...
"!ISCC!" /DAPP_VERSION=!APP_VERSION! /DGPU_VARIANT=cpu installer.iss

if not exist dist\HapticAI-Setup-CPU.exe (
    echo.
    echo ERROR: Inno Setup CPU build failed. Check output above.
    call build_venv\Scripts\deactivate.bat
    pause & exit /b 1
)

echo  CPU installer OK: dist\HapticAI-Setup-CPU.exe
for %%F in (dist\HapticAI-Setup-CPU.exe) do echo  Size: %%~zF bytes

call build_venv\Scripts\deactivate.bat

:: ── Done ─────────────────────────────────────────────────────────────────────
echo.
echo ============================================================
echo  Build complete! Upload ALL THREE files to GitHub Releases:
echo ============================================================
echo.
echo  1. Go to https://github.com/BurnedByAcid/hapticai-server/releases
echo  2. Click  Draft a new release
echo  3. Upload ALL THREE of these files:
echo       dist\HapticAI-Setup.exe            (RTX 30xx/40xx, CUDA 12.8)
echo       dist\HapticAI-Setup-50series.exe   (RTX 50xx, CUDA 12.9)
echo       dist\HapticAI-Setup-CPU.exe        (CPU-only, no GPU needed)
echo  4. Mark as Latest release and Publish
echo.
echo  Download links on HapticOS update automatically within 1 hour.
echo ============================================================

:: ── [12/12] Issue summary ─────────────────────────────────────────────────────
echo.
echo ============================================================
echo  [12/12] Build Issue Summary
echo ============================================================
if not exist "%BUILD_LOG%" (
    echo  ^(Log not available — run build_windows.bat directly to capture output.^)
    echo ============================================================
    goto :summary_done
)
powershell -NoProfile -Command ^
    "$log = Get-Content -Path '%BUILD_LOG%' -Encoding UTF8;" ^
    "$sep = '  ' + ('-' * 56);" ^
    "function Show-Section($title, $lines) {" ^
    "    Write-Host '';" ^
    "    Write-Host ('  ' + $title);" ^
    "    if ($lines) { $lines | ForEach-Object { Write-Host ('    ' + $_.Trim()) } }" ^
    "    else { Write-Host '    (none)' }" ^
    "};" ^
    "$conflicts   = $log | Select-String 'requires .* but you have' | ForEach-Object { $_.Line };" ^
    "$autoinstall = $log | Select-String 'AutoUpdate|attempting AutoUpdate' | ForEach-Object { $_.Line };" ^
    "$pipwarn     = $log | Select-String 'WARNING:' |" ^
    "    Where-Object { $_ -notmatch 'DeprecationWarning|werkzeug|NOTE:|This is a development server' } |" ^
    "    ForEach-Object { $_.Line };" ^
    "$errors      = $log | Select-String '^ERROR:' | ForEach-Object { $_.Line };" ^
    "Show-Section 'Dependency conflicts:' $conflicts;" ^
    "Show-Section 'Unexpected auto-installs:' $autoinstall;" ^
    "Show-Section 'pip warnings:' $pipwarn;" ^
    "Show-Section 'Errors:' $errors;" ^
    "Write-Host '';" ^
    "if (-not ($conflicts -or $autoinstall -or $pipwarn -or $errors)) {" ^
    "    Write-Host '  All clear — no unexpected issues detected.' }" ^
    "Write-Host ''"

echo ============================================================
echo  Full log saved to: build_output.log
echo ============================================================

:summary_done
pause
