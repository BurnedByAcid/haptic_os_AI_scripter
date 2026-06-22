import os
import re as _re
import sys
import json
import uuid
import time
import signal
import socket
import secrets
import threading
import logging
from pathlib import Path
from flask import Flask, render_template, request, jsonify, send_file
from flask_socketio import SocketIO, emit
try:
    from flask_cors import CORS as _CORS
    _has_flask_cors = True
except ImportError:
    _has_flask_cors = False

sys.path.insert(0, str(Path(__file__).parent))

app = Flask(__name__, template_folder="templates", static_folder="static")
app.config["SECRET_KEY"] = "hapticai-web-secret"
app.config["MAX_CONTENT_LENGTH"] = 500 * 1024 * 1024

_SESSION_TOKEN: str = secrets.token_urlsafe(32)

_UPLOAD_MAX_BYTES = 500 * 1024 * 1024
_UPLOAD_MAX_AGE_SECONDS = 24 * 3600

_LOCALHOST_RE = _re.compile(r"^http://localhost(:\d+)?$")
_LOOPBACK_ORIGIN_RE = _re.compile(r"^https?://(?:localhost|127\.\d+\.\d+\.\d+|\[::1\])(:\d+)?$")

def _build_allowed_origins():
    raw = os.environ.get("CORS_ALLOWED_ORIGINS", "")
    strings = [o.strip() for o in raw.split(",") if o.strip()] if raw.strip() else [
        "https://hapticos.org",
        "https://www.hapticos.org",
        "https://hapticos.replit.app",
        "http://localhost",
    ]
    non_local = [o for o in strings if "localhost" not in o]
    has_local = any("localhost" in o for o in strings)
    if has_local:
        return non_local + [_LOCALHOST_RE]
    return non_local

_allowed_origins = _build_allowed_origins()

def _origin_allowed(origin):
    for entry in _allowed_origins:
        if hasattr(entry, "match"):
            if entry.match(origin):
                return True
        elif entry == origin:
            return True
    return False

socketio = SocketIO(app, cors_allowed_origins=_origin_allowed, async_mode="threading")

logging.getLogger(__name__).info(
    "Flask-SocketIO initialised with async_mode=threading"
)

if _has_flask_cors:
    _CORS(app, origins=_allowed_origins,
          allow_headers=["Content-Type", "Authorization", "X-HapticAI-Token"],
          expose_headers=["Content-Disposition"])

    @app.after_request
    def _add_private_network_header(response):
        response.headers["Access-Control-Allow-Private-Network"] = "true"
        return response
else:
    @app.after_request
    def _add_cors_headers(response):
        origin = request.headers.get("Origin", "")
        if _origin_allowed(origin):
            response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization, X-HapticAI-Token"
        response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
        response.headers["Access-Control-Allow-Private-Network"] = "true"
        return response

    @app.route("/status", methods=["OPTIONS"])
    @app.route("/generate", methods=["OPTIONS"])
    def _options_handler():
        from flask import Response
        origin = request.headers.get("Origin", "")
        r = Response()
        if _origin_allowed(origin):
            r.headers["Access-Control-Allow-Origin"] = origin
        r.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization, X-HapticAI-Token"
        r.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
        r.headers["Access-Control-Allow-Private-Network"] = "true"
        return r

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def _require_trusted_request():
    """
    Guard for state-changing endpoints.

    Rules:
    1. If the request carries an Origin header (i.e. it originates from a
       browser page), that origin MUST be in the CORS allowlist.  This blocks
       any cross-site request a hostile page tries to send in no-cors mode,
       because the server rejects the request before any side effects occur.
    2. For browser requests (Origin present) the caller MUST also supply the
       per-session X-HapticAI-Token header.  HapticOS reads this token from
       GET /status (which is CORS-protected, so only allowed origins can read
       its response) and attaches it to every mutating call.

    Direct local callers (curl, desktop UI) that omit Origin are allowed
    through without a token — they are not reachable from a remote web page.

    Returns (None, None) when the request is trusted.
    Returns (response, status_code) when it must be rejected.
    """
    origin = request.headers.get("Origin", "")

    if not origin:
        # Origin absent — derive a synthetic origin from the Referer header so
        # that browsers which suppress Origin but still send Referer (e.g. some
        # Chromium variants in certain redirect flows) are handled correctly.
        referer = request.headers.get("Referer", "")
        if referer:
            try:
                from urllib.parse import urlparse as _urlparse
                _r = _urlparse(referer)
                if _r.scheme and _r.netloc:
                    origin = f"{_r.scheme}://{_r.netloc}"
            except Exception:
                pass

    if not origin:
        # No Origin and no usable Referer — direct local call (curl, native
        # desktop UI). These callers are unreachable from a remote web page.
        return None, None

    # Requests whose Origin is a loopback address are the HapticAI local web UI.
    # A remote page cannot forge a loopback Origin, so the network topology
    # itself provides the trust boundary here — no token needed.
    if _LOOPBACK_ORIGIN_RE.match(origin):
        return None, None

    # For any other origin (e.g. HapticOS at hapticos.replit.app) the origin
    # must be in the CORS allowlist AND the caller must supply the per-session
    # token.  Any future browser calls to /api/* mutating endpoints from
    # HapticOS must include the "X-HapticAI-Token" header obtained from GET /status.
    if not _origin_allowed(origin):
        logger.warning("Rejected mutating request from untrusted origin: %s", origin)
        return jsonify({"error": "forbidden"}), 403
    provided = request.headers.get("X-HapticAI-Token", "")
    if not secrets.compare_digest(provided, _SESSION_TOKEN):
        logger.warning("Rejected mutating request with bad session token from origin: %s", origin)
        return jsonify({"error": "forbidden"}), 403
    return None, None


def _cleanup_stale_uploads():
    """Remove upload and output files older than _UPLOAD_MAX_AGE_SECONDS."""
    cutoff = time.time() - _UPLOAD_MAX_AGE_SECONDS
    for folder in (UPLOAD_FOLDER, OUTPUT_FOLDER):
        for path in list(folder.iterdir()):
            try:
                if path.is_file() and path.stat().st_mtime < cutoff:
                    path.unlink()
                    logger.info("Removed stale file: %s", path)
            except OSError:
                pass
    stale_jobs = [jid for jid, j in list(jobs.items())
                  if j.get("status") in ("done", "error", "uploaded", "funscript_loaded")
                  and time.time() - j.get("_created_at", time.time()) > _UPLOAD_MAX_AGE_SECONDS]
    for jid in stale_jobs:
        jobs.pop(jid, None)

UPLOAD_FOLDER = Path("uploads")
OUTPUT_FOLDER = Path("output")
UPLOAD_FOLDER.mkdir(exist_ok=True)
OUTPUT_FOLDER.mkdir(exist_ok=True)


# ── User settings (output folder preference) ─────────────────────────────────

def _get_settings_path() -> Path:
    """Return path to HapticAI settings JSON file."""
    if sys.platform == "win32":
        base = Path(os.environ.get("APPDATA") or (Path.home() / "AppData" / "Roaming"))
    elif sys.platform == "darwin":
        base = Path.home() / "Library" / "Application Support"
    else:
        base = Path(os.environ.get("XDG_CONFIG_HOME") or (Path.home() / ".config"))
    d = base / "HapticAI"
    d.mkdir(parents=True, exist_ok=True)
    return d / "settings.json"


def _load_settings() -> dict:
    p = _get_settings_path()
    if p.exists():
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {}


def _save_settings(data: dict) -> None:
    _get_settings_path().write_text(json.dumps(data, indent=2), encoding="utf-8")


def _get_default_output_folder() -> Path:
    """Return the user's configured output folder, falling back to Documents/Funscripts."""
    settings = _load_settings()
    configured = settings.get("output_folder", "")
    if configured:
        p = Path(configured)
        try:
            p.mkdir(parents=True, exist_ok=True)
            return p
        except Exception:
            pass
    fallback = Path.home() / "Documents" / "Funscripts"
    fallback.mkdir(parents=True, exist_ok=True)
    return fallback


def _copy_safe(src: Path, dest_dir: Path) -> Path | None:
    """Copy *src* into *dest_dir* with collision-safe naming. Returns dest path or None."""
    import shutil
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / src.name
    if dest.exists():
        stem, suffix = src.stem, src.suffix
        for i in range(1, 100):
            dest = dest_dir / f"{stem} ({i}){suffix}"
            if not dest.exists():
                break
    shutil.copy2(src, dest)
    return dest


def _save_funscript_output(src: Path, job: dict) -> Path | None:
    """
    Copy the generated funscript to the appropriate output folder.

    Priority:
      1. job["source_local_folder"] — same directory as the source video file
      2. User's configured output folder (settings.json → output_folder)
      3. ~/Documents/Funscripts (built-in fallback)

    Returns the saved Path, or None on failure.
    """
    try:
        source_folder = job.get("source_local_folder")
        dest_dir = Path(source_folder) if source_folder else _get_default_output_folder()
        dest = _copy_safe(src, dest_dir)
        logger.info("Funscript saved to: %s", dest)
        return dest
    except Exception:
        logger.debug("Could not save funscript to output folder", exc_info=True)
        return None

def _get_port_file_path() -> Path:
    """
    Return the path for hapticai_port.txt.
    - PyInstaller frozen (packaged): OS app-data dir — writable, not inside
      a signed app bundle or Program Files.
    - Development: system temp dir — never committed to source.
    Always named hapticai_port.txt.
    """
    import platform
    if getattr(sys, "frozen", False):
        system = platform.system()
        if system == "Windows":
            base = Path(os.environ.get("LOCALAPPDATA") or
                        Path.home() / "AppData" / "Local")
        elif system == "Darwin":
            base = Path.home() / "Library" / "Application Support"
        else:
            base = Path(os.environ.get("XDG_DATA_HOME") or
                        Path.home() / ".local" / "share")
        app_dir = base / "HapticAI"
        app_dir.mkdir(parents=True, exist_ok=True)
        return app_dir / "hapticai_port.txt"
    import tempfile
    return Path(tempfile.gettempdir()) / "hapticai_port.txt"

PORT_FILE = _get_port_file_path()

jobs = {}


def find_free_port(preferred: int = 8000, host: str = "127.0.0.1") -> int:
    for port in [preferred] + list(range(8001, 8100)) + list(range(5000, 5100)):
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
                s.bind((host, port))
                return port
        except OSError:
            continue
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind((host, 0))
        return s.getsockname()[1]


def get_tracker_modes():
    try:
        from config.tracker_discovery import get_tracker_discovery, TrackerCategory, HIDDEN_TRACKER_NAMES
        discovery = get_tracker_discovery()
        modes = []
        for name, info in discovery._display_info_cache.items():
            if "example" in info.internal_name.lower() or "example" in info.display_name.lower():
                continue
            if info.internal_name in HIDDEN_TRACKER_NAMES:
                continue
            cli = info.cli_aliases[0] if info.cli_aliases else info.internal_name
            modes.append({
                "name": info.display_name,
                "internal": info.internal_name,
                "category": info.category.value,
                "description": info.description,
                "cli": cli,
                "supports_batch": info.supports_batch,
                "supports_realtime": info.supports_realtime,
            })
        return modes
    except Exception as e:
        logger.warning(f"Could not load tracker discovery: {e}")
        return [
            {"name": "3-Stage (Recommended)", "internal": "3-stage", "category": "offline",
             "description": "Full 3-stage offline analysis — highest accuracy", "cli": "3-stage",
             "supports_batch": True, "supports_realtime": False},
            {"name": "Optical Flow", "internal": "optical-flow", "category": "offline",
             "description": "Optical flow based tracking", "cli": "optical-flow",
             "supports_batch": True, "supports_realtime": False},
            {"name": "Live ROI", "internal": "live-roi", "category": "live",
             "description": "Real-time region-of-interest tracking", "cli": "live-roi",
             "supports_batch": False, "supports_realtime": True},
        ]


def serialize_plugin_schema(schema):
    result = {}
    for key, info in schema.items():
        entry = dict(info)
        if 'type' in entry and isinstance(entry['type'], type):
            entry['type'] = entry['type'].__name__
        result[key] = entry
    return result


def get_plugins():
    try:
        from funscript.plugins.plugin_loader import PluginLoader
        from funscript.plugins.base_plugin import plugin_registry
        loader = PluginLoader()
        loader.load_builtin_plugins()
        plugins = plugin_registry.list_plugins()
        for p in plugins:
            if 'parameters_schema' in p and p['parameters_schema']:
                p['parameters_schema'] = serialize_plugin_schema(p['parameters_schema'])
        return plugins
    except Exception as e:
        logger.warning(f"Could not load plugins: {e}")
        return [
            {"name": "Ultimate Autotune", "description": "8-stage enhancement pipeline for optimal quality", "version": "1.0.0"},
            {"name": "Simplify (RDP)", "description": "Reduces redundant points using RDP algorithm", "version": "1.0.0"},
            {"name": "Savitzky-Golay Filter", "description": "Smooths the funscript signal", "version": "1.0.0"},
            {"name": "Amplify", "description": "Scales signal amplitude", "version": "1.0.0"},
            {"name": "Speed Limiter", "description": "Limits maximum device speed", "version": "1.0.0"},
            {"name": "Anti-Jerk", "description": "Removes jerky intermediate points", "version": "1.0.0"},
            {"name": "Clamp", "description": "Clamps values to a min/max range", "version": "1.0.0"},
            {"name": "Invert", "description": "Inverts the funscript signal", "version": "1.0.0"},
        ]


@app.route("/")
def index():
    return render_template("index.html")


# ---------------------------------------------------------------------------
# HapticOS integration endpoints — used by use-hapticai-connection.ts
# ---------------------------------------------------------------------------

@app.route("/status")
def hapticos_status():
    """
    GET /status
    Returns server version and available generation options.
    Shape: { version: string, options: HapticAIOption[] }
    """
    options = [
        {
            "key": "mode",
            "label": "Processing Mode",
            "type": "select",
            "default": "3-stage",
            "choices": [m["cli"] for m in get_tracker_modes()],
        },
        {
            "key": "autotune",
            "label": "Auto-tune output",
            "type": "boolean",
            "default": True,
        },
        {
            "key": "generate_roll",
            "label": "Generate roll axis",
            "type": "boolean",
            "default": False,
        },
        {
            "key": "duration_minutes",
            "label": "Duration (minutes)",
            "type": "number",
            "default": None,
            "min": 0.17,
            "max": 10.0,
            "step": 0.5,
        },
        {
            "key": "intensity",
            "label": "Intensity",
            "type": "number",
            "default": None,
            "min": 0,
            "max": 100,
            "step": 1,
        },
        {
            "key": "creativity",
            "label": "Creativity",
            "type": "number",
            "default": 50,
            "min": 0,
            "max": 100,
        },
    ]
    return jsonify({"version": "0.5.4", "options": options, "session_token": _SESSION_TOKEN})


def _interpret_prompt(prompt: str, options: dict) -> dict:
    """
    Parse a natural-language haptic prompt and options into generation parameters.

    Returns a dict with keys:
        duration_s       – total script length in seconds
        base_interval_ms – nominal ms between action points (controls tempo)
        intensity        – 0.0–1.0 amplitude multiplier
        pattern          – "buildup", "wave", "burst", "constant", "descend", "edge"
        variation        – 0.0–1.0 randomness added on top of the base pattern
        autotune         – whether to apply smoothing post-generation
    """
    import re
    text = prompt.lower()

    # --- Duration ---
    if options.get("duration_minutes") is not None:
        try:
            duration_s = float(options["duration_minutes"]) * 60.0
        except (TypeError, ValueError):
            duration_s = 120.0
        duration_s = max(10.0, min(600.0, duration_s))
    else:
        duration_s = 120.0
        m = re.search(r'(\d+(?:\.\d+)?)\s*minute', text)
        if m:
            duration_s = float(m.group(1)) * 60.0
        else:
            m = re.search(r'(\d+(?:\.\d+)?)\s*second', text)
            if m:
                duration_s = float(m.group(1))
        duration_s = max(10.0, min(600.0, duration_s))

    # --- Tempo / interval ---
    if any(w in text for w in ("very slow", "extremely slow", "super slow", "glacial")):
        base_interval_ms = 1400
    elif any(w in text for w in ("slow", "gentle", "leisurely", "relaxed", "languid")):
        base_interval_ms = 900
    elif any(w in text for w in ("very fast", "extremely fast", "super fast", "frantic", "rapid", "quick")):
        base_interval_ms = 180
    elif any(w in text for w in ("fast", "speed", "intense pace", "urgent")):
        base_interval_ms = 300
    else:
        base_interval_ms = 550

    # --- Intensity ---
    if options.get("intensity") is not None:
        try:
            intensity = max(0.0, min(1.0, float(options["intensity"]) / 100.0))
        except (TypeError, ValueError):
            intensity = 0.70
    elif any(w in text for w in ("very intense", "extremely intense", "maximum", "full", "overwhelming")):
        intensity = 0.98
    elif any(w in text for w in ("intense", "strong", "powerful", "hard", "deep")):
        intensity = 0.82
    elif any(w in text for w in ("light", "soft", "gentle", "mild", "subtle", "delicate")):
        intensity = 0.40
    elif any(w in text for w in ("moderate", "medium", "average")):
        intensity = 0.62
    else:
        intensity = 0.70

    # --- Pattern ---
    if any(w in text for w in ("build", "buildup", "build up", "build-up", "ramp", "escalate", "rise", "crescendo", "increase")):
        pattern = "buildup"
    elif any(w in text for w in ("edg", "tease", "almost", "hold back", "denial")):
        pattern = "edge"
    elif any(w in text for w in ("burst", "pulse", "staccato", "stutter", "jolt", "snap", "spike")):
        pattern = "burst"
    elif any(w in text for w in ("descend", "wind down", "slow down", "fade", "taper", "decrease", "come down")):
        pattern = "descend"
    elif any(w in text for w in ("wave", "undulat", "rhythmic", "sway", "cycle", "ebb", "flow")):
        pattern = "wave"
    else:
        pattern = "constant"

    # --- Variation / randomness ---
    if any(w in text for w in ("random", "unpredictable", "surprise", "chaotic", "irregular")):
        variation = 0.45
    elif any(w in text for w in ("steady", "consistent", "even", "regular", "uniform")):
        variation = 0.05
    else:
        variation = 0.18

    autotune = bool(options.get("autotune", True))

    # Allow explicit creativity override (0–100) from the caller.
    # 0 → fully predictable (variation=0.0), 100 → chaotic (variation=0.60).
    if "creativity" in options:
        try:
            creativity = max(0.0, min(100.0, float(options["creativity"])))
            variation = (creativity / 100.0) * 0.60
        except (TypeError, ValueError):
            pass

    return {
        "duration_s": duration_s,
        "base_interval_ms": base_interval_ms,
        "intensity": intensity,
        "pattern": pattern,
        "variation": variation,
        "autotune": autotune,
    }


def _generate_actions(params: dict, seed: int = 0) -> list:
    """
    Synthesize a list of funscript actions from interpreted prompt parameters.
    """
    import math
    import random

    rng = random.Random(seed)

    duration_ms = int(params["duration_s"] * 1000)
    base_iv = params["base_interval_ms"]
    intensity = params["intensity"]
    pattern = params["pattern"]
    variation = params["variation"]

    actions = []
    t = 0

    low_base = max(5, int(50 - intensity * 45))
    high_base = min(100, int(50 + intensity * 45))

    going_up = True

    while t <= duration_ms:
        progress = t / duration_ms  # 0.0 → 1.0

        # --- Envelope: shape amplitude over time based on pattern ---
        if pattern == "buildup":
            envelope = 0.25 + 0.75 * progress
        elif pattern == "descend":
            envelope = 1.0 - 0.75 * progress
        elif pattern == "edge":
            # Three plateaus with sudden drops; keeps near peak but never quite goes over
            cycle = progress * 3.0
            phase = cycle % 1.0
            if phase < 0.85:
                envelope = 0.80 + 0.18 * (phase / 0.85)
            else:
                envelope = 0.30 + (phase - 0.85) / 0.15 * 0.50
        elif pattern == "wave":
            envelope = 0.55 + 0.45 * math.sin(math.pi * progress * 4)
        elif pattern == "burst":
            cycle_len = 0.15
            phase = (progress % cycle_len) / cycle_len
            envelope = 1.0 if phase < 0.5 else 0.15
        else:
            envelope = 1.0

        envelope = max(0.0, min(1.0, envelope))

        # --- Compute position for this tick ---
        lo = max(0, int(low_base + (1.0 - envelope) * (50 - low_base)))
        hi = min(100, int(high_base - (1.0 - envelope) * (high_base - 50)))
        lo = min(lo, hi - 5)

        if going_up:
            raw_pos = hi
        else:
            raw_pos = lo

        # Add variation noise
        noise = int(rng.gauss(0, variation * (hi - lo) * 0.3))
        pos = max(0, min(100, raw_pos + noise))
        actions.append({"at": t, "pos": pos})

        going_up = not going_up

        # Jitter the interval slightly for a human feel
        jitter_factor = 1.0 + rng.uniform(-variation * 0.25, variation * 0.25)
        interval = max(50, int(base_iv * jitter_factor))
        t += interval

    # Ensure the script ends with a neutral position
    if actions and actions[-1]["at"] < duration_ms:
        actions.append({"at": duration_ms, "pos": 0})

    return actions


def _fallback_smooth_actions(actions: list) -> list:
    """
    Pure-Python fallback smoother used when the HapticAI plugin system is
    unavailable.  Applies a 3-point weighted average then clamps device speed.
    """
    if len(actions) < 3:
        return actions

    smoothed = [dict(actions[0])]
    for i in range(1, len(actions) - 1):
        avg_pos = (actions[i - 1]["pos"] + actions[i]["pos"] * 2 + actions[i + 1]["pos"]) // 4
        smoothed.append({"at": actions[i]["at"], "pos": max(0, min(100, avg_pos))})
    smoothed.append(dict(actions[-1]))

    MAX_SPEED = 800
    result = [smoothed[0]]
    for i in range(1, len(smoothed)):
        dt = smoothed[i]["at"] - smoothed[i - 1]["at"]
        dp = abs(smoothed[i]["pos"] - smoothed[i - 1]["pos"])
        if dt > 0 and dp / dt * 1000 > MAX_SPEED:
            clamped_dp = int(MAX_SPEED * dt / 1000)
            direction = 1 if smoothed[i]["pos"] > smoothed[i - 1]["pos"] else -1
            new_pos = max(0, min(100, smoothed[i - 1]["pos"] + direction * clamped_dp))
            result.append({"at": smoothed[i]["at"], "pos": new_pos})
        else:
            result.append(smoothed[i])

    return result


def _try_app_logic_pipeline(raw_actions: list, options: dict, output_dir: Path) -> list | None:
    """
    Primary processing path.

    Saves *raw_actions* to a temporary funscript file, then invokes
    ``ApplicationLogic.run_cli()`` in *funscript_mode* so the real HapticAI
    processing pipeline (plugin system + internal file manager) transforms the
    signal.  The filter applied is chosen from the *options* dict:
        - autotune=True  → ``ultimate-autotune`` (8-stage pipeline)
        - autotune=False → ``speed-limiter``       (device-speed clamping only)

    The ``mode`` option is forwarded to ``run_cli`` so the processing quality
    level is respected (e.g. ``"3-stage"`` uses higher-quality settings in the
    autotune plugin).

    Returns the processed action list on success, or ``None`` if the core is
    unavailable (missing YOLO models / dependencies not installed) so the caller
    can fall back to the plugin-only path.

    The call runs inside a thread with a *50-second* timeout so the HTTP request
    cannot block indefinitely if a heavy initialisation stalls.
    """
    import types as _types
    import json as _json

    output_dir.mkdir(parents=True, exist_ok=True)
    temp_fs_path = output_dir / "hapticai_generate_input.funscript"
    temp_fs_path.write_text(_json.dumps({
        "version": "1.0",
        "inverted": False,
        "range": 100,
        "actions": raw_actions,
    }))

    result_holder: list[list | None] = [None]
    error_holder: list[str] = []

    def _worker():
        try:
            from application.logic.app_logic import ApplicationLogic

            autotune = bool(options.get("autotune", True))
            filter_name = "ultimate-autotune" if autotune else "speed-limiter"
            mode_val = str(options.get("mode", "3-stage"))

            args = _types.SimpleNamespace(
                input_path=str(temp_fs_path),
                mode=mode_val,
                od_mode="current",
                overwrite=True,
                autotune=autotune,
                copy=False,
                generate_roll=bool(options.get("generate_roll", False)),
                recursive=False,
                funscript_mode=True,
                filter=filter_name,
            )

            os.environ["FUNGEN_OUTPUT_DIR"] = str(output_dir)
            core_app = ApplicationLogic(is_cli=True)
            core_app.run_cli(args)

            if temp_fs_path.exists():
                content = _json.loads(temp_fs_path.read_text())
                processed = content.get("actions", [])
                if processed:
                    result_holder[0] = processed
                    return

            error_holder.append("run_cli produced no output")
        except Exception as exc:
            error_holder.append(str(exc))

    t = threading.Thread(target=_worker, daemon=True)
    t.start()
    t.join(timeout=50)

    if result_holder[0] is not None:
        logger.info("ApplicationLogic.run_cli pipeline succeeded (%d actions)", len(result_holder[0]))
        return result_holder[0]

    reason = error_holder[0] if error_holder else "timeout or unknown error"
    logger.warning("ApplicationLogic.run_cli unavailable — falling back to plugin system: %s", reason)
    return None


def _plugin_system_pipeline(raw_actions: list, options: dict) -> list | None:
    """
    Fallback processing path using the HapticAI plugin system directly
    (``funscript.plugins`` + ``DualAxisFunscript``), bypassing the heavyweight
    ``ApplicationLogic`` initialisation.

    This mirrors the logic inside ``_run_funscript_cli_mode`` and the existing
    ``/api/apply_filter`` endpoint.  Returns ``None`` if the plugin system
    itself is unavailable.
    """
    try:
        from funscript.plugins.plugin_loader import PluginLoader
        from funscript.plugins.base_plugin import plugin_registry
        from funscript.dual_axis_funscript import DualAxisFunscript

        loader = PluginLoader()
        loader.load_builtin_plugins()

        fs = DualAxisFunscript()
        for action in raw_actions:
            fs.primary_actions.append(dict(action))
        fs._invalidate_cache("primary")

        autotune = bool(options.get("autotune", True))
        mode = str(options.get("mode", "3-stage")).lower()
        high_quality = "3-stage" in mode or "optical" in mode

        speed_plugin = plugin_registry.get_plugin("Speed Limiter")
        if speed_plugin:
            speed_params = speed_plugin.validate_parameters({})
            speed_plugin.transform(fs, axis="primary", **speed_params)
            logger.debug("Speed Limiter applied via plugin system")

        if autotune:
            at_plugin = plugin_registry.get_plugin("Ultimate Autotune")
            if at_plugin:
                amplify_scale = 1.35 if high_quality else 1.25
                at_params = at_plugin.validate_parameters({"amplify_scale": amplify_scale})
                at_plugin.transform(fs, axis="primary", **at_params)
                logger.debug("Ultimate Autotune applied (high_quality=%s)", high_quality)

        result = list(fs.primary_actions)
        logger.info("Plugin system pipeline succeeded (%d actions)", len(result))
        return result

    except Exception as exc:
        logger.warning("Plugin system unavailable — falling back to built-in smoother: %s", exc)
        return None


def _build_roll_actions(primary_actions: list) -> list:
    """
    Derive a secondary (roll) axis from the primary signal by phase-shifting
    and inverting, producing a complementary oscillation pattern.
    """
    import math
    roll = []
    for i, a in enumerate(primary_actions):
        phase_offset = int(50 * math.sin(math.pi * i / max(1, len(primary_actions) - 1)))
        pos = max(0, min(100, 50 + (a["pos"] - 50) * -0.6 + phase_offset))
        roll.append({"at": a["at"], "pos": int(pos)})
    return roll


def _run_generate_job(job_id: str, prompt: str, options: dict) -> None:
    """
    Core generation logic executed synchronously for a /generate request.
    Updates jobs[job_id] with status, progress, and the final funscript.

    Processing pipeline (three tiers, first success wins):
      1. ApplicationLogic.run_cli (funscript_mode) — the real HapticAI core
      2. Plugin system directly (DualAxisFunscript + registry) — same plugins,
         bypasses heavyweight YOLO/tracker initialisation
      3. Pure-Python fallback smoother — no external deps required
    """
    import time as _time
    import json as _json

    job = jobs[job_id]

    def _progress(pct: int, msg: str) -> None:
        job["progress"] = pct
        job["log"].append(msg)
        logger.info("[job %s] %s", job_id, msg)

    try:
        _progress(5, "Interpreting prompt…")
        params = _interpret_prompt(prompt, options)
        _progress(15, f"Prompt interpreted: pattern={params['pattern']} "
                      f"duration={params['duration_s']:.0f}s "
                      f"interval={params['base_interval_ms']}ms "
                      f"intensity={params['intensity']:.2f}")

        seed = int(_time.time() * 1000) & 0xFFFFFF
        _progress(25, "Generating raw haptic signal…")
        raw_actions = _generate_actions(params, seed=seed)
        _progress(40, f"Raw signal: {len(raw_actions)} action points generated")

        output_dir = OUTPUT_FOLDER / f"gen_{job_id}"
        output_dir.mkdir(parents=True, exist_ok=True)

        _progress(45, "Attempting HapticAI core pipeline (ApplicationLogic.run_cli)…")
        processed_actions = _try_app_logic_pipeline(raw_actions, options, output_dir)
        pipeline_used = "ApplicationLogic.run_cli"

        if processed_actions is None:
            _progress(55, "Core pipeline unavailable — trying plugin system…")
            processed_actions = _plugin_system_pipeline(raw_actions, options)
            pipeline_used = "plugin-system"

        if processed_actions is None:
            _progress(65, "Plugin system unavailable — using built-in smoother…")
            autotune = bool(options.get("autotune", True))
            processed_actions = (
                _fallback_smooth_actions(raw_actions) if autotune else raw_actions
            )
            pipeline_used = "fallback-smoother"

        _progress(80, f"Pipeline '{pipeline_used}' complete: "
                      f"{len(processed_actions)} actions")

        generate_roll = bool(options.get("generate_roll", False))
        roll_actions: list = []
        if generate_roll:
            _progress(85, "Generating roll axis…")
            roll_actions = _build_roll_actions(processed_actions)
            _progress(88, f"Roll axis: {len(roll_actions)} points")

        duration_s = params["duration_s"]
        funscript: dict = {
            "version": "1.0",
            "inverted": False,
            "range": 100,
            "metadata": {
                "creator": "HapticAI",
                "description": prompt[:200],
                "duration": duration_s,
                "generated_by": "hapticos-prompt-engine",
                "pattern": params["pattern"],
                "pipeline": pipeline_used,
            },
            "actions": processed_actions,
        }
        if generate_roll and roll_actions:
            funscript["roll_actions"] = roll_actions

        funscript_str = _json.dumps(funscript)

        out_file = output_dir / f"gen_{job_id}.funscript"
        out_file.write_text(funscript_str)
        _save_funscript_output(out_file, job)

        job["funscript"] = funscript_str
        job["funscript_actions"] = processed_actions
        job["output_files"] = [str(out_file)]
        job["status"] = "done"
        job["progress"] = 100
        _progress(100, "Generation complete")

    except Exception as exc:
        logger.exception("Generation job %s failed", job_id)
        job["status"] = "error"
        job["error"] = str(exc)
        job["log"].append(f"Error: {exc}")


@app.route("/generate", methods=["POST"])
def hapticos_generate():
    """
    POST /generate
    Body: { prompt: string, options?: { mode?: string, autotune?: bool,
            generate_roll?: bool, duration_minutes?: number, intensity?: number } }
    Returns: { funscript: string }  (JSON-encoded funscript string)

    Interprets the natural-language prompt to derive haptic parameters (tempo,
    intensity, pattern shape, duration), synthesises a raw haptic signal, then
    runs it through the real HapticAI plugin pipeline (Speed Limiter +
    Ultimate Autotune) and returns the processed result.

    Options from /status are honoured:
      - autotune          – enable/disable HapticAI Ultimate Autotune pipeline
      - mode              – influences processing quality (3-stage → higher amplification)
      - generate_roll     – add a secondary roll axis to the output
      - duration_minutes  – explicit script length in minutes (0.17–10); overrides
                            duration inferred from the prompt text
      - intensity         – explicit amplitude 0–100 %; overrides keyword inference
    """
    err, code = _require_trusted_request()
    if err is not None:
        return err, code

    data = request.get_json(silent=True) or {}
    prompt = str(data.get("prompt", "")).strip()
    if not prompt:
        return jsonify({"error": "prompt is required"}), 400

    options = data.get("options") or {}
    if not isinstance(options, dict):
        options = {}

    job_id = str(uuid.uuid4())[:8]
    jobs[job_id] = {
        "id": job_id,
        "status": "processing",
        "progress": 0,
        "log": [],
        "funscript": None,
        "funscript_actions": [],
        "error": None,
        "source": "hapticos_generate",
    }

    _run_generate_job(job_id, prompt, options)

    job = jobs[job_id]
    if job["status"] == "error":
        return jsonify({"error": job.get("error", "Generation failed")}), 500

    import json as _json
    funscript_str = job["funscript"]
    preview_actions = job["funscript_actions"][:50]
    return jsonify({"funscript": funscript_str, "actions": preview_actions})


# ---------------------------------------------------------------------------
# End HapticOS integration endpoints
# ---------------------------------------------------------------------------


@app.route("/api/status")
def api_status():
    return jsonify({
        "ok": True,
        "version": "0.5.4",
        "port": _server_port,
    })


_LOOPBACK_PREFIXES = ("127.", "::1", "::ffff:127.")

@app.route("/api/shutdown", methods=["POST"])
def api_shutdown():
    remote = request.remote_addr or ""
    if not any(remote.startswith(p) for p in _LOOPBACK_PREFIXES):
        return jsonify({"error": "forbidden"}), 403

    err, code = _require_trusted_request()
    if err is not None:
        return err, code

    def _shutdown():
        time.sleep(0.3)
        if PORT_FILE.exists():
            PORT_FILE.unlink()
        os.kill(os.getpid(), signal.SIGTERM)

    threading.Thread(target=_shutdown, daemon=True).start()
    return jsonify({"status": "shutting_down"})


@app.route("/api/modes")
def api_modes():
    return jsonify(get_tracker_modes())


@app.route("/api/plugins")
def api_plugins():
    return jsonify(get_plugins())


@app.route("/api/upload", methods=["POST"])
def upload_video():
    err, code = _require_trusted_request()
    if err is not None:
        return err, code

    if request.content_length and request.content_length > _UPLOAD_MAX_BYTES:
        return jsonify({"error": "Upload exceeds the 500 MB limit"}), 413

    if "video" not in request.files:
        return jsonify({"error": "No file provided"}), 400
    file = request.files["video"]
    if file.filename == "":
        return jsonify({"error": "No file selected"}), 400

    allowed = {".mp4", ".mkv", ".avi", ".mov", ".wmv", ".webm", ".m4v"}
    ext = Path(file.filename).suffix.lower()
    if ext not in allowed:
        return jsonify({"error": f"Unsupported format. Allowed: {', '.join(allowed)}"}), 400

    _cleanup_stale_uploads()

    job_id = str(uuid.uuid4())[:8]
    dest = UPLOAD_FOLDER / f"{job_id}{ext}"
    file.save(dest)

    if dest.stat().st_size > _UPLOAD_MAX_BYTES:
        dest.unlink()
        return jsonify({"error": "Upload exceeds the 500 MB limit"}), 413

    jobs[job_id] = {
        "id": job_id,
        "filename": file.filename,
        "filepath": str(dest),
        "status": "uploaded",
        "progress": 0,
        "stage": 0,
        "log": [],
        "output_files": [],
        "_created_at": time.time(),
    }

    return jsonify({"job_id": job_id, "filename": file.filename, "size": dest.stat().st_size})


@app.route("/api/upload_funscript", methods=["POST"])
def upload_funscript():
    err, code = _require_trusted_request()
    if err is not None:
        return err, code

    if request.content_length and request.content_length > _UPLOAD_MAX_BYTES:
        return jsonify({"error": "Upload exceeds the 500 MB limit"}), 413

    if "funscript" not in request.files:
        return jsonify({"error": "No file provided"}), 400
    file = request.files["funscript"]
    if not file.filename.endswith(".funscript"):
        return jsonify({"error": "File must be a .funscript file"}), 400

    _cleanup_stale_uploads()

    job_id = str(uuid.uuid4())[:8]
    dest = UPLOAD_FOLDER / f"{job_id}.funscript"
    file.save(dest)

    if dest.stat().st_size > _UPLOAD_MAX_BYTES:
        dest.unlink()
        return jsonify({"error": "Upload exceeds the 500 MB limit"}), 413

    content = json.loads(dest.read_text())
    actions = content.get("actions", [])

    jobs[job_id] = {
        "id": job_id,
        "filename": file.filename,
        "filepath": str(dest),
        "status": "funscript_loaded",
        "progress": 100,
        "stage": 4,
        "log": [f"Loaded funscript: {file.filename} ({len(actions)} actions)"],
        "output_files": [str(dest)],
        "funscript_actions": actions,
        "_created_at": time.time(),
    }

    return jsonify({"job_id": job_id, "filename": file.filename, "actions": actions[:50]})


@app.route("/api/settings", methods=["GET"])
def get_settings():
    err, code = _require_trusted_request()
    if err is not None:
        return err, code
    settings = _load_settings()
    default_folder = str(Path.home() / "Documents" / "Funscripts")
    return jsonify({
        "output_folder": settings.get("output_folder", default_folder),
    })


@app.route("/api/settings", methods=["POST"])
def update_settings():
    err, code = _require_trusted_request()
    if err is not None:
        return err, code
    data = request.json or {}
    settings = _load_settings()
    if "output_folder" in data:
        folder = str(data["output_folder"]).strip()
        if folder:
            try:
                p = Path(folder)
                p.mkdir(parents=True, exist_ok=True)
                settings["output_folder"] = str(p)
            except Exception as exc:
                return jsonify({"error": f"Cannot use that folder: {exc}"}), 400
        else:
            settings.pop("output_folder", None)
    _save_settings(settings)
    default_folder = str(Path.home() / "Documents" / "Funscripts")
    return jsonify({"ok": True, "output_folder": settings.get("output_folder", default_folder)})


@app.route("/api/import-local", methods=["POST"])
def import_local_video():
    """
    POST /api/import-local  { "path": "C:\\Videos\\myvideo.mp4" }
    Creates a job from a local file path without uploading.
    The funscript will be saved to the same folder as the source video.
    """
    err, code = _require_trusted_request()
    if err is not None:
        return err, code
    data = request.json or {}
    path_str = str(data.get("path", "")).strip()
    if not path_str:
        return jsonify({"error": "No path provided"}), 400
    video_path = Path(path_str)
    if not video_path.exists():
        return jsonify({"error": f"File not found: {path_str}"}), 404
    if not video_path.is_file():
        return jsonify({"error": "Path is not a file"}), 400
    allowed = {".mp4", ".mkv", ".avi", ".mov", ".wmv", ".webm", ".m4v"}
    if video_path.suffix.lower() not in allowed:
        return jsonify({"error": f"Unsupported format. Allowed: {', '.join(sorted(allowed))}"}), 400
    _cleanup_stale_uploads()
    job_id = str(uuid.uuid4())[:8]
    jobs[job_id] = {
        "id": job_id,
        "filename": video_path.name,
        "filepath": str(video_path),
        "source_local_folder": str(video_path.parent),
        "status": "uploaded",
        "progress": 0,
        "stage": 0,
        "log": [],
        "output_files": [],
        "_created_at": time.time(),
    }
    return jsonify({"job_id": job_id, "filename": video_path.name, "size": video_path.stat().st_size})


@app.route("/api/process", methods=["POST"])
def start_processing():
    err, code = _require_trusted_request()
    if err is not None:
        return err, code

    data = request.json
    job_id = data.get("job_id")
    if not job_id or job_id not in jobs:
        return jsonify({"error": "Invalid job ID"}), 400

    job = jobs[job_id]
    mode = data.get("mode", "3-stage")
    settings = data.get("settings", {})

    job["status"] = "processing"
    job["mode"] = mode
    job["settings"] = settings
    job["progress"] = 0
    job["stage"] = 1
    job["log"] = []

    thread = threading.Thread(target=run_processing, args=(job_id,), daemon=True)
    thread.start()

    return jsonify({"status": "started", "job_id": job_id})


def emit_progress(job_id, stage, progress, message, status="processing"):
    job = jobs.get(job_id)
    if job:
        job["progress"] = progress
        job["stage"] = stage
        job["status"] = status
        job["log"].append(message)
    socketio.emit("progress", {
        "job_id": job_id,
        "stage": stage,
        "progress": progress,
        "message": message,
        "status": status,
    })


def run_processing(job_id):
    job = jobs[job_id]
    filepath = job["filepath"]
    mode = job.get("mode", "3-stage")
    settings = job.get("settings", {})

    try:
        emit_progress(job_id, 1, 5, "Initializing HapticAI (Beta) processing pipeline...")

        video_path = Path(filepath)
        if not video_path.exists():
            raise FileNotFoundError(f"Video file not found: {filepath}")

        emit_progress(job_id, 1, 10, f"Loading video: {video_path.name}")

        output_dir = OUTPUT_FOLDER / job_id
        output_dir.mkdir(exist_ok=True)

        emit_progress(job_id, 1, 15, f"Processing mode: {mode}")

        _run_hapticai_cli(job_id, filepath, mode, settings, output_dir)

    except Exception as e:
        logger.exception(f"Processing error for job {job_id}")
        emit_progress(job_id, 0, 0, f"Error: {str(e)}", status="error")
        jobs[job_id]["status"] = "error"
        jobs[job_id]["error"] = str(e)


def build_cli_args(filepath, mode, settings, output_dir):
    args = [filepath, "--mode", mode]
    if settings.get("overwrite"):
        args.append("--overwrite")
    if not settings.get("autotune", True):
        args.append("--no-autotune")
    if settings.get("generate_roll"):
        args.append("--generate-roll")
    return args


def _collect_funscript_results(job_id, video_path, output_dir):
    """Gather generated funscripts, update job state, and emit completion event."""
    job = jobs[job_id]
    funscript_files = list(output_dir.glob("*.funscript"))
    if not funscript_files:
        funscript_files = list(video_path.parent.glob(f"{video_path.stem}*.funscript"))

    if funscript_files:
        job["output_files"] = [str(f) for f in funscript_files]
        saved_paths = []
        for f in funscript_files:
            dest = _save_funscript_output(f, job)
            if dest:
                saved_paths.append(str(dest))
        emit_progress(job_id, 4, 100,
                      f"Complete! Generated {len(funscript_files)} funscript file(s).",
                      status="done")
        jobs[job_id]["status"] = "done"
        jobs[job_id]["saved_to"] = saved_paths
        actions_preview = []
        try:
            content = json.loads(funscript_files[0].read_text())
            actions_preview = content.get("actions", [])
        except Exception:
            pass
        jobs[job_id]["funscript_actions"] = actions_preview
        socketio.emit("complete", {
            "job_id": job_id,
            "files": [f.name for f in funscript_files],
            "saved_to": saved_paths,
            "actions": actions_preview[:100],
        })
    else:
        emit_progress(job_id, 0, 0,
                      "Processing completed but no funscript output found.",
                      status="error")
        jobs[job_id]["status"] = "error"


def _run_hapticai_inprocess(job_id, filepath, mode, settings, output_dir):
    """
    Run HapticAI processing in-process.
    Used when the app is packaged as a PyInstaller frozen bundle — in that
    case sys.executable is the bundle itself, not a Python interpreter, so
    spawning a subprocess with main.py is not viable.
    """
    import types
    emit_progress(job_id, 1, 20, "Loading HapticAI processing engine (in-process mode)...")

    try:
        from application.logic.app_logic import ApplicationLogic
    except ImportError as e:
        raise RuntimeError(f"Could not import HapticAI core: {e}") from e

    args = types.SimpleNamespace(
        input_path=filepath,
        mode=mode,
        od_mode="current",
        overwrite=settings.get("overwrite", False),
        autotune=settings.get("autotune", True),
        copy=False,
        generate_roll=settings.get("generate_roll", False),
        recursive=False,
        funscript_mode=False,
        filter=None,
    )

    os.environ["HAPTICAI_OUTPUT_DIR"] = str(output_dir)

    emit_progress(job_id, 1, 25, "Initializing ApplicationLogic (in-process)...")
    core_app = ApplicationLogic(is_cli=True)

    emit_progress(job_id, 1, 30, f"Stage 1: Starting processing — mode={mode}")
    core_app.run_cli(args)

    _collect_funscript_results(job_id, Path(filepath), output_dir)


def _run_hapticai_subprocess(job_id, filepath, mode, settings, output_dir):
    """
    Run HapticAI processing via subprocess (dev/source mode).
    Spawns main.py with sys.executable (a real Python interpreter).
    """
    import subprocess
    import time

    job = jobs[job_id]
    video_path = Path(filepath)

    hapticai_dir = Path(__file__).parent / "HapticAI-Powered-Funscript-Generator-main"
    main_py = hapticai_dir / "main.py"
    if not main_py.exists():
        hapticai_dir = Path(__file__).parent
        main_py = hapticai_dir / "main.py"

    cmd = [sys.executable, str(main_py), str(video_path), "--mode", mode, "--no-copy"]
    if not settings.get("autotune", True):
        cmd.append("--no-autotune")
    if settings.get("generate_roll"):
        cmd.append("--generate-roll")
    if settings.get("overwrite"):
        cmd.append("--overwrite")

    env = os.environ.copy()
    env["HAPTICAI_OUTPUT_DIR"] = str(output_dir)

    emit_progress(job_id, 1, 20, "Stage 1: Running AI object detection (YOLO)...")

    process = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        cwd=str(hapticai_dir),
        env=env,
    )

    stage_idx = 0
    start_time = time.time()
    for line in iter(process.stdout.readline, ""):
        line = line.strip()
        if not line:
            continue
        elapsed = time.time() - start_time
        emit_progress(job_id, stage_idx + 1, min(20 + int(elapsed * 2), 90), line)
        ll = line.lower()
        if "stage 1" in ll or "detection" in ll:
            stage_idx = 0
        elif "stage 2" in ll or "segmenting" in ll:
            stage_idx = 1
        elif "stage 3" in ll or "generating" in ll:
            stage_idx = 2
        elif "autotune" in ll or "post" in ll or "filter" in ll:
            stage_idx = 3

    process.wait()

    if process.returncode != 0 and process.returncode is not None:
        emit_progress(job_id, 0, 0,
                      f"Processing failed (exit code {process.returncode})",
                      status="error")
        jobs[job_id]["status"] = "error"
        return

    _collect_funscript_results(job_id, video_path, output_dir)


def _run_hapticai_cli(job_id, filepath, mode, settings, output_dir):
    """
    Dispatch to in-process (frozen/packaged) or subprocess (dev) execution.
    """
    if getattr(sys, "frozen", False):
        _run_hapticai_inprocess(job_id, filepath, mode, settings, output_dir)
    else:
        _run_hapticai_subprocess(job_id, filepath, mode, settings, output_dir)


@app.route("/api/apply_filter", methods=["POST"])
def apply_filter():
    err, code = _require_trusted_request()
    if err is not None:
        return err, code

    data = request.json
    job_id = data.get("job_id")
    plugin_name = data.get("plugin")
    params = data.get("params", {})
    axis = data.get("axis", "both")

    if not job_id or job_id not in jobs:
        return jsonify({"error": "Invalid job ID"}), 400

    job = jobs[job_id]
    actions = job.get("funscript_actions", [])
    if not actions:
        return jsonify({"error": "No funscript data loaded"}), 400

    try:
        from funscript.dual_axis_funscript import DualAxisFunscript
        from funscript.plugins.plugin_loader import PluginLoader
        from funscript.plugins.base_plugin import plugin_registry

        loader = PluginLoader()
        loader.load_builtin_plugins()
        plugin = plugin_registry.get_plugin(plugin_name)

        if not plugin:
            return jsonify({"error": f"Plugin '{plugin_name}' not found"}), 404

        fs = DualAxisFunscript()
        for action in actions:
            fs.primary_actions.append(action)
        fs._invalidate_cache("primary")

        validated_params = plugin.validate_parameters(params)
        plugin.transform(fs, axis=axis, **validated_params)

        new_actions = fs.primary_actions
        job["funscript_actions"] = new_actions

        output_dir = OUTPUT_FOLDER / job_id
        output_dir.mkdir(exist_ok=True)
        out_file = output_dir / f"filtered_{plugin_name.replace(' ', '_')}.funscript"
        out_data = {
            "version": "1.0",
            "inverted": False,
            "range": 100,
            "actions": new_actions,
        }
        out_file.write_text(json.dumps(out_data))

        if str(out_file) not in job["output_files"]:
            job["output_files"].append(str(out_file))

        return jsonify({"actions": new_actions[:100], "total": len(new_actions), "file": out_file.name})

    except Exception as e:
        logger.exception(f"Filter error: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/api/job/<job_id>")
def get_job(job_id):
    if job_id not in jobs:
        return jsonify({"error": "Job not found"}), 404
    job = dict(jobs[job_id])
    job.pop("funscript_actions", None)
    return jsonify(job)


@app.route("/api/download/<job_id>/<filename>")
def download_file(job_id, filename):
    if job_id not in jobs:
        return jsonify({"error": "Job not found"}), 404

    job = jobs[job_id]
    for filepath in job.get("output_files", []):
        p = Path(filepath)
        if p.name == filename:
            return send_file(p, as_attachment=True, download_name=filename)

    upload_path = UPLOAD_FOLDER / filename
    if upload_path.exists():
        return send_file(upload_path, as_attachment=True)

    return jsonify({"error": "File not found"}), 404


@app.route("/api/funscript_data/<job_id>")
def funscript_data(job_id):
    if job_id not in jobs:
        return jsonify({"error": "Job not found"}), 404
    actions = jobs[job_id].get("funscript_actions", [])
    return jsonify({"actions": actions})


@socketio.on("connect")
def on_connect():
    emit("connected", {"status": "ok"})


@socketio.on("subscribe")
def on_subscribe(data):
    job_id = data.get("job_id")
    if job_id and job_id in jobs:
        emit("job_state", jobs[job_id])


_server_port = 5000


def _get_tray_icon_image():
    """Load the HapticAI branding icon for the system tray.

    Looks for assets/branding/icon.ico relative to the executable (frozen)
    or the script directory (dev).  Falls back to a plain 64×64 red square
    so the tray always gets *something* even if the file is missing.
    """
    try:
        from PIL import Image as _PILImage
        if getattr(sys, "frozen", False):
            base = Path(sys._MEIPASS)
        else:
            base = Path(__file__).parent
        ico_path = base / "assets" / "branding" / "icon.ico"
        if ico_path.exists():
            return _PILImage.open(ico_path).convert("RGBA")
    except Exception:
        pass
    try:
        from PIL import Image as _PILImage
        img = _PILImage.new("RGBA", (64, 64), (233, 61, 68, 255))
        return img
    except Exception:
        return None


if __name__ == "__main__":
    import webbrowser
    import traceback

    # Write crash log to %APPDATA%\HapticAI\error.log so silent failures are visible
    _log_dir = Path(os.environ.get("APPDATA", str(Path.home()))) / "HapticAI"
    _log_dir.mkdir(parents=True, exist_ok=True)
    _error_log = _log_dir / "error.log"
    _startup_log = _log_dir / "startup.log"

    _file_handler = logging.FileHandler(_startup_log, mode="w", encoding="utf-8")
    _file_handler.setLevel(logging.INFO)
    _file_handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
    logging.getLogger().addHandler(_file_handler)

    logging.getLogger(__name__).info(
        "Flask-SocketIO initialised with async_mode=threading"
    )

    try:
        preferred = int(os.environ.get("PORT", 8000))
        bind_host = os.environ.get("HAPTICAI_HOST", "127.0.0.1")
        port = find_free_port(preferred, bind_host)
        _server_port = port

        PORT_FILE.write_text(str(port))

        print(f"HAPTICAI_PORT={port}", flush=True)
        print(f"HAPTICAI_URL=http://127.0.0.1:{port}", flush=True)
        print(f"HAPTICAI_PORT_FILE={PORT_FILE}", flush=True)

        logger.info(f"HapticAI (Beta) Web starting on http://{bind_host}:{port}")

        app_url = f"http://127.0.0.1:{port}"

        def _cleanup(signum, frame):
            if PORT_FILE.exists():
                PORT_FILE.unlink()
            sys.exit(0)

        signal.signal(signal.SIGTERM, _cleanup)

        # ── Try to set up a system tray icon (Windows / Linux with pystray) ──
        _tray_icon = None
        try:
            import pystray

            def _open_browser(icon=None, item=None):
                webbrowser.open(app_url)

            def _quit_app(icon, item):
                icon.stop()
                try:
                    import urllib.request as _urlreq
                    _urlreq.urlopen(
                        _urlreq.Request(
                            f"http://127.0.0.1:{port}/api/shutdown",
                            data=b"",
                            headers={"Authorization": f"Bearer {_SESSION_TOKEN}"},
                            method="POST",
                        ),
                        timeout=3,
                    )
                except Exception:
                    if PORT_FILE.exists():
                        PORT_FILE.unlink()
                    os.kill(os.getpid(), signal.SIGTERM)

            _img = _get_tray_icon_image()
            if _img is not None:
                _menu = pystray.Menu(
                    pystray.MenuItem("Open HapticAI", _open_browser, default=True),
                    pystray.Menu.SEPARATOR,
                    pystray.MenuItem("Quit", _quit_app),
                )
                _tray_icon = pystray.Icon("HapticAI", _img, "HapticAI", _menu)
        except Exception as _tray_err:
            logger.warning(f"System tray not available: {_tray_err}")
            _tray_icon = None

        # ── Start Flask in a background thread ──────────────────────────────
        def _run_server():
            socketio.run(app, host=bind_host, port=port, debug=False, allow_unsafe_werkzeug=True)

        _server_thread = threading.Thread(target=_run_server, daemon=True)
        _server_thread.start()

        # Auto-open the browser only once the server is confirmed accepting connections
        def _wait_and_open():
            import socket as _sock
            connected = False
            for _ in range(40):
                try:
                    with _sock.create_connection(("127.0.0.1", port), timeout=0.5):
                        connected = True
                        break
                except OSError:
                    time.sleep(0.25)
            if connected:
                webbrowser.open(app_url)
                if _tray_icon is not None and hasattr(_tray_icon, "notify"):
                    try:
                        _tray_icon.notify(
                            "HapticAI is running \u2014 click the tray icon to open",
                            "HapticAI",
                        )

                        def _auto_dismiss():
                            time.sleep(5)
                            try:
                                _tray_icon.remove_notification()
                            except Exception:
                                pass

                        threading.Thread(target=_auto_dismiss, daemon=True).start()
                    except Exception as _notify_err:
                        logger.debug(f"Startup notification not shown: {_notify_err}")

        threading.Thread(target=_wait_and_open, daemon=True).start()

        # ── Main thread: run tray (blocks) or wait for server thread ────────
        if _tray_icon is not None:
            _tray_icon.run()
        else:
            _server_thread.join()

    except Exception:
        _error_log.write_text(traceback.format_exc())
        raise
