export const BASE_V3 = "https://www.handyfeeling.com/api/handy-rest/v3";
export const BASE_V4 = "https://www.handyfeeling.com/api/handy-rest/v4";

// BASE stays v3 — all control-flow functions (HAMP, HDSP, HSSP, mode, etc.)
// continue using the stable v3 API. Only getStatus() probes v4 opportunistically.
export const BASE = BASE_V3;

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
  deviceModel?: string;
  firmwareVersion?: string;
  failureReason?: HandyFailureReason;
}

/**
 * Attempt a GET /connected against `base`. Returns the Response on success,
 * or null when the base URL is unreachable or returns 404 (no such API version).
 */
async function tryConnectedRequest(base: string, key: string): Promise<Response | null> {
  try {
    const res = await fetch(`${base}/connected`, { headers: headers(key) });
    if (res.status === 404) return null;
    return res;
  } catch {
    return null;
  }
}

/**
 * Parse a /connected response body into a boolean.
 * Handles all known response shapes across v3 and v4:
 *   - { result: true }                            (v3 boolean)
 *   - { result: { connected: true } }             (v3 object)
 *   - { result: { online: true } }                (v3/v4 variant)
 *   - { result: { status: "connected" } }         (v4 variant)
 *   - { connected: true }                         (legacy flat)
 *   - { online: true }                            (legacy flat variant)
 * Returns the parsed boolean plus a flag indicating whether a known shape matched.
 */
function parseConnectedBody(d: Record<string, unknown>): { connected: boolean; recognised: boolean } {
  if (typeof d.result === "boolean") {
    return { connected: d.result, recognised: true };
  }
  const r = d.result as Record<string, unknown> | undefined;
  if (r !== null && typeof r === "object") {
    if (typeof r.connected === "boolean") {
      return { connected: r.connected, recognised: true };
    }
    if (typeof r.online === "boolean") {
      return { connected: r.online, recognised: true };
    }
    if (typeof r.status === "string") {
      return { connected: r.status === "connected" || r.status === "online", recognised: true };
    }
  }
  if (typeof d.connected === "boolean") {
    return { connected: d.connected, recognised: true };
  }
  if (typeof d.online === "boolean") {
    return { connected: d.online, recognised: true };
  }
  return { connected: false, recognised: false };
}

export async function getStatus(key: string): Promise<HandyStatusResult> {
  // Try v4 first; if the endpoint doesn't exist (404) or is unreachable, fall
  // back to v3. This is a best-effort probe — any network failure here is
  // transparent to the caller.
  let connResp: Response | null = await tryConnectedRequest(BASE_V4, key);
  const usingV4 = connResp !== null;
  if (!usingV4) {
    connResp = await tryConnectedRequest(BASE_V3, key);
  }

  // Both v4 and v3 unreachable — network error
  if (connResp === null) {
    return { connected: false, failureReason: "network_error" };
  }

  const activeBase = usingV4 ? BASE_V4 : BASE_V3;

  // 401 or 400 = invalid/unknown connection key.
  // The Handy API returns 401 for non-UUID-shaped keys and 400 ("Invalid
  // connection key or channel reference") for UUID-shaped keys that are
  // not registered — both mean the key is wrong, not a network problem.
  if (connResp.status === 401 || connResp.status === 400) {
    return { connected: false, failureReason: "invalid_key" };
  }

  // Other non-OK responses (5xx etc.) are transient server/network errors
  if (!connResp.ok) {
    return { connected: false, failureReason: "network_error" };
  }

  const d = await connResp.json() as Record<string, unknown>;
  const { connected, recognised } = parseConnectedBody(d);

  if (!recognised) {
    console.warn(
      "[Handy] Unrecognised /connected response shape — device will appear offline. " +
      "Raw body:", JSON.stringify(d)
    );
  }

  // Also fire a warn when recognised but false, so users/devs can distinguish
  // "device offline" from "parsing failure" in the console.
  if (recognised && !connected) {
    // Normal offline state — no extra logging needed.
  }

  // 200 OK with result: false — key is recognised by the API, but the physical
  // device is powered off or out of Bluetooth range.
  if (!connected) {
    return { connected: false, failureReason: "device_offline" };
  }

  // Fetch /info from the same API version that answered /connected
  let battery: number | undefined;
  let mode: number | undefined;
  let deviceModel: string | undefined;
  let firmwareVersion: string | undefined;

  try {
    const infoRes = await fetch(`${activeBase}/info`, { headers: headers(key) });
    if (infoRes.ok) {
      const info = await infoRes.json() as Record<string, unknown>;
      const result = (info.result ?? info) as Record<string, unknown>;
      if (typeof result.mode === "number") mode = result.mode;
      if (result.hardware) deviceModel = String(result.hardware);
      if (result.fw_version) firmwareVersion = String(result.fw_version);
    }
  } catch {
    // Non-fatal — we still have a valid connected: true result
  }

  return { connected, battery, mode, deviceModel, firmwareVersion };
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
    const { server_time } = await res.json() as { server_time: number };
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
  const data = await res.json() as { url?: string };
  // v3 sync server returns { url } — the URL is passed to /hssp/setup as { url }
  const url = data.url;
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
