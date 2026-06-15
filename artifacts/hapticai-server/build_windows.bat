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

:: ── Check Python exists ─────────────────────────────────────────────────────
python --version >nul 2>&1
if errorlevel 1 (
    echo.
    echo ERROR: Python not found.
    echo        Install Python 3.11 from https://www.python.org/downloads/release/python-3119/
    echo        and make sure it is added to PATH during install.
    echo.
    pause & exit /b 1
)

:: ── Enforce Python 3.10 or 3.11 ─────────────────────────────────────────────
:: PyInstaller, PyTorch, NumPy, and Ultralytics do NOT support Python 3.12+
:: yet. Using 3.14 triggers OverflowError during PyInstaller analysis.
for /f "tokens=2" %%V in ('python --version 2^>^&1') do set PYVER=%%V
for /f "tokens=1,2 delims=." %%A in ("%PYVER%") do (
    set PY_MAJOR=%%A
    set PY_MINOR=%%B
)

if "%PY_MAJOR%" NEQ "3" (
    echo.
    echo ERROR: Python 3.11 is required. You have Python %PYVER%.
    echo        Download: https://www.python.org/downloads/release/python-3119/
    echo.
    pause & exit /b 1
)
if %PY_MINOR% LSS 10 (
    echo.
    echo ERROR: Python 3.10 or 3.11 is required. You have Python %PYVER%.
    echo        Download: https://www.python.org/downloads/release/python-3119/
    echo.
    pause & exit /b 1
)
if %PY_MINOR% GTR 11 (
    echo.
    echo ERROR: Python %PYVER% is NOT supported.
    echo        PyInstaller, PyTorch and NumPy require Python 3.10 or 3.11.
    echo.
    echo        If py.exe launcher is installed you can run a specific version:
    echo          py -3.11 -m pip install ...
    echo        Otherwise install Python 3.11 from:
    echo          https://www.python.org/downloads/release/python-3119/
    echo.
    pause & exit /b 1
)

echo  Python %PYVER% OK.

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
echo [1/6] Creating virtual environment...
if exist build_venv rmdir /s /q build_venv
python -m venv build_venv
call build_venv\Scripts\activate.bat

:: ── [2/6] Build tools ───────────────────────────────────────────────────────
echo [2/6] Installing build tools...
python -m pip install --upgrade pip wheel "pyinstaller<7"

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
