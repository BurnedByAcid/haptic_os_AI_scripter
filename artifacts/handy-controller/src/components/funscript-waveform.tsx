import { useRef, useEffect, useCallback, RefObject, CSSProperties } from "react";
import { Funscript } from "@/lib/scriptSync";

interface FunscriptWaveformProps {
  script: Funscript | null;
  videoRef: RefObject<HTMLVideoElement | null>;
  className?: string;
  style?: CSSProperties;
}

const NEON_CYAN = "hsl(186, 100%, 50%)";
const NEON_CYAN_RGBA = "rgba(0, 229, 255, ";
const BG = "#080c10";
const GRID = "rgba(255,255,255,0.04)";
const CURSOR_COLOR = "#ffffff";
const LABEL_COLOR = "rgba(255,255,255,0.28)";
const TICK_COLOR = "rgba(255,255,255,0.14)";
const LABEL_FONT = "10px monospace";
const BOTTOM_STRIP = 16; // px reserved for time labels

function formatMs(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

function niceInterval(totalMs: number, canvasW: number): number {
  const candidates = [5000, 10000, 15000, 30000, 60000, 120000, 300000, 600000, 1200000];
  const targetTicks = Math.max(3, Math.min(12, Math.floor(canvasW / 70)));
  for (const iv of candidates) {
    if (Math.floor(totalMs / iv) <= targetTicks) return iv;
  }
  return candidates[candidates.length - 1];
}

export function FunscriptWaveform({ script, videoRef, className, style }: FunscriptWaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);
  const lastCursorX = useRef<number>(-1);
  const bgLayerRef = useRef<ImageData | null>(null);

  const drawBackground = useCallback((ctx: CanvasRenderingContext2D, w: number, h: number) => {
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, w, h);

    if (!script || script.actions.length < 2) {
      ctx.fillStyle = "rgba(255,255,255,0.07)";
      ctx.font = "13px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("No script loaded", w / 2, h / 2);
      return;
    }

    const actions = script.actions;
    const totalMs = actions[actions.length - 1].at;
    if (totalMs <= 0) return;

    // Plot area sits above the bottom label strip
    const ph = h - BOTTOM_STRIP;

    const xOf = (ms: number) => (ms / totalMs) * w;
    const yOf = (pos: number) => ph - (pos / 100) * ph;

    // Subtle grid lines (confined to plot area)
    for (let gx = 0; gx <= w; gx += w / 10) {
      ctx.beginPath();
      ctx.strokeStyle = GRID;
      ctx.lineWidth = 1;
      ctx.moveTo(gx, 0);
      ctx.lineTo(gx, ph);
      ctx.stroke();
    }
    for (let gy = 0; gy <= ph; gy += ph / 4) {
      ctx.beginPath();
      ctx.strokeStyle = GRID;
      ctx.lineWidth = 1;
      ctx.moveTo(0, gy);
      ctx.lineTo(w, gy);
      ctx.stroke();
    }

    // Gradient fill under waveform
    const grad = ctx.createLinearGradient(0, 0, 0, ph);
    grad.addColorStop(0, NEON_CYAN_RGBA + "0.25)");
    grad.addColorStop(1, NEON_CYAN_RGBA + "0.0)");

    ctx.beginPath();
    ctx.moveTo(xOf(actions[0].at), yOf(actions[0].pos));
    for (let i = 1; i < actions.length; i++) {
      ctx.lineTo(xOf(actions[i].at), yOf(actions[i].pos));
    }
    ctx.lineTo(xOf(actions[actions.length - 1].at), ph);
    ctx.lineTo(xOf(actions[0].at), ph);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // Waveform line
    ctx.beginPath();
    ctx.moveTo(xOf(actions[0].at), yOf(actions[0].pos));
    for (let i = 1; i < actions.length; i++) {
      ctx.lineTo(xOf(actions[i].at), yOf(actions[i].pos));
    }
    ctx.strokeStyle = NEON_CYAN;
    ctx.lineWidth = 1.5;
    ctx.shadowColor = NEON_CYAN;
    ctx.shadowBlur = 6;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // ── X-axis: time tick marks + labels ──
    const interval = niceInterval(totalMs, w);
    ctx.font = LABEL_FONT;
    ctx.textBaseline = "bottom";

    for (let t = interval; t < totalMs; t += interval) {
      const x = xOf(t);
      // Tick mark
      ctx.beginPath();
      ctx.strokeStyle = TICK_COLOR;
      ctx.lineWidth = 1;
      ctx.moveTo(x, ph);
      ctx.lineTo(x, h);
      ctx.stroke();
      // Label — keep within canvas edges
      const label = formatMs(t);
      ctx.fillStyle = LABEL_COLOR;
      ctx.textAlign = x < 24 ? "left" : x > w - 24 ? "right" : "center";
      ctx.fillText(label, x, h - 1);
    }

    // ── Y-axis: position labels (left edge, inside plot area) ──
    ctx.textAlign = "left";
    ctx.fillStyle = LABEL_COLOR;
    // 100% at top
    ctx.textBaseline = "top";
    ctx.fillText("100", 3, 2);
    // 50% at mid
    ctx.textBaseline = "middle";
    ctx.fillText("50", 3, ph / 2);
    // 0% at bottom of plot area (above the time strip)
    ctx.textBaseline = "bottom";
    ctx.fillText("0", 3, ph - 1);
  }, [script]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;

    drawBackground(ctx, w, h);
    bgLayerRef.current = ctx.getImageData(0, 0, w, h);
    lastCursorX.current = -1;
  }, [drawBackground]);

  const drawCursor = useCallback(() => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    const bg = bgLayerRef.current;
    if (!canvas || !video || !bg || !script || script.actions.length < 2) return;

    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    const ph = h - BOTTOM_STRIP;
    const totalMs = script.actions[script.actions.length - 1].at;
    if (totalMs <= 0) return;

    const rawX = (video.currentTime * 1000 / totalMs) * w;
    const cursorX = Math.max(0, Math.min(Math.round(rawX), w));
    if (cursorX === lastCursorX.current) return;
    lastCursorX.current = cursorX;

    ctx.putImageData(bg, 0, 0);

    ctx.beginPath();
    ctx.strokeStyle = CURSOR_COLOR;
    ctx.lineWidth = 2;
    ctx.shadowColor = CURSOR_COLOR;
    ctx.shadowBlur = 8;
    ctx.moveTo(cursorX, 0);
    ctx.lineTo(cursorX, ph);
    ctx.stroke();
    ctx.shadowBlur = 0;

    const dotX = Math.max(2, Math.min(cursorX, w - 2));
    const posAtCursor = getPositionAtTime(script, video.currentTime * 1000);
    const dotY = ph - (posAtCursor / 100) * ph;
    ctx.beginPath();
    ctx.arc(dotX, dotY, 4, 0, Math.PI * 2);
    ctx.fillStyle = CURSOR_COLOR;
    ctx.shadowColor = NEON_CYAN;
    ctx.shadowBlur = 12;
    ctx.fill();
    ctx.shadowBlur = 0;
  }, [script, videoRef]);

  useEffect(() => {
    let active = true;
    const loop = () => {
      if (!active) return;
      drawCursor();
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => {
      active = false;
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [drawCursor]);

  const handleCanvasClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video || !script || script.actions.length < 2) return;

    const rect = canvas.getBoundingClientRect();
    const frac = (e.clientX - rect.left) / rect.width;
    const totalMs = script.actions[script.actions.length - 1].at;
    video.currentTime = (frac * totalMs) / 1000;
  }, [script, videoRef]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver(() => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (ctx) {
          drawBackground(ctx, w, h);
          bgLayerRef.current = ctx.getImageData(0, 0, w, h);
          lastCursorX.current = -1;
        }
      }
    });
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [drawBackground]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ cursor: script ? "pointer" : "default", display: "block", ...style }}
      onClick={handleCanvasClick}
    />
  );
}

function getPositionAtTime(script: Funscript, ms: number): number {
  const actions = script.actions;
  if (ms <= actions[0].at) return actions[0].pos;
  if (ms >= actions[actions.length - 1].at) return actions[actions.length - 1].pos;
  let lo = 0, hi = actions.length - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (actions[mid].at <= ms) lo = mid; else hi = mid;
  }
  const t = (ms - actions[lo].at) / (actions[hi].at - actions[lo].at);
  return actions[lo].pos + t * (actions[hi].pos - actions[lo].pos);
}
