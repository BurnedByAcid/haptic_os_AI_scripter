export const BASE = "https://www.handyfeeling.com/api/handy/v2";
export const SYNC_BASE = "https://www.handyfeeling.com/api/server/v3";

// Handy v2 motion limits
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

export interface HandyStatusResult {
  connected: boolean;
  battery?: number;
  mode?: number;
}

export async function getStatus(key: string): Promise<HandyStatusResult> {
  try {
    const [connRes, infoRes] = await Promise.allSettled([
      fetch(`${BASE}/connected`, { headers: headers(key) }),
      fetch(`${BASE}/info`, { headers: headers(key) })
    ]);
    let connected = false;
    let battery: number | undefined;
    let mode: number | undefined;
    if (connRes.status === "fulfilled" && connRes.value.ok) {
      const d = await connRes.value.json();
      connected = !!d.connected;
    }
    if (infoRes.status === "fulfilled" && infoRes.value.ok) {
      const d = await infoRes.value.json();
      battery = d.hardware?.batteryLevel;
      mode = d.mode;
    }
    return { connected, battery, mode };
  } catch {
    return { connected: false };
  }
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
    const slideMin = opts.slideMin ?? 60;
    const slideMax = opts.slideMax ?? 100;
    await fetch(`${BASE}/hamp/slide`, {
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
    await fetch(`${BASE}/hdsp/xava`, {
      method: "PUT",
      headers: headers(key),
      body: JSON.stringify({
        position: Math.max(0, Math.min(100, Math.round(position))) / 100,
        velocity: Math.min(Math.round(velocity), 100) / 100
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
 * Fetch server time and return the offset (serverTime - localTime) in ms.
 * Average of multiple samples for accuracy.
 */
export async function getServerTimeOffset(samples = 5): Promise<number> {
  const offsets: number[] = [];
  for (let i = 0; i < samples; i++) {
    const t0 = Date.now();
    const res = await fetch(`${SYNC_BASE}/servertime`);
    const t1 = Date.now();
    const { serverTime } = await res.json();
    offsets.push(serverTime - Math.round((t0 + t1) / 2));
  }
  // Return median offset
  offsets.sort((a, b) => a - b);
  return offsets[Math.floor(offsets.length / 2)];
}

/**
 * Upload funscript JSON to Handy's sync server and return the SHA.
 */
export async function uploadScript(scriptJson: object): Promise<string> {
  const blob = new Blob([JSON.stringify(scriptJson)], { type: "application/json" });
  const formData = new FormData();
  formData.append("file", blob, "script.funscript");
  const res = await fetch(`${SYNC_BASE}/syncFile`, { method: "POST", body: formData });
  if (!res.ok) throw new Error(`Script upload failed: ${res.status}`);
  const data = await res.json();
  // API returns { url, sha } or similar
  return (data.sha ?? data.url) as string;
}

/**
 * Tell the Handy which script to use (by SHA).
 * Call once after upload, before play.
 */
export async function hsspSetup(key: string, sha: string): Promise<void> {
  const res = await fetch(`${BASE}/hssp/setup`, {
    method: "PUT",
    headers: headers(key),
    body: JSON.stringify({ sha })
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`hssp/setup failed (${res.status}): ${body}`);
  }
}

/**
 * Start or seek HSSP playback.
 * @param key            Connection key
 * @param serverOffset   ms offset = serverTime - localTime (from getServerTimeOffset)
 * @param startTimeMs    Current video position in ms
 */
export async function hsspPlay(
  key: string,
  serverOffset: number,
  startTimeMs: number
): Promise<void> {
  const estimatedServerTime = Date.now() + serverOffset;
  const res = await fetch(`${BASE}/hssp/play`, {
    method: "PUT",
    headers: headers(key),
    body: JSON.stringify({ estimatedServerTime, startTime: startTimeMs })
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`hssp/play failed (${res.status}): ${body}`);
  }
}

/**
 * Stop HSSP playback.
 */
export async function hsspStop(key: string): Promise<void> {
  try {
    await fetch(`${BASE}/hamp/stop`, { method: "PUT", headers: headers(key) });
  } catch (e) {
    console.error("hsspStop error", e);
  }
}

// Legacy combined helper kept for backwards compat
export async function setHSSP(
  key: string,
  sha: string,
  serverTimeOffsetMs: number,
  startTimeMs = 0
): Promise<void> {
  try {
    await hsspSetup(key, sha);
    await hsspPlay(key, serverTimeOffsetMs, startTimeMs);
  } catch (e) {
    console.error("setHSSP error", e);
  }
}

export async function stopHSSP(key: string): Promise<void> {
  await hsspStop(key);
}
