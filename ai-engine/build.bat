@echo off
REM ── AIScripter Python engine build script (Windows) ──────────────────────
REM Produces a PyInstaller one-folder bundle at dist\engine\
setlocal ENABLEDELAYEDEXPANSION

set SCRIPT_DIR=%~dp0
set DIST_DIR=%1
if "%DIST_DIR%"=="" set DIST_DIR=%SCRIPT_DIR%dist

echo === Building AIScripter Python engine ===
echo Output: %DIST_DIR%\engine
echo.

cd /d "%SCRIPT_DIR%"

if not exist venv (
    echo Creating virtualenv...
    python -m venv venv
)

call venv\Scripts\activate.bat
pip install --quiet --upgrade pip
pip install --quiet pyinstaller
if exist requirements.txt (
    pip install --quiet -r requirements.txt
)

pyinstaller ^
    --onedir ^
    --name engine ^
    --distpath "%DIST_DIR%" ^
    --clean ^
    engine.py

if errorlevel 1 (
    echo ERROR: PyInstaller build failed.
    deactivate
    exit /b 1
)

call deactivate
echo.
echo === Done: %DIST_DIR%\engine\ ===
endlocal
