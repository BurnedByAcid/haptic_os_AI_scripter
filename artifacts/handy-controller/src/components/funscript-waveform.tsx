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

    const xOf = (ms: number) => (ms / totalMs) * w;
    const yOf = (pos: number) => h - (pos / 100) * h;

    for (let gx = 0; gx <= w; gx += w / 10) {
      ctx.beginPath();
      ctx.strokeStyle = GRID;
      ctx.lineWidth = 1;
      ctx.moveTo(gx, 0);
      ctx.lineTo(gx, h);
      ctx.stroke();
    }
    for (let gy = 0; gy <= h; gy += h / 4) {
      ctx.beginPath();
      ctx.strokeStyle = GRID;
      ctx.lineWidth = 1;
      ctx.moveTo(0, gy);
      ctx.lineTo(w, gy);
      ctx.stroke();
    }

    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, NEON_CYAN_RGBA + "0.25)");
    grad.addColorStop(1, NEON_CYAN_RGBA + "0.0)");

    ctx.beginPath();
    ctx.moveTo(xOf(actions[0].at), yOf(actions[0].pos));
    for (let i = 1; i < actions.length; i++) {
      ctx.lineTo(xOf(actions[i].at), yOf(actions[i].pos));
    }
    ctx.lineTo(xOf(actions[actions.length - 1].at), h);
    ctx.lineTo(xOf(actions[0].at), h);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

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
    ctx.lineTo(cursorX, h);
    ctx.stroke();
    ctx.shadowBlur = 0;

    const dotX = Math.max(2, Math.min(cursorX, w - 2));
    const posAtCursor = getPositionAtTime(script, video.currentTime * 1000);
    const dotY = h - (posAtCursor / 100) * h;
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
