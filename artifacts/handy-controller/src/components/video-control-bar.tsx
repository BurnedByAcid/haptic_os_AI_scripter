import { useState, useEffect, useCallback, useRef, RefObject } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Play, Pause, RotateCcw,
  ChevronFirst, ChevronLast,
  SkipBack, SkipForward,
  StepBack, StepForward,
  Maximize2, Minimize2,
} from "lucide-react";

const FRAME_S = 1 / 30;

function formatTime(s: number): string {
  if (!isFinite(s)) return "0:00";
  const m = Math.floor(s / 60);
  const ss = Math.floor(s % 60);
  return `${m}:${String(ss).padStart(2, "0")}`;
}

interface VideoControlBarProps {
  videoRef: RefObject<HTMLVideoElement | null>;
  /** Element to fullscreen — defaults to the video element if omitted */
  containerRef?: RefObject<HTMLElement | null>;
  isEditor?: boolean;
  markers?: number[];
  extraControls?: React.ReactNode;
  className?: string;
}

export function VideoControlBar({
  videoRef,
  containerRef,
  isEditor = false,
  markers = [],
  extraControls,
  className = "",
}: VideoControlBarProps) {
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [skipMs, setSkipMs] = useState(500);
  const [skipInput, setSkipInput] = useState("500");
  const [fullscreen, setFullscreen] = useState(false);
  const [scrubbing, setScrubbing] = useState(false);
  const [hovering, setHovering] = useState(false);

  const rafRef = useRef<number | null>(null);
  const scrubBarRef = useRef<HTMLDivElement>(null);

  // rAF loop — runs while playing to keep scrub bar smooth
  const startRaf = useCallback(() => {
    const loop = () => {
      const v = videoRef.current;
      if (v) setCurrentTime(v.currentTime);
      rafRef.current = requestAnimationFrame(loop);
    };
    if (rafRef.current === null) rafRef.current = requestAnimationFrame(loop);
  }, [videoRef]);

  const stopRaf = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  // Fullscreen sync
  useEffect(() => {
    const onChange = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      const target = containerRef?.current ?? videoRef.current;
      target?.requestFullscreen();
    }
  }, [containerRef, videoRef]);

  // Sync events + start/stop rAF
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onPlay = () => { setPlaying(true); startRaf(); };
    const onPause = () => { setPlaying(false); stopRaf(); setCurrentTime(video.currentTime); };
    const onMeta = () => { setDuration(video.duration); setCurrentTime(video.currentTime); };
    const onEnded = () => { setPlaying(false); stopRaf(); };

    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("ended", onEnded);
    video.addEventListener("loadedmetadata", onMeta);
    video.addEventListener("loadeddata", onMeta);

    setPlaying(!video.paused);
    setCurrentTime(video.currentTime);
    if (video.duration) setDuration(video.duration);
    if (!video.paused) startRaf();

    return () => {
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("ended", onEnded);
      video.removeEventListener("loadedmetadata", onMeta);
      video.removeEventListener("loadeddata", onMeta);
      stopRaf();
    };
  }, [videoRef, startRaf, stopRaf]);

  // Compute seek position from pointer event on scrub bar
  const seekFromEvent = useCallback((e: React.PointerEvent | PointerEvent) => {
    const bar = scrubBarRef.current;
    const v = videoRef.current;
    if (!bar || !v || !v.duration) return;
    const rect = bar.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    v.currentTime = pct * v.duration;
    setCurrentTime(pct * v.duration);
  }, [videoRef]);

  // Pointer-based drag scrub
  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setScrubbing(true);
    seekFromEvent(e);
  }, [seekFromEvent]);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!scrubbing) return;
    seekFromEvent(e);
  }, [scrubbing, seekFromEvent]);

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!scrubbing) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    setScrubbing(false);
    seekFromEvent(e);
  }, [scrubbing, seekFromEvent]);

  // Controls
  const toggle = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    v.paused ? v.play() : v.pause();
  }, [videoRef]);

  const restart = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = 0;
    v.pause();
  }, [videoRef]);

  const stepBack = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    v.pause();
    v.currentTime = Math.max(0, v.currentTime - FRAME_S);
  }, [videoRef]);

  const stepForward = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    v.pause();
    v.currentTime = Math.min(v.duration || Infinity, v.currentTime + FRAME_S);
  }, [videoRef]);

  const skipBackward = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Math.max(0, v.currentTime - skipMs / 1000);
  }, [videoRef, skipMs]);

  const skipForward = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Math.min(v.duration || Infinity, v.currentTime + skipMs / 1000);
  }, [videoRef, skipMs]);

  const prevMarker = useCallback(() => {
    const v = videoRef.current;
    if (!v || !markers.length) return;
    const nowMs = v.currentTime * 1000;
    const prev = [...markers].reverse().find(m => m < nowMs - 50);
    if (prev !== undefined) v.currentTime = prev / 1000;
  }, [videoRef, markers]);

  const nextMarker = useCallback(() => {
    const v = videoRef.current;
    if (!v || !markers.length) return;
    const nowMs = v.currentTime * 1000;
    const next = markers.find(m => m > nowMs + 50);
    if (next !== undefined) v.currentTime = next / 1000;
  }, [videoRef, markers]);

  const handleSkipInput = (val: string) => {
    setSkipInput(val);
    const n = parseInt(val, 10);
    if (!isNaN(n) && n > 0) setSkipMs(n);
  };

  const progress = duration > 0 ? currentTime / duration : 0;
  const active = hovering || scrubbing;

  return (
    <div className={`flex flex-col gap-1 select-none ${className}`}>
      {/* ── Scrub bar ── */}
      <div
        ref={scrubBarRef}
        className="relative w-full h-5 flex items-center cursor-pointer group/scrub"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
      >
        {/* Track background */}
        <div className="absolute inset-x-0 h-1.5 top-1/2 -translate-y-1/2 rounded-full bg-white/10 overflow-hidden">
          {/* Filled portion */}
          <div
            className="h-full bg-primary rounded-full"
            style={{ width: `${progress * 100}%`, transition: scrubbing ? "none" : undefined }}
          />
        </div>

        {/* Marker pips */}
        {duration > 0 && markers.map((ms, i) => (
          <div
            key={i}
            className="absolute top-1/2 -translate-y-1/2 w-0.5 h-2.5 rounded-full bg-white/40 pointer-events-none"
            style={{ left: `${(ms / 1000 / duration) * 100}%` }}
          />
        ))}

        {/* Thumb */}
        <div
          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 rounded-full bg-white shadow-md pointer-events-none"
          style={{
            left: `${progress * 100}%`,
            width: active ? 14 : 10,
            height: active ? 14 : 10,
            opacity: duration > 0 ? 1 : 0,
            transition: scrubbing ? "none" : "width 120ms, height 120ms",
            boxShadow: "0 0 0 2px rgba(0,229,255,0.35)",
          }}
        />
      </div>

      {/* ── Buttons row ── */}
      <div className="flex items-center gap-1 flex-wrap">
        <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-foreground" onClick={restart} title="Restart">
          <RotateCcw className="h-3.5 w-3.5" />
        </Button>
        <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-foreground" onClick={stepBack} title="Step back 1 frame">
          <StepBack className="h-3.5 w-3.5" />
        </Button>
        <Button size="icon" variant="ghost" className="h-8 w-8 text-foreground hover:bg-primary/20 hover:text-primary" onClick={toggle} title={playing ? "Pause" : "Play"}>
          {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </Button>
        <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-foreground" onClick={stepForward} title="Step forward 1 frame">
          <StepForward className="h-3.5 w-3.5" />
        </Button>

        <span className="text-xs font-mono text-muted-foreground ml-1 min-w-[90px]">
          {formatTime(currentTime)} / {formatTime(duration)}
        </span>

        {isEditor && (
          <>
            <div className="w-px h-5 bg-border/60 mx-1" />
            <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-foreground" onClick={prevMarker} title="Previous marker" disabled={!markers.length}>
              <ChevronFirst className="h-3.5 w-3.5" />
            </Button>
            <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-foreground" onClick={nextMarker} title="Next marker" disabled={!markers.length}>
              <ChevronLast className="h-3.5 w-3.5" />
            </Button>
            <div className="w-px h-5 bg-border/60 mx-1" />
            <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-foreground" onClick={skipBackward} title={`Skip back ${skipMs}ms`}>
              <SkipBack className="h-3.5 w-3.5" />
            </Button>
            <div className="flex items-center gap-1">
              <Input
                type="number"
                min={1}
                value={skipInput}
                onChange={e => handleSkipInput(e.target.value)}
                className="h-7 w-16 text-xs text-center bg-background/50 border-border/50 px-1 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
                title="Skip amount in milliseconds"
              />
              <span className="text-[10px] text-muted-foreground">ms</span>
            </div>
            <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-foreground" onClick={skipForward} title={`Skip forward ${skipMs}ms`}>
              <SkipForward className="h-3.5 w-3.5" />
            </Button>
          </>
        )}

        {extraControls && (
          <div className="ml-auto flex items-center gap-1">
            {extraControls}
          </div>
        )}

        {/* Fullscreen */}
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7 text-muted-foreground hover:text-foreground ml-auto"
          onClick={toggleFullscreen}
          title={fullscreen ? "Exit fullscreen" : "Fullscreen"}
        >
          {fullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
        </Button>
      </div>
    </div>
  );
}
