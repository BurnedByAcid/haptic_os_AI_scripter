import { useState, useRef, useEffect, useCallback } from "react";
import { useHandy } from "@/hooks/use-handy";
import { setHDSP } from "@/lib/handyApi";
import { GlPatchMatcher } from "@/lib/gl-patch-matcher";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Slider } from "@/components/ui/slider";
import { Progress } from "@/components/ui/progress";
import { Trash2, Download, FilePlus, Upload, Mic, Square, ChevronDown, ChevronUp, ZoomIn, ZoomOut } from "lucide-react";
import { VideoControlBar } from "@/components/video-control-bar";

const STORAGE_KEY = "scripter_session_v1";

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
  const { key, connected } = useHandy();
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
  const [selectedPointId, setSelectedPointId] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [realtimeTest, setRealtimeTest] = useState(false);

  // ─── Layout state ───
  const [tabsOpen, setTabsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"beat" | "timeline" | "visual">("beat");

  // ─── Timeline Editor state ───
  const [tlZoomLevel, setTlZoomLevel] = useState(3); // 0 = max zoom (2 s), 9 = min (60 s)
  // Stable refs so keyboard handler always sees latest values without re-subscribing
  const currentTimeRef = useRef(0);
  const pointsRef = useRef<Point[]>([]);
  useEffect(() => { currentTimeRef.current = currentTime; }, [currentTime]);
  useEffect(() => { pointsRef.current = points; }, [points]);

  // ─── Video rect (for VT overlay alignment) ───
  const videoBlockRef = useRef<HTMLDivElement>(null);
  const videoContainerRef = useRef<HTMLDivElement>(null);
  const [videoRect, setVideoRect] = useState({ left: 0, top: 0, width: 0, height: 0 });

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const isDragging = useRef(false);

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
  const [vtMovementLimit, setVtMovementLimit] = useState(300);
  const [vtChosenRange, setVtChosenRange] = useState<[number, number]>([0, 100]);
  const [vtAnalyzing, setVtAnalyzing] = useState(false);
  const [vtProgress, setVtProgress] = useState(0);
  const [vtStartTime, setVtStartTime] = useState(0);
  const [vtEndTime, setVtEndTime] = useState(0);
  const [vtPreviewPoints, setVtPreviewPoints] = useState<Point[]>([]);

  // ─── GPU patch matcher ───
  const glRef = useRef<GlPatchMatcher | null>(null);
  const [gpuAvail, setGpuAvail] = useState(false);
  useEffect(() => {
    try {
      glRef.current = new GlPatchMatcher();
      setGpuAvail(true);
    } catch {
      glRef.current = null;
      setGpuAvail(false);
    }
    return () => { glRef.current?.destroy(); glRef.current = null; };
  }, []);

  // ─── Beat Detector state ───
  const bdCanvasRef = useRef<HTMLCanvasElement>(null);
  const [bdIsActive, setBdIsActive] = useState(false);
  const [bdBpm, setBdBpm] = useState(0);
  const [bdSensitivity, setBdSensitivity] = useState(1.5);
  const [bdIsRecording, setBdIsRecording] = useState(false);
  const bdAudioCtxRef = useRef<AudioContext | null>(null);
  const bdAnalyserRef = useRef<AnalyserNode | null>(null);
  const bdSourceRef = useRef<MediaStreamAudioSourceNode | AudioBufferSourceNode | null>(null);
  const bdRafRef = useRef<number | null>(null);
  const bdLastBeatRef = useRef(0);
  const bdEnergyHistoryRef = useRef<number[]>([]);
  const bdBeatIntervalHistoryRef = useRef<number[]>([]);
  const bdSensitivityRef = useRef(bdSensitivity);
  const bdIsRecordingRef = useRef(bdIsRecording);
  const bdRecordStartRef = useRef(0);
  const bdBeatPosRef = useRef(0); // alternates 0 ↔ 100
  const [bdPointsAdded, setBdPointsAdded] = useState(0);

  useEffect(() => { bdSensitivityRef.current = bdSensitivity; }, [bdSensitivity]);
  useEffect(() => { bdIsRecordingRef.current = bdIsRecording; }, [bdIsRecording]);

  const bdLoop = useCallback(() => {
    if (!bdAnalyserRef.current || !bdCanvasRef.current) return;
    const analyser = bdAnalyserRef.current;
    const canvas = bdCanvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteTimeDomainData(dataArray);

    let energy = 0;
    for (let i = 0; i < dataArray.length; i++) {
      const val = (dataArray[i] - 128) / 128;
      energy += val * val;
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
        const beatMs = Math.round(now - bdRecordStartRef.current);
        const pos = bdBeatPosRef.current;
        bdBeatPosRef.current = pos === 0 ? 100 : 0;
        setPoints(prev => [...prev, { id: crypto.randomUUID(), time: beatMs, pos }]);
        setBdPointsAdded(c => c + 1);
      }

      ctx.fillStyle = "rgba(0, 229, 255, 0.25)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    } else {
      ctx.fillStyle = "rgba(0, 0, 0, 0.2)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    ctx.lineWidth = 2;
    ctx.strokeStyle = "hsl(186, 100%, 50%)";
    ctx.beginPath();
    const sliceWidth = canvas.width / dataArray.length;
    let x = 0;
    for (let i = 0; i < dataArray.length; i++) {
      const v = dataArray[i] / 128.0;
      const y = (v * canvas.height) / 2;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
      x += sliceWidth;
    }
    ctx.stroke();

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
    bdLoop();
  }, [bdLoop]);

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
      source.connect(ctx.destination);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
      bdAnalyserRef.current = analyser;
      bdSourceRef.current = source;
      source.start(0);
      setBdIsActive(true);
      bdLoop();
    } catch (err) { console.error(err); }
  }, [bdLoop]);

  const bdStop = useCallback(() => {
    setBdIsActive(false);
    setBdIsRecording(false);
    bdIsRecordingRef.current = false;
    if (bdRafRef.current) cancelAnimationFrame(bdRafRef.current);
    if (bdSourceRef.current instanceof AudioBufferSourceNode) {
      try { bdSourceRef.current.stop(); } catch { /* ignore */ }
    } else if (bdSourceRef.current instanceof MediaStreamAudioSourceNode) {
      bdSourceRef.current.mediaStream.getTracks().forEach(t => t.stop());
    }
    if (bdAudioCtxRef.current) bdAudioCtxRef.current.close();
    bdEnergyHistoryRef.current = [];
    bdBeatIntervalHistoryRef.current = [];
    bdLastBeatRef.current = 0;
    setBdBpm(0);
  }, []);

  useEffect(() => { return bdStop; }, [bdStop]);

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

    // ── Committed points (cyan) ──
    const sorted = [...points].sort((a, b) => a.time - b.time);
    if (sorted.length > 0) {
      ctx.strokeStyle = "hsl(186,100%,50%)";
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
        const sel = p.id === selectedPointId;
        ctx.fillStyle = sel ? "hsl(186,100%,50%)" : "#fff";
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

  }, [points, vtPreviewPoints, selectedPointId, currentTime, tlZoomLevel]);

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
    const clickedPoint = getPointAtCursor(x, y, canvas);
    if (clickedPoint) {
      setSelectedPointId(clickedPoint.id);
      isDragging.current = true;
    } else {
      setSelectedPointId(null);
      const { xToTime } = tlCoordsForCanvas(canvas);
      const time = Math.max(0, xToTime(x));
      const pos = Math.max(0, Math.min(100, Math.round(100 - (y / canvas.height) * 100)));
      const newPoint = { id: crypto.randomUUID(), time, pos };
      setPoints(prev => [...prev, newPoint]);
      setSelectedPointId(newPoint.id);
    }
  };

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDragging.current || !selectedPointId) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { x, y } = canvasClientToCanvas(e);
    const { xToTime } = tlCoordsForCanvas(canvas);
    const newTime = Math.max(0, xToTime(x));
    const newPos = Math.max(0, Math.min(100, Math.round(100 - (y / canvas.height) * 100)));
    setPoints(pts => pts.map(p => p.id === selectedPointId ? { ...p, time: newTime, pos: newPos } : p));
    if (realtimeTest && connected && key) setHDSP(key, newPos, 87);
  };

  const handleCanvasMouseUp = () => { isDragging.current = false; };

  const exportScript = () => {
    const sorted = [...points].sort((a, b) => a.time - b.time);
    const script = { actions: sorted.map(p => ({ at: Math.round(p.time), pos: p.pos })) };
    const blob = new Blob([JSON.stringify(script, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "script.funscript";
    a.click();
    URL.revokeObjectURL(url);
  };

  const deleteSelected = () => {
    if (selectedPointId) {
      setPoints(pts => pts.filter(p => p.id !== selectedPointId));
      setSelectedPointId(null);
    }
  };

  const handleVideoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) setVideoUrl(URL.createObjectURL(file));
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
          setSelectedPointId(null);
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

      switch (e.key) {
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
      ctx.strokeStyle = "hsl(186, 100%, 50%)";
      ctx.lineWidth = Math.max(1, canvas.width / 600);
      ctx.strokeRect(x, y, w, h);
      ctx.fillStyle = "rgba(0,229,255,0.18)";
      ctx.fillRect(x, y, w, h);
      // Dimension label
      const fontSize = Math.max(10, Math.round(canvas.width / 70));
      ctx.font = `bold ${fontSize}px monospace`;
      ctx.fillStyle = "hsl(186, 100%, 50%)";
      ctx.shadowColor = "#000";
      ctx.shadowBlur = 3;
      ctx.fillText(`${w}×${h}`, x + w + 3, y + fontSize);
      ctx.shadowBlur = 0;
    }
  }, [vtZone]);

  // Redraw VT frame whenever video position changes or zone changes
  useEffect(() => {
    if (videoUrl) drawVtFrame();
  }, [vtZone, videoUrl, currentTime, drawVtFrame]);

  // Convert a CSS-space drag rect (clamped to 25×25px) into video pixel coords
  const cssDragToZone = useCallback((
    startCssX: number, startCssY: number,
    endCssX: number, endCssY: number,
    canvas: HTMLCanvasElement
  ) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const MAX_CSS = 25;
    const rawCssW = endCssX - startCssX;
    const rawCssH = endCssY - startCssY;
    const cssW = Math.max(1, Math.min(MAX_CSS, Math.abs(rawCssW)));
    const cssH = Math.max(1, Math.min(MAX_CSS, Math.abs(rawCssH)));
    const cssTlX = rawCssW >= 0 ? startCssX : startCssX - cssW;
    const cssTlY = rawCssH >= 0 ? startCssY : startCssY - cssH;
    return {
      x: Math.max(0, Math.round(cssTlX * scaleX)),
      y: Math.max(0, Math.round(cssTlY * scaleY)),
      w: Math.max(1, Math.round(cssW * scaleX)),
      h: Math.max(1, Math.round(cssH * scaleY)),
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
    // Feed the reference into the GPU matcher so it's ready for analysis
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

  const [analyzeMode, setAnalyzeMode] = useState<"gpu" | "cpu">("cpu");

  const runAnalysis = async () => {
    const video = videoRef.current;
    if (!video || !vtZone || !vtSampledPatch) return;

    setVtAnalyzing(true);
    setVtProgress(0);
    setVtPreviewPoints([]);

    const { x, y, w, h } = vtZone;
    const VW = video.videoWidth || 640;
    const VH = video.videoHeight || 360;
    const nx = x / VW, ny = y / VH, nw = w / VW, nh = h / VH;

    const startMs = vtStartTime * 1000;
    const endMs = vtEndTime > 0 ? vtEndTime * 1000 : video.duration * 1000;
    const stepMs = 1000 / 30;           // 30 fps analysis resolution
    const rangeMs = endMs - startMs;
    const triggerTimes: number[] = [];
    let lastState = false;
    let lastTriggerMs = startMs - vtMinDelay; // ensures first trigger is never suppressed

    const gl = glRef.current;
    // Ensure the GPU matcher has the current reference (in case vtSampledPatch changed)
    if (gl) {
      try { gl.setReference(vtSampledPatch, w, h); } catch { /* ignore */ }
    }

    const useGpu = gl !== null;
    const hasRvfc = "requestVideoFrameCallback" in HTMLVideoElement.prototype;
    setAnalyzeMode(useGpu ? "gpu" : "cpu");

    // Save video state so we can restore it after analysis
    const savedRate    = video.playbackRate;
    const savedMuted   = video.muted;
    const savedTime    = video.currentTime;
    const savedPaused  = video.paused;

    try {
      if (hasRvfc) {
        // ─── FAST PATH: play at high speed, catch frames via rVFC ───────────
        // Seek to start
        video.currentTime = startMs / 1000;
        await new Promise<void>(res => {
          const fn = () => { video.removeEventListener("seeked", fn); res(); };
          video.addEventListener("seeked", fn);
        });

        video.muted = true;
        video.playbackRate = 16;

        await new Promise<void>((resolve) => {
          let lastAnalyzed = startMs - stepMs;
          let done = false;

          const finish = () => {
            if (done) return;
            done = true;
            video.pause();
            video.removeEventListener("ended", finish);
            resolve();
          };

          // Safety net: if the video hits its natural end the rVFC stops firing —
          // without this the Promise would hang forever.
          video.addEventListener("ended", finish, { once: true });

          const processFrame = (_now: number, meta: { mediaTime: number }) => {
            if (done) return;
            const frameMs = meta.mediaTime * 1000;

            if (frameMs >= endMs) {
              finish();
              return;
            }

            // Only analyse if we've advanced at least one step
            if (frameMs - lastAnalyzed >= stepMs) {
              try {
                let rms: number;
                if (useGpu) {
                  rms = gl!.computeRms(video, nx, ny, nw, nh);
                } else {
                  // rVFC without GPU — use 2D canvas cropped to patch
                  const off2d = document.createElement("canvas");
                  off2d.width = w; off2d.height = h;
                  const ctx2 = off2d.getContext("2d")!;
                  ctx2.drawImage(video, x, y, w, h, 0, 0, w, h);
                  rms = patchRms(toGray(ctx2.getImageData(0, 0, w, h).data), vtSampledPatch!);
                }
                const matched = rms < vtTolerance;
                if (matched && !lastState && frameMs - lastTriggerMs >= vtMinDelay) {
                  triggerTimes.push(frameMs);
                  lastTriggerMs = frameMs;
                }
                lastState = matched;
                lastAnalyzed = frameMs;
              } catch (e) {
                console.error("frame analysis error", e);
                finish();
                return;
              }
              setVtProgress(Math.min(99, Math.round(((frameMs - startMs) / rangeMs) * 100)));
            }

            (video as any).requestVideoFrameCallback(processFrame);
          };

          (video as any).requestVideoFrameCallback(processFrame);
          video.play().catch(() => finish());
        });

      } else {
        // ─── FALLBACK: seek-based loop (works in all browsers) ──────────────
        const off = document.createElement("canvas");
        off.width = VW; off.height = VH;
        const ctx = off.getContext("2d")!;

        let t = startMs;
        while (t <= endMs) {
          video.currentTime = t / 1000;
          await new Promise<void>(res => {
            const fn = () => { video.removeEventListener("seeked", fn); res(); };
            video.addEventListener("seeked", fn);
          });

          let rms: number;
          if (useGpu) {
            rms = gl!.computeRms(video, nx, ny, nw, nh);
          } else {
            ctx.drawImage(video, 0, 0);
            rms = patchRms(toGray(ctx.getImageData(x, y, w, h).data), vtSampledPatch!);
          }

          const matched = rms < vtTolerance;
          if (matched && !lastState && t - lastTriggerMs >= vtMinDelay) {
            triggerTimes.push(t);
            lastTriggerMs = t;
          }
          lastState = matched;
          t += stepMs;
          setVtProgress(Math.round(((t - startMs) / rangeMs) * 100));
        }
      }
    } finally {
      // Restore video to its previous state
      video.muted        = savedMuted;
      video.playbackRate = savedRate;
      video.currentTime  = savedTime;
      if (!savedPaused) video.play().catch(() => {});
    }

    // Commit all detections at the neutral midpoint — cheap, one pos value for every hit.
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

    setVtAnalyzing(false);
  };

  const commitPreviewPoints = () => {
    setPoints(prev => [...prev, ...vtPreviewPoints]);
    setVtPreviewPoints([]);
  };

  return (
    <div className="p-4 h-full flex flex-col max-w-[1600px] mx-auto gap-3">
      {/* Header */}
      <div className="flex justify-between items-center flex-shrink-0">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Scripter</h1>
          <p className="text-muted-foreground text-sm">Create and edit Funscripts.</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              if (points.length === 0 || window.confirm("Start a new script? All unsaved points will be cleared.")) {
                setPoints([]);
                setSelectedPointId(null);
                try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
              }
            }}
            data-testid="button-new-script"
          >
            <FilePlus className="mr-2 h-4 w-4" /> New Script
          </Button>
          <Button size="sm" onClick={exportScript} disabled={points.length === 0} data-testid="button-export-script">
            <Download className="mr-2 h-4 w-4" /> Export .funscript
          </Button>
        </div>
      </div>

      {/* ── Shared video player — takes 2/3 of available height ── */}
      <div ref={videoBlockRef} className={`flex flex-col rounded-lg border border-border/50 overflow-hidden min-h-0 ${vtAnalyzing ? "hidden" : ""}`} style={{ flex: 2 }}>
        {/* Toolbar */}
        <div className="bg-card/50 border-b border-border px-3 py-2 flex gap-2 items-center flex-shrink-0 flex-wrap">
          <Button variant="secondary" size="sm" className="relative cursor-pointer">
            <span>Load Video</span>
            <input type="file" accept="video/*" className="absolute inset-0 opacity-0 cursor-pointer" onChange={handleVideoUpload} />
          </Button>
          <Button variant="outline" size="sm" className="relative cursor-pointer" data-testid="button-import-funscript">
            <Upload className="mr-2 h-4 w-4" /><span>Import .funscript</span>
            <input type="file" accept=".funscript,.json,application/json" className="absolute inset-0 opacity-0 cursor-pointer" onChange={handleImportFunscript} />
          </Button>
          <label className="flex items-center gap-2 text-sm cursor-pointer ml-auto">
            <input
              type="checkbox"
              checked={realtimeTest}
              onChange={e => setRealtimeTest(e.target.checked)}
              className="rounded border-border bg-black"
            />
            Real-time Test (Handy)
          </label>
        </div>
        {/* Video */}
        <div ref={videoContainerRef} className="flex-1 min-h-0 bg-black relative">
          <video
            ref={videoRef}
            src={videoUrl ?? undefined}
            className="w-full h-full object-contain"
            preload="auto"
            onLoadedData={e => { const v = e.currentTarget; v.currentTime = 0; v.pause(); }}
            onLoadedMetadata={e => setVtEndTime(Math.round(e.currentTarget.duration))}
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
              Click and drag on the video to draw sampling zone (max 25×25px)
            </div>
          )}
        </div>
        {/* Controls bar */}
        <div className="bg-card/60 border-t border-border/50 px-3 py-2 flex-shrink-0">
          <VideoControlBar
            videoRef={videoRef}
            containerRef={videoBlockRef}
            isEditor
            markers={[...points].sort((a, b) => a.time - b.time).map(p => p.time)}
          />
        </div>
      </div>

      {/* ── Tabs — collapsible tool panel ── */}
      <Tabs
        value={activeTab}
        onValueChange={v => { setActiveTab(v as "beat" | "timeline" | "visual"); setTabsOpen(v !== "visual"); }}
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
          {/* Waveform canvas */}
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

          {/* Controls panel */}
          <div className="w-56 flex flex-col gap-3 overflow-auto flex-shrink-0">
            <Card className="bg-card/50 border-border/50 flex-shrink-0">
              <CardContent className="pt-3 pb-3 space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Input Source</p>
                {bdIsActive ? (
                  <Button variant="destructive" size="sm" className="w-full" onClick={bdStop}>
                    <Square className="mr-2 h-3.5 w-3.5" /> Stop Audio
                  </Button>
                ) : (
                  <>
                    <Button variant="secondary" size="sm" className="w-full" onClick={bdStartMic}>
                      <Mic className="mr-2 h-3.5 w-3.5" /> Use Microphone
                    </Button>
                    <Button variant="secondary" size="sm" className="w-full relative cursor-pointer">
                      <Upload className="mr-2 h-3.5 w-3.5" /><span>Upload Audio</span>
                      <input type="file" accept="audio/*" className="absolute inset-0 opacity-0 cursor-pointer" onChange={bdStartFile} />
                    </Button>
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
          </div>
        </TabsContent>

        {/* Timeline Tab */}
        <TabsContent value="timeline" className="flex-1 flex flex-col gap-2 mt-3 min-h-0">
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
            {/* Delete selected button */}
            {selectedPointId && (
              <div className="absolute top-2 left-2 flex gap-2 z-10 opacity-0 group-hover:opacity-100 transition-opacity">
                <Button variant="destructive" size="icon" className="h-6 w-6" onClick={deleteSelected} title="Delete selected point (or press Delete)">
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            )}
            {points.length === 0 && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none text-muted-foreground/50 text-xs text-center px-4 select-none">
                Click to place markers · <span className="font-mono">` 1–9 0</span> = add at pos · <span className="font-mono">← →</span> frame step · <span className="font-mono">↑ ↓</span> jump markers
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
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${analyzeMode === "gpu" ? "border-primary/60 text-primary bg-primary/10" : "border-muted-foreground/40 text-muted-foreground"}`}>
                  {analyzeMode === "gpu" ? "⚡ GPU" : "CPU"}
                </span>
              </div>
              <div className="w-full max-w-md">
                <Progress value={vtProgress} className="h-3" />
              </div>
              <p className="text-2xl font-mono font-bold text-primary">{vtProgress}%</p>
              {analyzeMode === "gpu" && (
                <p className="text-[10px] text-muted-foreground">WebGL shader + fast playback — up to 16× faster than seek-based CPU</p>
              )}
            </div>
          )}

          {/* Zone status */}
          {!vtAnalyzing && (
            <div className="flex-1 flex flex-col gap-2 min-h-0 justify-start">
              <div className="rounded-lg border border-border/50 bg-card/40 p-3 flex flex-col gap-2">
                <p className="text-xs text-muted-foreground">
                  {videoUrl
                    ? "Click and drag on the video above to draw a sampling zone (capped at 25×25px on screen)."
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
                      <span className={`text-[10px] px-2 py-0.5 rounded-full border ${gpuAvail ? "border-primary/50 text-primary bg-primary/10" : "border-muted-foreground/30 text-muted-foreground"}`}>
                        {gpuAvail ? "⚡ GPU-accelerated" : "CPU mode"}
                      </span>
                    </div>
                  </div>

                  {vtPreviewPoints.length > 0 && (
                    <div className="space-y-2 p-3 bg-primary/10 border border-primary/30 rounded-lg">
                      <p className="text-xs font-medium text-primary">{vtPreviewPoints.length} points ready — preview in Timeline Editor</p>
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
    </div>
  );
}
