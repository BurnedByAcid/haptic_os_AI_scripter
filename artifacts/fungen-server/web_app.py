import os
import sys
import json
import uuid
import signal
import socket
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
app.config["SECRET_KEY"] = "fungen-web-secret"
socketio = SocketIO(app, cors_allowed_origins="*", async_mode="threading")

if _has_flask_cors:
    _CORS(app, origins="*")
else:
    @app.after_request
    def _add_cors_headers(response):
        response.headers["Access-Control-Allow-Origin"] = "*"
        response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
        response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
        return response

    @app.route("/status", methods=["OPTIONS"])
    @app.route("/generate", methods=["OPTIONS"])
    def _options_handler():
        from flask import Response
        r = Response()
        r.headers["Access-Control-Allow-Origin"] = "*"
        r.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
        r.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
        return r

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

UPLOAD_FOLDER = Path("uploads")
OUTPUT_FOLDER = Path("output")
UPLOAD_FOLDER.mkdir(exist_ok=True)
OUTPUT_FOLDER.mkdir(exist_ok=True)

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
# HapticOS integration endpoints — used by use-fungen-connection.ts
# ---------------------------------------------------------------------------

@app.route("/status")
def hapticos_status():
    """
    GET /status
    Returns server version and available generation options.
    Shape: { version: string, options: FunGenOption[] }
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
    ]
    return jsonify({"version": "0.5.4", "options": options})


@app.route("/generate", methods=["POST"])
def hapticos_generate():
    """
    POST /generate
    Body: { prompt: string, options?: { mode?: string, autotune?: bool, generate_roll?: bool } }
    Returns: { funscript: string }  (JSON-encoded funscript string)

    Prompt-driven generation is not yet implemented in the FunGen core — this
    endpoint queues a stub job that returns a minimal valid funscript so the
    HapticOS frontend can complete the round-trip.  When the AI generation
    back-end is wired up the stub below should be replaced with a real call.
    """
    data = request.get_json(silent=True) or {}
    prompt = str(data.get("prompt", "")).strip()
    if not prompt:
        return jsonify({"error": "prompt is required"}), 400

    import time
    import json as _json

    duration_ms = 120_000
    interval_ms = 500
    num_points = duration_ms // interval_ms

    actions = []
    import math
    for i in range(num_points + 1):
        t = i / num_points
        pos = int(50 + 45 * math.sin(2 * math.pi * t * 4 + math.pi / 4))
        pos = max(0, min(100, pos))
        actions.append({"at": i * interval_ms, "pos": pos})

    funscript = {
        "version": "1.0",
        "inverted": False,
        "range": 100,
        "metadata": {
            "creator": "HapticAI (Beta)",
            "description": prompt[:200],
            "duration": duration_ms / 1000,
        },
        "actions": actions,
    }

    return jsonify({"funscript": _json.dumps(funscript), "actions": actions[:50]})


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

    def _shutdown():
        import time
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
    if "video" not in request.files:
        return jsonify({"error": "No file provided"}), 400
    file = request.files["video"]
    if file.filename == "":
        return jsonify({"error": "No file selected"}), 400

    allowed = {".mp4", ".mkv", ".avi", ".mov", ".wmv", ".webm", ".m4v"}
    ext = Path(file.filename).suffix.lower()
    if ext not in allowed:
        return jsonify({"error": f"Unsupported format. Allowed: {', '.join(allowed)}"}), 400

    job_id = str(uuid.uuid4())[:8]
    dest = UPLOAD_FOLDER / f"{job_id}{ext}"
    file.save(dest)

    jobs[job_id] = {
        "id": job_id,
        "filename": file.filename,
        "filepath": str(dest),
        "status": "uploaded",
        "progress": 0,
        "stage": 0,
        "log": [],
        "output_files": [],
    }

    return jsonify({"job_id": job_id, "filename": file.filename, "size": dest.stat().st_size})


@app.route("/api/upload_funscript", methods=["POST"])
def upload_funscript():
    if "funscript" not in request.files:
        return jsonify({"error": "No file provided"}), 400
    file = request.files["funscript"]
    if not file.filename.endswith(".funscript"):
        return jsonify({"error": "File must be a .funscript file"}), 400

    job_id = str(uuid.uuid4())[:8]
    dest = UPLOAD_FOLDER / f"{job_id}.funscript"
    file.save(dest)

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
    }

    return jsonify({"job_id": job_id, "filename": file.filename, "actions": actions[:50]})


@app.route("/api/process", methods=["POST"])
def start_processing():
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

        _run_fungen_cli(job_id, filepath, mode, settings, output_dir)

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
        emit_progress(job_id, 4, 100,
                      f"Complete! Generated {len(funscript_files)} funscript file(s).",
                      status="done")
        jobs[job_id]["status"] = "done"
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
            "actions": actions_preview[:100],
        })
    else:
        emit_progress(job_id, 0, 0,
                      "Processing completed but no funscript output found.",
                      status="error")
        jobs[job_id]["status"] = "error"


def _run_fungen_inprocess(job_id, filepath, mode, settings, output_dir):
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

    os.environ["FUNGEN_OUTPUT_DIR"] = str(output_dir)

    emit_progress(job_id, 1, 25, "Initializing ApplicationLogic (in-process)...")
    core_app = ApplicationLogic(is_cli=True)

    emit_progress(job_id, 1, 30, f"Stage 1: Starting processing — mode={mode}")
    core_app.run_cli(args)

    _collect_funscript_results(job_id, Path(filepath), output_dir)


def _run_fungen_subprocess(job_id, filepath, mode, settings, output_dir):
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


def _run_fungen_cli(job_id, filepath, mode, settings, output_dir):
    """
    Dispatch to in-process (frozen/packaged) or subprocess (dev) execution.
    """
    if getattr(sys, "frozen", False):
        _run_fungen_inprocess(job_id, filepath, mode, settings, output_dir)
    else:
        _run_fungen_subprocess(job_id, filepath, mode, settings, output_dir)


@app.route("/api/apply_filter", methods=["POST"])
def apply_filter():
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


if __name__ == "__main__":
    preferred = int(os.environ.get("PORT", 8000))
    bind_host = os.environ.get("HAPTICAI_HOST", "127.0.0.1")
    port = find_free_port(preferred, bind_host)
    _server_port = port

    PORT_FILE.write_text(str(port))

    print(f"HAPTICAI_PORT={port}", flush=True)
    print(f"HAPTICAI_URL=http://127.0.0.1:{port}", flush=True)
    print(f"HAPTICAI_PORT_FILE={PORT_FILE}", flush=True)

    logger.info(f"HapticAI (Beta) Web starting on http://{bind_host}:{port}")

    def _cleanup(signum, frame):
        if PORT_FILE.exists():
            PORT_FILE.unlink()
        sys.exit(0)

    signal.signal(signal.SIGTERM, _cleanup)

    socketio.run(app, host=bind_host, port=port, debug=False, allow_unsafe_werkzeug=True)
