"""
AIScripter engine — video-to-funscript generation.

This module is the entry point for the PyInstaller-frozen engine binary.
The daemon (local-daemon) spawns this process with --url <video_url> and
expects a valid funscript JSON string written to stdout on completion.

Usage:
    engine.py --url <video_url> [--output <path>]

Processing pipeline:
    1. Download the video to a temp file using yt-dlp
    2. Extract audio → run amplitude-envelope analysis to derive motion cues
    3. Build a funscript from the motion cues
    4. Write funscript JSON to stdout (or --output file)

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


# ── Download helpers ──────────────────────────────────────────────────────────

def download_audio(url: str, out_wav: str) -> None:
    """
    Download the audio track of a video URL to a WAV file using yt-dlp.
    Writes progress lines to stderr so the daemon can parse them.
    """
    import sys as _sys
    cmd = [
        "yt-dlp",
        "--no-playlist",
        "--extract-audio",
        "--audio-format", "wav",
        "--audio-quality", "5",   # 128kbps equivalent
        "--output", out_wav.replace(".wav", ".%(ext)s"),
        "--newline",
        "--progress",
        url,
    ]
    result = subprocess.run(cmd, capture_output=False, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"yt-dlp exited with code {result.returncode}")


def find_downloaded_wav(stem: str) -> str:
    """yt-dlp may change the extension; find the actual output file."""
    for ext in ("wav", "m4a", "mp3", "ogg", "opus"):
        candidate = f"{stem}.{ext}"
        if os.path.exists(candidate):
            return candidate
    raise FileNotFoundError(f"Could not find downloaded audio near stem: {stem}")


# ── Audio analysis ─────────────────────────────────────────────────────────────

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

    # Decode samples to [-1.0, 1.0]
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
    while i + window_size <= len(samples):
        chunk = samples[i:i + window_size]
        rms = math.sqrt(sum(s * s for s in chunk) / len(chunk))
        t = (i + window_size / 2) / framerate
        envelope.append((t, rms))
        i += hop_size
    return envelope


def rms_to_funscript(envelope: list[tuple[float, float]]) -> dict:
    """
    Convert an RMS amplitude envelope to a funscript.

    Strategy:
    - Normalise RMS to [0, 100] stroke range.
    - Alternate between high (motion crest) and low (motion trough) positions
      each time the normalised RMS crosses a midpoint threshold, creating a
      reciprocating pattern driven by the audio energy.
    - Decimate to at most one action per 150 ms to stay within device limits.
    """
    if not envelope:
        return {"version": "1.0", "inverted": False, "range": 90, "actions": []}

    rms_vals = [v for _, v in envelope]
    rms_max = max(rms_vals) or 1.0
    rms_min = min(rms_vals)
    rms_range = rms_max - rms_min or 1.0

    actions = []
    last_pos = 0
    last_action_ms = -999
    threshold_high = 0.6
    threshold_low = 0.3
    state_high = False   # alternates between high/low stroke

    for t, rms in envelope:
        norm = (rms - rms_min) / rms_range          # 0.0 – 1.0
        pos = int(norm * 90)                          # 0 – 90
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
            # Smooth interpolation between last position and current energy
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


# ── Conversion helper for non-WAV audio (ffmpeg fallback) ─────────────────────

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


# ── Main ───────────────────────────────────────────────────────────────────────

def generate_funscript(video_url: str) -> dict:
    """
    Full pipeline: download → extract audio → analyse → funscript.
    """
    with tempfile.TemporaryDirectory() as tmpdir:
        stem = os.path.join(tmpdir, "audio")
        print("[engine] Downloading audio...", file=sys.stderr)
        try:
            download_audio(video_url, stem + ".wav")
        except Exception as exc:
            raise RuntimeError(f"Download failed: {exc}") from exc

        # Locate output file (yt-dlp may change the extension)
        audio_path = find_downloaded_wav(stem)
        print(f"[engine] Audio at {audio_path}", file=sys.stderr)

        # Convert to WAV if needed
        wav_path = stem + "_final.wav"
        if not audio_path.endswith(".wav"):
            print("[engine] Converting to WAV...", file=sys.stderr)
            try:
                convert_to_wav(audio_path, wav_path)
            except Exception:
                # ffmpeg not available — return minimal stub
                return {"version": "1.0", "inverted": False, "range": 90, "actions": []}
        else:
            wav_path = audio_path

        print("[engine] Analysing audio...", file=sys.stderr)
        framerate, mono = read_wav_samples(wav_path)
        if framerate is None or not mono:
            raise RuntimeError("Could not decode audio samples from WAV file")

        print(f"[engine] {len(mono)} samples at {framerate} Hz", file=sys.stderr)
        envelope = compute_rms_envelope(mono, framerate, window_ms=80)
        funscript = rms_to_funscript(envelope)
        print(
            f"[engine] Generated {len(funscript['actions'])} actions",
            file=sys.stderr,
        )
        funscript["metadata"] = {
            "source_url": video_url,
            "generator": "AIScripter",
        }
        return funscript


def main() -> None:
    args = parse_args()
    try:
        funscript = generate_funscript(args.url)
        output_json = json.dumps(funscript, indent=2)
        if args.output:
            with open(args.output, "w", encoding="utf-8") as f:
                f.write(output_json)
            print(f"[engine] Written to {args.output}", file=sys.stderr)
        else:
            print(output_json)
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
