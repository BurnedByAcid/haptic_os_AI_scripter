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

:: Create and activate venv
echo [1/5] Creating virtual environment...
if exist build_venv rmdir /s /q build_venv
python -m venv build_venv
call build_venv\Scripts\activate.bat

:: Upgrade pip + install wheel
echo [2/5] Installing build tools...
python -m pip install --upgrade pip wheel pyinstaller

:: Install FunGen dependencies from official requirements files
echo [3/5] Installing FunGen dependencies...

:: Core requirements (GUI packages install fine on Windows, just not used in web mode)
pip install -r core.requirements.txt --ignore-requires-python

:: CPU-only torch/torchvision
pip install -r cpu.requirements.txt --index-url https://download.pytorch.org/whl/cpu

:: Web-mode and CORS deps
pip install -r web.requirements.txt

:: Override: use headless OpenCV (no window-system dependency for server process)
pip install opencv-python-headless --upgrade flask-cors

:: Build
echo [4/5] Running PyInstaller...
pyinstaller fungen_windows.spec --clean --noconfirm

:: Check result
if not exist dist\HapticAI-Setup.exe (
    if not exist dist\FunGen.exe (
        echo ERROR: Build failed. Check output above.
        call build_venv\Scripts\deactivate.bat
        pause & exit /b 1
    )
    :: Rename legacy output
    rename dist\FunGen.exe HapticAI-Setup.exe
)

:: Deactivate
call build_venv\Scripts\deactivate.bat

echo [5/5] Done!
echo.
echo Output: dist\HapticAI-Setup.exe
echo.
for %%F in (dist\HapticAI-Setup.exe) do echo Size: %%~zF bytes
echo.
echo ============================================================
echo  Upload to HapticOS
echo ============================================================
echo.
echo  Set your admin token first:
echo    set HAPTICAI_ADMIN_TOKEN=^<token from HAPTICAI_ADMIN_TOKEN env var^>
echo.
echo  Then run:
echo    curl -X POST https://hapticos.replit.app/api/hapticai/upload ^
echo         -H "Authorization: Bearer %HAPTICAI_ADMIN_TOKEN%" ^
echo         -F "platform=windows" ^
echo         -F "version=%VERSION%" ^
echo         -F "file=@dist\HapticAI-Setup.exe"
echo.
echo  The download will be live at:
echo    https://hapticos.replit.app/api/hapticai/download/windows
echo ============================================================
pause
