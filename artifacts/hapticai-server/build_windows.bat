@echo off
setlocal EnableDelayedExpansion
title HapticAI (Beta) Windows Build

:: Always run from the directory containing this script, regardless of how it was launched
cd /d "%~dp0"

echo ============================================================
echo  HapticAI (Beta) Windows Build Script
echo  Builds THREE installers:
echo    HapticAI-Setup.exe         (RTX 30xx / 40xx, CUDA 12.8)
echo    HapticAI-Setup-50series.exe   (RTX 50xx, CUDA 12.9)
echo    HapticAI-Setup-CPU.exe        (No GPU required, CPU-only)
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
set "PYTHON_CMD="

python --version >nul 2>&1
if errorlevel 1 goto :try_py311
for /f "tokens=2" %%V in ('python --version 2^>^&1') do set "PYVER=%%V"
for /f "tokens=1,2 delims=." %%A in ("!PYVER!") do set "PY_MAJOR=%%A" & set "PY_MINOR=%%B"
if not "!PY_MAJOR!"=="3" goto :try_py311
if !PY_MINOR! LSS 10 goto :try_py311
if !PY_MINOR! GTR 11 goto :try_py311
set "PYTHON_CMD=python"
echo  Found Python !PYVER! on PATH.
goto :python_found

:try_py311
py -3.11 --version >nul 2>&1
if errorlevel 1 goto :try_py311v
set "PYTHON_CMD=py -3.11"
for /f "tokens=2" %%V in ('py -3.11 --version 2^>^&1') do echo  Found Python %%V via py launcher.
goto :python_found

:try_py311v
py -V:3.11 --version >nul 2>&1
if errorlevel 1 goto :try_py310
set "PYTHON_CMD=py -V:3.11"
for /f "tokens=2" %%V in ('py -V:3.11 --version 2^>^&1') do echo  Found Python %%V via py launcher.
goto :python_found

:try_py310
py -3.10 --version >nul 2>&1
if errorlevel 1 goto :try_py310v
set "PYTHON_CMD=py -3.10"
for /f "tokens=2" %%V in ('py -3.10 --version 2^>^&1') do echo  Found Python %%V via py launcher.
goto :python_found

:try_py310v
py -V:3.10 --version >nul 2>&1
if errorlevel 1 goto :no_python
set "PYTHON_CMD=py -V:3.10"
for /f "tokens=2" %%V in ('py -V:3.10 --version 2^>^&1') do echo  Found Python %%V via py launcher.
goto :python_found

:no_python
echo.
echo ERROR: Python 3.10 or 3.11 not found.
echo.
echo   The py launcher could not find 3.10 or 3.11.
echo.
echo   Install Python 3.11 from https://www.python.org/downloads/release/python-3119/
echo   Tick "Add Python to PATH" during install, then re-run this script.
echo.
pause & exit /b 1

:python_found

:: ── Find makensis ────────────────────────────────────────────────────────────
set "MAKENSIS=makensis"
makensis /VERSION >nul 2>&1
if not errorlevel 1 goto :nsis_found
if exist "C:\Program Files (x86)\NSIS\makensis.exe" goto :nsis_x86
if exist "C:\Program Files\NSIS\makensis.exe" goto :nsis_x64
echo.
echo ERROR: NSIS not found. Install NSIS 3.x from https://nsis.sourceforge.io
echo.
pause & exit /b 1

:nsis_x86
set "MAKENSIS=C:\Program Files (x86)\NSIS\makensis.exe"
echo  Found NSIS at Program Files ^(x86^).
goto :nsis_found

:nsis_x64
set "MAKENSIS=C:\Program Files\NSIS\makensis.exe"
echo  Found NSIS at Program Files.

:nsis_found

:: ── [1/11] Virtual environment ──────────────────────────────────────────────
echo.
echo [1/11] Creating virtual environment using !PYTHON_CMD!...
if exist build_venv rmdir /s /q build_venv
!PYTHON_CMD! -m venv build_venv
call build_venv\Scripts\activate.bat

:: ── [2/11] Build tools ──────────────────────────────────────────────────────
echo [2/11] Installing build tools...
!PYTHON_CMD! -m pip install --upgrade pip wheel "pyinstaller<7"

:: ── [3/11] Standard deps (CUDA 12.8 — RTX 30xx / 40xx) ─────────────────────
echo [3/11] Installing standard deps ^(CUDA 12.8 for RTX 30xx/40xx^)...
pip install -r core.requirements.txt --ignore-requires-python
pip install -r cuda.requirements.txt
pip install -r web.requirements.txt
pip install opencv-python-headless --upgrade flask-cors

:: ── [4/11] PyInstaller — standard build ─────────────────────────────────────
echo [4/11] Running PyInstaller ^(standard^)...
pyinstaller hapticai_windows.spec --clean --noconfirm

if not exist dist\HapticAI.exe (
    echo.
    echo ERROR: PyInstaller standard build failed. Check output above.
    call build_venv\Scripts\deactivate.bat
    pause & exit /b 1
)

:: ── [5/11] NSIS — standard installer ────────────────────────────────────────
echo [5/11] Building standard installer ^(NSIS^)...
"!MAKENSIS!" /DVERSION="%VERSION%" installer.nsi

if not exist dist\HapticAI-Setup.exe (
    echo.
    echo ERROR: NSIS standard build failed. Check output above.
    call build_venv\Scripts\deactivate.bat
    pause & exit /b 1
)

echo  Standard installer OK: dist\HapticAI-Setup.exe
for %%F in (dist\HapticAI-Setup.exe) do echo  Size: %%~zF bytes

:: ── [6/11] Upgrade to 50-series deps (CUDA 12.9 — RTX 50xx) ────────────────
echo.
echo [6/11] Installing 50-series deps ^(CUDA 12.9 for RTX 50xx^)...
pip install -r cuda.50series.requirements.txt --force-reinstall

:: ── [7/11] PyInstaller — 50-series build ────────────────────────────────────
echo [7/11] Running PyInstaller ^(50-series^)...
pyinstaller hapticai_windows_50series.spec --clean --noconfirm

if not exist dist\HapticAI-50series.exe (
    echo.
    echo ERROR: PyInstaller 50-series build failed. Check output above.
    call build_venv\Scripts\deactivate.bat
    pause & exit /b 1
)

:: ── [8/11] NSIS — 50-series installer ───────────────────────────────────────
echo [8/11] Building 50-series installer ^(NSIS^)...
"!MAKENSIS!" /DVERSION="%VERSION%" /DGPU_VARIANT=50series installer.nsi

if not exist dist\HapticAI-Setup-50series.exe (
    echo.
    echo ERROR: NSIS 50-series build failed. Check output above.
    call build_venv\Scripts\deactivate.bat
    pause & exit /b 1
)

echo  50-series installer OK: dist\HapticAI-Setup-50series.exe
for %%F in (dist\HapticAI-Setup-50series.exe) do echo  Size: %%~zF bytes

:: ── [9/11] Swap to CPU-only PyTorch ─────────────────────────────────────────
echo.
echo [9/11] Installing CPU-only PyTorch ^(no GPU required^)...
pip install -r cpu.requirements.txt --force-reinstall

:: ── [10/11] PyInstaller — CPU build ─────────────────────────────────────────
echo [10/11] Running PyInstaller ^(CPU^)...
pyinstaller hapticai_windows_cpu.spec --clean --noconfirm

if not exist dist\HapticAI-CPU.exe (
    echo.
    echo ERROR: PyInstaller CPU build failed. Check output above.
    call build_venv\Scripts\deactivate.bat
    pause & exit /b 1
)

:: ── [11/11] NSIS — CPU installer ────────────────────────────────────────────
echo [11/11] Building CPU installer ^(NSIS^)...
"!MAKENSIS!" /DVERSION="%VERSION%" /DGPU_VARIANT=cpu installer.nsi

if not exist dist\HapticAI-Setup-CPU.exe (
    echo.
    echo ERROR: NSIS CPU build failed. Check output above.
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
echo  3. Set the tag to:  %VERSION%
echo  4. Upload ALL THREE of these files:
echo       dist\HapticAI-Setup.exe            (RTX 30xx/40xx, CUDA 12.8)
echo       dist\HapticAI-Setup-50series.exe   (RTX 50xx, CUDA 12.9)
echo       dist\HapticAI-Setup-CPU.exe        (CPU-only, no GPU needed)
echo  5. Mark as Latest release and Publish
echo.
echo  Download links on HapticOS update automatically within 1 hour.
echo ============================================================
pause
