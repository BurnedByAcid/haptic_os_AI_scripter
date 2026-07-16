# HapticOS ↔ HapticAI Integration Guide

## Overview

HapticOS connects to the HapticAI local server to enable AI-powered haptic script
generation. The server runs on the user's machine and exposes two endpoints that
HapticOS polls and calls.

## Endpoints

### `GET /status`

Polled every 3 seconds by `use-hapticai-connection.ts` to check whether the server
is reachable and to discover available generation options.

**Response shape**

```json
{
  "version": "0.5.4",
  "options": [
    {
      "key": "mode",
      "label": "Processing Mode",
      "type": "select",
      "default": "3-stage",
      "choices": ["3-stage", "optical-flow", "live-roi"]
    },
    {
      "key": "autotune",
      "label": "Auto-tune output",
      "type": "boolean",
      "default": true
    },
    {
      "key": "generate_roll",
      "label": "Generate roll axis",
      "type": "boolean",
      "default": false
    }
  ]
}
```

`HapticAIOption` types supported by HapticOS: `"number"`, `"boolean"`, `"select"`.

### `POST /generate`

Triggered when the user clicks **Generate Script** in HapticOS.

**Request body**

```json
{
  "prompt": "A slow build-up that intensifies over 2 minutes…",
  "options": {
    "mode": "3-stage",
    "autotune": true,
    "generate_roll": false
  }
}
```

**Success response (200)**

```json
{
  "funscript": "{\"version\":\"1.0\",\"actions\":[…]}",
  "actions": [{"at": 0, "pos": 50}, …]
}
```

`funscript` is a JSON-encoded string of the complete funscript document.
`actions` is an optional preview of the first actions (not used by HapticOS, for
debugging convenience).

**Error response (4xx / 5xx)**

```json
{ "error": "human-readable error message" }
```

HapticOS displays the `error` field directly to the user.

## CORS

The server must allow cross-origin requests from `http://localhost:*` (and from
the HapticOS hosted domain when running in production). Set
`cors_allowed_origins="*"` on `flask_socketio.SocketIO` and add appropriate
CORS headers to Flask responses if a reverse proxy is involved.

The current implementation already sets `cors_allowed_origins="*"` in
`web_app.py`.

## Port

Default port is **`8000`** (dynamic — the server tries 8000 first, then
8001–8099, then 5000–5099, and writes the chosen port to `hapticai_port.txt`).
HapticOS defaults to `http://localhost:8000` so out-of-the-box no configuration
is needed. The user can override it in the Setup Panel.

> **Note:** If you change the default port in `web_app.py`, update the
> `DEFAULT_URL` constant in `artifacts/handy-controller/src/hooks/use-hapticai-connection.ts`
> to match.

## Packaging

Build the server into a self-contained executable using the provided build
scripts:

| Platform | Script | Output |
|----------|--------|--------|
| Windows  | `build_windows.bat` | `dist/HapticAI.exe` |
| macOS    | `build_macos.sh`    | `dist/HapticAI.app` |

Both scripts use PyInstaller with the matching `.spec` file
(`hapticai_windows.spec` / `hapticai_macos.spec`).

## Development workflow

Run the server locally alongside the HapticOS frontend:

```bash
cd artifacts/hapticai-server
pip install -r web.requirements.txt
python web_app.py
```

The server starts on a free port (default `5000`) and prints the URL to stdout.
Point HapticOS at `http://localhost:<port>` via the setup panel.
