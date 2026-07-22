"""
AIScripter engine — video-to-funscript generation.

This module is the entry point for the PyInstaller-frozen engine binary.
The daemon (local-daemon) spawns this process with --url <video_url> and
expects a valid funscript JSON string written to stdout on completion.

Usage:
    engine.py --url <video_url> [--output <path>]

Processing pipeline:
    1. Download the video to a temp file using yt-dlp
    2. Extract per-frame motion via OpenCV dense optical flow
    3. Build a funscript from the motion intensity envelope
    4. Write funscript JSON to stdout (or --output file)

Progress reporting:
    Lines of the form "PROGRESS:nn" are written to stderr so the daemon
    can update the job percent in real time.

Exit codes:
    0  success
    1  error (message written to stderr)
"""

import argparse
import json
import math
import os
import shutil
import struct
import subprocess
import sys
import tempfile
import wave
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="AIScripter engine")
    parser.add_argument("--url", required=True, help="Video URL to process")
    parser.add_argument(
        "--output",
        default=None,
        help="Write funscript to this file instead of stdout",
    )
    parser.add_argument(
        "--max-travel",
        type=int,
        default=300,
        help="Maximum stroke distance between high and low points (200–500, default 300)",
    )
    return parser.parse_args()


def progress(pct: int) -> None:
    """Emit a structured progress line that the daemon parses."""
    print(f"PROGRESS:{pct}", file=sys.stderr, flush=True)


# ── Bundled tool resolution ───────────────────────────────────────────────────
#
# The Windows installer ships yt-dlp.exe / ffmpeg.exe / ffprobe.exe in a `bin`
# directory next to the frozen engine executable so end users do not need
# either tool preinstalled. Resolution order:
#   1. $AISCRIPTER_BIN_DIR (explicit override, set by the daemon or tests)
#   2. <dir of frozen engine executable>/bin        (installed layout)
#   3. <dir of engine.py>/bin                       (dev layout)
#   4. system PATH                                  (last resort)

def _bundled_bin_dirs() -> list[Path]:
    dirs: list[Path] = []
    env_dir = os.environ.get("AISCRIPTER_BIN_DIR")
    if env_dir:
        dirs.append(Path(env_dir))
    if getattr(sys, "frozen", False):
        dirs.append(Path(sys.executable).resolve().parent / "bin")
    dirs.append(Path(__file__).resolve().parent / "bin")
    return [d for d in dirs if d.is_dir()]


def find_tool(name: str) -> str:
    """
    Return the absolute path to a bundled tool (yt-dlp, ffmpeg, ffprobe),
    preferring the copies shipped with the installer over anything on PATH.
    Raises RuntimeError when the tool cannot be found anywhere.
    """
    exe_name = f"{name}.exe" if os.name == "nt" else name
    for bin_dir in _bundled_bin_dirs():
        candidate = bin_dir / exe_name
        if candidate.exists():
            return str(candidate)
    found = shutil.which(name)
    if found:
        return found
    raise RuntimeError(
        f"{name} not found — bundled copy is missing and it is not on PATH"
    )


def _ffmpeg_location_args() -> list[str]:
    """Extra yt-dlp args pointing it at the bundled ffmpeg, when present."""
    try:
        ffmpeg_path = find_tool("ffmpeg")
    except RuntimeError:
        return []
    return ["--ffmpeg-location", str(Path(ffmpeg_path).parent)]


# ── yt-dlp self-update ────────────────────────────────────────────────────────

_yt_dlp_updated = False


def try_update_yt_dlp() -> None:
    """
    Attempt to self-update the bundled yt-dlp binary to the latest stable
    release before downloading.  This means existing installs automatically
    get extractor fixes (e.g. broken RedTube support) without a full
    application reinstall.

    Runs once per engine process invocation; silently skips on any failure
    (network unavailable, permission error, etc.) so the job still proceeds
    with the current version.
    """
    global _yt_dlp_updated
    if _yt_dlp_updated:
        return
    _yt_dlp_updated = True
    try:
        yt_dlp = find_tool("yt-dlp")
        print("[engine] Checking for yt-dlp updates...", file=sys.stderr, flush=True)
        result = subprocess.run(
            [yt_dlp, "--update-to", "stable"],
            capture_output=True,
            text=True,
            timeout=60,
        )
        output = (result.stdout + result.stderr).strip()
        first_line = output.splitlines()[0] if output else "no output"
        print(f"[engine] yt-dlp update: {first_line}", file=sys.stderr, flush=True)
    except Exception as exc:
        print(f"[engine] yt-dlp self-update skipped ({exc}); continuing with bundled version", file=sys.stderr, flush=True)


# ── Download helpers ──────────────────────────────────────────────────────────

def download_video(url: str, out_path: str) -> None:
    """
    Download the best video+audio to out_path using yt-dlp.
    Uses a format that keeps the file as a single container (mp4/mkv/webm).
    """
    yt_dlp = find_tool("yt-dlp")
    cmd = [
        yt_dlp,
        "--no-playlist",
        "--format", "bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720][ext=mp4]/best[height<=720]/best",
        "--merge-output-format", "mp4",
        "--output", out_path,
        "--newline",
        "--no-warnings",
        *_ffmpeg_location_args(),
        url,
    ]
    print("[engine] Running yt-dlp for video download...", file=sys.stderr, flush=True)
    result = subprocess.run(cmd, capture_output=True, text=True, errors="replace")
    if result.stdout.strip():
        for line in result.stdout.strip().splitlines()[-5:]:
            print(f"[engine] yt-dlp: {line}", file=sys.stderr, flush=True)
    if result.returncode != 0:
        stderr_tail = result.stderr.strip().splitlines()
        err_lines = [l for l in stderr_tail if "ERROR:" in l or "error" in l.lower()]
        detail = err_lines[-1] if err_lines else (stderr_tail[-1] if stderr_tail else "")
        if detail:
            print(f"[engine] yt-dlp error detail: {detail}", file=sys.stderr, flush=True)
        msg = f"yt-dlp exited with code {result.returncode}"
        if "Unable to extract" in detail or "unsupported URL" in detail.lower():
            msg += " — this site is not currently supported by yt-dlp"
        raise RuntimeError(msg)


def download_audio(url: str, out_wav: str) -> None:
    """
    Fallback: download only audio track to a WAV file using yt-dlp.
    """
    yt_dlp = find_tool("yt-dlp")
    cmd = [
        yt_dlp,
        "--no-playlist",
        "--extract-audio",
        "--audio-format", "wav",
        "--audio-quality", "5",
        "--output", out_wav.replace(".wav", ".%(ext)s"),
        "--newline",
        "--no-warnings",
        *_ffmpeg_location_args(),
        url,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, errors="replace")
    if result.returncode != 0:
        stderr_tail = result.stderr.strip().splitlines()
        err_lines = [l for l in stderr_tail if "ERROR:" in l or "error" in l.lower()]
        detail = err_lines[-1] if err_lines else (stderr_tail[-1] if stderr_tail else "")
        msg = f"yt-dlp (audio) exited with code {result.returncode}"
        if "Unable to extract" in detail or "unsupported URL" in detail.lower():
            msg += " — this site is not currently supported by yt-dlp"
        raise RuntimeError(msg)


def find_downloaded_file(stem: str, extensions: tuple) -> str:
    """Find the actual output file after yt-dlp (it may change the extension)."""
    for ext in extensions:
        candidate = f"{stem}.{ext}"
        if os.path.exists(candidate):
            return candidate
    raise FileNotFoundError(f"Could not find downloaded file near stem: {stem}")


# ── Video frame analysis (primary path) ──────────────────────────────────────

def analyze_video_frames(video_path: str, sample_fps: float = 8.0) -> list[tuple[float, float]]:
    """
    Compute a motion-intensity envelope from video frames using dense optical flow.

    Samples the video at sample_fps frames per second, resizes each frame to a
    small working size, computes Farneback dense optical flow between consecutive
    frames, and returns a list of (time_seconds, motion_intensity) tuples where
    motion_intensity is the mean magnitude of the flow field.

    Returns an empty list if OpenCV is not available or if the video cannot be
    decoded.
    """
    try:
        import cv2
        import numpy as np
    except ImportError:
        print("[engine] opencv-python not available; falling back to audio analysis", file=sys.stderr, flush=True)
        return []

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        print(f"[engine] Could not open video: {video_path}", file=sys.stderr, flush=True)
        return []

    native_fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) or 0
    duration = total_frames / native_fps if native_fps > 0 and total_frames > 0 else 0

    print(
        f"[engine] Video: {native_fps:.1f} fps, {total_frames} frames, ~{duration:.0f}s",
        file=sys.stderr,
        flush=True,
    )

    # How many native frames to skip between samples
    step = max(1, int(round(native_fps / sample_fps)))

    WORK_W, WORK_H = 320, 180  # resize target for speed

    envelope: list[tuple[float, float]] = []
    prev_gray = None
    frame_idx = 0
    last_progress_pct = 35

    while True:
        ret, frame = cap.read()
        if not ret:
            break

        if frame_idx % step == 0:
            small = cv2.resize(frame, (WORK_W, WORK_H))
            gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)

            if prev_gray is not None:
                flow = cv2.calcOpticalFlowFarneback(
                    prev_gray, gray,
                    None,
                    pyr_scale=0.5,
                    levels=3,
                    winsize=13,
                    iterations=3,
                    poly_n=5,
                    poly_sigma=1.1,
                    flags=0,
                )
                mag, _ = cv2.cartToPolar(flow[..., 0], flow[..., 1])
                intensity = float(np.mean(mag))
                t = frame_idx / native_fps
                envelope.append((t, intensity))

            prev_gray = gray

            # Emit incremental progress between 35% and 85%
            if total_frames > 0:
                raw_pct = 35 + int((frame_idx / total_frames) * 50)
                pct = min(85, raw_pct)
                if pct > last_progress_pct:
                    progress(pct)
                    last_progress_pct = pct

        frame_idx += 1

    cap.release()
    print(f"[engine] Optical flow: {len(envelope)} samples", file=sys.stderr, flush=True)
    return envelope


# ── Audio analysis (fallback path) ───────────────────────────────────────────

def read_wav_samples(path: str):
    """Read a WAV file and return (sample_rate, mono_samples_float32_list)."""
    try:
        with wave.open(path, "rb") as wf:
            n_channels = wf.getnchannels()
            sampwidth = wf.getsampwidth()
            framerate = wf.getframerate()
            n_frames = wf.getnframes()
            raw = wf.readframes(n_frames)
    except Exception:
        return None, None

    fmt_map = {1: "b", 2: "h", 4: "i"}
    fmt = fmt_map.get(sampwidth)
    if fmt is None:
        return None, None
    n_samples = len(raw) // sampwidth
    samples = list(struct.unpack(f"<{n_samples}{fmt}", raw[:n_samples * sampwidth]))
    max_val = float(2 ** (8 * sampwidth - 1))
    mono: list[float] = []
    for i in range(0, len(samples), n_channels):
        ch = samples[i:i + n_channels]
        mono.append(sum(ch) / (n_channels * max_val))
    return framerate, mono


def compute_rms_envelope(samples: list[float], framerate: int, window_ms: int = 100) -> list[tuple[float, float]]:
    """
    Compute an RMS amplitude envelope over a sliding window.
    Returns a list of (time_seconds, rms_value) tuples.
    """
    window_size = max(1, int(framerate * window_ms / 1000))
    hop_size = window_size // 2
    envelope = []
    i = 0
    total = len(samples)
    last_progress_pct = 35
    while i + window_size <= total:
        chunk = samples[i:i + window_size]
        rms = math.sqrt(sum(s * s for s in chunk) / len(chunk))
        t = (i + window_size / 2) / framerate
        envelope.append((t, rms))
        i += hop_size

        # Emit incremental progress between 35% and 85%
        raw_pct = 35 + int((i / total) * 50)
        pct = min(85, raw_pct)
        if pct > last_progress_pct:
            progress(pct)
            last_progress_pct = pct

    return envelope


def convert_to_wav(src: str, dst: str) -> None:
    """Use ffmpeg to convert audio file to WAV mono 44100 Hz."""
    cmd = [
        find_tool("ffmpeg"), "-y", "-i", src,
        "-vn", "-ar", "44100", "-ac", "1", "-f", "wav", dst,
    ]
    result = subprocess.run(cmd, capture_output=True)
    if result.returncode != 0:
        raise RuntimeError(
            f"ffmpeg conversion failed: {result.stderr.decode(errors='replace')}"
        )


# ── Funscript generation ──────────────────────────────────────────────────────

def envelope_to_funscript(
    envelope: list[tuple[float, float]],
    max_travel: int = 300,
) -> dict:
    """
    Convert a motion/amplitude envelope to a proper funscript.

    Rules enforced:
    1. Alternating peaks / valleys — every action alternates between a
       high position and a low position around the midpoint (50).
    2. Speed limit — full 0→100 stroke takes at least ~120 ms (the fastest
       realistic device limit).  We clamp per-segment speed to MAX_SPEED.
    3. Max travel (stroke) — the distance between peak and valley never
       exceeds max_travel, and adapts per-peak based on local marker density
       (mirrors the Scripter Dynamic tool behaviour).
    4. Rest at end — the script always returns to position 0 on the final
       action so the device is not left at an extreme.

    Algorithm:
    - Detect local maxima (peaks) in the envelope where the value rises above
      the 65th percentile and is locally maximal.
    - For each detected peak, compute an adaptive stroke that respects
      max_travel and the local density of peaks (dense regions get smaller
      strokes so the device can keep up).
    - Alternate high / low positions around midpoint 50 using that stroke.
    - Clamp speed between consecutive actions using MAX_SPEED.
    """
    if not envelope:
        return {"version": "1.0", "inverted": False, "range": 90, "actions": []}

    vals = [v for _, v in envelope]
    v_max = max(vals) or 1.0
    v_min = min(vals)
    v_range = v_max - v_min or 1.0

    # Step 1: detect local maxima above the 65th percentile threshold
    threshold = v_min + 0.65 * v_range
    peaks: list[tuple[float, float]] = []
    i = 0
    n = len(envelope)
    while i < n:
        t, v = envelope[i]
        if v >= threshold:
            # consume the whole above-threshold run, taking the highest point
            run_start = i
            best_idx = i
            best_val = v
            while i < n and envelope[i][1] >= threshold:
                if envelope[i][1] > best_val:
                    best_val = envelope[i][1]
                    best_idx = i
                i += 1
            # Require a local maximum (higher than neighbours)
            left = envelope[best_idx - 1][1] if best_idx > 0 else v_min
            right = envelope[best_idx + 1][1] if best_idx + 1 < n else v_min
            if best_val >= left and best_val >= right:
                peaks.append(envelope[best_idx])
        else:
            i += 1

    if not peaks:
        # No strong peaks found — fall back to simple threshold-crossing
        for t, v in envelope:
            if v >= threshold:
                peaks.append((t, v))
        # deduplicate by time
        seen: set[int] = set()
        uniq: list[tuple[float, float]] = []
        for t, v in peaks:
            key = int(t * 1000) // 200
            if key not in seen:
                seen.add(key)
                uniq.append((t, v))
        peaks = uniq

    if not peaks:
        return {"version": "1.0", "inverted": False, "range": 90, "actions": []}

    peak_times = [t for t, _ in peaks]

    # Step 2: adaptive stroke per peak based on local density (mirror of
    # Scripter's computeAdaptivePositions logic).
    # For each peak, count how many other peaks fall within a 1-second window.
    # More peaks in that window = smaller stroke so the device can keep up.
    limit_clamped = max(0, min(100, max_travel))
    target_strokes: list[int] = []
    for i, t in enumerate(peak_times):
        # count peaks in [t-0.5s, t+0.5s]
        count = sum(1 for pt in peak_times if abs(pt - t) <= 0.5)
        transitions = max(1, count - 1)
        stroke = min(100, max(5, limit_clamped // transitions))
        target_strokes.append(stroke)

    # Step 3: smooth stroke changes with a bidirectional ramp (max ±20 per step)
    RAMP_STEP = 20
    strokes = list(target_strokes)
    for i in range(1, len(strokes)):
        strokes[i] = min(strokes[i], strokes[i - 1] + RAMP_STEP)
    for i in range(len(strokes) - 2, -1, -1):
        strokes[i] = min(strokes[i], strokes[i + 1] + RAMP_STEP)

    # Step 4: alternating hi / lo around midpoint 50
    # Even indices = high, odd = low  (starts high)
    raw_actions: list[dict] = []
    for idx, ((t, _), stroke) in enumerate(zip(peaks, strokes)):
        at_ms = int(round(t * 1000))
        half = round(stroke / 2)
        lo = max(0, 50 - half)
        hi = min(100, 50 + (stroke - half))
        pos = hi if idx % 2 == 0 else lo
        raw_actions.append({"at": at_ms, "pos": int(pos)})

    # Step 5: speed clamp — ensure we never exceed MAX_SPEED
    # A full 0→100 stroke should take at least ~100 ms at realistic limits.
    MAX_SPEED = 800.0  # pos units per second (100% stroke / 125ms = 800)
    actions: list[dict] = []
    if raw_actions:
        actions.append(raw_actions[0])
        for i in range(1, len(raw_actions)):
            prev = actions[-1]
            cur = raw_actions[i]
            dt = cur["at"] - prev["at"]
            if dt <= 0:
                # Skip overlapping / duplicate timestamps
                continue
            dp = abs(cur["pos"] - prev["pos"])
            speed = (dp / dt) * 1000.0  # pos units per second
            if speed > MAX_SPEED and dp > 0:
                # Clamp: extend dt so speed = MAX_SPEED
                min_dt = int(round((dp / MAX_SPEED) * 1000))
                cur = {"at": prev["at"] + min_dt, "pos": cur["pos"]}
            actions.append(cur)

    # Step 6: ensure script ends at rest (pos 0)
    if actions:
        last_t = actions[-1]["at"]
        # Add a short rest (at least 200 ms after last action)
        rest_t = max(last_t + 200, int(envelope[-1][0] * 1000) + 100)
        if actions[-1]["pos"] != 0:
            actions.append({"at": rest_t, "pos": 0})

    return {
        "version": "1.0",
        "inverted": False,
        "range": 90,
        "actions": actions,
    }


# ── Main pipeline ─────────────────────────────────────────────────────────────

def generate_funscript(video_url: str, max_travel: int = 300) -> dict:
    """
    Full pipeline: download → optical-flow analysis → funscript.
    Falls back to audio RMS analysis if OpenCV is unavailable.
    """
    try_update_yt_dlp()

    with tempfile.TemporaryDirectory() as tmpdir:
        # ── 1. Download video ──────────────────────────────────────────────────
        progress(10)
        print("[engine] Downloading video...", file=sys.stderr, flush=True)
        video_stem = os.path.join(tmpdir, "video")
        video_path = video_stem + ".mp4"

        try:
            download_video(video_url, video_path)
            if not os.path.exists(video_path):
                video_path = find_downloaded_file(
                    video_stem, ("mp4", "mkv", "webm", "mov", "avi")
                )
        except Exception as exc:
            print(f"[engine] Video download failed: {exc}", file=sys.stderr, flush=True)
            video_path = None

        progress(30)

        # ── 2. Optical-flow analysis (primary) ────────────────────────────────
        envelope: list[tuple[float, float]] = []
        script_source = "optical_flow"

        if video_path and os.path.exists(video_path):
            print("[engine] Running optical-flow frame analysis...", file=sys.stderr, flush=True)
            progress(35)
            envelope = analyze_video_frames(video_path)
        else:
            print("[engine] No video file; skipping optical-flow step", file=sys.stderr, flush=True)

        # ── 3. Audio RMS fallback if optical flow produced nothing ─────────────
        if not envelope:
            script_source = "audio_rms"
            print(
                "WARNING:video_download_failed — falling back to audio RMS analysis",
                file=sys.stderr,
                flush=True,
            )
            print("[engine] Falling back to audio RMS analysis...", file=sys.stderr, flush=True)
            progress(35)
            audio_stem = os.path.join(tmpdir, "audio")
            try:
                download_audio(video_url, audio_stem + ".wav")
                audio_path = find_downloaded_file(
                    audio_stem, ("wav", "m4a", "mp3", "ogg", "opus")
                )
            except Exception as exc:
                raise RuntimeError(f"Audio download also failed: {exc}") from exc

            wav_path = audio_stem + "_final.wav"
            if not audio_path.endswith(".wav"):
                print("[engine] Converting to WAV...", file=sys.stderr, flush=True)
                try:
                    convert_to_wav(audio_path, wav_path)
                except Exception:
                    raise RuntimeError("ffmpeg not available — cannot decode audio")
            else:
                wav_path = audio_path

            framerate, mono = read_wav_samples(wav_path)
            if framerate is None or not mono:
                raise RuntimeError("Could not decode audio samples from WAV file")

            print(f"[engine] {len(mono)} audio samples at {framerate} Hz", file=sys.stderr, flush=True)
            envelope = compute_rms_envelope(mono, framerate, window_ms=80)

        # ── 4. Build funscript ────────────────────────────────────────────────
        progress(90)
        print("[engine] Building funscript...", file=sys.stderr, flush=True)
        funscript = envelope_to_funscript(envelope, max_travel=max_travel)
        funscript["metadata"] = {
            "source_url": video_url,
            "generator": "AIScripter",
            "source": script_source,
        }
        print(
            f"[engine] Generated {len(funscript['actions'])} actions",
            file=sys.stderr,
            flush=True,
        )
        progress(95)
        return funscript


def main() -> None:
    args = parse_args()
    try:
        funscript = generate_funscript(args.url, max_travel=args.max_travel)
        output_json = json.dumps(funscript, indent=2)
        if args.output:
            with open(args.output, "w", encoding="utf-8") as f:
                f.write(output_json)
            print(f"[engine] Written to {args.output}", file=sys.stderr, flush=True)
        else:
            print(output_json)
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr, flush=True)
        sys.exit(1)


if __name__ == "__main__":
    main()
