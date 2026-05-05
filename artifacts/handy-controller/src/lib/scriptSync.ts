import { setHDSP, uploadScript, hsspSetup, hsspPlay, hsspStop, getServerTimeOffset } from "./handyApi";

export interface FunscriptAction {
  at: number;
  pos: number;
}

export interface Funscript {
  actions: FunscriptAction[];
}

// ─── Content-hash cache helpers ───────────────────────────────────────────────

const CACHE_PREFIX = "hssp_sha_";

/**
 * Compute a SHA-256 hex digest of the canonicalized funscript JSON.
 * Actions are sorted by `at` so two scripts with the same data but different
 * insertion order produce the same hash.
 */
async function computeScriptHash(script: Funscript): Promise<string> {
  const canonical = JSON.stringify({
    actions: [...script.actions].sort((a, b) => a.at - b.at || a.pos - b.pos),
  });
  const encoded = new TextEncoder().encode(canonical);
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function getCachedSha(contentHash: string): string | null {
  try {
    return sessionStorage.getItem(CACHE_PREFIX + contentHash);
  } catch {
    return null;
  }
}

function setCachedSha(contentHash: string, sha: string): void {
  try {
    sessionStorage.setItem(CACHE_PREFIX + contentHash, sha);
  } catch {
    // sessionStorage unavailable — silently skip caching
  }
}

function evictCachedSha(contentHash: string): void {
  try {
    sessionStorage.removeItem(CACHE_PREFIX + contentHash);
  } catch {
    // ignore
  }
}

// ─── HDSP Engine (real-time rAF polling) ─────────────────────────────────────

export class ScriptSyncEngine {
  private key: string = "";
  private script: Funscript | null = null;
  private isRunning: boolean = false;
  private animationFrameId: number | null = null;
  private videoElement: HTMLVideoElement | null = null;
  private lastCallTime: number = 0;
  private readonly THROTTLE_MS = 1000 / 30; // max 30 calls per sec
  private velocity: number = 87;

  setKey(key: string) {
    this.key = key;
  }

  setScript(script: Funscript | null) {
    this.script = script;
  }

  setVideo(video: HTMLVideoElement | null) {
    this.videoElement = video;
  }
  
  setVelocity(vel: number) {
    this.velocity = vel;
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.loop();
  }

  stop() {
    this.isRunning = false;
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  private loop = () => {
    if (!this.isRunning) return;

    this.update();

    this.animationFrameId = requestAnimationFrame(this.loop);
  };

  private update() {
    if (!this.key || !this.script || !this.videoElement || this.videoElement.paused) {
      return;
    }

    const now = performance.now();
    if (now - this.lastCallTime < this.THROTTLE_MS) {
      return;
    }

    const currentMs = this.videoElement.currentTime * 1000;
    const actions = this.script.actions;

    if (actions.length === 0) return;

    // Binary search for surrounding points
    let low = 0;
    let high = actions.length - 1;
    let mid = 0;

    while (low <= high) {
      mid = Math.floor((low + high) / 2);
      if (actions[mid].at === currentMs) {
        break;
      } else if (actions[mid].at < currentMs) {
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    // Interpolate
    let pos = 0;
    if (actions[mid].at === currentMs) {
      pos = actions[mid].pos;
    } else {
      let leftIdx = actions[mid].at <= currentMs ? mid : mid - 1;
      let rightIdx = leftIdx + 1;

      if (leftIdx < 0) {
        pos = actions[0].pos;
      } else if (rightIdx >= actions.length) {
        pos = actions[actions.length - 1].pos;
      } else {
        const left = actions[leftIdx];
        const right = actions[rightIdx];
        const t = (currentMs - left.at) / (right.at - left.at);
        pos = left.pos + t * (right.pos - left.pos);
      }
    }

    setHDSP(this.key, Math.round(pos), this.velocity);
    this.lastCallTime = now;
  }
}

// ─── HSSP Engine (server-side sync) ──────────────────────────────────────────

export type HSSPStatus = "idle" | "uploading" | "ready" | "error";

export class HSSPSyncEngine {
  private key: string = "";
  private sha: string | null = null;
  private serverOffset: number = 0;
  private status: HSSPStatus = "idle";
  private onStatusChange: ((s: HSSPStatus) => void) | null = null;
  private onErrorChange: ((msg: string) => void) | null = null;
  private onReady: (() => void) | null = null;
  /** Monotonically-increasing token; stale async operations are discarded. */
  private token: number = 0;

  setKey(key: string) {
    this.key = key;
  }

  getStatus(): HSSPStatus {
    return this.status;
  }

  onStatus(cb: (s: HSSPStatus) => void) {
    this.onStatusChange = cb;
  }

  onError(cb: (msg: string) => void) {
    this.onErrorChange = cb;
  }

  /** Register a callback invoked once when status transitions to "ready". */
  onReadyOnce(cb: () => void) {
    this.onReady = cb;
  }

  private setStatus(s: HSSPStatus) {
    this.status = s;
    this.onStatusChange?.(s);
    if (s === "ready") {
      const cb = this.onReady;
      this.onReady = null;
      cb?.();
    }
  }

  /** Upload script to Handy's server, calibrate server time, and run hssp/setup. */
  async prepare(script: Funscript): Promise<boolean> {
    if (!this.key) return false;
    // Increment token to invalidate any in-flight prepare from a previous script
    const myToken = ++this.token;
    this.setStatus("uploading");
    try {
      // Compute a strong content hash to use as the cache key.
      // This runs quickly and lets us skip the upload entirely on a cache hit.
      const contentHash = await computeScriptHash(script);
      if (myToken !== this.token) return false;

      const cachedSha = getCachedSha(contentHash);

      let sha: string;
      let offset: number;

      if (cachedSha) {
        // Cache hit: skip upload, only calibrate server time
        offset = await getServerTimeOffset(5);
        if (myToken !== this.token) return false;

        // Attempt setup with the cached SHA. If the server rejects it (e.g. the
        // SHA expired on the backend), evict the bad entry and fall back to a
        // fresh upload so this prepare() still succeeds.
        try {
          await hsspSetup(this.key, cachedSha);
          sha = cachedSha;
        } catch {
          evictCachedSha(contentHash);
          const [freshSha, freshOffset] = await Promise.all([
            uploadScript(script),
            getServerTimeOffset(5),
          ]);
          if (myToken !== this.token) return false;
          if (typeof freshSha !== "string" || freshSha.length === 0) {
            throw new Error("uploadScript returned an invalid SHA after cache eviction");
          }
          sha = freshSha;
          offset = freshOffset;
          setCachedSha(contentHash, sha);
          await hsspSetup(this.key, sha);
        }
      } else {
        // Cache miss: upload and calibrate in parallel
        const [uploadedSha, serverOffset] = await Promise.all([
          uploadScript(script),
          getServerTimeOffset(5),
        ]);
        if (myToken !== this.token) return false;
        if (typeof uploadedSha !== "string" || uploadedSha.length === 0) {
          throw new Error("uploadScript returned an invalid SHA");
        }
        sha = uploadedSha;
        offset = serverOffset;
        // Store the SHA so subsequent prepare() calls with the same script
        // content skip the upload (cache expires on tab/window close).
        setCachedSha(contentHash, sha);
        await hsspSetup(this.key, sha);
      }

      if (myToken !== this.token) return false;
      this.sha = sha;
      this.serverOffset = offset;
      this.setStatus("ready");
      return true;
    } catch (e) {
      if (myToken !== this.token) return false;
      console.error("HSSP prepare failed:", e);
      const msg = e instanceof Error ? e.message : "Unknown error";
      this.onErrorChange?.(msg);
      this.setStatus("error");
      return false;
    }
  }

  /** Call on video play or seek-then-play. */
  async play(currentTimeMs: number): Promise<void> {
    if (this.status !== "ready" || !this.sha || !this.key) return;
    try {
      await hsspPlay(this.key, this.serverOffset, currentTimeMs);
    } catch (e) {
      console.error("HSSP play failed:", e);
      this.setStatus("error");
    }
  }

  /** Call on seek while playing. Re-issues play with updated position. */
  async seek(currentTimeMs: number): Promise<void> {
    await this.play(currentTimeMs);
  }

  /** Call on pause. */
  async pause(): Promise<void> {
    if (!this.key) return;
    try {
      await hsspStop(this.key);
    } catch (e) {
      console.error("HSSP stop failed:", e);
    }
  }

  /** Reset state (e.g. when a new script is loaded). */
  reset() {
    this.sha = null;
    this.serverOffset = 0;
    this.setStatus("idle");
  }
}

// ─── Global instances ─────────────────────────────────────────────────────────

export const syncEngine = new ScriptSyncEngine();
export const hsspEngine = new HSSPSyncEngine();
