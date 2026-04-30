import { useState, useEffect, useCallback, RefObject } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Play, Pause, RotateCcw,
  ChevronFirst, ChevronLast,
  SkipBack, SkipForward,
  StepBack, StepForward,
} from "lucide-react";

const FRAME_S = 1 / 30; // 30fps frame step

function formatTime(s: number): string {
  if (!isFinite(s)) return "0:00";
  const m = Math.floor(s / 60);
  const ss = Math.floor(s % 60);
  return `${m}:${String(ss).padStart(2, "0")}`;
}

interface VideoControlBarProps {
  videoRef: RefObject<HTMLVideoElement | null>;
  /** Shows marker nav + adjustable skip when true */
  isEditor?: boolean;
  /** Sorted list of marker timestamps in milliseconds (for editor mode) */
  markers?: number[];
  /** Optional extra buttons rendered at the right end */
  extraControls?: React.ReactNode;
  className?: string;
}

export function VideoControlBar({
  videoRef,
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

  // Sync play/pause + time from the video element
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onTime = () => setCurrentTime(video.currentTime);
    const onMeta = () => { setDuration(video.duration); setCurrentTime(video.currentTime); };

    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("timeupdate", onTime);
    video.addEventListener("loadedmetadata", onMeta);
    video.addEventListener("loadeddata", onMeta);

    // Sync initial state
    setPlaying(!video.paused);
    setCurrentTime(video.currentTime);
    if (video.duration) setDuration(video.duration);

    return () => {
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("timeupdate", onTime);
      video.removeEventListener("loadedmetadata", onMeta);
      video.removeEventListener("loadeddata", onMeta);
    };
  }, [videoRef]);

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
    // Find the last marker strictly before current time (with 50ms grace)
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

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className={`flex flex-col gap-1.5 select-none ${className}`}>
      {/* Progress bar */}
      <div
        className="w-full h-1.5 bg-white/10 rounded-full cursor-pointer group/prog"
        onClick={e => {
          const v = videoRef.current;
          if (!v || !duration) return;
          const rect = e.currentTarget.getBoundingClientRect();
          v.currentTime = ((e.clientX - rect.left) / rect.width) * duration;
        }}
      >
        <div
          className="h-full bg-primary rounded-full transition-none group-hover/prog:bg-primary/80"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Buttons row */}
      <div className="flex items-center gap-1 flex-wrap">
        {/* Restart */}
        <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-foreground" onClick={restart} title="Restart">
          <RotateCcw className="h-3.5 w-3.5" />
        </Button>

        {/* Frame back */}
        <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-foreground" onClick={stepBack} title="Step back 1 frame">
          <StepBack className="h-3.5 w-3.5" />
        </Button>

        {/* Play/Pause */}
        <Button size="icon" variant="ghost" className="h-8 w-8 text-foreground hover:bg-primary/20 hover:text-primary" onClick={toggle} title={playing ? "Pause" : "Play"}>
          {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </Button>

        {/* Frame forward */}
        <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-foreground" onClick={stepForward} title="Step forward 1 frame">
          <StepForward className="h-3.5 w-3.5" />
        </Button>

        {/* Time display */}
        <span className="text-xs font-mono text-muted-foreground ml-1 min-w-[90px]">
          {formatTime(currentTime)} / {formatTime(duration)}
        </span>

        {isEditor && (
          <>
            <div className="w-px h-5 bg-border/60 mx-1" />

            {/* Prev marker */}
            <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-foreground" onClick={prevMarker} title="Previous marker" disabled={!markers.length}>
              <ChevronFirst className="h-3.5 w-3.5" />
            </Button>

            {/* Next marker */}
            <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-foreground" onClick={nextMarker} title="Next marker" disabled={!markers.length}>
              <ChevronLast className="h-3.5 w-3.5" />
            </Button>

            <div className="w-px h-5 bg-border/60 mx-1" />

            {/* Skip backward */}
            <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-foreground" onClick={skipBackward} title={`Skip back ${skipMs}ms`}>
              <SkipBack className="h-3.5 w-3.5" />
            </Button>

            {/* Skip ms input */}
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

            {/* Skip forward */}
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
      </div>
    </div>
  );
}
