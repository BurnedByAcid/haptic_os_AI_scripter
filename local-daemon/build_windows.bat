@echo off
REM ── AIScripter Windows build script ──────────────────────────────────────────
REM Produces AIScripter-Setup.exe via:
REM   1. cargo build --release      (Rust daemon)
REM   2. PyInstaller freeze         (Python engine)
REM   3. Bundle yt-dlp + ffmpeg     (downloaded into engine\bin)
REM   4. Inno Setup compile         (installer)

setlocal ENABLEDELAYEDEXPANSION

set SCRIPT_DIR=%~dp0
set ROOT_DIR=%SCRIPT_DIR%..
set DIST_DIR=%SCRIPT_DIR%dist
set ENGINE_DIR=%ROOT_DIR%\ai-engine
set INNO_COMPILER=C:\Program Files (x86)\Inno Setup 6\ISCC.exe

echo === AIScripter Windows Build ===
echo.

REM ── Step 1: Build Rust daemon ─────────────────────────────────────────────
echo [1/4] Building Rust daemon...
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
echo [2/4] Freezing Python engine with PyInstaller...
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

REM ── Step 3: Download and bundle yt-dlp + ffmpeg ───────────────────────────
echo [3/4] Bundling yt-dlp and ffmpeg...
set BIN_DIR=%DIST_DIR%\stage\engine\bin
if not exist "%BIN_DIR%" mkdir "%BIN_DIR%"

if not exist "%BIN_DIR%\yt-dlp.exe" (
    echo     Downloading yt-dlp.exe...
    curl.exe -L -o "%BIN_DIR%\yt-dlp.exe" https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe
    if errorlevel 1 (
        echo ERROR: Failed to download yt-dlp.exe
        exit /b 1
    )
    echo     Verifying yt-dlp.exe checksum...
    curl.exe -L -o "%DIST_DIR%\yt-dlp-SHA256SUMS" https://github.com/yt-dlp/yt-dlp/releases/latest/download/SHA2-256SUMS
    powershell -NoProfile -Command ^
        "$expected = ((Get-Content '%DIST_DIR%\yt-dlp-SHA256SUMS' | Where-Object { $_ -match 'yt-dlp\.exe$' }) -split '\s+')[0];" ^
        "$actual = (Get-FileHash '%BIN_DIR%\yt-dlp.exe' -Algorithm SHA256).Hash.ToLower();" ^
        "if (-not $expected -or $actual -ne $expected.ToLower()) { Write-Error \"yt-dlp checksum mismatch\"; exit 1 }"
    if errorlevel 1 (
        echo ERROR: yt-dlp.exe checksum verification failed
        del "%BIN_DIR%\yt-dlp.exe"
        exit /b 1
    )
    del "%DIST_DIR%\yt-dlp-SHA256SUMS"
)

if not exist "%BIN_DIR%\ffmpeg.exe" (
    echo     Downloading ffmpeg essentials build...
    curl.exe -L -o "%DIST_DIR%\ffmpeg.zip" https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip
    if errorlevel 1 (
        echo ERROR: Failed to download ffmpeg.zip
        exit /b 1
    )
    echo     Verifying ffmpeg.zip checksum...
    curl.exe -L -o "%DIST_DIR%\ffmpeg.zip.sha256" https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip.sha256
    powershell -NoProfile -Command ^
        "$expected = ((Get-Content '%DIST_DIR%\ffmpeg.zip.sha256' -Raw).Trim() -split '\s+')[0];" ^
        "$actual = (Get-FileHash '%DIST_DIR%\ffmpeg.zip' -Algorithm SHA256).Hash.ToLower();" ^
        "if (-not $expected -or $actual -ne $expected.ToLower()) { Write-Error \"ffmpeg checksum mismatch\"; exit 1 }"
    if errorlevel 1 (
        echo ERROR: ffmpeg.zip checksum verification failed
        del "%DIST_DIR%\ffmpeg.zip"
        exit /b 1
    )
    del "%DIST_DIR%\ffmpeg.zip.sha256"
    powershell -NoProfile -Command ^
        "Expand-Archive -Force '%DIST_DIR%\ffmpeg.zip' '%DIST_DIR%\ffmpeg_extract';" ^
        "$bin = Get-ChildItem '%DIST_DIR%\ffmpeg_extract' -Recurse -Filter ffmpeg.exe | Select-Object -First 1;" ^
        "Copy-Item $bin.FullName '%BIN_DIR%\ffmpeg.exe';" ^
        "$probe = Get-ChildItem '%DIST_DIR%\ffmpeg_extract' -Recurse -Filter ffprobe.exe | Select-Object -First 1;" ^
        "Copy-Item $probe.FullName '%BIN_DIR%\ffprobe.exe'"
    if errorlevel 1 (
        echo ERROR: Failed to extract ffmpeg binaries
        exit /b 1
    )
    del "%DIST_DIR%\ffmpeg.zip"
    rmdir /S /Q "%DIST_DIR%\ffmpeg_extract"
)
echo     Done: %BIN_DIR%\yt-dlp.exe + ffmpeg.exe + ffprobe.exe
echo.

REM ── Step 4: Inno Setup ────────────────────────────────────────────────────
echo [4/4] Compiling Inno Setup installer...
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
