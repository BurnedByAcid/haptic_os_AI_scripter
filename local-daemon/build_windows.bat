@echo off
REM ── AIScripter Windows build script ──────────────────────────────────────────
REM Produces AIScripter-Setup.exe via:
REM   1. cargo build --release  (Rust daemon)
REM   2. PyInstaller freeze     (Python engine)
REM   3. Inno Setup compile     (installer)

setlocal ENABLEDELAYEDEXPANSION

set SCRIPT_DIR=%~dp0
set ROOT_DIR=%SCRIPT_DIR%..
set DIST_DIR=%SCRIPT_DIR%dist
set ENGINE_DIR=%ROOT_DIR%\ai-engine
set INNO_COMPILER=C:\Program Files (x86)\Inno Setup 6\ISCC.exe

echo === AIScripter Windows Build ===
echo.

REM ── Step 1: Build Rust daemon ─────────────────────────────────────────────
echo [1/3] Building Rust daemon...
pushd "%SCRIPT_DIR%"
cargo build --release
if errorlevel 1 (
    echo ERROR: cargo build failed.
    exit /b 1
)
popd
echo     Done: target\release\local-daemon.exe
echo.

REM ── Step 2: PyInstaller freeze for Python engine ──────────────────────────
echo [2/3] Freezing Python engine with PyInstaller...
pushd "%ENGINE_DIR%"
if not exist venv (
    python -m venv venv
    call venv\Scripts\activate.bat
    pip install --quiet pyinstaller
    if exist requirements.txt pip install --quiet -r requirements.txt
) else (
    call venv\Scripts\activate.bat
    pip install --quiet pyinstaller
    if exist requirements.txt pip install --quiet -r requirements.txt
)
pyinstaller --onedir --name engine --distpath "%DIST_DIR%\engine_dist" engine.py
if errorlevel 1 (
    echo ERROR: PyInstaller failed.
    deactivate
    popd
    exit /b 1
)
deactivate
popd
echo     Done: dist\engine_dist\engine\
echo.

REM ── Assemble staging directory ────────────────────────────────────────────
if not exist "%DIST_DIR%\stage" mkdir "%DIST_DIR%\stage"
copy /Y "%SCRIPT_DIR%target\release\local-daemon.exe" "%DIST_DIR%\stage\AIScripter.exe"
xcopy /E /I /Y "%DIST_DIR%\engine_dist\engine" "%DIST_DIR%\stage\engine"

REM ── Step 3: Inno Setup ────────────────────────────────────────────────────
echo [3/3] Compiling Inno Setup installer...
if not exist "%INNO_COMPILER%" (
    echo WARNING: Inno Setup not found at expected path. Skipping installer step.
    echo          Staged files are in: %DIST_DIR%\stage
    goto :done
)
"%INNO_COMPILER%" "%SCRIPT_DIR%installer.iss"
if errorlevel 1 (
    echo ERROR: Inno Setup compile failed.
    exit /b 1
)
echo.

:done
echo === Build complete ===
echo Output: %DIST_DIR%\AIScripter-Setup.exe
endlocal
