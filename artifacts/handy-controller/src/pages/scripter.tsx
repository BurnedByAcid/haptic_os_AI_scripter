import { useState, useRef, useEffect, useCallback } from "react";
import { useFeatureTracking } from "@/hooks/use-analytics";
import { useHandy } from "@/hooks/use-handy";
import { useSubscription } from "@/hooks/use-subscription";
import { useAuth } from "@clerk/react";
import { Link } from "wouter";
import { setHDSP } from "@/lib/handyApi";
import { GlPatchMatcher } from "@/lib/gl-patch-matcher";
import { WebGpuPatchMatcher } from "@/lib/webgpu-patch-matcher";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Slider } from "@/components/ui/slider";
import { Progress } from "@/components/ui/progress";
import { Trash2, Download, FilePlus, Upload, Mic, Square, ChevronDown, ChevronUp, ZoomIn, ZoomOut, Copy, Scissors, Clipboard, Wrench, X, ChevronRight, Lock, Crown, Loader2, BookmarkPlus, Link2, Activity } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { validateVideoUrl } from "@/lib/validation";
import { useBlockedReport } from "@/contexts/blocked-report-context";
import { VideoControlBar } from "@/components/video-control-bar";
import { SaveScriptDialog } from "@/components/save-script-dialog";
import { ResumeDraftPicker, ExitWarningDialog, type DraftSummary } from "@/components/scripter-drafts";
import { useDirtyExitWarning } from "@/hooks/use-dirty-exit-warning";
import { useLocation } from "wouter";
import { AUDIO_CLEANER_SESSION_KEY } from "@/pages/audio-cleaner";
import { applyVocalRemoval, applyImpactSuppression, applyScreamSuppression } from "@/lib/audio-dsp";

const API_BASE = import.meta.env.VITE_API_URL ?? "";

const STORAGE_KEY = "scripter_session_v1";

/** 11 EQ bands — label, Hz range, display colour */
const BD_BANDS: { label: string; range: [number, number]; color: string }[] = [
  { label: "Sub",     range: [20,     60],   color: "#6366f1" },
  { label: "Bass",    range: [60,    250],   color: "#8b5cf6" },
  { label: "Lo-Mid",  range: [250,   500],   color: "#7c3aed" },
  { label: "Mid",     range: [500,   1000],  color: "#a855f7" },
  { label: "Up-Mid",  range: [1000,  2000],  color: "#c026d3" },
  { label: "Prsnc",   range: [2000,  4000],  color: "#0ea5e9" },
  { label: "Brill",   range: [4000,  6000],  color: "#10b981" },
  { label: "High",    range: [6000,  8000],  color: "#84cc16" },
  { label: "V-High",  range: [8000,  12000], color: "#eab308" },
  { label: "U-High",  range: [12000, 16000], color: "#f59e0b" },
  { label: "Air",     range: [16000, 20000], color: "#ef4444" },
];

/** 10 zoom levels: half-window in seconds (2 s → 60 s). Index 0 = max zoom. */
const TL_ZOOM_LEVELS = Array.from({ length: 10 }, (_, i) => 2 + (58 * i) / 9);

/** Pick the smallest "nice" tick interval (ms) that puts ≈ 6 ticks in view. */
function niceTickMs(halfWindowMs: number): number {
  const target = (halfWindowMs * 2) / 6;
  for (const n of [100, 200, 250, 500, 1000, 2000, 5000, 10000, 15000, 30000, 60000]) {
    if (n >= target) return n;
  }
  return 60000;
}

/** Format milliseconds as a short time label. */
function fmtMs(ms: number): string {
  const s = ms / 1000;
  if (s >= 60) return `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
  return `${s.toFixed(s < 10 ? 2 : 1)}s`;
}

interface Point {
  id: string;
  time: number;
  pos: number;
}

export default function Scripter() {
  useFeatureTracking("scripter");
  const { key, connected } = useHandy();
  const { isFree, isLoaded: planLoaded } = useSubscription();
  const isSubscriber = planLoaded && !isFree;
  const { getToken } = useAuth();
  const [, setLocation] = useLocation();

  // ─── Dirty / unsaved-work tracking ───
  // We snapshot the "clean" `Point[]` array reference. Dirty = the live
  // `points` reference is no longer the snapshot. React always swaps the
  // array reference on every `setPoints(...)`, so identity comparison is
  // both cheap (no JSON hashing of thousands of points) and correct (it
  // catches every real mutation while letting trusted checkpoints below
  // swap the snapshot in lockstep with the new points value).
  //
  // Checkpoint usage:
  //   - export (no points change)        → `markClean()`
  //   - import / draft load / New Script → `setPoints(next); markClean(next);`
  const [dirty, setDirty] = useState(false);
  const cleanPointsRef = useRef<Point[] | null>(null);
  const markClean = useCallback((snapshot?: Point[]) => {
    cleanPointsRef.current = snapshot ?? pointsRef.current;
    setDirty(false);
  }, []);

  // ─── Draft / exit warning state ───
  const [activeDraftSlot, setActiveDraftSlot] = useState<number | null>(null);
  const [resumeDrafts, setResumeDrafts] = useState<DraftSummary[]>([]);
  const [resumePickerOpen, setResumePickerOpen] = useState(false);
  const [exitDialogOpen, setExitDialogOpen] = useState(false);
  const pendingNavRef = useRef<string | null>(null);

  // ─── Save dialog ───
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);

  // ─── Daily usage gate (free tier only) ───
  const [usageState, setUsageState] = useState<"checking" | "allowed" | "blocked">("checking");
  const usageRecordedRef = useRef(false);

  useEffect(() => {
    if (!planLoaded) return;
    if (!isFree) {
      setUsageState("allowed");
      return;
    }
    if (usageRecordedRef.current) return;
    usageRecordedRef.current = true;

    (async () => {
      try {
        const token = await getToken();
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (token) headers["Authorization"] = `Bearer ${token}`;

        // Single atomic call: checks limit AND records usage in one DB transaction.
        // Returns { allowed: boolean }. Fail-closed: block on any error.
        const res = await fetch(`${API_BASE}/api/usage/scripter/start`, {
          method: "POST",
          headers,
        });
        if (!res.ok) {
          // Server error — block access to prevent limit bypass
          setUsageState("blocked");
          return;
        }
        const { allowed } = await res.json() as { allowed: boolean };
        setUsageState(allowed ? "allowed" : "blocked");
      } catch {
        // Network error — fail closed for free users to enforce the billing gate
        setUsageState("blocked");
      }
    })();
  }, [planLoaded, isFree, getToken]);

  const [points, setPoints] = useState<Point[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (!saved) return [];
      const parsed = JSON.parse(saved);
      if (
        Array.isArray(parsed) &&
        parsed.every(
          (p) =>
            p !== null &&
            typeof p === "object" &&
            typeof p.id === "string" &&
            typeof p.time === "number" &&
            typeof p.pos === "number"
        )
      ) {
        return parsed as Point[];
      }
      return [];
    } catch {
      return [];
    }
  });
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoFileName, setVideoFileName] = useState<string | null>(null);
  const [urlDialogOpen, setUrlDialogOpen] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  const [urlError, setUrlError] = useState<string | null>(null);
  const { toast } = useToast();
  const { openBlockedReport } = useBlockedReport();
  const [currentTime, setCurrentTime] = useState(0);
  // Tracks how many times each base filename has been exported this session
  const exportCountsRef = useRef<Map<string, number>>(new Map());
  const [realtimeTest, setRealtimeTest] = useState(false);

  // ─── Layout state ───
  const [tabsOpen, setTabsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"beat" | "timeline" | "visual">("beat");

  // ─── Timeline Editor state ───
  const [tlZoomLevel, setTlZoomLevel] = useState(3); // 0 = max zoom (2 s), 9 = min (60 s)
  // Stable refs so keyboard handler always sees latest values without re-subscribing
  const currentTimeRef = useRef(0);
  const pointsRef = useRef<Point[]>([]);
  const selectedIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => { currentTimeRef.current = currentTime; }, [currentTime]);
  useEffect(() => { pointsRef.current = points; }, [points]);
  useEffect(() => { selectedIdsRef.current = selectedIds; }, [selectedIds]);

  // Initialise the clean-snapshot to whatever points we hydrated with so a
  // localStorage-restored session opens as "clean", then keep `dirty` in
  // sync via identity comparison against the snapshot.
  useEffect(() => {
    if (cleanPointsRef.current === null) cleanPointsRef.current = points;
    setDirty(points !== cleanPointsRef.current);
  }, [points]);

  // Build / apply funscript JSON for draft save/load.
  const buildFunscriptJson = useCallback(() => {
    const sorted = [...pointsRef.current].sort((a, b) => a.time - b.time);
    return JSON.stringify({ actions: sorted.map(p => ({ at: Math.round(p.time), pos: p.pos })) });
  }, []);

  // Replaces the editor's points with a freshly-parsed funscript and
  // simultaneously snapshots the new array as the "clean" baseline. Doing
  // both in the same call avoids the async-setState race where the parent
  // would otherwise call `markClean()` against the stale `pointsRef.current`
  // and the next commit would immediately re-mark dirty.
  const applyFunscriptJson = useCallback((json: string, _draftName: string): Point[] => {
    try {
      const parsed = JSON.parse(json) as { actions?: { at: number; pos: number }[] };
      if (!Array.isArray(parsed.actions)) return pointsRef.current;
      const imported: Point[] = parsed.actions
        .filter(a => a && typeof a.at === "number" && typeof a.pos === "number")
        .map(a => ({
          id: crypto.randomUUID(),
          time: a.at,
          pos: Math.max(0, Math.min(100, a.pos)),
        }));
      setPoints(imported);
      setSelectedIds(new Set());
      markClean(imported);
      return imported;
    } catch {
      toast({ title: "Couldn't load draft (invalid funscript JSON)", variant: "destructive" });
      return pointsRef.current;
    }
  }, [markClean]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Resume-draft picker on mount: show only when editor is empty and the
  //     user actually has saved drafts (subscriber or recently-downgraded). ───
  const resumeCheckedRef = useRef(false);
  useEffect(() => {
    if (resumeCheckedRef.current) return;
    if (!planLoaded) return;
    resumeCheckedRef.current = true;
    if (pointsRef.current.length > 0) return;
    (async () => {
      try {
        const token = await getToken();
        if (!token) return;
        const res = await fetch(`${API_BASE}/api/scripter-drafts`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const list = await res.json() as DraftSummary[];
        if (list.length > 0) {
          setResumeDrafts(list);
          setResumePickerOpen(true);
        }
      } catch { /* silent */ }
    })();
  }, [planLoaded, getToken]);

  const handleResumeDraft = useCallback(async (slot: number) => {
    setResumePickerOpen(false);
    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/api/scripter-drafts/${slot}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        toast({ title: "Couldn't load draft", variant: "destructive" });
        return;
      }
      const d = await res.json() as DraftSummary & { funscript_json: string };
      const nextPoints = applyFunscriptJson(d.funscript_json, d.name);
      setActiveDraftSlot(slot);
      markClean(nextPoints);
    } catch {
      toast({ title: "Network error loading draft", variant: "destructive" });
    }
  }, [getToken, applyFunscriptJson, markClean, toast]);

  // ─── Exit warning ───
  const handleAttemptNavigate = useCallback((href: string | null) => {
    pendingNavRef.current = href;
    setExitDialogOpen(true);
    return false;
  }, []);
  useDirtyExitWarning({ dirty, onAttemptNavigate: handleAttemptNavigate });
  const handleExitConfirm = useCallback(() => {
    setExitDialogOpen(false);
    setDirty(false);
    const href = pendingNavRef.current;
    pendingNavRef.current = null;
    if (href === null) {
      // Came from popstate (back/forward) — replay the back action.
      setTimeout(() => window.history.back(), 0);
      return;
    }
    if (href) {
      try {
        const url = new URL(href, window.location.href);
        if (url.origin === window.location.origin) {
          // Defer so React commits the dirty=false update first
          setTimeout(() => setLocation(url.pathname + url.search + url.hash), 0);
        } else {
          window.location.href = href;
        }
      } catch {
        window.location.href = href;
      }
    }
  }, [setLocation]);
  const handleExitCancel = useCallback(() => {
    setExitDialogOpen(false);
    pendingNavRef.current = null;
  }, []);

  // ─── Video rect (for VT overlay alignment) ───
  const videoBlockRef = useRef<HTMLDivElement>(null);
  const videoContainerRef = useRef<HTMLDivElement>(null);
  const [videoRect, setVideoRect] = useState({ left: 0, top: 0, width: 0, height: 0 });

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const isDragging = useRef(false);
  // Clipboard: relative-time offsets so paste anchors to playhead
  const clipboardRef = useRef<Array<{ relTime: number; pos: number }>>([]);
  // Rubber-band selection box (canvas pixel coords)
  const isRubberBanding = useRef(false);
  const selBoxRef = useRef<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  // Drag anchor: snapshot of every selected point's position at drag-start
  const dragAnchorRef = useRef<{
    mouseTime: number;
    mouseY: number;
    items: { id: string; origTime: number; origPos: number }[];
  } | null>(null);

  // ─── Tools menu / Presets popup state ───
  const [showToolsMenu, setShowToolsMenu] = useState(false);
  const [showPresetsPopup, setShowPresetsPopup] = useState(false);
  const [customPatternText, setCustomPatternText] = useState("");
  const toolsMenuRef = useRef<HTMLDivElement>(null);

  // ─── Visual Trigger state ───
  const vtCanvasRef = useRef<HTMLCanvasElement>(null);
  const [vtZone, setVtZone] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const vtDragStartRef = useRef<{ cssX: number; cssY: number } | null>(null);
  const vtDragLiveRef = useRef<typeof vtZone>(null); // live preview during drag
  const [vtDragging, setVtDragging] = useState(false);
  const [vtSampledPatch, setVtSampledPatch] = useState<Uint8Array | null>(null);
  const vtPatchPreviewRef = useRef<HTMLCanvasElement>(null);
  const [vtTolerance, setVtTolerance] = useState(20); // RMS threshold 0-255
  const [vtMinDelay, setVtMinDelay] = useState(200);   // ms cooldown between triggers
  const [vtFrameDebounce, setVtFrameDebounce] = useState(5); // frame-based debounce 1–5
  const [vtMovementLimit, setVtMovementLimit] = useState(300);
  const [vtChosenRange, setVtChosenRange] = useState<[number, number]>([0, 100]);
  const [vtAnalyzing, setVtAnalyzing] = useState(false);
  const vtCancelRef = useRef(false);
  const [vtProgress, setVtProgress] = useState(0);
  const [vtStartTime, setVtStartTime] = useState(0);
  const [vtEndTime, setVtEndTime] = useState(0);
  const [vtPreviewPoints, setVtPreviewPoints] = useState<Point[]>([]);

  // ─── GPU patch matcher ───
  // Holds whichever matcher was successfully initialised: WebGPU > WebGL > none.
  const glRef = useRef<WebGpuPatchMatcher | GlPatchMatcher | null>(null);
  // "webgpu" | "webgl" | "cpu" — determines the badge label and computeRms path.
  const [gpuMode, setGpuMode] = useState<"webgpu" | "webgl" | "cpu">("cpu");
  const gpuAvail = gpuMode !== "cpu";
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // ── Try WebGPU first ──
      try {
        const wgpu = await WebGpuPatchMatcher.create();
        if (cancelled) { wgpu.destroy(); return; }

        // If the GPU device is lost after initialisation (GPU reset, mobile
        // background, driver crash), tear down the matcher and re-initialise
        // the fallback chain so future scans still work.
        wgpu.onLost = () => {
          // Don't touch state after the component has unmounted.
          if (cancelled) {
            wgpu.destroy();
            return;
          }
          if (glRef.current === wgpu) {
            wgpu.destroy();
            glRef.current = null;
          }
          // Attempt WebGL first, then CPU
          try {
            const gl = new GlPatchMatcher();
            glRef.current = gl;
            setGpuMode("webgl");
            console.log("[VideoAnalysis] GPU path: WebGL (after WebGPU device loss)");
          } catch {
            glRef.current = null;
            setGpuMode("cpu");
            console.log("[VideoAnalysis] GPU path: CPU (after WebGPU device loss)");
          }
        };

        glRef.current = wgpu;
        setGpuMode("webgpu");
        console.log("[VideoAnalysis] GPU path: WebGPU");
        return;
      } catch { /* fall through */ }

      // ── Fall back to WebGL ──
      try {
        glRef.current = new GlPatchMatcher();
        if (cancelled) { glRef.current.destroy(); glRef.current = null; return; }
        setGpuMode("webgl");
        console.log("[VideoAnalysis] GPU path: WebGL");
        return;
      } catch { /* fall through */ }

      // ── CPU-only ──
      glRef.current = null;
      setGpuMode("cpu");
      console.log("[VideoAnalysis] GPU path: CPU");
    })();
    return () => {
      cancelled = true;
      glRef.current?.destroy();
      glRef.current = null;
    };
  }, []);

  // ─── Beat Detector state ───
  const bdCanvasRef = useRef<HTMLCanvasElement>(null);
  const [bdIsActive, setBdIsActive] = useState(false);
  const [bdBpm, setBdBpm] = useState(0);
  const [bdFromCleaner, setBdFromCleaner] = useState<string | null>(() =>
    sessionStorage.getItem(AUDIO_CLEANER_SESSION_KEY)
  );
  const [bdSensitivity, setBdSensitivity] = useState(1.5);
  const [bdIsRecording, setBdIsRecording] = useState(false);
  const bdAudioCtxRef = useRef<AudioContext | null>(null);
  const bdAnalyserRef = useRef<AnalyserNode | null>(null);
  const bdAnalyserRRef = useRef<AnalyserNode | null>(null); // right-channel analyser for stereo vocal removal
  const bdSourceRef = useRef<MediaStreamAudioSourceNode | AudioBufferSourceNode | MediaElementAudioSourceNode | null>(null);
  const bdUsingVideoRef = useRef(false); // true = timing comes from videoRef.currentTime
  // Persistent across stop/start — createMediaElementSource can only be called ONCE per element
  const bdVideoCtxRef  = useRef<AudioContext | null>(null);
  const bdVideoSrcRef  = useRef<MediaElementAudioSourceNode | null>(null);
  const bdRafRef = useRef<number | null>(null);
  const bdLastBeatRef = useRef(0);
  const bdEnergyHistoryRef = useRef<number[]>([]);
  const bdBeatIntervalHistoryRef = useRef<number[]>([]);
  const bdSensitivityRef = useRef(bdSensitivity);
  const bdIsRecordingRef = useRef(bdIsRecording);
  const bdRecordStartRef = useRef(0);
  const bdBeatPosRef = useRef(0); // alternates 0 ↔ 100
  const [bdPointsAdded, setBdPointsAdded] = useState(0);

  const [bdBandEnabled, setBdBandEnabled] = useState<boolean[]>(() => Array(11).fill(true));
  const bdBandEnabledRef = useRef<boolean[]>(Array(11).fill(true));
  const bdFilterGainsRef = useRef<GainNode[]>([]); // one GainNode per band, gates audio to destination

  // ─── Band Cleaner state (inline DSP inside the Beat Detector) ───
  const [bdCleanBand, setBdCleanBand] = useState<number | null>(null);
  const bdCleanBandRef = useRef<number | null>(null);
  const [bdCleanOpts, setBdCleanOpts] = useState({
    vocalRemoval: false,
    impactSuppression: true,
    screamSuppression: false,
  });
  const bdCleanOptsRef = useRef(bdCleanOpts);

  useEffect(() => { bdSensitivityRef.current = bdSensitivity; }, [bdSensitivity]);
  useEffect(() => { bdIsRecordingRef.current = bdIsRecording; }, [bdIsRecording]);
  useEffect(() => { bdBandEnabledRef.current = bdBandEnabled; }, [bdBandEnabled]);
  useEffect(() => { bdCleanBandRef.current = bdCleanBand; }, [bdCleanBand]);
  useEffect(() => { bdCleanOptsRef.current = bdCleanOpts; }, [bdCleanOpts]);

  // When a clean band is selected, automatically solo it in the band filter chain
  useEffect(() => {
    if (bdCleanBand === null) return;
    setBdBandEnabled(prev => prev.map((_, j) => j === bdCleanBand));
  }, [bdCleanBand]);

  // Sync band enables → gain nodes so the user hears only active bands
  useEffect(() => {
    bdBandEnabled.forEach((on, i) => {
      const g = bdFilterGainsRef.current[i];
      if (g) g.gain.setTargetAtTime(on ? 1 : 0, g.context.currentTime, 0.02);
    });
  }, [bdBandEnabled]);

  const bdLoop = useCallback(() => {
    if (!bdAnalyserRef.current || !bdCanvasRef.current) return;
    const analyser = bdAnalyserRef.current;
    const canvas = bdCanvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const binCount = analyser.frequencyBinCount; // fftSize/2 = 1024
    const freqData = new Uint8Array(binCount);
    analyser.getByteFrequencyData(freqData);

    const hzPerBin = analyser.context.sampleRate / analyser.fftSize;
    const enabled = bdBandEnabledRef.current;
    const cleanBand = bdCleanBandRef.current;
    const cleanOpts = bdCleanOptsRef.current;
    const anyCleanerOn = cleanOpts.vocalRemoval || cleanOpts.impactSuppression || cleanOpts.screamSuppression;

    // ── Compute energy — optionally from a DSP-cleaned time-domain snapshot ──
    let energy = 0;

    if (cleanBand !== null && anyCleanerOn && bdAudioCtxRef.current) {
      // Get raw PCM snapshot from the primary (left) analyser
      const tdDataL = new Float32Array(analyser.fftSize);
      analyser.getFloatTimeDomainData(tdDataL);

      const audioCtx = bdAudioCtxRef.current;
      const analyserR = bdAnalyserRRef.current;

      let tempBuf: AudioBuffer;
      if (cleanOpts.vocalRemoval && analyserR) {
        // Stereo path: capture right channel and build a 2-ch buffer so phase
        // cancellation in applyVocalRemoval actually removes centre-panned audio
        const tdDataR = new Float32Array(analyser.fftSize);
        analyserR.getFloatTimeDomainData(tdDataR);
        tempBuf = audioCtx.createBuffer(2, tdDataL.length, audioCtx.sampleRate);
        tempBuf.getChannelData(0).set(tdDataL);
        tempBuf.getChannelData(1).set(tdDataR);
        tempBuf = applyVocalRemoval(tempBuf, audioCtx);
      } else {
        // Mono path (mic or vocal removal off): vocal removal is a no-op on mono
        tempBuf = audioCtx.createBuffer(1, tdDataL.length, audioCtx.sampleRate);
        tempBuf.getChannelData(0).set(tdDataL);
        if (cleanOpts.vocalRemoval) tempBuf = applyVocalRemoval(tempBuf, audioCtx);
      }

      // Apply remaining DSP transforms
      if (cleanOpts.impactSuppression) tempBuf = applyImpactSuppression(tempBuf, audioCtx);
      if (cleanOpts.screamSuppression) tempBuf = applyScreamSuppression(tempBuf, audioCtx);

      // Compute RMS² energy from the cleaned samples (use left channel as representative)
      const samples = tempBuf.getChannelData(0);
      let sumSq = 0;
      for (let i = 0; i < samples.length; i++) sumSq += samples[i] * samples[i];
      energy = sumSq / samples.length;
    } else {
      // Default: frequency-bin energy from enabled bands
      let totalBins = 0;
      for (let b = 0; b < BD_BANDS.length; b++) {
        if (!enabled[b]) continue;
        const startBin = Math.max(0, Math.round(BD_BANDS[b].range[0] / hzPerBin));
        const endBin   = Math.min(binCount - 1, Math.round(BD_BANDS[b].range[1] / hzPerBin));
        for (let i = startBin; i <= endBin; i++) {
          const v = freqData[i] / 255;
          energy += v * v;
          totalBins++;
        }
      }
      if (totalBins > 0) energy /= totalBins; // normalise so scale doesn't shift as bands toggle
    }

    const history = bdEnergyHistoryRef.current;
    history.push(energy);
    if (history.length > 43) history.shift();
    const avgEnergy = history.reduce((a, b) => a + b, 0) / history.length;
    const now = performance.now();

    const isBeat = energy > avgEnergy * bdSensitivityRef.current && now - bdLastBeatRef.current > 250;
    if (isBeat) {
      const interval = now - bdLastBeatRef.current;
      if (interval > 0 && interval < 3000) {
        bdBeatIntervalHistoryRef.current.push(interval);
        if (bdBeatIntervalHistoryRef.current.length > 8) bdBeatIntervalHistoryRef.current.shift();
        const avgInterval = bdBeatIntervalHistoryRef.current.reduce((a, b) => a + b, 0) / bdBeatIntervalHistoryRef.current.length;
        setBdBpm(Math.round(60000 / avgInterval));
      }
      bdLastBeatRef.current = now;

      if (bdIsRecordingRef.current) {
        // When analysing video audio, stamp the actual video position for perfect sync
        const beatMs = bdUsingVideoRef.current
          ? Math.round((videoRef.current?.currentTime ?? 0) * 1000)
          : Math.round(now - bdRecordStartRef.current);
        const pos = bdBeatPosRef.current;
        bdBeatPosRef.current = pos === 0 ? 100 : 0;
        setPoints(prev => [...prev, { id: crypto.randomUUID(), time: beatMs, pos }]);
        setBdPointsAdded(c => c + 1);
      }
    }

    // ── Draw per-band spectrum ──────────────────────────────────────────────
    ctx.fillStyle = "rgba(0,0,0,0.18)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const bandW = canvas.width / BD_BANDS.length;
    for (let b = 0; b < BD_BANDS.length; b++) {
      const startBin = Math.max(0, Math.round(BD_BANDS[b].range[0] / hzPerBin));
      const endBin   = Math.min(binCount - 1, Math.round(BD_BANDS[b].range[1] / hzPerBin));
      const numBins  = Math.max(1, endBin - startBin + 1);
      const isCleanBand = cleanBand === b;

      // Average amplitude in this band (0-255)
      let sum = 0;
      for (let i = startBin; i <= endBin; i++) sum += freqData[i];
      const avg = sum / numBins;

      // Cleaning band gets a subtle tinted background
      if (isCleanBand) {
        ctx.fillStyle = BD_BANDS[b].color + "18";
        ctx.fillRect(b * bandW, 0, bandW, canvas.height);
      }

      // Draw sub-bar columns within each band section
      const subBarW = Math.max(1, (bandW - 2) / numBins);
      for (let i = startBin; i <= endBin; i++) {
        const barH = (freqData[i] / 255) * canvas.height;
        const bx = b * bandW + (i - startBin) * subBarW;
        ctx.fillStyle = enabled[b] ? BD_BANDS[b].color + "cc" : "#1a1a1a";
        ctx.fillRect(bx, canvas.height - barH, subBarW - 0.5, barH);
      }

      // Band average level indicator (bright top bar)
      if (enabled[b]) {
        const levelH = (avg / 255) * canvas.height;
        ctx.fillStyle = BD_BANDS[b].color;
        ctx.fillRect(b * bandW + 1, canvas.height - levelH - 2, bandW - 4, 3);
      }

      // Cleaning band: draw a distinct ring border + "Cleaning" label
      if (isCleanBand) {
        ctx.strokeStyle = BD_BANDS[b].color;
        ctx.lineWidth = 2;
        ctx.strokeRect(b * bandW + 1, 1, bandW - 2, canvas.height - 2);
        ctx.fillStyle = BD_BANDS[b].color;
        ctx.font = "bold 9px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(anyCleanerOn ? "Cleaning" : "Isolated", b * bandW + bandW / 2, 14);
      }

      // Divider
      ctx.fillStyle = "rgba(255,255,255,0.06)";
      ctx.fillRect(b * bandW, 0, 1, canvas.height);
    }

    // Beat flash overlay
    if (isBeat) {
      ctx.fillStyle = "rgba(168,85,247,0.18)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    bdRafRef.current = requestAnimationFrame(bdLoop);
  }, [setPoints]);

  const bdSetupAudio = useCallback((stream: MediaStream) => {
    const ctx = new AudioContext();
    bdAudioCtxRef.current = ctx;
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(analyser);
    bdSourceRef.current = source;
    bdAnalyserRef.current = analyser;
    bdAnalyserRRef.current = null; // mic is mono — no right-channel analyser
    bdLoop();
  }, [bdLoop]);

  /**
   * Build 7 bandpass filter chains (HP→LP→Gain→destination) so the user
   * can HEAR only the selected frequency bands.  The analyser is kept on the
   * raw source so the spectrum display shows all bands regardless of selection.
   */
  const bdBuildFilters = useCallback((ctx: AudioContext, source: AudioNode) => {
    // Raw analyser for spectrum display + beat detection (left/mono channel)
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;

    // Split into stereo so vocal removal (phase cancellation) can operate on both
    // channels independently.  A ChannelSplitter always outputs 2 outputs; if the
    // source is mono the second output will be silence — that is fine because
    // bdLoop checks for the right-channel analyser before building the stereo buffer.
    const splitter = ctx.createChannelSplitter(2);
    source.connect(splitter);
    splitter.connect(analyser, 0); // left channel → primary analyser (spectrum display)

    const analyserR = ctx.createAnalyser();
    analyserR.fftSize = 2048;
    splitter.connect(analyserR, 1); // right channel → secondary analyser

    bdAnalyserRef.current = analyser;
    bdAnalyserRRef.current = analyserR;

    // 3× cascaded HP + 3× cascaded LP per band → Gain → destination
    // 6th-order roll-off (~−120 dB/oct) for tight inter-band isolation.
    // Q = 0.7071 (Butterworth) keeps the passband flat while the skirts drop fast.
    const STAGES = 3;
    const FILT_Q = 0.7071;
    const gains: GainNode[] = BD_BANDS.map((band, b) => {
      const lo = Math.max(20, band.range[0]);
      const hi = Math.min(ctx.sampleRate / 2 - 1, band.range[1]);

      let node: AudioNode = source;

      for (let s = 0; s < STAGES; s++) {
        const hp = ctx.createBiquadFilter();
        hp.type = "highpass";
        hp.frequency.value = lo;
        hp.Q.value = FILT_Q;
        node.connect(hp);
        node = hp;
      }
      for (let s = 0; s < STAGES; s++) {
        const lp = ctx.createBiquadFilter();
        lp.type = "lowpass";
        lp.frequency.value = hi;
        lp.Q.value = FILT_Q;
        node.connect(lp);
        node = lp;
      }

      const gain = ctx.createGain();
      gain.gain.value = bdBandEnabledRef.current[b] ? 1 : 0;
      node.connect(gain);
      gain.connect(ctx.destination);

      return gain;
    });

    bdFilterGainsRef.current = gains;
  }, []);

  const bdStartMic = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      bdSetupAudio(stream);
      setBdIsActive(true);
    } catch (e) { console.error(e); }
  }, [bdSetupAudio]);

  const bdStartFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const arrayBuffer = await file.arrayBuffer();
      const ctx = new AudioContext();
      bdAudioCtxRef.current = ctx;
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      bdSourceRef.current = source;
      bdBuildFilters(ctx, source);
      source.start(0);
      setBdIsActive(true);
      bdLoop();
    } catch (err) { console.error(err); }
  }, [bdLoop, bdBuildFilters]);

  const bdLoadFromUrl = useCallback(async (url: string) => {
    try {
      const res = await fetch(url);
      const arrayBuffer = await res.arrayBuffer();
      const ctx = new AudioContext();
      bdAudioCtxRef.current = ctx;
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      bdSourceRef.current = source;
      bdBuildFilters(ctx, source);
      source.start(0);
      setBdIsActive(true);
      bdLoop();
      sessionStorage.removeItem(AUDIO_CLEANER_SESSION_KEY);
      setBdFromCleaner(null);
    } catch (err) { console.error(err); }
  }, [bdLoop, bdBuildFilters]);

  const bdStop = useCallback(() => {
    setBdIsActive(false);
    setBdIsRecording(false);
    bdIsRecordingRef.current = false;
    if (bdRafRef.current) cancelAnimationFrame(bdRafRef.current);

    const isVideo = bdUsingVideoRef.current;
    if (bdSourceRef.current instanceof AudioBufferSourceNode) {
      try { bdSourceRef.current.stop(); } catch { /* ignore */ }
    } else if (bdSourceRef.current instanceof MediaStreamAudioSourceNode) {
      bdSourceRef.current.mediaStream.getTracks().forEach(t => t.stop());
    }
    // For video mode: disconnect filter gains so audio goes silent, but
    // keep the AudioContext + MediaElementAudioSourceNode alive for reuse
    if (isVideo) {
      bdFilterGainsRef.current.forEach(g => { try { g.disconnect(); } catch { /* ignore */ } });
      try { bdAnalyserRef.current?.disconnect(); } catch { /* ignore */ }
    }

    bdSourceRef.current = null;
    bdFilterGainsRef.current = [];
    bdUsingVideoRef.current = false;
    bdAnalyserRef.current = null;
    bdAnalyserRRef.current = null;

    // Only close the AudioContext for non-video sessions
    if (!isVideo && bdAudioCtxRef.current) {
      bdAudioCtxRef.current.close();
    }
    bdAudioCtxRef.current = null;

    bdEnergyHistoryRef.current = [];
    bdBeatIntervalHistoryRef.current = [];
    bdLastBeatRef.current = 0;
    setBdBpm(0);
  }, []);

  useEffect(() => {
    return () => {
      bdStop();
      // Also close the persistent video AudioContext on unmount
      bdVideoCtxRef.current?.close();
      bdVideoCtxRef.current = null;
      bdVideoSrcRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const bdToggleRecord = useCallback(() => {
    if (!bdIsRecordingRef.current) {
      bdRecordStartRef.current = performance.now();
      bdBeatPosRef.current = 100; // first beat will be 100
      setBdPointsAdded(0);
      setBdIsRecording(true);
    } else {
      setBdIsRecording(false);
    }
  }, []);

  /** Route the already-loaded video element's audio through the band analyser for live preview.
   *  createMediaElementSource() can only be called once per element, so we persist the context
   *  and source node across stop/start cycles — only the filter graph gets rebuilt each time. */
  const bdStartVideo = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    // Stop any mic/file session first (but don't destroy the video ctx)
    if (!bdUsingVideoRef.current) bdStop();
    if (bdRafRef.current) cancelAnimationFrame(bdRafRef.current);
    try {
      // Reuse or create the persistent video AudioContext
      let ctx = bdVideoCtxRef.current;
      if (!ctx || ctx.state === "closed") {
        ctx = new AudioContext();
        bdVideoCtxRef.current = ctx;
        bdVideoSrcRef.current = null; // source must be recreated with a new context
      }
      // Reuse or create the persistent MediaElementAudioSourceNode
      let source = bdVideoSrcRef.current;
      if (!source) {
        source = ctx.createMediaElementSource(video);
        bdVideoSrcRef.current = source;
      }
      // Resume context if suspended (browser autoplay policy)
      if (ctx.state === "suspended") ctx.resume();
      bdAudioCtxRef.current = ctx;
      bdSourceRef.current = source;
      bdBuildFilters(ctx, source); // filtered audio → destination (user hears selected bands only)
      bdUsingVideoRef.current = true;
      setBdIsActive(true);
      bdLoop();
    } catch (err) { console.error("bdStartVideo:", err); }
  }, [bdLoop, bdStop, bdBuildFilters]);

  // ─────────────── Timeline drawing ───────────────

  const drawTimeline = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    const centerX = W / 2;
    const halfWindowMs = TL_ZOOM_LEVELS[tlZoomLevel] * 1000;

    // Coordinate helper: time → canvas X
    const timeToX = (t: number) => centerX + ((t - currentTime) / halfWindowMs) * centerX;

    ctx.clearRect(0, 0, W, H);

    // ── Horizontal position-axis grid ──
    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    ctx.lineWidth = 1;
    for (let i = 0; i <= 10; i++) {
      const y = (H / 10) * i;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }

    // ── Time ruler ticks ──
    const tickMs = niceTickMs(halfWindowMs);
    const startTick = Math.ceil((currentTime - halfWindowMs) / tickMs) * tickMs;
    ctx.font = "10px monospace";
    ctx.textAlign = "center";
    for (let t = startTick; t <= currentTime + halfWindowMs; t += tickMs) {
      const x = timeToX(t);
      if (x < 0 || x > W) continue;
      ctx.strokeStyle = "rgba(255,255,255,0.10)";
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H - 18); ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,0.35)";
      ctx.fillText(fmtMs(t), x, H - 4);
    }

    // ── Committed points (purple) ──
    const sorted = [...points].sort((a, b) => a.time - b.time);
    if (sorted.length > 0) {
      ctx.strokeStyle = "hsl(270,85%,60%)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      sorted.forEach((p, i) => {
        const x = timeToX(p.time);
        const y = H - (p.pos / 100) * H;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      });
      ctx.stroke();

      sorted.forEach(p => {
        const x = timeToX(p.time);
        if (x < -12 || x > W + 12) return;
        const y = H - (p.pos / 100) * H;
        const sel = selectedIds.has(p.id);
        ctx.fillStyle = sel ? "hsl(270,85%,60%)" : "#fff";
        ctx.beginPath();
        ctx.arc(x, y, sel ? 6 : 4, 0, Math.PI * 2);
        ctx.fill();
        if (sel) { ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.5; ctx.stroke(); }
      });
    }

    // ── Preview points (amber, dashed) ──
    if (vtPreviewPoints.length > 0) {
      const vsorted = [...vtPreviewPoints].sort((a, b) => a.time - b.time);
      ctx.strokeStyle = "rgba(251,191,36,0.8)";
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 3]);
      ctx.beginPath();
      vsorted.forEach((p, i) => {
        const x = timeToX(p.time);
        const y = H - (p.pos / 100) * H;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      });
      ctx.stroke();
      ctx.setLineDash([]);
      vsorted.forEach(p => {
        const x = timeToX(p.time);
        if (x < -12 || x > W + 12) return;
        const y = H - (p.pos / 100) * H;
        ctx.fillStyle = "rgba(251,191,36,0.9)";
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fill();
      });
    }

    // ── Rubber-band selection box ──
    const box = selBoxRef.current;
    if (box) {
      const rx = Math.min(box.x1, box.x2);
      const ry = Math.min(box.y1, box.y2);
      const rw = Math.abs(box.x2 - box.x1);
      const rh = Math.abs(box.y2 - box.y1);
      ctx.fillStyle = "rgba(168,85,247,0.08)";
      ctx.fillRect(rx, ry, rw, rh);
      ctx.strokeStyle = "rgba(168,85,247,0.7)";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 2]);
      ctx.strokeRect(rx, ry, rw, rh);
      ctx.setLineDash([]);
    }

    // ── Center playhead ──
    ctx.strokeStyle = "rgba(255,255,255,0.90)";
    ctx.lineWidth = 2;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(centerX, 0);
    ctx.lineTo(centerX, H);
    ctx.stroke();

    // Downward triangle at top to mark playhead
    ctx.fillStyle = "rgba(255,255,255,0.90)";
    ctx.beginPath();
    ctx.moveTo(centerX - 7, 0);
    ctx.lineTo(centerX + 7, 0);
    ctx.lineTo(centerX, 10);
    ctx.closePath();
    ctx.fill();

    // Current-time label just below the triangle
    ctx.fillStyle = "rgba(255,255,255,0.90)";
    ctx.font = "bold 11px monospace";
    ctx.textAlign = "center";
    ctx.fillText(fmtMs(currentTime), centerX, 26);

  }, [points, vtPreviewPoints, selectedIds, currentTime, tlZoomLevel]);

  useEffect(() => {
    drawTimeline();
  }, [drawTimeline]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(points));
    } catch {
      // quota exceeded or private browsing — silently ignore
    }
  }, [points]);

  // Map canvas-pixel coords ↔ time using current zoom & currentTime
  const tlCoordsForCanvas = (canvas: HTMLCanvasElement) => {
    const centerX = canvas.width / 2;
    const halfWindowMs = TL_ZOOM_LEVELS[tlZoomLevel] * 1000;
    const timeToX = (t: number) => centerX + ((t - currentTime) / halfWindowMs) * centerX;
    const xToTime = (x: number) => currentTime + ((x - centerX) / centerX) * halfWindowMs;
    return { centerX, halfWindowMs, timeToX, xToTime };
  };

  const canvasClientToCanvas = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * canvas.width,
      y: ((e.clientY - rect.top) / rect.height) * canvas.height,
    };
  };

  const getPointAtCursor = (x: number, y: number, canvas: HTMLCanvasElement) => {
    const { timeToX } = tlCoordsForCanvas(canvas);
    for (let i = points.length - 1; i >= 0; i--) {
      const p = points[i];
      const px = timeToX(p.time);
      const py = canvas.height - (p.pos / 100) * canvas.height;
      if (Math.hypot(x - px, y - py) < 10) return p;
    }
    return null;
  };

  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { x, y } = canvasClientToCanvas(e);
    const { xToTime } = tlCoordsForCanvas(canvas);
    const clickedPoint = getPointAtCursor(x, y, canvas);

    if (clickedPoint) {
      const isModifier = e.shiftKey || e.ctrlKey || e.metaKey;
      if (isModifier) {
        // Toggle this point in/out of selection without starting a drag
        setSelectedIds(prev => {
          const next = new Set(prev);
          if (next.has(clickedPoint.id)) next.delete(clickedPoint.id);
          else next.add(clickedPoint.id);
          return next;
        });
      } else {
        // If point not already selected, replace selection with just this one
        if (!selectedIds.has(clickedPoint.id)) {
          setSelectedIds(new Set([clickedPoint.id]));
        }
        // Snapshot all currently-selected point positions for group drag
        const currentSel = selectedIds.has(clickedPoint.id)
          ? selectedIds
          : new Set([clickedPoint.id]);
        dragAnchorRef.current = {
          mouseTime: xToTime(x),
          mouseY: y,
          items: pointsRef.current
            .filter(p => currentSel.has(p.id))
            .map(p => ({ id: p.id, origTime: p.time, origPos: p.pos })),
        };
        isDragging.current = true;
      }
    } else {
      // Empty space: start rubber-band (no immediate point creation)
      if (!e.shiftKey && !e.ctrlKey && !e.metaKey) {
        setSelectedIds(new Set());
      }
      selBoxRef.current = { x1: x, y1: y, x2: x, y2: y };
      isRubberBanding.current = true;
    }
  };

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { x, y } = canvasClientToCanvas(e);

    if (isDragging.current && dragAnchorRef.current) {
      const { xToTime } = tlCoordsForCanvas(canvas);
      const { mouseTime, mouseY, items } = dragAnchorRef.current;
      const deltaTime = xToTime(x) - mouseTime;
      const deltaPosRaw = ((mouseY - y) / canvas.height) * 100;
      setPoints(pts => pts.map(p => {
        const orig = items.find(it => it.id === p.id);
        if (!orig) return p;
        const newTime = Math.max(0, orig.origTime + deltaTime);
        const newPos = Math.max(0, Math.min(100, Math.round(orig.origPos + deltaPosRaw)));
        return { ...p, time: newTime, pos: newPos };
      }));
      if (realtimeTest && connected && key) {
        const anchorItem = items[0];
        if (anchorItem) {
          const newPos = Math.max(0, Math.min(100, Math.round(anchorItem.origPos + ((mouseY - y) / canvas.height) * 100)));
          setHDSP(key, newPos, 87);
        }
      }
      return;
    }

    if (isRubberBanding.current && selBoxRef.current) {
      selBoxRef.current = { ...selBoxRef.current, x2: x, y2: y };
      drawTimeline(); // immediate redraw to show the box
    }
  };

  const handleCanvasMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;

    if (isDragging.current) {
      isDragging.current = false;
      dragAnchorRef.current = null;
      return;
    }

    if (isRubberBanding.current && canvas) {
      const box = selBoxRef.current;
      isRubberBanding.current = false;
      selBoxRef.current = null;

      if (!box) return;

      const dragDist = Math.hypot(box.x2 - box.x1, box.y2 - box.y1);

      if (dragDist < 5) {
        // Treated as a click on empty space — create a new point
        if (!e.shiftKey && !e.ctrlKey && !e.metaKey) {
          const { xToTime } = tlCoordsForCanvas(canvas);
          const time = Math.max(0, xToTime(box.x1));
          const pos = Math.max(0, Math.min(100, Math.round(100 - (box.y1 / canvas.height) * 100)));
          const newPoint: Point = { id: crypto.randomUUID(), time, pos };
          setPoints(prev => [...prev, newPoint]);
          setSelectedIds(new Set([newPoint.id]));
        }
      } else {
        // Rubber-band: select all points whose canvas coords fall inside the box
        const { timeToX } = tlCoordsForCanvas(canvas);
        const xMin = Math.min(box.x1, box.x2);
        const xMax = Math.max(box.x1, box.x2);
        const yMin = Math.min(box.y1, box.y2);
        const yMax = Math.max(box.y1, box.y2);
        const inBox = pointsRef.current.filter(p => {
          const px = timeToX(p.time);
          const py = canvas.height - (p.pos / 100) * canvas.height;
          return px >= xMin && px <= xMax && py >= yMin && py <= yMax;
        });
        if (e.shiftKey || e.ctrlKey || e.metaKey) {
          setSelectedIds(prev => new Set([...prev, ...inBox.map(p => p.id)]));
        } else {
          setSelectedIds(new Set(inBox.map(p => p.id)));
        }
      }
      drawTimeline(); // clear rubber-band
    }
  };

  const exportScript = async () => {
    const sorted = [...points].sort((a, b) => a.time - b.time);
    const script = { actions: sorted.map(p => ({ at: Math.round(p.time), pos: p.pos })) };
    const json = JSON.stringify(script, null, 2);

    // Derive base name from the loaded video (strip its extension)
    const baseName = videoFileName
      ? videoFileName.replace(/\.[^/.]+$/, "")
      : "script";

    // Build versioned filename: first export = baseName.funscript,
    // subsequent exports = baseName (01).funscript, baseName (02).funscript …
    const counts = exportCountsRef.current;
    const count = counts.get(baseName) ?? 0;
    const suffix = count === 0 ? "" : ` (${String(count).padStart(2, "0")})`;
    const fileName = `${baseName}${suffix}.funscript`;
    counts.set(baseName, count + 1);

    // Try the File System Access API (Chrome / Edge) so the save dialog opens
    // pre-filled with the right name and in the same folder as the video.
    const fsa = (window as unknown as Record<string, unknown>).showSaveFilePicker;
    if (typeof fsa === "function") {
      try {
        const handle = await (fsa as (opts: unknown) => Promise<FileSystemFileHandle>)({
          suggestedName: fileName,
          types: [
            {
              description: "Funscript",
              accept: { "application/json": [".funscript"] },
            },
          ],
        });
        const writable = await handle.createWritable();
        await writable.write(json);
        await writable.close();
        markClean();
        return;
      } catch (err) {
        // User cancelled the picker — do nothing
        if ((err as { name?: string }).name === "AbortError") return;
        // Other error — fall through to anchor download
      }
    }

    // Fallback: classic anchor download (Firefox, Safari, etc.)
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
    markClean();
  };

  const deleteSelected = () => {
    if (selectedIds.size === 0) return;
    setPoints(pts => pts.filter(p => !selectedIds.has(p.id)));
    setSelectedIds(new Set());
  };

  const copySelected = () => {
    if (selectedIds.size === 0) return;
    const sel = pointsRef.current.filter(p => selectedIds.has(p.id));
    const minTime = Math.min(...sel.map(p => p.time));
    clipboardRef.current = sel.map(p => ({ relTime: p.time - minTime, pos: p.pos }));
  };

  const cutSelected = () => {
    copySelected();
    deleteSelected();
  };

  const pasteClipboard = () => {
    if (clipboardRef.current.length === 0) return;
    const anchor = currentTimeRef.current;
    const pasted: Point[] = clipboardRef.current.map(entry => ({
      id: crypto.randomUUID(),
      time: anchor + entry.relTime,
      pos: entry.pos,
    }));
    setPoints(prev => [...prev, ...pasted]);
    setSelectedIds(new Set(pasted.map(p => p.id)));
  };

  // ─── Preset pattern data ────────────────────────────────────────────────────
  const TEETH_PATTERN    = [0,75,0,75,0,75,0,75,0,100,0,100,0,100,0,100,25,100,25,100,25,100,25,100,0,100,0,100,0,100,0,100];
  const STEPS_PATTERN    = [0,65,5,70,10,75,15,80,20,85,25,90,30,95,35,100,40,100,35,95,30,90,25,85,20,80,15,75,10,70,5,65];
  const BOUNDS_PATTERN   = [0,65,10,75,20,85,30,95,40,100,40,95,30,85,20,75,10,65];
  const PULSE_PATTERN    = [100,0,100,100,0,100];
  const ALT_PATTERN      = [0,100];
  const DYNAMIC_PATTERN  = [0,100];
  const SM_TRI_PATTERN   = [0,60];
  const MED_TRI_PATTERN  = [0,80];

  /** Apply a repeating array of pos values to selected markers (sorted by time). */
  const applyPattern = (values: number[]) => {
    if (values.length === 0) return;
    const sel = [...pointsRef.current]
      .filter(p => selectedIdsRef.current.has(p.id))
      .sort((a, b) => a.time - b.time);
    if (sel.length === 0) return;
    const idxMap = new Map(sel.map((s, i) => [s.id, i]));
    setPoints(prev => prev.map(p => {
      const i = idxMap.get(p.id);
      if (i === undefined) return p;
      return { ...p, pos: values[i % values.length] };
    }));
    setShowToolsMenu(false);
    setShowPresetsPopup(false);
  };

  /** Wave: alternating 0 / smooth sine arch (range 60–100) */
  const applyWavePattern = () => {
    const sel = [...pointsRef.current]
      .filter(p => selectedIdsRef.current.has(p.id))
      .sort((a, b) => a.time - b.time);
    if (sel.length === 0) return;
    const oddCount = Math.ceil(sel.length / 2);
    const values = sel.map((_, i) => {
      if (i % 2 === 0) return 0;
      const oi = Math.floor(i / 2);
      return Math.round(80 + 20 * Math.cos(2 * Math.PI * oi / Math.max(oddCount, 1)));
    });
    const idxMap = new Map(sel.map((s, i) => [s.id, i]));
    setPoints(prev => prev.map(p => {
      const i = idxMap.get(p.id);
      if (i === undefined) return p;
      return { ...p, pos: values[i] };
    }));
    setShowToolsMenu(false);
    setShowPresetsPopup(false);
  };

  /** Custom: parse user text as comma-separated numbers */
  const applyCustomPattern = () => {
    const values = customPatternText
      .split(',')
      .map(v => Math.max(0, Math.min(100, Math.round(Number(v.trim())))))
      .filter(v => !isNaN(v));
    applyPattern(values);
  };

  /** Set all selected markers to pos=50 */
  const normalizeSelected = () => {
    if (selectedIds.size === 0) return;
    setPoints(prev => prev.map(p => selectedIds.has(p.id) ? { ...p, pos: 50 } : p));
    setShowToolsMenu(false);
  };

  /** Invert pos: 0→100, 100→0, etc. */
  const flipSelected = () => {
    if (selectedIds.size === 0) return;
    setPoints(prev => prev.map(p => selectedIds.has(p.id) ? { ...p, pos: 100 - p.pos } : p));
    setShowToolsMenu(false);
  };

  const handleVideoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setVideoUrl(URL.createObjectURL(file));
      setVideoFileName(file.name);
    }
  };

  const handleLoadVideoUrl = () => {
    const trimmed = urlInput.trim();
    if (!trimmed) {
      setUrlError("Please paste a video URL.");
      return;
    }
    const err = validateVideoUrl(trimmed);
    if (err) {
      setUrlError(err.message);
      return;
    }
    // Only direct video URLs (.mp4/.webm/.ogg/.mov) can be analyzed by the
    // <video> element. Embed hosts like YouTube/Vimeo serve HTML pages, not
    // raw video, so they cannot be used for funscript generation here.
    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      setUrlError("That doesn't look like a valid URL.");
      return;
    }
    const isDirectVideo = /\.(mp4|webm|ogg|mov)(\?.*)?$/i.test(parsed.pathname);
    if (!isDirectVideo) {
      setUrlError(
        "Only direct video file URLs (.mp4, .webm, .ogg, .mov) work in the Scripter. Embed pages like YouTube or Vimeo can't be analyzed — please download the video and load the file, or paste a direct video link."
      );
      return;
    }
    // Derive a friendly file name from the URL pathname.
    const name = decodeURIComponent(parsed.pathname.split("/").pop() || "video");
    setVideoUrl(trimmed);
    setVideoFileName(name);
    setUrlDialogOpen(false);
    setUrlInput("");
    setUrlError(null);
    toast({ title: "Video loaded", description: name });
  };

  const handleImportFunscript = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result as string);
        if (!Array.isArray(parsed?.actions)) {
          alert("Invalid .funscript file: missing actions array.");
          return;
        }
        const imported: Point[] = parsed.actions
          .filter(
            (a: unknown) =>
              a !== null &&
              typeof a === "object" &&
              typeof (a as Record<string, unknown>).at === "number" &&
              typeof (a as Record<string, unknown>).pos === "number"
          )
          .map((a: { at: number; pos: number }) => ({
            id: crypto.randomUUID(),
            time: a.at,
            pos: Math.max(0, Math.min(100, a.pos)),
          }));
        if (imported.length === 0) {
          alert("No valid actions found in the .funscript file.");
          return;
        }
        if (
          points.length === 0 ||
          window.confirm(
            `Replace current ${points.length} point(s) with ${imported.length} imported point(s)?`
          )
        ) {
          setPoints(imported);
          setSelectedIds(new Set());
          markClean(imported);
        }
      } catch {
        alert("Could not parse the file. Make sure it is a valid .funscript or JSON file.");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const updateTime = () => setCurrentTime(video.currentTime * 1000);
    video.addEventListener("timeupdate", updateTime);
    return () => video.removeEventListener("timeupdate", updateTime);
  }, [videoUrl]);

  // ─── Timeline Editor keyboard shortcuts ───
  // Active only when Timeline tab is open. Uses stable refs so the listener
  // is registered only once (no re-subscriptions on every time/point change).
  useEffect(() => {
    if (activeTab !== "timeline" || !tabsOpen) return;

    const FRAME_MS = 1000 / 30; // ≈ 33.33 ms per frame

    const addMarker = (pos: number) => {
      const t = currentTimeRef.current;
      setPoints(prev => [...prev, { id: crypto.randomUUID(), time: t, pos }]);
    };

    const seekTo = (ms: number) => {
      const video = videoRef.current;
      if (!video) return;
      video.currentTime = Math.max(0, Math.min(ms / 1000, video.duration || Infinity));
    };

    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) return;

      const pts = pointsRef.current;
      const now = currentTimeRef.current;
      const selIds = selectedIdsRef.current;
      const isMod = e.ctrlKey || e.metaKey;

      // ── Ctrl/Cmd combos ──
      if (isMod) {
        switch (e.key.toLowerCase()) {
          case "a":
            e.preventDefault();
            setSelectedIds(new Set(pts.map(p => p.id)));
            return;
          case "c": {
            e.preventDefault();
            const sel = pts.filter(p => selIds.has(p.id));
            if (sel.length === 0) return;
            const minTime = Math.min(...sel.map(p => p.time));
            clipboardRef.current = sel.map(p => ({ relTime: p.time - minTime, pos: p.pos }));
            return;
          }
          case "x": {
            e.preventDefault();
            const sel = pts.filter(p => selIds.has(p.id));
            if (sel.length === 0) return;
            const minTime = Math.min(...sel.map(p => p.time));
            clipboardRef.current = sel.map(p => ({ relTime: p.time - minTime, pos: p.pos }));
            setPoints(prev => prev.filter(p => !selIds.has(p.id)));
            setSelectedIds(new Set());
            return;
          }
          case "v": {
            e.preventDefault();
            if (clipboardRef.current.length === 0) return;
            const pasted = clipboardRef.current.map(entry => ({
              id: crypto.randomUUID(),
              time: now + entry.relTime,
              pos: entry.pos,
            }));
            setPoints(prev => [...prev, ...pasted]);
            setSelectedIds(new Set(pasted.map(p => p.id)));
            return;
          }
        }
        return; // don't fall through to digit shortcuts when Ctrl/Cmd held
      }

      switch (e.key) {
        // ── Delete / Backspace: remove selected points ──
        case "Delete":
        case "Backspace":
          if (selIds.size > 0) {
            e.preventDefault();
            setPoints(prev => prev.filter(p => !selIds.has(p.id)));
            setSelectedIds(new Set());
          }
          break;

        // ── Place marker at current time ──
        case "`": e.preventDefault(); addMarker(0);   break;
        case "1": e.preventDefault(); addMarker(10);  break;
        case "2": e.preventDefault(); addMarker(20);  break;
        case "3": e.preventDefault(); addMarker(30);  break;
        case "4": e.preventDefault(); addMarker(40);  break;
        case "5": e.preventDefault(); addMarker(50);  break;
        case "6": e.preventDefault(); addMarker(60);  break;
        case "7": e.preventDefault(); addMarker(70);  break;
        case "8": e.preventDefault(); addMarker(80);  break;
        case "9": e.preventDefault(); addMarker(90);  break;
        case "0": e.preventDefault(); addMarker(100); break;

        // ── Frame step ──
        case "ArrowLeft":  e.preventDefault(); seekTo(now - FRAME_MS); break;
        case "ArrowRight": e.preventDefault(); seekTo(now + FRAME_MS); break;

        // ── Jump between markers ──
        case "ArrowDown": {
          e.preventDefault();
          const sorted = [...pts].sort((a, b) => a.time - b.time);
          const prev = [...sorted].reverse().find(p => p.time < now - 10);
          if (prev) seekTo(prev.time);
          break;
        }
        case "ArrowUp": {
          e.preventDefault();
          const sorted = [...pts].sort((a, b) => a.time - b.time);
          const next = sorted.find(p => p.time > now + 10);
          if (next) seekTo(next.time);
          break;
        }
      }
    };

    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [activeTab, tabsOpen]); // stable: refs handle currentTime + points

  // Render reference patch to preview canvas
  useEffect(() => {
    const preview = vtPatchPreviewRef.current;
    if (!preview || !vtSampledPatch || !vtZone) return;
    const { w, h } = vtZone;
    preview.width = w;
    preview.height = h;
    const ctx = preview.getContext("2d")!;
    const img = ctx.createImageData(w, h);
    for (let i = 0; i < vtSampledPatch.length; i++) {
      const v = vtSampledPatch[i];
      img.data[i * 4] = v;
      img.data[i * 4 + 1] = v;
      img.data[i * 4 + 2] = v;
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }, [vtSampledPatch, vtZone]);

  // Track the letterbox-corrected rect of the video inside its container
  useEffect(() => {
    const container = videoContainerRef.current;
    const video = videoRef.current;
    if (!container || !video) return;
    const compute = () => {
      const cw = container.clientWidth;
      const ch = container.clientHeight;
      const vw = video.videoWidth || 0;
      const vh = video.videoHeight || 0;
      if (!vw || !vh) { setVideoRect({ left: 0, top: 0, width: cw, height: ch }); return; }
      const cAR = cw / ch;
      const vAR = vw / vh;
      let dw: number, dh: number, dx: number, dy: number;
      if (cAR > vAR) { dh = ch; dw = ch * vAR; dx = (cw - dw) / 2; dy = 0; }
      else            { dw = cw; dh = cw / vAR; dx = 0; dy = (ch - dh) / 2; }
      setVideoRect({ left: dx, top: dy, width: dw, height: dh });
    };
    const ro = new ResizeObserver(compute);
    ro.observe(container);
    video.addEventListener("loadedmetadata", compute);
    compute();
    return () => { ro.disconnect(); video.removeEventListener("loadedmetadata", compute); };
  }, [videoUrl]);

  // ─────────────── Visual Trigger ───────────────

  // VT uses the shared videoRef — no separate video needed

  const drawVtFrame = useCallback(() => {
    const canvas = vtCanvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video || !video.readyState) return;
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 360;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(video, 0, 0);
    const zone = vtDragLiveRef.current ?? vtZone;
    if (zone) {
      const { x, y, w, h } = zone;
      ctx.strokeStyle = "hsl(270,85%,60%)";
      ctx.lineWidth = Math.max(1, canvas.width / 600);
      ctx.strokeRect(x, y, w, h);
      ctx.fillStyle = "rgba(168,85,247,0.18)";
      ctx.fillRect(x, y, w, h);
      // Dimension label — shows MIN/MAX suffix when a drag clamp is active
      const MIN_VID = 10, MAX_VID = 50;
      const isDragging = vtDragLiveRef.current !== null;
      const wSuffix = isDragging ? (w <= MIN_VID ? " MIN" : w >= MAX_VID ? " MAX" : "") : "";
      const hSuffix = isDragging ? (h <= MIN_VID ? " MIN" : h >= MAX_VID ? " MAX" : "") : "";
      const label = `${w}${wSuffix}×${h}${hSuffix}`;
      const fontSize = Math.max(10, Math.round(canvas.width / 70));
      ctx.font = `bold ${fontSize}px monospace`;
      ctx.fillStyle = "hsl(270,85%,60%)";
      ctx.shadowColor = "#000";
      ctx.shadowBlur = 3;
      ctx.fillText(label, x + w + 3, y + fontSize);
      ctx.shadowBlur = 0;
    }
  }, [vtZone]);

  // Redraw VT frame whenever video position changes or zone changes
  useEffect(() => {
    if (videoUrl) drawVtFrame();
  }, [vtZone, videoUrl, currentTime, drawVtFrame]);

  // Convert a CSS-space drag rect into video pixel coords.
  // Size is clamped to [10, 50] video pixels AFTER applying the canvas→video
  // scale, so the constraint is always in native video resolution space.
  const cssDragToZone = useCallback((
    startCssX: number, startCssY: number,
    endCssX: number, endCssY: number,
    canvas: HTMLCanvasElement
  ) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const MIN_VID = 10;
    const MAX_VID = 50;
    const rawCssW = endCssX - startCssX;
    const rawCssH = endCssY - startCssY;
    const absCssW = Math.abs(rawCssW);
    const absCssH = Math.abs(rawCssH);
    const cssTlX = rawCssW >= 0 ? startCssX : startCssX - absCssW;
    const cssTlY = rawCssH >= 0 ? startCssY : startCssY - absCssH;
    // Clamp in video-pixel space
    const vidW = Math.min(MAX_VID, Math.max(MIN_VID, Math.round(absCssW * scaleX)));
    const vidH = Math.min(MAX_VID, Math.max(MIN_VID, Math.round(absCssH * scaleY)));
    return {
      x: Math.max(0, Math.round(cssTlX * scaleX)),
      y: Math.max(0, Math.round(cssTlY * scaleY)),
      w: vidW,
      h: vidH,
    };
  }, []);

  const handleVtPointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = vtCanvasRef.current;
    if (!canvas) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const rect = canvas.getBoundingClientRect();
    vtDragStartRef.current = { cssX: e.clientX - rect.left, cssY: e.clientY - rect.top };
    vtDragLiveRef.current = null;
    setVtDragging(true);
    setVtZone(null);
    setVtSampledPatch(null);
  }, []);

  const handleVtPointerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!vtDragging || !vtDragStartRef.current) return;
    const canvas = vtCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const zone = cssDragToZone(
      vtDragStartRef.current.cssX, vtDragStartRef.current.cssY,
      e.clientX - rect.left, e.clientY - rect.top, canvas
    );
    vtDragLiveRef.current = zone;
    drawVtFrame();
  }, [vtDragging, cssDragToZone, drawVtFrame]);

  const handleVtPointerUp = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!vtDragging || !vtDragStartRef.current) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    const canvas = vtCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const zone = cssDragToZone(
      vtDragStartRef.current.cssX, vtDragStartRef.current.cssY,
      e.clientX - rect.left, e.clientY - rect.top, canvas
    );
    vtDragLiveRef.current = null;
    setVtZone(zone);
    setVtDragging(false);
    vtDragStartRef.current = null;
  }, [vtDragging, cssDragToZone]);

  /** Convert RGBA ImageData pixels to a Uint8Array of grayscale (luma) values */
  const toGray = (rgba: Uint8ClampedArray): Uint8Array => {
    const gray = new Uint8Array(rgba.length / 4);
    for (let i = 0; i < rgba.length; i += 4)
      gray[i >> 2] = Math.round(0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]);
    return gray;
  };

  /** RMS pixel difference between two same-length grayscale arrays (0=identical, 255=max diff) */
  const patchRms = (a: Uint8Array, b: Uint8Array): number => {
    let sum = 0;
    for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; sum += d * d; }
    return Math.sqrt(sum / (a.length || 1));
  };

  const samplePatch = () => {
    const video = videoRef.current;
    if (!video || !vtZone) return;
    const off = document.createElement("canvas");
    off.width = video.videoWidth || 640;
    off.height = video.videoHeight || 360;
    const ctx = off.getContext("2d")!;
    ctx.drawImage(video, 0, 0);
    const { x, y, w, h } = vtZone;
    const rgba = ctx.getImageData(x, y, w, h).data;
    const gray = toGray(rgba);
    setVtSampledPatch(gray);
    // Feed the reference into whichever matcher is active
    try { glRef.current?.setReference(gray, w, h); } catch { /* ignore */ }
  };

  /**
   * Range levels sorted from widest stroke to narrowest.
   * Each entry is [lo, hi]; stroke size = hi - lo.
   * Rule: each trigger = one movement of strokeSize.
   * Max total movement in any 1-second window must stay ≤ 400.
   */
  const VT_RANGE_LEVELS: [number, number][] = [
    [0, 100], // 100 — up to 4 triggers/sec
    [0,  95], //  95
    [5,  95], //  90
    [5,  90], //  85
    [10, 90], //  80 — up to 5 triggers/sec
    [10, 85], //  75
    [15, 85], //  70
    [15, 80], //  65
    [20, 80], //  60
    [20, 75], //  55
    [25, 75], //  50
    [25, 70], //  45
    [30, 70], //  40
    [30, 65], //  35
    [35, 65], //  30
    [35, 60], //  25
    [40, 60], //  20
    [40, 55], //  15
    [45, 55], //  10
    [45, 50], //   5
    [50, 50], //   0 — last resort
  ];

  const [analyzeMode, setAnalyzeMode] = useState<"webgpu" | "webgl" | "cpu">("cpu");

  const cancelAnalysis = () => {
    vtCancelRef.current = true;
    if (videoRef.current) videoRef.current.pause();
  };

  const runAnalysis = async () => {
    const video = videoRef.current;
    if (!video || !vtZone || !vtSampledPatch) return;

    vtCancelRef.current = false;
    setVtAnalyzing(true);
    setVtProgress(0);
    setVtPreviewPoints([]);

    // Outer try/finally guarantees setVtAnalyzing(false) on every exit path,
    // including worker init failure, frame errors, and unexpected throws.
    try {
      await runAnalysisInner(video);
    } catch (err) {
      console.error("[VideoAnalysis] scan failed:", err);
    } finally {
      setVtAnalyzing(false);
    }
  };

  const runAnalysisInner = async (video: HTMLVideoElement) => {
    const { x, y, w, h } = vtZone!;
    const VW = video.videoWidth || 640;
    const VH = video.videoHeight || 360;
    const nx = x / VW, ny = y / VH, nw = w / VW, nh = h / VH;

    const startMs = vtStartTime * 1000;
    const endMs   = vtEndTime > 0 ? vtEndTime * 1000 : video.duration * 1000;
    const stepMs  = 1000 / 30; // 30 fps analysis resolution
    const rangeMs = endMs - startMs;

    // ── Spin up the dedicated analysis worker ─────────────────────────────────
    // The worker owns the full state machine: frame scheduling decisions (stepMs
    // gating), RMS computation, trigger detection, and progress calculation.
    //
    // The main thread is intentionally a thin frame pump.  It performs only the
    // DOM-bound work that cannot run in a worker:
    //   • video seeking  (video.currentTime — HTMLVideoElement property)
    //   • rVFC scheduling (video.requestVideoFrameCallback — HTMLVideoElement method)
    //   • frame capture  (createImageBitmap(video) — requires live video element)
    // Everything else lives in the worker.
    const worker = new Worker(
      new URL("../workers/frame-analysis.worker.ts", import.meta.url),
      { type: "module" },
    );

    // ── Pipelined message handler ─────────────────────────────────────────────
    // The rVFC loop no longer waits for a worker reply before registering the
    // next frame callback.  Instead the main thread keeps up to PIPELINE_DEPTH
    // frames in-flight simultaneously: capture → send → re-register immediately,
    // while the worker processes each frame and replies asynchronously.
    //
    // Each in-flight frame is tracked by its frameMs timestamp in pendingFrames.
    // The worker echoes frameMs on every 'progress' and 'frame-skip' reply so
    // we can resolve the correct promise without relying on ordering.
    //
    // A semaphore (pipelineSlots) caps concurrent in-flight frames to prevent
    // unbounded ImageBitmap memory accumulation when the worker is slower than
    // the rVFC delivery rate.
    const PIPELINE_DEPTH = 4;

    // frameMs → { resolve, reject } for in-flight sendFrame promises
    const pendingFrames = new Map<number, { resolve: () => void; reject: (e: Error) => void }>();

    // Semaphore: tracks free pipeline slots
    let freeSlots = PIPELINE_DEPTH;
    const slotWaiters: Array<() => void> = [];

    const acquireSlot = (): Promise<void> => {
      if (freeSlots > 0) { freeSlots--; return Promise.resolve(); }
      return new Promise<void>(res => slotWaiters.push(res));
    };
    const releaseSlot = (): void => {
      const waiter = slotWaiters.shift();
      if (waiter) { waiter(); } else { freeSlots++; }
    };

    let resolveComplete: ((t: number[]) => void) | null = null;
    let rejectComplete:  ((e: Error) => void)    | null = null;
    let resolveInit:     (() => void)            | null = null;
    let rejectInit:      ((e: Error) => void)    | null = null;

    const rejectAll = (err: Error) => {
      rejectInit?.(err);     resolveInit     = null; rejectInit     = null;
      rejectComplete?.(err); resolveComplete = null; rejectComplete = null;
      for (const { reject } of pendingFrames.values()) reject(err);
      pendingFrames.clear();
      // Drain semaphore waiters so any blocked acquireSlot calls reject cleanly
      slotWaiters.splice(0).forEach(w => w());
    };

    worker.onmessage = (e: MessageEvent) => {
      switch (e.data.type as string) {
        case "ready":
          setAnalyzeMode(e.data.mode as "webgpu" | "webgl" | "cpu");
          resolveInit?.(); resolveInit = null; rejectInit = null;
          break;
        case "mode-changed": {
          const newMode = e.data.mode as "webgpu" | "webgl" | "cpu";
          const lostMode = e.data.reason as string;
          setAnalyzeMode(newMode);
          toast({
            title: `${lostMode === "webgpu" ? "WebGPU" : "WebGL"} lost — switched to CPU`,
            description: "GPU device was lost mid-scan. Analysis will continue using the CPU.",
            variant: "destructive",
          });
          break;
        }
        case "progress": {
          // Worker finished analysing a frame — drive the progress badge and
          // unblock the corresponding pipeline slot.
          setVtProgress(e.data.percent as number);
          const p = pendingFrames.get(e.data.frameMs as number);
          if (p) { pendingFrames.delete(e.data.frameMs as number); p.resolve(); }
          releaseSlot();
          break;
        }
        case "frame-skip": {
          // Worker skipped this frame (too close to the previous analysed one);
          // unblock the pipeline slot so the next frame can be sent.
          const p = pendingFrames.get(e.data.frameMs as number);
          if (p) { pendingFrames.delete(e.data.frameMs as number); p.resolve(); }
          releaseSlot();
          break;
        }
        case "complete":
          resolveComplete?.(e.data.triggerTimes as number[]);
          resolveComplete = null; rejectComplete = null;
          break;
        case "error":
          rejectAll(new Error(e.data.message as string));
          break;
      }
    };

    // Reject all pending promises if the worker crashes or fails to load.
    worker.onerror = (e) => {
      rejectAll(new Error(`Worker error: ${e.message ?? "unknown"}`));
    };
    worker.onmessageerror = () => {
      rejectAll(new Error("Worker message deserialisation error"));
    };

    // ── RPC helpers ───────────────────────────────────────────────────────────

    // Post one frame bitmap to the worker and track its reply promise.
    // The caller is responsible for acquiring a pipeline slot before calling
    // this, and must NOT await the returned promise in the hot rVFC path —
    // fire-and-forget with a .catch() handler to keep the loop pipelined.
    const sendFrame = (bitmap: ImageBitmap, frameMs: number): Promise<void> =>
      new Promise<void>((res, rej) => {
        pendingFrames.set(frameMs, { resolve: res, reject: rej });
        worker.postMessage({ type: "frame", bitmap, frameMs }, [bitmap]);
      });

    // Signal end of scan; receive the accumulated trigger times from the worker.
    const collectResults = (): Promise<number[]> =>
      new Promise<number[]>((res, rej) => {
        resolveComplete = res; rejectComplete = rej;
        worker.postMessage({ type: "end" });
      });

    // Wait for all pipelined in-flight frames to receive their worker replies
    // before sending 'end'.  We do this by acquiring every slot — once we hold
    // all PIPELINE_DEPTH slots the pipeline is fully drained.
    const drainPipeline = async (): Promise<void> => {
      const drains: Promise<void>[] = [];
      for (let i = 0; i < PIPELINE_DEPTH; i++) drains.push(acquireSlot());
      await Promise.all(drains);
      // Release them all so the semaphore is clean for any future use.
      for (let i = 0; i < PIPELINE_DEPTH; i++) releaseSlot();
    };

    // Initialise the worker: sets up GPU/CPU path and all scan parameters.
    // Worker replies with { type: 'ready', mode } once it is ready.
    await new Promise<void>((res, rej) => {
      resolveInit = res; rejectInit = rej;
      worker.postMessage({
        type: "init",
        refPatch: vtSampledPatch,
        patchW: w, patchH: h,
        startMs, endMs, rangeMs, stepMs,
        tolerance: vtTolerance,
        minDelay:  vtMinDelay,
        frameDebounce: vtFrameDebounce,
        nx, ny, nw, nh,
      });
    });

    const hasRvfc = "requestVideoFrameCallback" in HTMLVideoElement.prototype;

    // Save video state so we can restore it after analysis
    const savedRate   = video.playbackRate;
    const savedMuted  = video.muted;
    const savedTime   = video.currentTime;
    const savedPaused = video.paused;

    let triggerTimes: number[] = [];

    try {
      if (hasRvfc) {
        // ─── FAST PATH: play at high speed, catch frames via rVFC ───────────
        // Main thread: seek → play → capture bitmap → send to worker (repeat).
        // The worker decides which frames are worth analysing (stepMs gating)
        // and replies with 'progress' (analysed) or 'frame-skip' (too close).
        video.currentTime = startMs / 1000;
        await new Promise<void>(res => {
          const fn = () => { video.removeEventListener("seeked", fn); res(); };
          video.addEventListener("seeked", fn);
        });

        video.muted = true;
        video.playbackRate = 16;

        await new Promise<void>((resolve, reject) => {
          let done = false;

          const finish = () => {
            if (done) return;
            done = true;
            video.pause();
            video.removeEventListener("ended", finish);
            resolve();
          };

          // Safety net: if the video hits its natural end the rVFC stops firing.
          video.addEventListener("ended", finish, { once: true });

          // processFrame is the main-thread rVFC callback — kept intentionally
          // thin.  The worker owns all frame scheduling and analysis decisions.
          //
          // Pipeline: we acquire a slot (throttles to PIPELINE_DEPTH in-flight
          // frames), capture the bitmap, post to the worker, then immediately
          // re-register the next rVFC callback WITHOUT waiting for the worker
          // reply.  The worker reply (progress/frame-skip) releases the slot
          // asynchronously, so up to PIPELINE_DEPTH frames are in-flight at
          // once — the main thread is never idle waiting for the worker.
          const processFrame = async (_now: number, meta: { mediaTime: number }) => {
            if (done || vtCancelRef.current) { finish(); return; }
            const frameMs = meta.mediaTime * 1000;

            if (frameMs >= endMs) {
              finish();
              return;
            }

            // Throttle: block here only when all pipeline slots are occupied.
            // This keeps at most PIPELINE_DEPTH ImageBitmaps alive at once.
            await acquireSlot();
            if (done) { releaseSlot(); return; }

            let bmp: ImageBitmap;
            try {
              // createImageBitmap is DOM-only; must stay on main thread.
              bmp = await createImageBitmap(video);
            } catch (err) {
              // Slot was acquired but no sendFrame will be called, so release
              // manually before propagating the error.
              releaseSlot();
              console.error("[VideoAnalysis] frame capture error:", err);
              reject(err);
              finish();
              return;
            }

            if (done) { releaseSlot(); bmp.close(); return; }

            // Fire-and-forget: post to worker, do NOT await the reply.
            // The reply handler (progress/frame-skip) releases the slot.
            sendFrame(bmp, frameMs).catch(err => {
              console.error("[VideoAnalysis] frame error:", err);
              reject(err);
              finish();
            });

            // Re-register immediately — this is the key pipelining step:
            // the next frame is captured while the worker processes this one.
            if (!done) (video as any).requestVideoFrameCallback(processFrame);
          };

          (video as any).requestVideoFrameCallback(processFrame);
          video.play().catch((err) => { reject(err); finish(); });
        });

      } else {
        // ─── FALLBACK: seek-based loop (works in all browsers) ──────────────
        // Main thread drives seeking (video.currentTime is DOM-only).
        // The worker receives each seeked frame and handles analysis.
        // Seeking is the bottleneck here so pipelining is minimal, but we
        // still go through acquireSlot/sendFrame to share the same tracking.
        let t = startMs;
        while (t <= endMs && !vtCancelRef.current) {
          video.currentTime = t / 1000;
          await new Promise<void>(res => {
            const fn = () => { video.removeEventListener("seeked", fn); res(); };
            video.addEventListener("seeked", fn);
          });

          if (vtCancelRef.current) break;

          const bmp = await createImageBitmap(video);
          await acquireSlot();
          // sendFrame adds the frame to pendingFrames; the message handler
          // resolves the promise AND calls releaseSlot() on reply, so we
          // must NOT call releaseSlot() ourselves — just await the promise.
          await sendFrame(bmp, t);

          t += stepMs;
        }
      }

      // Drain pipeline: wait for all in-flight frames before sending 'end'.
      await drainPipeline();

      // Signal end of scan; worker replies with all accumulated trigger times.
      // Skipped when cancelled — partial results are discarded.
      if (!vtCancelRef.current) {
        triggerTimes = await collectResults();
      }

    } finally {
      // Restore video to its previous state
      video.muted        = savedMuted;
      video.playbackRate = savedRate;
      video.currentTime  = savedTime;
      if (!savedPaused) video.play().catch(() => {});

      // Tear down the analysis worker
      worker.postMessage({ type: "destroy" });
      worker.terminate();
    }

    // ── Post-processing (skipped on cancellation) ─────────────────────────────
    if (vtCancelRef.current) return;

    // Commit all detections at the neutral midpoint — one pos value per trigger.
    setVtPreviewPoints(triggerTimes.map(time => ({
      id: crypto.randomUUID(),
      time,
      pos: 50,
    })));

    // Pass 2 — find the densest 1-second window.
    let maxInWindow = 0;
    for (let i = 0; i < triggerTimes.length; i++) {
      let count = 1;
      for (let j = i + 1; j < triggerTimes.length && triggerTimes[j] - triggerTimes[i] < 1000; j++) count++;
      maxInWindow = Math.max(maxInWindow, count);
    }

    // Pass 3 — choose the widest range level where maxInWindow × strokeSize ≤ vtMovementLimit.
    //          Hard floor: never collapse past 20↔80 (stroke = 60).
    let lo = 0, hi = 100;
    if (maxInWindow > 0) {
      const maxStroke = Math.floor(vtMovementLimit / maxInWindow);
      const chosen = VT_RANGE_LEVELS.filter(([l, h]) => h - l >= 60)
                                     .find(([l, h]) => h - l <= maxStroke);
      if (chosen) { [lo, hi] = chosen; }
      else { lo = 20; hi = 80; }
    }
    setVtChosenRange([lo, hi]);

    // Pass 4 — redistribute: replace every pos=50 placeholder with alternating hi/lo.
    setVtPreviewPoints(prev =>
      prev.map((pt, i) => ({ ...pt, pos: i % 2 === 0 ? hi : lo }))
    );
  };

  const commitPreviewPoints = () => {
    setPoints(prev => [...prev, ...vtPreviewPoints]);
    setVtPreviewPoints([]);
  };

  if (usageState === "checking") {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (usageState === "blocked") {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <div className="flex flex-col items-center gap-4 text-center max-w-sm">
          <div className="h-16 w-16 rounded-full bg-primary/10 border border-primary/30 flex items-center justify-center">
            <Lock className="h-7 w-7 text-primary" />
          </div>
          <div>
            <h2 className="text-xl font-bold">Daily limit reached</h2>
            <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
              Free accounts can open <strong>2 Scripter sessions per day</strong>. You've used both for today.
              Come back tomorrow or upgrade for unlimited access.
            </p>
          </div>
          <Link href="/upgrade">
            <Button className="gap-2">
              <Crown className="h-4 w-4" />
              Upgrade for unlimited access
            </Button>
          </Link>
          <p className="text-xs text-muted-foreground">Resets daily at midnight UTC</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-2 px-3 h-full flex flex-col max-w-[1600px] mx-auto gap-2">
      {/* Header */}
      <div className="flex justify-between items-center flex-shrink-0">
        <h1 className="text-lg font-bold tracking-tight">Scripter</h1>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              if (points.length === 0 || window.confirm("Start a new script? All unsaved points will be cleared.")) {
                const empty: Point[] = [];
                setPoints(empty);
                setSelectedIds(new Set());
                setActiveDraftSlot(null);
                try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
                markClean(empty);
              }
            }}
            data-testid="button-new-script"
          >
            <FilePlus className="mr-1.5 h-3.5 w-3.5" /> New Script
          </Button>
          <Button size="sm" onClick={() => setSaveDialogOpen(true)} disabled={points.length === 0} data-testid="button-export-script">
            <BookmarkPlus className="mr-1.5 h-3.5 w-3.5" /> Save Script
          </Button>
        </div>
      </div>

      {/* ── Shared video player — takes 2/3 of available height ── */}
      <div ref={videoBlockRef} className={`flex flex-row rounded-lg border border-border/50 overflow-hidden min-h-0 ${vtAnalyzing ? "hidden" : ""}`} style={{ flex: 2 }}>
        {/* Left sidebar: load/import controls */}
        <div className="w-36 flex-shrink-0 bg-card/50 border-r border-border/50 flex flex-col gap-1.5 p-2">
          <Button size="sm" className="relative cursor-pointer w-full justify-start text-xs h-7">
            <Upload className="mr-1.5 h-3 w-3 flex-shrink-0" />
            <span className="truncate">Load Video</span>
            <input type="file" accept="video/*" className="absolute inset-0 opacity-0 cursor-pointer" onChange={handleVideoUpload} />
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="w-full justify-start text-xs h-7"
            onClick={() => { setUrlError(null); setUrlDialogOpen(true); }}
            data-testid="button-paste-video-url"
          >
            <Link2 className="mr-1.5 h-3 w-3 flex-shrink-0" /> Paste URL
          </Button>
          <Button variant="outline" size="sm" className="relative cursor-pointer w-full justify-start text-xs h-7" data-testid="button-import-funscript">
            <Download className="mr-1.5 h-3 w-3 flex-shrink-0" /><span className="truncate">Import .funscript</span>
            <input type="file" accept=".funscript,.json,application/json" className="absolute inset-0 opacity-0 cursor-pointer" onChange={handleImportFunscript} />
          </Button>
          <div className="mt-auto pt-2 border-t border-border/50">
            <label className="flex items-center gap-1.5 text-[11px] cursor-pointer leading-tight">
              <input
                type="checkbox"
                checked={realtimeTest}
                onChange={e => setRealtimeTest(e.target.checked)}
                className="rounded border-border bg-black flex-shrink-0"
              />
              Real-time Test
            </label>
          </div>
        </div>
        {/* Video + controls */}
        <div className="flex-1 flex flex-col min-h-0 min-w-0">
        {/* Video */}
        <div ref={videoContainerRef} className="flex-1 min-h-0 bg-black relative">
          <video
            ref={videoRef}
            src={videoUrl ?? undefined}
            crossOrigin="anonymous"
            className="w-full h-full object-contain"
            preload="auto"
            onLoadedData={e => { const v = e.currentTarget; v.currentTime = 0; v.pause(); }}
            onLoadedMetadata={e => setVtEndTime(Math.round(e.currentTarget.duration))}
            onError={() => {
              if (videoUrl && /^https?:/.test(videoUrl)) {
                toast({
                  variant: "destructive",
                  title: "Couldn't load video",
                  description: "The host may not allow direct playback (CORS) or the file is unavailable. Try downloading and loading the file instead.",
                });
              }
            }}
          />
          {!videoUrl && (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground gap-2">
              <Upload className="h-8 w-8 opacity-30" />
              <span className="text-sm">Load a video to get started</span>
            </div>
          )}
          {/* VT zone-picker overlay — only shown on Visual Trigger tab */}
          {activeTab === "visual" && videoUrl && (
            <canvas
              ref={vtCanvasRef}
              className="absolute z-10"
              style={{
                left: videoRect.left,
                top: videoRect.top,
                width: videoRect.width,
                height: videoRect.height,
                cursor: vtDragging ? "crosshair" : "crosshair",
              }}
              onPointerDown={handleVtPointerDown}
              onPointerMove={handleVtPointerMove}
              onPointerUp={handleVtPointerUp}
              onPointerLeave={handleVtPointerUp}
            />
          )}
          {activeTab === "visual" && videoUrl && !vtZone && !vtDragging && (
            <div className="absolute bottom-2 left-1/2 -translate-x-1/2 bg-black/70 text-xs text-muted-foreground px-3 py-1 rounded-full pointer-events-none z-20">
              Click and drag on the video to draw sampling zone (10–50 video px)
            </div>
          )}
        </div>
        {/* Controls bar */}
        <div className="bg-card/60 border-t border-border/50 px-3 py-1.5 flex-shrink-0">
          <VideoControlBar
            videoRef={videoRef}
            containerRef={videoBlockRef}
            isEditor
            markers={[...points].sort((a, b) => a.time - b.time).map(p => p.time)}
          />
        </div>
        </div>{/* end Video + controls */}
      </div>

      {/* ── Tabs — collapsible tool panel ── */}
      <Tabs
        value={activeTab}
        onValueChange={v => { setActiveTab(v as "beat" | "timeline" | "visual"); setTabsOpen(true); }}
        className="flex flex-col min-h-0 flex-shrink-0"
        style={tabsOpen ? { flex: 1, minHeight: 0 } : {}}
      >
        <TabsList className="bg-card/50 w-full flex-shrink-0 flex justify-between items-center h-9 px-1">
          <div className="flex">
            <TabsTrigger value="beat" className="text-xs h-7">Beat Detector</TabsTrigger>
            <TabsTrigger value="timeline" className="text-xs h-7">Timeline Editor</TabsTrigger>
            <TabsTrigger value="visual" className="text-xs h-7">Visual Trigger</TabsTrigger>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 ml-auto text-muted-foreground hover:text-foreground"
            onClick={() => setTabsOpen(o => !o)}
            title={tabsOpen ? "Collapse tools" : "Expand tools"}
          >
            {tabsOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
          </Button>
        </TabsList>

        {tabsOpen && <>
        {/* Beat Detector Tab */}
        <TabsContent value="beat" className="flex-1 flex gap-3 mt-3 min-h-0 overflow-hidden">
          {/* Spectrum canvas + band toggles */}
          <div className="flex-1 flex flex-col gap-2 min-h-0">
            {/* Audio Cleaner handoff banner */}
            {bdFromCleaner && (
              <div className="flex-shrink-0 flex items-center gap-3 bg-primary/10 border border-primary/40 rounded-lg px-3 py-2">
                <Activity className="h-4 w-4 text-primary flex-shrink-0" />
                <span className="text-sm text-primary flex-1">Cleaned audio ready from Audio Cleaner</span>
                <Button
                  size="sm"
                  className="h-7 text-xs gap-1.5 flex-shrink-0"
                  onClick={() => bdLoadFromUrl(bdFromCleaner)}
                >
                  Load into Beat Detector
                </Button>
                <button
                  className="text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
                  onClick={() => {
                    sessionStorage.removeItem(AUDIO_CLEANER_SESSION_KEY);
                    setBdFromCleaner(null);
                  }}
                  title="Dismiss"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}
            <div className="flex-1 bg-black rounded-lg border border-border/50 overflow-hidden relative min-h-0">
              <canvas ref={bdCanvasRef} className="w-full h-full absolute inset-0" width={800} height={300} />
              {!bdIsActive && (
                <div className="absolute inset-0 flex items-center justify-center text-muted-foreground text-sm">
                  Select an input source to begin
                </div>
              )}
              {bdIsRecording && (
                <div className="absolute top-3 left-3 flex items-center gap-2 bg-red-600/90 text-white text-xs font-bold px-3 py-1.5 rounded-full">
                  <span className="h-2 w-2 rounded-full bg-white animate-pulse inline-block" /> REC · {bdPointsAdded} points
                </div>
              )}
            </div>

            {/* 7-band EQ toggles */}
            <div className="flex gap-1.5 flex-shrink-0">
              {BD_BANDS.map((band, i) => {
                const on = bdBandEnabled[i];
                return (
                  <button
                    key={band.label}
                    className="flex-1 rounded-md border text-[10px] font-bold tracking-wide py-1.5 transition-all select-none"
                    style={{
                      borderColor: on ? band.color : "rgba(255,255,255,0.08)",
                      background: on ? band.color + "22" : "rgba(0,0,0,0.4)",
                      color: on ? band.color : "rgba(255,255,255,0.25)",
                    }}
                    onClick={() => setBdBandEnabled(prev => {
                      const activeCount = prev.filter(Boolean).length;
                      const isSoloed = activeCount === 1 && prev[i];
                      if (isSoloed) return Array(7).fill(true); // already solo → reset to all
                      return prev.map((_, j) => j === i);       // solo this band
                    })}
                    title={`${band.label}: ${band.range[0]}–${band.range[1]} Hz · click to solo`}
                  >
                    <div>{band.label}</div>
                    <div className="font-mono font-normal text-[8px] opacity-70 leading-tight">
                      {band.range[0] >= 1000 ? `${band.range[0]/1000}k` : band.range[0]}–{band.range[1] >= 1000 ? `${band.range[1]/1000}k` : band.range[1]}
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Quick-select helpers */}
            <div className="flex gap-2 flex-shrink-0 text-[10px] flex-wrap">
              <span className="text-muted-foreground/40 italic">Click band to solo · click again to reset</span>
              <span className="text-border">·</span>
              <button
                className="text-muted-foreground hover:text-primary transition-colors"
                onClick={() => setBdBandEnabled(Array(11).fill(true))}
              >All</button>
              <span className="text-border">|</span>
              {[
                { label: "Kick",   mask: [true,true,false,false,false,false,false,false,false,false,false] },
                { label: "Snare",  mask: [false,false,true,true,true,false,false,false,false,false,false] },
                { label: "Hi-hat", mask: [false,false,false,false,false,false,false,true,true,true,true] },
              ].map(preset => (
                <button
                  key={preset.label}
                  className="text-muted-foreground hover:text-primary transition-colors"
                  onClick={() => setBdBandEnabled(preset.mask)}
                >{preset.label}</button>
              ))}
            </div>
          </div>

          {/* Controls panel */}
          <div className="w-56 flex flex-col gap-3 overflow-auto flex-shrink-0">
            <Card className="bg-card/50 border-border/50 flex-shrink-0">
              <CardContent className="pt-3 pb-3 space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Input Source</p>
                {bdIsActive ? (
                  <div className="space-y-2">
                    <Button variant="destructive" size="sm" className="w-full" onClick={bdStop}>
                      <Square className="mr-2 h-3.5 w-3.5" /> Stop Audio
                    </Button>
                    {bdUsingVideoRef.current && (
                      <p className="text-[10px] text-center text-primary/70">
                        Analysing video audio · play the video to see spectrum
                      </p>
                    )}
                  </div>
                ) : (
                  <>
                    {/* Video audio — only show when a video is loaded */}
                    {videoUrl && (
                      <Button
                        variant="outline-primary"
                        size="sm"
                        className="w-full"
                        onClick={bdStartVideo}
                      >
                        <span className="mr-2 text-base leading-none">▶</span>Use Video Audio
                      </Button>
                    )}
                    <Button size="sm" className="w-full" onClick={bdStartMic}>
                      <Mic className="mr-2 h-3.5 w-3.5" /> Use Microphone
                    </Button>
                    <Button size="sm" className="w-full relative cursor-pointer">
                      <Upload className="mr-2 h-3.5 w-3.5" /><span>Upload Audio File</span>
                      <input type="file" accept="audio/*" className="absolute inset-0 opacity-0 cursor-pointer" onChange={bdStartFile} />
                    </Button>
                    {!videoUrl && (
                      <p className="text-[10px] text-muted-foreground/50 text-center">
                        Load a video in the Player to use video audio
                      </p>
                    )}
                  </>
                )}
              </CardContent>
            </Card>

            <Card className="bg-card/50 border-primary/20 flex-shrink-0">
              <CardContent className="pt-3 pb-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">BPM</span>
                  <span className="text-2xl font-bold font-mono text-primary">{bdBpm > 0 ? bdBpm : "—"}</span>
                </div>
                <Button
                  size="sm"
                  className="w-full"
                  variant={bdIsRecording ? "destructive" : "default"}
                  disabled={!bdIsActive}
                  onClick={bdToggleRecord}
                >
                  {bdIsRecording ? (
                    <><Square className="mr-2 h-3.5 w-3.5" /> Stop</>
                  ) : (
                    <><span className="mr-1.5 text-sm leading-none">●</span> Record to Script</>
                  )}
                </Button>
                {bdPointsAdded > 0 && !bdIsRecording && (
                  <p className="text-[10px] text-center text-muted-foreground">{bdPointsAdded} pts added → Timeline Editor</p>
                )}
              </CardContent>
            </Card>

            <Card className="bg-card/50 border-border/50 flex-shrink-0">
              <CardContent className="pt-3 pb-3 space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Sensitivity</span>
                  <span className="font-mono text-primary text-xs">{bdSensitivity.toFixed(1)}×</span>
                </div>
                <Slider min={1.0} max={3.0} step={0.1} value={[bdSensitivity]} onValueChange={v => setBdSensitivity(v[0])} />
              </CardContent>
            </Card>

            {/* Band Cleaner card */}
            <Card className="bg-card/50 border-primary/20 flex-shrink-0">
              <CardContent className="pt-3 pb-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Band Cleaner</span>
                  {bdCleanBand !== null && (
                    <button
                      className="text-[9px] text-muted-foreground hover:text-foreground transition-colors"
                      onClick={() => {
                        setBdCleanBand(null);
                        setBdBandEnabled(Array(11).fill(true));
                      }}
                      title="Clear band selection"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>
                <p className="text-[10px] text-muted-foreground leading-snug">
                  Pick a band to isolate, then enable cleaners to filter before beat detection.
                </p>

                {/* Band picker — two rows of pills */}
                <div className="grid grid-cols-4 gap-1">
                  {BD_BANDS.map((band, i) => {
                    const isSelected = bdCleanBand === i;
                    return (
                      <button
                        key={band.label}
                        className="rounded text-[9px] font-bold py-1 transition-all leading-tight"
                        style={{
                          borderWidth: 1,
                          borderStyle: "solid",
                          borderColor: isSelected ? band.color : "rgba(255,255,255,0.08)",
                          background: isSelected ? band.color + "33" : "rgba(0,0,0,0.3)",
                          color: isSelected ? band.color : "rgba(255,255,255,0.3)",
                        }}
                        onClick={() => {
                          if (isSelected) {
                            setBdCleanBand(null);
                            setBdBandEnabled(Array(11).fill(true));
                          } else {
                            setBdCleanBand(i);
                          }
                        }}
                        title={`${band.label}: ${band.range[0]}–${band.range[1]} Hz`}
                      >
                        {band.label}
                      </button>
                    );
                  })}
                </div>

                {/* Cleaner toggles — only shown when a band is selected */}
                {bdCleanBand !== null && (
                  <div className="space-y-1.5 pt-1 border-t border-border/40">
                    {(
                      [
                        { key: "vocalRemoval" as const, label: "Vocal Removal", desc: "Phase-cancels center-panned vocals" },
                        { key: "impactSuppression" as const, label: "Impact Suppression", desc: "Limits sharp transient peaks" },
                        { key: "screamSuppression" as const, label: "Scream Suppression", desc: "Hi-freq rolloff + peak limiter" },
                      ]
                    ).map(({ key, label, desc }) => (
                      <label key={key} className="flex items-start gap-2 cursor-pointer group">
                        <div className="mt-0.5 relative flex-shrink-0">
                          <input
                            type="checkbox"
                            checked={bdCleanOpts[key]}
                            onChange={() => setBdCleanOpts(prev => ({ ...prev, [key]: !prev[key] }))}
                            className="sr-only"
                          />
                          <div
                            className={`h-3.5 w-3.5 rounded border transition-colors flex items-center justify-center ${
                              bdCleanOpts[key]
                                ? "bg-primary border-primary"
                                : "border-border bg-background group-hover:border-primary/50"
                            }`}
                          >
                            {bdCleanOpts[key] && (
                              <svg className="h-2.5 w-2.5 text-white" viewBox="0 0 12 12" fill="none">
                                <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            )}
                          </div>
                        </div>
                        <div>
                          <p className="text-[10px] font-medium text-foreground leading-tight">{label}</p>
                          <p className="text-[9px] text-muted-foreground leading-snug">{desc}</p>
                        </div>
                      </label>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Timeline Tab */}
        <TabsContent value="timeline" className="flex-1 flex flex-col gap-2 mt-3 min-h-0">
          {/* ── Tools toolbar ── */}
          <div className="flex items-center gap-2 flex-shrink-0 relative" ref={toolsMenuRef}>
            <div className="relative">
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs gap-1.5 border-border/50"
                onClick={() => setShowToolsMenu(m => !m)}
              >
                <Wrench className="h-3 w-3" />
                Tools
                <ChevronDown className="h-3 w-3 opacity-60" />
              </Button>

              {/* Dropdown menu */}
              {showToolsMenu && (
                <div
                  className="absolute top-full left-0 mt-1 z-50 min-w-[180px] rounded-md border border-border bg-popover shadow-xl py-1 text-sm"
                  onMouseLeave={() => {}}
                >
                  {/* 1. Normalize */}
                  <button
                    className="w-full text-left px-3 py-1.5 hover:bg-accent hover:text-accent-foreground transition-colors flex items-center gap-2 disabled:opacity-40"
                    disabled={selectedIds.size === 0}
                    onClick={normalizeSelected}
                  >
                    <span className="text-primary font-mono text-[10px] w-4">50</span>
                    Normalize
                    {selectedIds.size > 0 && <span className="ml-auto text-[10px] text-muted-foreground">{selectedIds.size} pts</span>}
                  </button>

                  {/* 2. Preset Patterns */}
                  <button
                    className="w-full text-left px-3 py-1.5 hover:bg-accent hover:text-accent-foreground transition-colors flex items-center gap-2"
                    onClick={() => { setShowPresetsPopup(true); setShowToolsMenu(false); }}
                  >
                    <ChevronRight className="h-3 w-3 text-primary" />
                    Preset Patterns…
                  </button>

                  <div className="my-1 border-t border-border/50" />

                  {/* 3. Flip */}
                  <button
                    className="w-full text-left px-3 py-1.5 hover:bg-accent hover:text-accent-foreground transition-colors flex items-center gap-2 disabled:opacity-40"
                    disabled={selectedIds.size === 0}
                    onClick={flipSelected}
                  >
                    <span className="text-primary font-mono text-[10px] w-4">↕</span>
                    Flip
                    {selectedIds.size > 0 && <span className="ml-auto text-[10px] text-muted-foreground">{selectedIds.size} pts</span>}
                  </button>
                </div>
              )}
            </div>

            {selectedIds.size === 0 && (
              <span className="text-[10px] text-muted-foreground/50 select-none">
                Select markers first to use tools
              </span>
            )}

            {/* Click-outside closer */}
            {showToolsMenu && (
              <div className="fixed inset-0 z-40" onClick={() => setShowToolsMenu(false)} />
            )}
          </div>

          {/* ── Preset Patterns Popup ── */}
          {showPresetsPopup && (
            <div className="fixed inset-0 z-50 flex items-center justify-center">
              <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowPresetsPopup(false)} />
              <div className="relative bg-card border border-border rounded-xl shadow-2xl w-[480px] max-w-[95vw] max-h-[80vh] overflow-y-auto p-5">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-semibold text-sm tracking-wide">Preset Patterns</h3>
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setShowPresetsPopup(false)}>
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
                {selectedIds.size === 0 && (
                  <p className="text-xs text-amber-400 mb-3 bg-amber-400/10 border border-amber-400/30 rounded px-2 py-1.5">
                    No markers selected — select some first, then apply a pattern.
                  </p>
                )}
                <div className="grid grid-cols-2 gap-2 text-xs">

                  {/* Wave */}
                  <div className="col-span-2 border border-border/50 rounded-lg p-3 hover:border-primary/40 transition-colors">
                    <div className="flex items-center justify-between mb-1.5">
                      <div>
                        <span className="font-medium">Wave</span>
                        <span className="ml-2 text-muted-foreground text-[10px]">0, 95, 0, 100, 0, 95, 0, 80 …</span>
                      </div>
                      <Button size="sm" className="h-6 text-[10px]" disabled={selectedIds.size === 0} onClick={applyWavePattern}>Apply</Button>
                    </div>
                    <div className="flex gap-0.5 h-6">
                      {[0,95,0,100,0,95,0,80,0,70,0,65,0,70,0,80,0,90].map((v,i) => (
                        <div key={i} className="flex-1 bg-border/30 rounded-sm flex items-end overflow-hidden">
                          <div className="w-full bg-primary/70 rounded-sm" style={{ height: `${v}%` }} />
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Teeth */}
                  <div className="border border-border/50 rounded-lg p-3 hover:border-primary/40 transition-colors">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="font-medium">Teeth</span>
                      <Button size="sm" className="h-6 text-[10px]" disabled={selectedIds.size === 0} onClick={() => applyPattern(TEETH_PATTERN)}>Apply</Button>
                    </div>
                    <div className="flex gap-0.5 h-6">
                      {TEETH_PATTERN.slice(0,16).map((v,i) => (
                        <div key={i} className="flex-1 bg-border/30 rounded-sm flex items-end overflow-hidden">
                          <div className="w-full bg-primary/70 rounded-sm" style={{ height: `${v}%` }} />
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Alternate */}
                  <div className="border border-border/50 rounded-lg p-3 hover:border-primary/40 transition-colors">
                    <div className="flex items-center justify-between mb-1.5">
                      <div>
                        <span className="font-medium">Alternate</span>
                        <span className="ml-1 text-muted-foreground text-[10px]">0, 100</span>
                      </div>
                      <Button size="sm" className="h-6 text-[10px]" disabled={selectedIds.size === 0} onClick={() => applyPattern(ALT_PATTERN)}>Apply</Button>
                    </div>
                    <div className="flex gap-0.5 h-6">
                      {[0,100,0,100,0,100,0,100].map((v,i) => (
                        <div key={i} className="flex-1 bg-border/30 rounded-sm flex items-end overflow-hidden">
                          <div className="w-full bg-primary/70 rounded-sm" style={{ height: `${v}%` }} />
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Steps */}
                  <div className="border border-border/50 rounded-lg p-3 hover:border-primary/40 transition-colors">
                    <div className="flex items-center justify-between mb-1.5">
                      <div>
                        <span className="font-medium">Steps</span>
                        <span className="ml-1 text-muted-foreground text-[10px]">5-unit stairs</span>
                      </div>
                      <Button size="sm" className="h-6 text-[10px]" disabled={selectedIds.size === 0} onClick={() => applyPattern(STEPS_PATTERN)}>Apply</Button>
                    </div>
                    <div className="flex gap-0.5 h-6">
                      {STEPS_PATTERN.slice(0,16).map((v,i) => (
                        <div key={i} className="flex-1 bg-border/30 rounded-sm flex items-end overflow-hidden">
                          <div className="w-full bg-primary/70 rounded-sm" style={{ height: `${v}%` }} />
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Bounds */}
                  <div className="border border-border/50 rounded-lg p-3 hover:border-primary/40 transition-colors">
                    <div className="flex items-center justify-between mb-1.5">
                      <div>
                        <span className="font-medium">Bounds</span>
                        <span className="ml-1 text-muted-foreground text-[10px]">10-unit stairs</span>
                      </div>
                      <Button size="sm" className="h-6 text-[10px]" disabled={selectedIds.size === 0} onClick={() => applyPattern(BOUNDS_PATTERN)}>Apply</Button>
                    </div>
                    <div className="flex gap-0.5 h-6">
                      {BOUNDS_PATTERN.map((v,i) => (
                        <div key={i} className="flex-1 bg-border/30 rounded-sm flex items-end overflow-hidden">
                          <div className="w-full bg-primary/70 rounded-sm" style={{ height: `${v}%` }} />
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Pulse */}
                  <div className="border border-border/50 rounded-lg p-3 hover:border-primary/40 transition-colors">
                    <div className="flex items-center justify-between mb-1.5">
                      <div>
                        <span className="font-medium">Pulse</span>
                        <span className="ml-1 text-muted-foreground text-[10px]">100, 0, 100, 100, 0, 100</span>
                      </div>
                      <Button size="sm" className="h-6 text-[10px]" disabled={selectedIds.size === 0} onClick={() => applyPattern(PULSE_PATTERN)}>Apply</Button>
                    </div>
                    <div className="flex gap-0.5 h-6">
                      {[100,0,100,100,0,100,100,0,100,100,0,100].map((v,i) => (
                        <div key={i} className="flex-1 bg-border/30 rounded-sm flex items-end overflow-hidden">
                          <div className="w-full bg-primary/70 rounded-sm" style={{ height: `${v}%` }} />
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Dynamic */}
                  <div className="border border-border/50 rounded-lg p-3 hover:border-primary/40 transition-colors">
                    <div className="flex items-center justify-between mb-1.5">
                      <div>
                        <span className="font-medium">Dynamic</span>
                        <span className="ml-1 text-muted-foreground text-[10px]">max travel</span>
                      </div>
                      <Button size="sm" className="h-6 text-[10px]" disabled={selectedIds.size === 0} onClick={() => applyPattern(DYNAMIC_PATTERN)}>Apply</Button>
                    </div>
                    <div className="flex gap-0.5 h-6">
                      {[0,100,0,100,0,100,0,100].map((v,i) => (
                        <div key={i} className="flex-1 bg-border/30 rounded-sm flex items-end overflow-hidden">
                          <div className="w-full bg-violet-400/70 rounded-sm" style={{ height: `${v}%` }} />
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Small Triangle */}
                  <div className="border border-border/50 rounded-lg p-3 hover:border-primary/40 transition-colors">
                    <div className="flex items-center justify-between mb-1.5">
                      <div>
                        <span className="font-medium">Small △</span>
                        <span className="ml-1 text-muted-foreground text-[10px]">0, 60</span>
                      </div>
                      <Button size="sm" className="h-6 text-[10px]" disabled={selectedIds.size === 0} onClick={() => applyPattern(SM_TRI_PATTERN)}>Apply</Button>
                    </div>
                    <div className="flex gap-0.5 h-6">
                      {[0,60,0,60,0,60,0,60].map((v,i) => (
                        <div key={i} className="flex-1 bg-border/30 rounded-sm flex items-end overflow-hidden">
                          <div className="w-full bg-primary/70 rounded-sm" style={{ height: `${v}%` }} />
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Med Triangle */}
                  <div className="border border-border/50 rounded-lg p-3 hover:border-primary/40 transition-colors">
                    <div className="flex items-center justify-between mb-1.5">
                      <div>
                        <span className="font-medium">Med △</span>
                        <span className="ml-1 text-muted-foreground text-[10px]">0, 80</span>
                      </div>
                      <Button size="sm" className="h-6 text-[10px]" disabled={selectedIds.size === 0} onClick={() => applyPattern(MED_TRI_PATTERN)}>Apply</Button>
                    </div>
                    <div className="flex gap-0.5 h-6">
                      {[0,80,0,80,0,80,0,80].map((v,i) => (
                        <div key={i} className="flex-1 bg-border/30 rounded-sm flex items-end overflow-hidden">
                          <div className="w-full bg-primary/70 rounded-sm" style={{ height: `${v}%` }} />
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Custom */}
                  <div className="col-span-2 border border-primary/30 rounded-lg p-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-medium text-primary">Custom</span>
                      <Button size="sm" className="h-6 text-[10px]" disabled={selectedIds.size === 0 || !customPatternText.trim()} onClick={applyCustomPattern}>Apply</Button>
                    </div>
                    <input
                      type="text"
                      value={customPatternText}
                      onChange={e => setCustomPatternText(e.target.value)}
                      placeholder="e.g.  0, 75, 50, 100, 25"
                      className="w-full bg-background border border-border rounded px-2 py-1 text-xs font-mono placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/60"
                    />
                    <p className="text-[10px] text-muted-foreground mt-1">Comma-separated values 0–100. Pattern repeats over all selected markers.</p>
                  </div>

                </div>
              </div>
            </div>
          )}

          {/* Timeline canvas fills the space */}
          <Card className="bg-black border-border/50 relative overflow-hidden flex-1 min-h-0 group">
            <canvas
              ref={canvasRef}
              width={1600}
              height={300}
              className="w-full h-full cursor-crosshair"
              onMouseDown={handleCanvasMouseDown}
              onMouseMove={handleCanvasMouseMove}
              onMouseUp={handleCanvasMouseUp}
              onMouseLeave={handleCanvasMouseUp}
            />
            {/* Zoom controls — fixed upper-right */}
            <div className="absolute top-2 right-2 flex items-center gap-1 z-10">
              <span className="text-[10px] text-muted-foreground font-mono mr-1 select-none">
                ±{TL_ZOOM_LEVELS[tlZoomLevel] < 10
                  ? TL_ZOOM_LEVELS[tlZoomLevel].toFixed(1)
                  : Math.round(TL_ZOOM_LEVELS[tlZoomLevel])}s
              </span>
              <Button
                variant="outline"
                size="icon"
                className="h-6 w-6 bg-black/70 border-border/50 hover:bg-black"
                onClick={() => setTlZoomLevel(l => Math.max(0, l - 1))}
                disabled={tlZoomLevel === 0}
                title="Zoom in (smaller window)"
              >
                <ZoomIn className="h-3 w-3" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="h-6 w-6 bg-black/70 border-border/50 hover:bg-black"
                onClick={() => setTlZoomLevel(l => Math.min(9, l + 1))}
                disabled={tlZoomLevel === 9}
                title="Zoom out (larger window)"
              >
                <ZoomOut className="h-3 w-3" />
              </Button>
            </div>
            {/* Multi-select action toolbar */}
            {selectedIds.size > 0 && (
              <div className="absolute top-2 left-2 flex items-center gap-1 z-10 opacity-0 group-hover:opacity-100 transition-opacity">
                <span className="text-[10px] text-primary font-bold font-mono bg-black/70 px-1.5 py-0.5 rounded mr-1 select-none">
                  {selectedIds.size} selected
                </span>
                <Button variant="outline" size="icon" className="h-6 w-6 bg-black/70 border-border/50" onClick={copySelected} title="Copy (Ctrl+C)">
                  <Copy className="h-3 w-3" />
                </Button>
                <Button variant="outline" size="icon" className="h-6 w-6 bg-black/70 border-border/50" onClick={cutSelected} title="Cut (Ctrl+X)">
                  <Scissors className="h-3 w-3" />
                </Button>
                <Button variant="destructive" size="icon" className="h-6 w-6" onClick={deleteSelected} title="Delete (Del)">
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            )}
            {/* Paste button — visible when clipboard has content */}
            {clipboardRef.current.length > 0 && (
              <div className="absolute bottom-6 left-2 z-10 opacity-0 group-hover:opacity-100 transition-opacity">
                <Button variant="outline" size="sm" className="h-6 text-[10px] bg-black/70 border-border/50 gap-1" onClick={pasteClipboard} title="Paste at playhead (Ctrl+V)">
                  <Clipboard className="h-3 w-3" /> Paste {clipboardRef.current.length}
                </Button>
              </div>
            )}
            {points.length === 0 && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none text-muted-foreground/50 text-xs text-center px-4 select-none">
                Click to place · drag to select area · <span className="font-mono">Shift+click</span> multi-select · <span className="font-mono">Ctrl+C/X/V</span> copy/cut/paste
              </div>
            )}
          </Card>
          <div className="flex justify-between items-center text-xs text-muted-foreground px-1 flex-shrink-0">
            <span>Points: {points.length}</span>
            <span className="hidden sm:inline font-mono opacity-50 text-[10px]">
              ` 1–9 0 add · ←→ frame · ↑↓ jump
            </span>
            <Button variant="ghost" size="sm" onClick={() => setPoints([])} className="text-destructive hover:text-destructive h-7 text-xs">Clear All</Button>
          </div>
        </TabsContent>

        {/* Visual Trigger Tab */}
        <TabsContent value="visual" className="flex-1 flex gap-3 mt-3 min-h-0 overflow-hidden">
          {/* ── Analysis in progress: just show progress bar ── */}
          {vtAnalyzing && (
            <div className="flex-1 flex flex-col items-center justify-center gap-4 px-8">
              <div className="flex items-center gap-2">
                <p className="text-sm text-muted-foreground">Scanning video for pattern matches…</p>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${analyzeMode !== "cpu" ? "border-primary/60 text-primary bg-primary/10" : "border-muted-foreground/40 text-muted-foreground"}`}>
                  {analyzeMode === "webgpu" ? "⚡ WebGPU" : analyzeMode === "webgl" ? "⚡ WebGL" : "CPU"}
                </span>
              </div>
              <div className="w-full max-w-md">
                <Progress value={vtProgress} className="h-3" />
              </div>
              <p className="text-2xl font-mono font-bold text-primary">{vtProgress}%</p>
              {analyzeMode !== "cpu" && (
                <p className="text-[10px] text-muted-foreground">{analyzeMode === "webgpu" ? "WebGPU compute shader — fastest path" : "WebGL shader"} + fast playback — up to 16× faster than seek-based CPU</p>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={cancelAnalysis}
                data-testid="button-vt-cancel"
              >
                <X className="h-3.5 w-3.5 mr-1.5" />
                Cancel
              </Button>
            </div>
          )}

          {/* Zone status */}
          {!vtAnalyzing && (
            <div className="flex-1 flex flex-col gap-2 min-h-0 justify-start">
              <div className="rounded-lg border border-border/50 bg-card/40 p-3 flex flex-col gap-2">
                <p className="text-xs text-muted-foreground">
                  {videoUrl
                    ? "Click and drag on the video above to draw a sampling zone (10–50 video pixels)."
                    : "Load a video using the toolbar above to get started."}
                </p>
                {vtZone && (
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                    <span className="text-muted-foreground">Zone:</span>
                    <span className="font-mono text-primary">{vtZone.x},{vtZone.y} — {vtZone.w}×{vtZone.h}px</span>
                    {vtSampledPatch
                      ? <span className="text-primary">Pattern sampled ✓</span>
                      : <span className="text-muted-foreground">→ expand panel to sample pattern</span>
                    }
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Settings panel */}
          {!vtAnalyzing && <div className="w-64 flex-shrink-0 overflow-auto">
            <Card className="bg-card/50 border-primary/20">
                <CardContent className="p-4 space-y-4">
                  <div>
                    <p className="text-sm font-medium mb-1">Reference Pattern</p>
                    {vtSampledPatch && vtZone ? (
                      <div className="flex items-center gap-3">
                        <canvas
                          ref={vtPatchPreviewRef}
                          className="rounded border border-primary/40"
                          style={{ width: 48, height: 48, imageRendering: "pixelated" }}
                        />
                        <span className="text-xs text-muted-foreground leading-snug">
                          {vtZone.w}×{vtZone.h}px<br />grayscale patch<br />sampled ✓
                        </span>
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">Draw a zone on the video, then sample</p>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-2 w-full"
                      disabled={!vtZone}
                      onClick={samplePatch}
                      data-testid="button-vt-sample"
                    >
                      Sample Pattern at Zone
                    </Button>
                  </div>

                  <div>
                    <div className="flex justify-between mb-1">
                      <span className="text-sm font-medium">Match Sensitivity</span>
                      <span className="text-xs font-mono text-primary">RMS &lt; {vtTolerance}</span>
                    </div>
                    <Slider min={2} max={80} step={1} value={[vtTolerance]} onValueChange={v => setVtTolerance(v[0])} />
                    <p className="text-[10px] text-muted-foreground mt-1">Lower = stricter match (2=exact, 80=loose)</p>
                  </div>

                  <div>
                    <div className="flex justify-between mb-1">
                      <span className="text-sm font-medium">Min Trigger Delay</span>
                      <span className="text-xs font-mono text-primary">{vtMinDelay} ms</span>
                    </div>
                    <Slider min={0} max={2000} step={50} value={[vtMinDelay]} onValueChange={v => setVtMinDelay(v[0])} />
                    <p className="text-[10px] text-muted-foreground mt-1">Cooldown between triggers — suppresses duplicate detections on held frames (default 200 ms)</p>
                  </div>

                  <div>
                    <div className="flex justify-between mb-1">
                      <span className="text-sm font-medium">Frame Debounce</span>
                      <span className="text-xs font-mono text-primary">{vtFrameDebounce} frame{vtFrameDebounce !== 1 ? "s" : ""}</span>
                    </div>
                    <Slider min={1} max={5} step={1} value={[vtFrameDebounce]} onValueChange={v => setVtFrameDebounce(v[0])} />
                    <p className="text-[10px] text-muted-foreground mt-1">Suppress re-trigger for this many consecutive frames after a match (default 5)</p>
                  </div>

                  <div>
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-sm font-medium">Movement Limit</span>
                      <span className="text-xs font-mono text-primary">{vtMovementLimit} units/sec</span>
                    </div>
                    <Slider min={60} max={400} step={10} value={[vtMovementLimit]} onValueChange={v => setVtMovementLimit(v[0])} />
                    <p className="text-[10px] text-muted-foreground mt-1">Max total movement in any 1-second window (default 300)</p>
                  </div>

                  <div>
                    <p className="text-xs font-medium mb-1 text-muted-foreground uppercase tracking-wider">Output Range</p>
                    <div className="bg-background/60 rounded border border-border/50 px-3 py-2 text-sm">
                      <span className="font-mono text-primary">{vtChosenRange[0]}</span>
                      <span className="text-muted-foreground mx-2">↔</span>
                      <span className="font-mono text-primary">{vtChosenRange[1]}</span>
                      <span className="text-xs text-muted-foreground ml-2">(auto)</span>
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-1">
                      Alternates hi↔lo. Collapses automatically to keep movement ≤ 400 units/sec.
                    </p>
                  </div>

                  <div>
                    <p className="text-xs font-medium mb-2 text-muted-foreground uppercase tracking-wider">Time Range (seconds)</p>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs text-muted-foreground">Start (s)</label>
                        <input
                          type="number"
                          min={0}
                          value={vtStartTime}
                          onChange={e => setVtStartTime(Number(e.target.value))}
                          className="w-full bg-input rounded px-2 py-1 text-sm mt-1 border border-border"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground">End (s, 0=full)</label>
                        <input
                          type="number"
                          min={0}
                          value={vtEndTime}
                          onChange={e => setVtEndTime(Number(e.target.value))}
                          className="w-full bg-input rounded px-2 py-1 text-sm mt-1 border border-border"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col gap-1">
                    <Button
                      className="w-full"
                      disabled={!vtZone || !vtSampledPatch || vtAnalyzing}
                      onClick={runAnalysis}
                      data-testid="button-vt-analyze"
                    >
                      {vtAnalyzing ? `Analyzing... ${vtProgress}%` : "Analyze Video"}
                    </Button>
                    <div className="flex justify-end">
                      <span className={`text-[10px] px-2 py-0.5 rounded-full border ${gpuMode === "webgpu" ? "border-primary/50 text-primary bg-primary/10" : gpuMode === "webgl" ? "border-primary/40 text-primary/80 bg-primary/5" : "border-muted-foreground/30 text-muted-foreground"}`}>
                        {gpuMode === "webgpu" ? "⚡ WebGPU" : gpuMode === "webgl" ? "⚡ WebGL" : "CPU mode"}
                      </span>
                    </div>
                  </div>

                  {vtPreviewPoints.length > 0 && (
                    <div className="space-y-2 p-3 bg-primary/10 border border-primary/30 rounded-lg">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-medium text-primary">{vtPreviewPoints.length} points ready — preview in Timeline Editor</p>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full border ${analyzeMode === "webgpu" ? "border-primary/50 text-primary bg-primary/10" : analyzeMode === "webgl" ? "border-primary/40 text-primary/80 bg-primary/5" : "border-muted-foreground/30 text-muted-foreground"}`}>
                          {analyzeMode === "webgpu" ? "⚡ Analyzed with WebGPU" : analyzeMode === "webgl" ? "⚡ Analyzed with WebGL" : "Analyzed with CPU"}
                        </span>
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" className="flex-1" onClick={commitPreviewPoints} data-testid="button-vt-commit">
                          Add to Script
                        </Button>
                        <Button size="sm" variant="destructive" className="flex-1" onClick={() => setVtPreviewPoints([])}>
                          Discard
                        </Button>
                      </div>
                    </div>
                  )}

                  {points.length > 0 && (
                    <p className="text-xs text-primary text-center">{points.length} total points in script</p>
                  )}
                </CardContent>
              </Card>
            </div>}
        </TabsContent>
        </>}
      </Tabs>

      {/* ── Paste Video URL Dialog ── */}
      <Dialog open={urlDialogOpen} onOpenChange={(open) => { setUrlDialogOpen(open); if (!open) { setUrlInput(""); setUrlError(null); } }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Load video from URL</DialogTitle>
            <DialogDescription>
              Paste a direct video link (.mp4, .webm, .ogg, .mov). Embed pages like YouTube or Vimeo can't be analyzed for funscript generation.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Input
              type="url"
              placeholder="https://example.com/video.mp4"
              value={urlInput}
              onChange={(e) => { setUrlInput(e.target.value); if (urlError) setUrlError(null); }}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleLoadVideoUrl(); } }}
              autoFocus
              data-testid="input-video-url"
            />
            {urlError && (
              <div className="space-y-1">
                <p className="text-sm text-destructive" data-testid="text-url-error">{urlError}</p>
                <button
                  type="button"
                  className="text-xs text-primary underline hover:text-primary/80"
                  onClick={() =>
                    openBlockedReport({
                      kind: "scripter_url",
                      item: urlInput.trim(),
                      blockMessage: urlError,
                    })
                  }
                  data-testid="button-report-blocked-url"
                >
                  Think this is in error? Click to report.
                </button>
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              Note: the video host must allow cross-origin playback. If loading fails, download the file and use Load Video instead.
            </p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setUrlDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleLoadVideoUrl} data-testid="button-load-video-url">Load Video</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Resume-draft picker (shown on mount when editor empty + drafts exist) ── */}
      {resumePickerOpen && (
        <ResumeDraftPicker
          drafts={resumeDrafts}
          onResume={handleResumeDraft}
          onSkip={() => setResumePickerOpen(false)}
          onDeleted={() => setResumeDrafts((prev) => prev.slice(1))}
        />
      )}

      {/* ── Exit warning dialog ── */}
      <ExitWarningDialog
        open={exitDialogOpen}
        isFree={isFree}
        buildFunscriptJson={buildFunscriptJson}
        draftName={videoFileName ? videoFileName.replace(/\.[^/.]+$/, "") : "Unfinished script"}
        onStay={handleExitCancel}
        onLeave={handleExitConfirm}
      />

      {/* ── Save Script Dialog ── */}
      {saveDialogOpen && (() => {
        const sorted = [...points].sort((a, b) => a.time - b.time);
        const scriptJson = JSON.stringify({ actions: sorted.map(p => ({ at: Math.round(p.time), pos: p.pos })) });
        const baseName = videoFileName ? videoFileName.replace(/\.[^/.]+$/, "") : "script";
        return (
          <SaveScriptDialog
            open={saveDialogOpen}
            onClose={() => setSaveDialogOpen(false)}
            scriptJson={scriptJson}
            videoUrl={videoUrl}
            videoFileName={videoFileName}
            suggestedTitle={baseName}
            onDownload={() => { exportScript(); setSaveDialogOpen(false); }}
            onSavedSuccess={() => markClean()}
          />
        );
      })()}
    </div>
  );
}
