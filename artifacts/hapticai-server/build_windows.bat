@echo off
setlocal EnableDelayedExpansion
title HapticAI (Beta) Windows Build

echo ============================================================
echo  HapticAI (Beta) Windows Build Script
echo ============================================================

:: Check Python
python --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Python not found. Install Python 3.10 or 3.11 and add to PATH.
    pause & exit /b 1
)

:: Require version argument
set VERSION=%1
if "%VERSION%"=="" (
    echo.
    echo Usage: build_windows.bat ^<version^>   e.g.  build_windows.bat v1.0.0
    echo.
    pause & exit /b 1
)

:: Check NSIS is available
makensis /VERSION >nul 2>&1
if errorlevel 1 (
    echo.
    echo ERROR: NSIS not found. Install NSIS 3.x from https://nsis.sourceforge.io
    echo        and make sure makensis.exe is on your PATH.
    echo.
    pause & exit /b 1
)

:: Create and activate venv
echo [1/6] Creating virtual environment...
if exist build_venv rmdir /s /q build_venv
python -m venv build_venv
call build_venv\Scripts\activate.bat

:: Upgrade pip + install wheel
echo [2/6] Installing build tools...
python -m pip install --upgrade pip wheel pyinstaller

:: Install HapticAI dependencies from official requirements files
echo [3/6] Installing HapticAI dependencies...

:: Core requirements (GUI packages install fine on Windows, just not used in web mode)
pip install -r core.requirements.txt --ignore-requires-python

:: CPU-only torch/torchvision
pip install -r cpu.requirements.txt --index-url https://download.pytorch.org/whl/cpu

:: Web-mode and CORS deps
pip install -r web.requirements.txt

:: Override: use headless OpenCV (no window-system dependency for server process)
pip install opencv-python-headless --upgrade flask-cors

:: Build the app .exe with PyInstaller
echo [4/6] Running PyInstaller...
pyinstaller hapticai_windows.spec --clean --noconfirm

:: Check PyInstaller result
if not exist dist\HapticAI.exe (
    echo ERROR: PyInstaller build failed. Check output above.
    call build_venv\Scripts\deactivate.bat
    pause & exit /b 1
)

:: Deactivate venv before NSIS (not needed for makensis)
call build_venv\Scripts\deactivate.bat

:: Build the installer with NSIS
echo [5/6] Running NSIS to build installer...
set HAPTICAI_VERSION=%VERSION%
makensis /DVERSION="%VERSION%" installer.nsi

:: Check NSIS result
if not exist dist\HapticAI-Setup.exe (
    echo ERROR: NSIS build failed. Check output above.
    pause & exit /b 1
)

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
echo  1. Go to your GitHub repository
echo  2. Click  Releases ^> Draft a new release
echo  3. Set the tag to:  %VERSION%
echo  4. Upload:  dist\HapticAI-Setup.exe
echo  5. Publish the release
echo.
echo  The download link on HapticOS will update automatically
echo  within 1 hour (or immediately after the cache refreshes).
echo.
echo  GitHub repo:  https://github.com/BurnedByAcid/hapticai-server
echo ============================================================
pause
