@echo off
setlocal EnableDelayedExpansion
title HapticAI (Beta) Windows Build

echo ============================================================
echo  HapticAI (Beta) Windows Build Script
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

:: ── [1/6] Virtual environment ───────────────────────────────────────────────
echo.
echo [1/6] Creating virtual environment using !PYTHON_CMD!...
if exist build_venv rmdir /s /q build_venv
!PYTHON_CMD! -m venv build_venv
call build_venv\Scripts\activate.bat

:: ── [2/6] Build tools ───────────────────────────────────────────────────────
echo [2/6] Installing build tools...
!PYTHON_CMD! -m pip install --upgrade pip wheel "pyinstaller<7"

:: ── [3/6] Dependencies ──────────────────────────────────────────────────────
echo [3/6] Installing HapticAI dependencies...

pip install -r core.requirements.txt --ignore-requires-python
pip install -r cpu.requirements.txt --index-url https://download.pytorch.org/whl/cpu
pip install -r web.requirements.txt
pip install opencv-python-headless --upgrade flask-cors

:: ── [4/6] PyInstaller ───────────────────────────────────────────────────────
echo [4/6] Running PyInstaller...
pyinstaller hapticai_windows.spec --clean --noconfirm

if not exist dist\HapticAI.exe (
    echo.
    echo ERROR: PyInstaller build failed. Check output above.
    call build_venv\Scripts\deactivate.bat
    pause & exit /b 1
)

call build_venv\Scripts\deactivate.bat

:: ── [5/6] NSIS installer ────────────────────────────────────────────────────
echo [5/6] Running NSIS to build installer...
set HAPTICAI_VERSION=%VERSION%
makensis /DVERSION="%VERSION%" installer.nsi

if not exist dist\HapticAI-Setup.exe (
    echo.
    echo ERROR: NSIS build failed. Check output above.
    pause & exit /b 1
)

:: ── [6/6] Done ──────────────────────────────────────────────────────────────
echo [6/6] Done!
echo.
echo Output: dist\HapticAI-Setup.exe
echo.
for %%F in (dist\HapticAI-Setup.exe) do echo Size: %%~zF bytes
echo.
echo ============================================================
echo  Upload to GitHub Releases
echo ============================================================
echo.
echo  1. Go to https://github.com/BurnedByAcid/hapticai-server/releases
echo  2. Click  Draft a new release
echo  3. Set the tag to:  %VERSION%
echo  4. Upload:  dist\HapticAI-Setup.exe
echo  5. Mark as Latest release and Publish
echo.
echo  The download link on HapticOS updates automatically within 1 hour.
echo ============================================================
pause
