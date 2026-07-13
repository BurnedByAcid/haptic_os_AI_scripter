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
    return parser.parse_args()


def progress(pct: int) -> None:
    """Emit a structured progress line that the daemon parses."""
    print(f"PROGRESS:{pct}", file=sys.stderr, flush=True)


# ── Download helpers ──────────────────────────────────────────────────────────

def download_video(url: str, out_path: str) -> None:
    """
    Download the best video+audio to out_path using yt-dlp.
    Uses a format that keeps the file as a single container (mp4/mkv/webm).
    """
    cmd = [
        "yt-dlp",
        "--no-playlist",
        "--format", "bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720][ext=mp4]/best[height<=720]/best",
        "--merge-output-format", "mp4",
        "--output", out_path,
        "--newline",
        url,
    ]
    print("[engine] Running yt-dlp for video download...", file=sys.stderr, flush=True)
    result = subprocess.run(cmd, capture_output=False, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"yt-dlp exited with code {result.returncode}")


def download_audio(url: str, out_wav: str) -> None:
    """
    Fallback: download only audio track to a WAV file using yt-dlp.
    """
    cmd = [
        "yt-dlp",
        "--no-playlist",
        "--extract-audio",
        "--audio-format", "wav",
        "--audio-quality", "5",
        "--output", out_wav.replace(".wav", ".%(ext)s"),
        "--newline",
        url,
    ]
    result = subprocess.run(cmd, capture_output=False, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"yt-dlp (audio) exited with code {result.returncode}")


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
        "ffmpeg", "-y", "-i", src,
        "-vn", "-ar", "44100", "-ac", "1", "-f", "wav", dst,
    ]
    result = subprocess.run(cmd, capture_output=True)
    if result.returncode != 0:
        raise RuntimeError(
            f"ffmpeg conversion failed: {result.stderr.decode(errors='replace')}"
        )


# ── Funscript generation ──────────────────────────────────────────────────────

def envelope_to_funscript(envelope: list[tuple[float, float]]) -> dict:
    """
    Convert a motion/amplitude envelope to a funscript.

    Strategy:
    - Normalise values to [0, 100] stroke range.
    - Alternate between high (motion crest) and low (motion trough) positions
      each time the normalised value crosses a midpoint threshold, creating a
      reciprocating pattern driven by motion energy.
    - Decimate to at most one action per 150 ms to stay within device limits.
    """
    if not envelope:
        return {"version": "1.0", "inverted": False, "range": 90, "actions": []}

    vals = [v for _, v in envelope]
    v_max = max(vals) or 1.0
    v_min = min(vals)
    v_range = v_max - v_min or 1.0

    actions = []
    last_pos = 0
    last_action_ms = -999
    threshold_high = 0.6
    threshold_low = 0.3
    state_high = False

    for t, v in envelope:
        norm = (v - v_min) / v_range  # 0.0 – 1.0
        pos = int(norm * 90)           # 0 – 90
        at_ms = int(t * 1000)

        # Rate-limit: at most one action per 150 ms
        if at_ms - last_action_ms < 150:
            continue

        if not state_high and norm > threshold_high:
            state_high = True
            pos = max(50, pos)
        elif state_high and norm < threshold_low:
            state_high = False
            pos = min(30, pos)
        else:
            pos = int(last_pos * 0.6 + pos * 0.4)

        actions.append({"at": at_ms, "pos": pos})
        last_pos = pos
        last_action_ms = at_ms

    return {
        "version": "1.0",
        "inverted": False,
        "range": 90,
        "actions": actions,
    }


# ── Main pipeline ─────────────────────────────────────────────────────────────

def generate_funscript(video_url: str) -> dict:
    """
    Full pipeline: download → optical-flow analysis → funscript.
    Falls back to audio RMS analysis if OpenCV is unavailable.
    """
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
        funscript = envelope_to_funscript(envelope)
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
        funscript = generate_funscript(args.url)
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
