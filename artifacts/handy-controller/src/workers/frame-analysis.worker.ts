/**
 * frame-analysis.worker.ts
 *
 * Dedicated Web Worker that owns the complete scan state machine.
 *
 * The main thread is intentionally a thin frame pump. It performs only the
 * DOM-bound work that cannot run in a worker: video seeking (video.currentTime),
 * requestVideoFrameCallback (HTMLVideoElement method), and createImageBitmap.
 * Everything else — frame scheduling decisions, RMS computation, trigger
 * detection, and progress calculation — lives here in the worker.
 *
 * ─── Protocol (postMessage) ───────────────────────────────────────────────
 *
 *   Main → Worker
 *   ─────────────
 *   { type: 'init',
 *     refPatch: Uint8Array, patchW: number, patchH: number,
 *     startMs: number, endMs: number, rangeMs: number,
 *     stepMs: number,
 *     tolerance: number, minDelay: number, frameDebounce: number,
 *     nx, ny, nw, nh: number }
 *     Initialise GPU/CPU matchers and all scan parameters.
 *     frameDebounce: suppress re-trigger for N consecutive analyzed frames (1–5).
 *     Reply: { type: 'ready', mode: 'webgpu'|'webgl'|'cpu' }
 *
 *   { type: 'frame', bitmap: ImageBitmap, frameMs: number }
 *     One video frame (transferred, zero-copy).
 *     Worker decides whether to analyse it based on the stepMs resolution.
 *       Analysed frame → { type: 'progress', percent: number, frameMs: number }
 *       Skipped frame  → { type: 'frame-skip', frameMs: number }
 *       GPU demotion   → { type: 'mode-changed', mode: 'cpu', reason: 'webgpu'|'webgl' }
 *       Error          → { type: 'error', message: string }
 *     frameMs is echoed back so the main thread can match replies to the
 *     correct pipeline slot without relying on message ordering.
 *
 *   { type: 'end' }
 *     No more frames. Reply: { type: 'complete', triggerTimes: number[] }
 *
 *   { type: 'destroy' }
 *     Tear down GPU resources (no reply).
 */

import { WebGpuPatchMatcher } from "@/lib/webgpu-patch-matcher";
import { GlPatchMatcher }     from "@/lib/gl-patch-matcher";

// ─── GPU / CPU state ─────────────────────────────────────────────────────────

type Mode = "webgpu" | "webgl" | "cpu";

let mode: Mode = "cpu";
let wgpuMatcher: WebGpuPatchMatcher | null = null;
let glMatcher:   GlPatchMatcher    | null  = null;

// ─── Scan-state machine (worker owns all of this) ─────────────────────────────

let startMs              = 0;
let rangeMs              = 1;
let stepMs               = 1000 / 30; // 30 fps resolution
let tolerance            = 0;
let minDelay             = 0;
let frameDebounce        = 5; // suppress re-trigger for N analyzed frames after a match
let lastState            = false;
let lastTriggerMs        = 0;
let lastTriggerFrameIdx  = -Infinity; // analyzed-frame index of the last trigger
let analyzedFrameCount   = 0;         // counts every frame that passes the stepMs gate
let lastAnalyzedMs       = -Infinity; // frame scheduling: skip frames closer than stepMs
let triggerTimes: number[] = [];

// ─── Crop coordinates (normalised 0–1) ───────────────────────────────────────

let cropNx = 0, cropNy = 0, cropNw = 0, cropNh = 0;

// ─── CPU helpers ─────────────────────────────────────────────────────────────

let refPatch: Uint8Array | null = null;
let patchPixW = 0, patchPixH = 0;

function toGray(rgba: Uint8ClampedArray): Uint8Array {
  const gray = new Uint8Array(rgba.length / 4);
  for (let i = 0; i < rgba.length; i += 4)
    gray[i >> 2] = Math.round(0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]);
  return gray;
}

function patchRms(a: Uint8Array, b: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; sum += d * d; }
  return Math.sqrt(sum / (a.length || 1));
}

function cpuRmsFromBitmap(bitmap: ImageBitmap): number {
  const pw = Math.round(cropNw * bitmap.width)  || 1;
  const ph = Math.round(cropNh * bitmap.height) || 1;
  const px = Math.round(cropNx * bitmap.width);
  const py = Math.round(cropNy * bitmap.height);
  const canvas = new OffscreenCanvas(pw, ph);
  const ctx = canvas.getContext("2d") as OffscreenCanvasRenderingContext2D;
  ctx.drawImage(bitmap, px, py, pw, ph, 0, 0, pw, ph);
  const data = ctx.getImageData(0, 0, pw, ph).data;
  return patchRms(toGray(data), refPatch!);
}

// ─── Per-frame RMS computation (GPU/CPU fallback) ─────────────────────────────

async function computeRms(bitmap: ImageBitmap): Promise<number> {
  if (mode === "webgpu" && wgpuMatcher) {
    try {
      return await wgpuMatcher.computeRms(bitmap, cropNx, cropNy, cropNw, cropNh);
    } catch (gpuErr) {
      console.warn("[FrameWorker] WebGPU error — demoting to CPU:", gpuErr);
      wgpuMatcher.destroy();
      wgpuMatcher = null;
      mode = "cpu";
      self.postMessage({ type: "mode-changed", mode, reason: "webgpu" });
      return cpuRmsFromBitmap(bitmap);
    }
  }
  if (mode === "webgl" && glMatcher) {
    try {
      return glMatcher.computeRms(bitmap, cropNx, cropNy, cropNw, cropNh);
    } catch (gpuErr) {
      console.warn("[FrameWorker] WebGL error — demoting to CPU:", gpuErr);
      glMatcher.destroy();
      glMatcher = null;
      mode = "cpu";
      self.postMessage({ type: "mode-changed", mode, reason: "webgl" });
      return cpuRmsFromBitmap(bitmap);
    }
  }
  return cpuRmsFromBitmap(bitmap);
}

// ─── Message handlers ─────────────────────────────────────────────────────────

async function handleInit(msg: {
  refPatch: Uint8Array; patchW: number; patchH: number;
  startMs: number; rangeMs: number; stepMs: number;
  tolerance: number; minDelay: number; frameDebounce?: number;
  nx: number; ny: number; nw: number; nh: number;
}): Promise<void> {
  refPatch      = msg.refPatch;
  patchPixW     = msg.patchW;
  patchPixH     = msg.patchH;
  startMs       = msg.startMs;
  rangeMs       = msg.rangeMs;
  stepMs        = msg.stepMs;
  tolerance     = msg.tolerance;
  minDelay      = msg.minDelay;
  frameDebounce = msg.frameDebounce ?? 5;
  cropNx        = msg.nx;
  cropNy        = msg.ny;
  cropNw        = msg.nw;
  cropNh        = msg.nh;

  // Reset state machine for this scan
  lastState            = false;
  lastTriggerMs        = msg.startMs - msg.minDelay; // allows trigger at very first frame
  lastTriggerFrameIdx  = -Infinity;
  analyzedFrameCount   = 0;
  lastAnalyzedMs       = -Infinity;
  triggerTimes         = [];

  // ── Try WebGPU (navigator.gpu available in workers) ──
  try {
    wgpuMatcher = await WebGpuPatchMatcher.create();
    wgpuMatcher.setReference(refPatch, patchPixW, patchPixH);
    mode = "webgpu";
    console.log("[FrameWorker] GPU path: WebGPU");
    self.postMessage({ type: "ready", mode });
    return;
  } catch { /* fall through */ }

  // ── Fall back to WebGL via OffscreenCanvas ──
  try {
    const offscreen = new OffscreenCanvas(1, 1);
    glMatcher = new GlPatchMatcher(offscreen);
    glMatcher.setReference(refPatch, patchPixW, patchPixH);
    mode = "webgl";
    console.log("[FrameWorker] GPU path: WebGL (OffscreenCanvas)");
    self.postMessage({ type: "ready", mode });
    return;
  } catch { /* fall through */ }

  // ── CPU only ──
  mode = "cpu";
  console.log("[FrameWorker] GPU path: CPU (no GPU available)");
  self.postMessage({ type: "ready", mode });
}

async function handleFrame(bitmap: ImageBitmap, frameMs: number): Promise<void> {
  if (!refPatch) {
    bitmap.close();
    self.postMessage({ type: "error", message: "Worker not initialised — send 'init' first" });
    return;
  }

  // ── Frame scheduling decision (worker owns this) ──────────────────────────
  // The main thread forwards every rVFC frame unconditionally; the worker
  // decides which frames are far enough apart to warrant analysis.
  // For the seek-based path the main thread already steps by stepMs, so every
  // frame passes this check — but the guard is correct either way.
  if (frameMs - lastAnalyzedMs < stepMs) {
    bitmap.close();
    // Reply so the main thread can unblock the corresponding pipeline slot.
    self.postMessage({ type: "frame-skip", frameMs });
    return;
  }

  try {
    // All heavy computation (GPU/CPU RMS) runs here, off the main thread.
    const rms = await computeRms(bitmap);
    bitmap.close();

    lastAnalyzedMs = frameMs;
    analyzedFrameCount++;

    // ── Trigger detection ─────────────────────────────────────────────────
    const matched = rms < tolerance;
    const msOk    = frameMs - lastTriggerMs >= minDelay;
    const frameOk = analyzedFrameCount - lastTriggerFrameIdx >= frameDebounce;
    if (matched && !lastState && msOk && frameOk) {
      triggerTimes.push(frameMs);
      lastTriggerMs       = frameMs;
      lastTriggerFrameIdx = analyzedFrameCount;
    }
    lastState = matched;

    // ── Emit progress to main thread ──────────────────────────────────────
    // frameMs is echoed so the main thread can resolve the correct pipeline slot.
    const percent = Math.min(99, Math.round(((frameMs - startMs) / rangeMs) * 100));
    self.postMessage({ type: "progress", percent, frameMs, markerCount: triggerTimes.length });

  } catch (err) {
    bitmap.close();
    self.postMessage({
      type: "error",
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

// ─── Dispatcher ───────────────────────────────────────────────────────────────

self.onmessage = async (e: MessageEvent) => {
  const msg = e.data;
  switch (msg.type) {
    case "init":    await handleInit(msg); break;
    case "frame":   await handleFrame(msg.bitmap as ImageBitmap, msg.frameMs as number); break;
    case "end":
      // Main thread signals scan complete; return all accumulated trigger times.
      self.postMessage({ type: "complete", triggerTimes });
      break;
    case "destroy":
      wgpuMatcher?.destroy();
      glMatcher?.destroy();
      wgpuMatcher = null;
      glMatcher   = null;
      break;
  }
};
