export const BASE = "https://www.handyfeeling.com/api/handy-rest/v3";

// Handy v3 motion limits
// Max physical speed: 350 units/s (full stroke = 100 units)
// HAMP velocity API takes 0-100 (% of max speed), so 100% = 350 units/s
// HDSP velocity takes 0-1 (normalised), so 1.0 = max speed ≈ 350 units/s
export const HANDY_MAX_SPEED_UNITS_PER_SEC = 350;
export const pctToHampVelocity = (pct: number) => Math.max(0, Math.min(100, Math.round(pct)));
export const pctToHdspVelocity = (pct: number) => Math.max(0, Math.min(1, pct / 100));

const headers = (key: string) => ({
  "X-Connection-Key": key,
  "Content-Type": "application/json",
  "Accept": "application/json"
});

export type HandyFailureReason = "invalid_key" | "network_error" | "device_offline";

export interface HandyStatusResult {
  connected: boolean;
  battery?: number;
  mode?: number;
  failureReason?: HandyFailureReason;
}

export async function getStatus(key: string): Promise<HandyStatusResult> {
  const [connRes, infoRes] = await Promise.allSettled([
    fetch(`${BASE}/connected`, { headers: headers(key) }),
    fetch(`${BASE}/info`, { headers: headers(key) })
  ]);

  // Network error — fetch itself rejected (e.g. no internet, DNS failure)
  if (connRes.status === "rejected") {
    return { connected: false, failureReason: "network_error" };
  }

  const connResp = connRes.value;

  // 401 = invalid/unknown connection key
  if (connResp.status === 401) {
    return { connected: false, failureReason: "invalid_key" };
  }

  // Other non-OK responses (4xx/5xx) are treated as transient server/network errors
  if (!connResp.ok) {
    return { connected: false, failureReason: "network_error" };
  }

  const d = await connResp.json();
  let connected = false;
  // v3: /connected returns {"result": true} (boolean) or {"result": {"connected": true}} (object)
  // Also handle legacy flat {"connected": true} shape just in case.
  if (typeof d.result === "boolean") {
    connected = d.result;
  } else if (typeof d.result?.connected === "boolean") {
    connected = d.result.connected;
  } else {
    connected = !!d.connected;
  }

  // 200 OK with result: false — key is recognised by the API, but the physical
  // device is powered off or out of Bluetooth range.
  if (!connected) {
    return { connected: false, failureReason: "device_offline" };
  }

  let battery: number | undefined;
  let mode: number | undefined;
  if (infoRes.status === "fulfilled" && infoRes.value.ok) {
    const info = await infoRes.value.json();
    // v3 DeviceInfo no longer carries battery — battery comes from SSE events
    mode = info.result?.mode ?? info.mode;
  }

  return { connected, battery, mode };
}

export async function setMode(key: string, mode: number): Promise<void> {
  try {
    await fetch(`${BASE}/mode`, {
      method: "PUT",
      headers: headers(key),
      body: JSON.stringify({ mode })
    });
  } catch (e) {
    console.error("setMode error", e);
  }
}

export async function setHAMP(
  key: string,
  opts: { velocity?: number; slideMin?: number; slideMax?: number }
): Promise<void> {
  try {
    await setMode(key, 0);
    if (opts.velocity !== undefined) {
      // velocity: 0-100 (0-100% of max speed)
      await fetch(`${BASE}/hamp/velocity`, {
        method: "PUT",
        headers: headers(key),
        body: JSON.stringify({ velocity: Math.max(0, Math.min(100, Math.round(opts.velocity))) })
      });
    }
    // Default stroke range: 60%-100% when not specified
    // v3: stroke range moved from /hamp/slide to /slider/stroke
    const slideMin = opts.slideMin ?? 60;
    const slideMax = opts.slideMax ?? 100;
    await fetch(`${BASE}/slider/stroke`, {
      method: "PUT",
      headers: headers(key),
      body: JSON.stringify({ min: slideMin / 100, max: slideMax / 100 })
    });
  } catch (e) {
    console.error("setHAMP error", e);
  }
}

export async function setHDSP(key: string, position: number, velocity: number): Promise<void> {
  try {
    // v3 XAVA body: { xa: absolute-position 0-1, va: absolute-velocity 0-1 }
    await fetch(`${BASE}/hdsp/xava`, {
      method: "PUT",
      headers: headers(key),
      body: JSON.stringify({
        xa: Math.max(0, Math.min(100, Math.round(position))) / 100,
        va: Math.min(Math.round(velocity), 100) / 100
      })
    });
  } catch (e) {
    console.error("setHDSP error", e);
  }
}

export async function stopDevice(key: string): Promise<void> {
  try {
    await fetch(`${BASE}/hamp/stop`, { method: "PUT", headers: headers(key) });
  } catch (e) {
    console.error("stopDevice error", e);
  }
}

// ─── HSSP — Handy Sync Script Play ───────────────────────────────────────────

/**
 * Fetch server time and return the offset (server_time - localTime) in ms.
 * Average of multiple samples for accuracy.
 * v3: response field is server_time (snake_case), not serverTime.
 */
export async function getServerTimeOffset(samples = 5): Promise<number> {
  const offsets: number[] = [];
  for (let i = 0; i < samples; i++) {
    const t0 = Date.now();
    const res = await fetch(`${BASE}/servertime`);
    const t1 = Date.now();
    const { server_time } = await res.json();
    offsets.push(server_time - Math.round((t0 + t1) / 2));
  }
  // Return median offset
  offsets.sort((a, b) => a - b);
  return offsets[Math.floor(offsets.length / 2)];
}

/**
 * Upload funscript JSON to Handy's sync server and return the script URL.
 * v3: the sync server returns { url } which is passed directly to /hssp/setup.
 */
export async function uploadScript(scriptJson: object): Promise<string> {
  const blob = new Blob([JSON.stringify(scriptJson)], { type: "application/json" });
  const formData = new FormData();
  formData.append("file", blob, "script.funscript");
  const res = await fetch(`${BASE}/syncFile`, { method: "POST", body: formData });
  if (!res.ok) throw new Error(`Script upload failed: ${res.status}`);
  const data = await res.json();
  // v3 sync server returns { url } — the URL is passed to /hssp/setup as { url }
  const url = data.url as string | undefined;
  if (!url) throw new Error("Script upload returned no URL");
  return url;
}

/**
 * Tell the Handy which script to use (by URL).
 * v3: /hssp/setup takes { url } not { sha }.
 * Call once after upload, before play.
 */
export async function hsspSetup(key: string, url: string): Promise<void> {
  const res = await fetch(`${BASE}/hssp/setup`, {
    method: "PUT",
    headers: headers(key),
    body: JSON.stringify({ url })
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`hssp/setup failed (${res.status}): ${body}`);
  }
}

/**
 * Start or seek HSSP playback.
 * v3: body fields are snake_case: { start_time, server_time }.
 * @param key            Connection key
 * @param serverOffset   ms offset = server_time - localTime (from getServerTimeOffset)
 * @param startTimeMs    Current video position in ms
 */
export async function hsspPlay(
  key: string,
  serverOffset: number,
  startTimeMs: number
): Promise<void> {
  const server_time = Date.now() + serverOffset;
  const res = await fetch(`${BASE}/hssp/play`, {
    method: "PUT",
    headers: headers(key),
    body: JSON.stringify({ start_time: startTimeMs, server_time })
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`hssp/play failed (${res.status}): ${body}`);
  }
}

/**
 * Stop HSSP playback.
 * v3: /hssp/stop (was incorrectly /hamp/stop).
 */
export async function hsspStop(key: string): Promise<void> {
  try {
    await fetch(`${BASE}/hssp/stop`, { method: "PUT", headers: headers(key) });
  } catch (e) {
    console.error("hsspStop error", e);
  }
}

// Legacy combined helper kept for backwards compat
export async function setHSSP(
  key: string,
  url: string,
  serverTimeOffsetMs: number,
  startTimeMs = 0
): Promise<void> {
  try {
    await hsspSetup(key, url);
    await hsspPlay(key, serverTimeOffsetMs, startTimeMs);
  } catch (e) {
    console.error("setHSSP error", e);
  }
}

export async function stopHSSP(key: string): Promise<void> {
  await hsspStop(key);
}
