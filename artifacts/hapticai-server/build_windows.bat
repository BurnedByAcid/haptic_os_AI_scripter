@echo off
setlocal EnableDelayedExpansion
title HapticAI (Beta) Windows Build

echo ============================================================
echo  HapticAI (Beta) Windows Build Script
echo  Builds TWO installers:
echo    HapticAI-Setup.exe        (RTX 30xx / 40xx, CUDA 12.8)
echo    HapticAI-Setup-50series.exe  (RTX 50xx, CUDA 12.9)
echo ============================================================

:: ── Require version argument ────────────────────────────────────────────────
set VERSION=%1
if "%VERSION%"=="" (
    echo.
    echo Usage: build_windows.bat ^<version^>   e.g.  build_windows.bat v01.01.12
    echo.
    pause & exit /b 1
)

:: ── Find a usable Python 3.10 or 3.11 ──────────────────────────────────────
:: Strategy:
::   1. Check if `python` on PATH is 3.10 or 3.11 — use it directly.
::   2. Otherwise try `py -3.11` (Python Launcher for Windows) — use that.
::   3. Otherwise try `py -3.10` — use that.
::   4. Otherwise abort with instructions.

set PYTHON_CMD=

:: Try PATH python first
python --version >nul 2>&1
if not errorlevel 1 (
    for /f "tokens=2" %%V in ('python --version 2^>^&1') do set PYVER=%%V
    for /f "tokens=1,2 delims=." %%A in ("!PYVER!") do (
        set PY_MAJOR=%%A
        set PY_MINOR=%%B
    )
    if "!PY_MAJOR!"=="3" (
        if !PY_MINOR! GEQ 10 if !PY_MINOR! LEQ 11 (
            set PYTHON_CMD=python
            echo  Found Python !PYVER! on PATH.
        )
    )
)

:: Try py launcher for 3.11 if PATH python didn't qualify
if "!PYTHON_CMD!"=="" (
    py -3.11 --version >nul 2>&1
    if not errorlevel 1 (
        set PYTHON_CMD=py -3.11
        for /f "tokens=2" %%V in ('py -3.11 --version 2^>^&1') do set PYVER=%%V
        echo  Found Python !PYVER! via py launcher ^(py -3.11^).
    )
)

:: Try py launcher for 3.10 as last resort
if "!PYTHON_CMD!"=="" (
    py -3.10 --version >nul 2>&1
    if not errorlevel 1 (
        set PYTHON_CMD=py -3.10
        for /f "tokens=2" %%V in ('py -3.10 --version 2^>^&1') do set PYVER=%%V
        echo  Found Python !PYVER! via py launcher ^(py -3.10^).
    )
)

:: Nothing worked
if "!PYTHON_CMD!"=="" (
    echo.
    echo ERROR: Python 3.10 or 3.11 not found.
    echo.
    echo   Your PATH python is too new ^(3.12+^) and the py launcher
    echo   could not find 3.10 or 3.11 either.
    echo.
    echo   Fix options:
    echo     A) Install Python 3.11: https://www.python.org/downloads/release/python-3119/
    echo        Tick "Add Python to PATH" during install, then re-run this script.
    echo     B) If Python 3.11 is already installed but not on PATH:
    echo        Open this script in Notepad and set PYTHON_CMD manually at the top,
    echo        e.g.  set PYTHON_CMD=C:\Python311\python.exe
    echo.
    pause & exit /b 1
)

:: ── Check NSIS ──────────────────────────────────────────────────────────────
makensis /VERSION >nul 2>&1
if errorlevel 1 (
    echo.
    echo ERROR: NSIS not found. Install NSIS 3.x from https://nsis.sourceforge.io
    echo        and make sure makensis.exe is on your PATH.
    echo.
    pause & exit /b 1
)

:: ── [1/8] Virtual environment ───────────────────────────────────────────────
echo.
echo [1/8] Creating virtual environment using !PYTHON_CMD!...
if exist build_venv rmdir /s /q build_venv
!PYTHON_CMD! -m venv build_venv
call build_venv\Scripts\activate.bat

:: ── [2/8] Build tools ───────────────────────────────────────────────────────
echo [2/8] Installing build tools...
!PYTHON_CMD! -m pip install --upgrade pip wheel "pyinstaller<7"

:: ── [3/8] Standard deps (CUDA 12.8 — RTX 30xx / 40xx) ──────────────────────
echo [3/8] Installing standard deps ^(CUDA 12.8 for RTX 30xx/40xx^)...
pip install -r core.requirements.txt --ignore-requires-python
pip install -r cuda.requirements.txt
pip install -r web.requirements.txt
pip install opencv-python-headless --upgrade flask-cors

:: ── [4/8] PyInstaller — standard build ──────────────────────────────────────
echo [4/8] Running PyInstaller ^(standard^)...
pyinstaller hapticai_windows.spec --clean --noconfirm

if not exist dist\HapticAI.exe (
    echo.
    echo ERROR: PyInstaller standard build failed. Check output above.
    call build_venv\Scripts\deactivate.bat
    pause & exit /b 1
)

:: ── [5/8] NSIS — standard installer ─────────────────────────────────────────
echo [5/8] Building standard installer ^(NSIS^)...
makensis /DVERSION="%VERSION%" installer.nsi

if not exist dist\HapticAI-Setup.exe (
    echo.
    echo ERROR: NSIS standard build failed. Check output above.
    call build_venv\Scripts\deactivate.bat
    pause & exit /b 1
)

echo  Standard installer OK: dist\HapticAI-Setup.exe
for %%F in (dist\HapticAI-Setup.exe) do echo  Size: %%~zF bytes

:: ── [6/8] Upgrade to 50-series deps (CUDA 12.9 — RTX 50xx) ─────────────────
echo.
echo [6/8] Installing 50-series deps ^(CUDA 12.9 for RTX 50xx^)...
pip install -r cuda.50series.requirements.txt --force-reinstall

:: ── [7/8] PyInstaller — 50-series build ─────────────────────────────────────
echo [7/8] Running PyInstaller ^(50-series^)...
pyinstaller hapticai_windows_50series.spec --clean --noconfirm

if not exist dist\HapticAI-50series.exe (
    echo.
    echo ERROR: PyInstaller 50-series build failed. Check output above.
    call build_venv\Scripts\deactivate.bat
    pause & exit /b 1
)

:: ── [8/8] NSIS — 50-series installer ────────────────────────────────────────
echo [8/8] Building 50-series installer ^(NSIS^)...
makensis /DVERSION="%VERSION%" /DGPU_VARIANT=50series installer.nsi

if not exist dist\HapticAI-Setup-50series.exe (
    echo.
    echo ERROR: NSIS 50-series build failed. Check output above.
    call build_venv\Scripts\deactivate.bat
    pause & exit /b 1
)

echo  50-series installer OK: dist\HapticAI-Setup-50series.exe
for %%F in (dist\HapticAI-Setup-50series.exe) do echo  Size: %%~zF bytes

call build_venv\Scripts\deactivate.bat

:: ── Done ─────────────────────────────────────────────────────────────────────
echo.
echo ============================================================
echo  Build complete! Upload BOTH files to GitHub Releases:
echo ============================================================
echo.
echo  1. Go to https://github.com/BurnedByAcid/hapticai-server/releases
echo  2. Click  Draft a new release
echo  3. Set the tag to:  %VERSION%
echo  4. Upload BOTH of these files:
echo       dist\HapticAI-Setup.exe            (RTX 30xx/40xx)
echo       dist\HapticAI-Setup-50series.exe   (RTX 50xx)
echo  5. Mark as Latest release and Publish
echo.
echo  Download links on HapticOS update automatically within 1 hour.
echo ============================================================
pause
