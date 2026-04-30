import { useState, useRef, useEffect, useCallback } from "react";
import { useHandy } from "@/hooks/use-handy";
import { setHDSP } from "@/lib/handyApi";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Slider } from "@/components/ui/slider";
import { Trash2, Download, FilePlus, Upload } from "lucide-react";

const STORAGE_KEY = "scripter_session_v1";

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
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const isDragging = useRef(false);

  // ─── Visual Trigger state ───
  const vtCanvasRef = useRef<HTMLCanvasElement>(null);
  const vtVideoRef = useRef<HTMLVideoElement>(null);
  const vtVideoUrl = useRef<string | null>(null);
  const [vtVideoLoaded, setVtVideoLoaded] = useState(false);
  const [vtZone, setVtZone] = useState<{ x: number; y: number } | null>(null);
  const [vtSampledColor, setVtSampledColor] = useState<[number, number, number, number] | null>(null);
  const [vtTolerance, setVtTolerance] = useState(40);
  const [vtOnPos, setVtOnPos] = useState(100);
  const [vtOffPos, setVtOffPos] = useState(0);
  const [vtAnalyzing, setVtAnalyzing] = useState(false);
  const [vtProgress, setVtProgress] = useState(0);
  const [vtStartTime, setVtStartTime] = useState(0);
  const [vtEndTime, setVtEndTime] = useState(0);
  const [vtPreviewPoints, setVtPreviewPoints] = useState<Point[]>([]);

  // ─────────────── Timeline drawing ───────────────

  const drawTimeline = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = "rgba(255,255,255,0.05)";
    ctx.lineWidth = 1;
    for (let i = 0; i <= 10; i++) {
      ctx.beginPath();
      ctx.moveTo(0, (canvas.height / 10) * i);
      ctx.lineTo(canvas.width, (canvas.height / 10) * i);
      ctx.stroke();
    }

    const allTimes = [...points, ...vtPreviewPoints].map(p => p.time);
    const duration = videoRef.current?.duration ? videoRef.current.duration * 1000 : 10000;
    const maxTime = Math.max(duration, allTimes.length ? Math.max(...allTimes) + 1000 : 10000);

    // Draw committed points in cyan
    if (points.length > 0) {
      const sorted = [...points].sort((a, b) => a.time - b.time);
      ctx.strokeStyle = "hsl(186, 100%, 50%)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      sorted.forEach((p, i) => {
        const x = (p.time / maxTime) * canvas.width;
        const y = canvas.height - (p.pos / 100) * canvas.height;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
      sorted.forEach(p => {
        const x = (p.time / maxTime) * canvas.width;
        const y = canvas.height - (p.pos / 100) * canvas.height;
        ctx.fillStyle = p.id === selectedPointId ? "hsl(186, 100%, 50%)" : "white";
        ctx.beginPath();
        ctx.arc(x, y, p.id === selectedPointId ? 6 : 4, 0, Math.PI * 2);
        ctx.fill();
        if (p.id === selectedPointId) {
          ctx.strokeStyle = "white";
          ctx.stroke();
        }
      });
    }

    // Draw preview points (vtPreviewPoints) as amber overlay before commit
    if (vtPreviewPoints.length > 0) {
      const sorted = [...vtPreviewPoints].sort((a, b) => a.time - b.time);
      ctx.strokeStyle = "rgba(251,191,36,0.8)";
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 3]);
      ctx.beginPath();
      sorted.forEach((p, i) => {
        const x = (p.time / maxTime) * canvas.width;
        const y = canvas.height - (p.pos / 100) * canvas.height;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
      ctx.setLineDash([]);
      sorted.forEach(p => {
        const x = (p.time / maxTime) * canvas.width;
        const y = canvas.height - (p.pos / 100) * canvas.height;
        ctx.fillStyle = "rgba(251,191,36,0.9)";
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fill();
      });
    }

    if (videoRef.current) {
      const x = (currentTime / maxTime) * canvas.width;
      ctx.strokeStyle = "rgba(255,255,255,0.5)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvas.height);
      ctx.stroke();
    }
  }, [points, vtPreviewPoints, selectedPointId, currentTime]);

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

  const getPointAtCursor = (x: number, y: number, canvas: HTMLCanvasElement) => {
    const duration = videoRef.current?.duration ? videoRef.current.duration * 1000 : 10000;
    const maxTime = Math.max(duration, points.length ? Math.max(...points.map(p => p.time)) + 1000 : 10000);
    for (let i = points.length - 1; i >= 0; i--) {
      const p = points[i];
      const px = (p.time / maxTime) * canvas.width;
      const py = canvas.height - (p.pos / 100) * canvas.height;
      if (Math.hypot(x - px, y - py) < 10) return p;
    }
    return null;
  };

  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const clickedPoint = getPointAtCursor(x, y, canvas);
    if (clickedPoint) {
      setSelectedPointId(clickedPoint.id);
      isDragging.current = true;
    } else {
      setSelectedPointId(null);
      const duration = videoRef.current?.duration ? videoRef.current.duration * 1000 : 10000;
      const maxTime = Math.max(duration, points.length ? Math.max(...points.map(p => p.time)) + 1000 : 10000);
      const time = (x / canvas.width) * maxTime;
      const pos = Math.round(100 - (y / canvas.height) * 100);
      const newPoint = { id: crypto.randomUUID(), time, pos };
      setPoints(prev => [...prev, newPoint]);
      setSelectedPointId(newPoint.id);
    }
  };

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDragging.current || !selectedPointId) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const duration = videoRef.current?.duration ? videoRef.current.duration * 1000 : 10000;
    const maxTime = Math.max(duration, points.length ? Math.max(...points.map(p => p.time)) + 1000 : 10000);
    const newTime = Math.max(0, (x / canvas.width) * maxTime);
    const newPos = Math.max(0, Math.min(100, Math.round(100 - (y / canvas.height) * 100)));
    setPoints(pts => pts.map(p => p.id === selectedPointId ? { ...p, time: newTime, pos: newPos } : p));
    if (realtimeTest && connected && key) {
      setHDSP(key, newPos, 87);
    }
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

  // ─────────────── Visual Trigger ───────────────

  const handleVtVideoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    vtVideoUrl.current = url;
    const video = vtVideoRef.current!;
    video.src = url;
    video.currentTime = 0;
    video.onloadedmetadata = () => {
      setVtEndTime(Math.round(video.duration));
    };
    video.onloadeddata = () => {
      setVtVideoLoaded(true);
      drawVtFrame();
    };
  };

  const drawVtFrame = useCallback(() => {
    const canvas = vtCanvasRef.current;
    const video = vtVideoRef.current;
    if (!canvas || !video) return;
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 360;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(video, 0, 0);
    if (vtZone) {
      ctx.strokeStyle = "hsl(186, 100%, 50%)";
      ctx.lineWidth = 2;
      ctx.strokeRect(vtZone.x - 2, vtZone.y - 2, 9, 9);
      ctx.fillStyle = "rgba(0,229,255,0.25)";
      ctx.fillRect(vtZone.x - 2, vtZone.y - 2, 9, 9);
    }
  }, [vtZone]);

  useEffect(() => {
    if (vtVideoLoaded) drawVtFrame();
  }, [vtZone, vtVideoLoaded, drawVtFrame]);

  const handleVtCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = vtCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = Math.round((e.clientX - rect.left) * scaleX);
    const y = Math.round((e.clientY - rect.top) * scaleY);
    setVtZone({ x, y });
    setVtSampledColor(null);
  };

  const sampleColor = () => {
    const canvas = vtCanvasRef.current;
    if (!canvas || !vtZone) return;
    const ctx = canvas.getContext("2d")!;
    const data = ctx.getImageData(vtZone.x, vtZone.y, 5, 5).data;
    let r = 0, g = 0, b = 0, a = 0;
    for (let i = 0; i < data.length; i += 4) {
      r += data[i]; g += data[i + 1]; b += data[i + 2]; a += data[i + 3];
    }
    const n = 25;
    setVtSampledColor([Math.round(r / n), Math.round(g / n), Math.round(b / n), Math.round(a / n)]);
  };

  const colorDistance = (a: number[], b: number[]) =>
    Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2 + (a[3] - b[3]) ** 2);

  const runAnalysis = async () => {
    const video = vtVideoRef.current;
    const canvas = vtCanvasRef.current;
    if (!video || !canvas || !vtZone || !vtSampledColor) return;

    setVtAnalyzing(true);
    setVtProgress(0);
    setVtPreviewPoints([]);

    const startMs = vtStartTime * 1000;
    const endMs = vtEndTime > 0 ? vtEndTime * 1000 : video.duration * 1000;
    // Step at video frame cadence (~30fps = 33ms per frame)
    const stepMs = Math.round(1000 / 30);
    const generated: Point[] = [];
    let lastState = false;
    let t = startMs;
    const rangeMs = endMs - startMs;

    while (t <= endMs) {
      video.currentTime = t / 1000;
      await new Promise<void>(res => {
        const onSeeked = () => { video.removeEventListener("seeked", onSeeked); res(); };
        video.addEventListener("seeked", onSeeked);
      });
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const px = ctx.getImageData(vtZone.x, vtZone.y, 5, 5).data;
      let r = 0, g = 0, b = 0, a = 0;
      for (let i = 0; i < px.length; i += 4) { r += px[i]; g += px[i + 1]; b += px[i + 2]; a += px[i + 3]; }
      const avg = [r / 25, g / 25, b / 25, a / 25];
      const dist = colorDistance(avg, vtSampledColor);
      const matched = dist < vtTolerance;

      if (matched !== lastState) {
        generated.push({ id: crypto.randomUUID(), time: t, pos: matched ? vtOnPos : vtOffPos });
        lastState = matched;
      }

      t += stepMs;
      setVtProgress(Math.round(((t - startMs) / rangeMs) * 100));
    }

    setVtPreviewPoints(generated);
    setVtAnalyzing(false);
  };

  const commitPreviewPoints = () => {
    setPoints(prev => [...prev, ...vtPreviewPoints]);
    setVtPreviewPoints([]);
  };

  return (
    <div className="p-6 h-full flex flex-col max-w-[1600px] mx-auto gap-6">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Scripter</h1>
          <p className="text-muted-foreground">Create and edit Funscripts.</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
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
          <Button onClick={exportScript} disabled={points.length === 0} data-testid="button-export-script">
            <Download className="mr-2 h-4 w-4" /> Export .funscript
          </Button>
        </div>
      </div>

      <Tabs defaultValue="visual" className="flex-1 flex flex-col min-h-0">
        <TabsList className="bg-card/50 w-fit">
          <TabsTrigger value="timeline">Timeline Editor</TabsTrigger>
          <TabsTrigger value="visual">Visual Trigger</TabsTrigger>
        </TabsList>

        {/* Timeline Tab */}
        <TabsContent value="timeline" className="flex-1 flex flex-col gap-4 mt-4 min-h-0">
          <div className="flex gap-4 items-center bg-card/50 p-4 rounded-lg border border-border">
            <Button variant="secondary" className="relative cursor-pointer" size="sm">
              <span>Load Reference Video</span>
              <input type="file" accept="video/*" className="absolute inset-0 opacity-0 cursor-pointer" onChange={handleVideoUpload} />
            </Button>
            <Button variant="outline" className="relative cursor-pointer" size="sm" data-testid="button-import-funscript">
              <Upload className="mr-2 h-4 w-4" />
              <span>Import .funscript</span>
              <input
                type="file"
                accept=".funscript,.json,application/json"
                className="absolute inset-0 opacity-0 cursor-pointer"
                onChange={handleImportFunscript}
              />
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

          <Card className="bg-black border-border/50 relative overflow-hidden flex-shrink-0 group">
            <canvas
              ref={canvasRef}
              width={1600}
              height={300}
              className="w-full h-[300px] cursor-crosshair"
              onMouseDown={handleCanvasMouseDown}
              onMouseMove={handleCanvasMouseMove}
              onMouseUp={handleCanvasMouseUp}
              onMouseLeave={handleCanvasMouseUp}
            />
            {points.length === 0 && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none text-muted-foreground">
                Click anywhere to add control points
              </div>
            )}
            {selectedPointId && (
              <div className="absolute top-4 right-4 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <Button variant="destructive" size="icon" onClick={deleteSelected} title="Delete selected point">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            )}
          </Card>

          <div className="flex justify-between text-sm text-muted-foreground px-2">
            <span>Points: {points.length}</span>
            <Button variant="ghost" size="sm" onClick={() => setPoints([])} className="text-destructive hover:text-destructive h-8">Clear All</Button>
          </div>

          {videoUrl && (
            <div className="flex-1 min-h-0 bg-black rounded-lg border border-border/50 overflow-hidden mt-4">
              <video
                ref={videoRef}
                src={videoUrl}
                className="w-full h-full object-contain"
                controls
                preload="auto"
                onLoadedData={e => { const v = e.currentTarget; v.currentTime = 0; v.pause(); }}
              />
            </div>
          )}
        </TabsContent>

        {/* Visual Trigger Tab */}
        <TabsContent value="visual" className="flex-1 flex flex-col gap-4 mt-4 min-h-0 overflow-auto">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Video preview */}
            <div className="lg:col-span-2 space-y-3">
              <div className="flex gap-3 items-center">
                <Button variant="secondary" size="sm" className="relative cursor-pointer">
                  <span>Load Video</span>
                  <input type="file" accept="video/*" className="absolute inset-0 opacity-0 cursor-pointer" onChange={handleVtVideoUpload} />
                </Button>
                {vtVideoLoaded && (
                  <span className="text-xs text-muted-foreground">Click on the video to pin the 5×5 sampling zone</span>
                )}
              </div>
              <div className="relative bg-black rounded-lg border border-border/50 overflow-hidden min-h-[200px] flex items-center justify-center">
                {!vtVideoLoaded && (
                  <span className="text-muted-foreground text-sm">No video loaded</span>
                )}
                <canvas
                  ref={vtCanvasRef}
                  className={`w-full ${vtVideoLoaded ? "block cursor-crosshair" : "hidden"}`}
                  onClick={handleVtCanvasClick}
                />
                <video ref={vtVideoRef} className="hidden" />
              </div>
              {vtVideoLoaded && (
                <input
                  type="range"
                  min={0}
                  max={vtVideoRef.current?.duration || 100}
                  step={0.033}
                  defaultValue={0}
                  className="w-full accent-cyan-400"
                  onChange={e => {
                    if (vtVideoRef.current) {
                      vtVideoRef.current.currentTime = Number(e.target.value);
                      drawVtFrame();
                    }
                  }}
                />
              )}
            </div>

            {/* Controls */}
            <div className="space-y-4">
              <Card className="bg-card/50 border-primary/20">
                <CardContent className="p-4 space-y-4">
                  <div>
                    <p className="text-sm font-medium mb-1">Sampled Color</p>
                    {vtSampledColor ? (
                      <div className="flex items-center gap-3">
                        <div
                          className="w-10 h-10 rounded border border-border"
                          style={{ backgroundColor: `rgb(${vtSampledColor[0]},${vtSampledColor[1]},${vtSampledColor[2]})` }}
                        />
                        <span className="text-xs font-mono text-muted-foreground">
                          rgb({vtSampledColor[0]},{vtSampledColor[1]},{vtSampledColor[2]})
                        </span>
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">Pin a zone first, then sample</p>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-2 w-full"
                      disabled={!vtZone}
                      onClick={sampleColor}
                      data-testid="button-vt-sample"
                    >
                      Sample Color at Zone
                    </Button>
                  </div>

                  <div>
                    <div className="flex justify-between mb-1">
                      <span className="text-sm font-medium">Color Tolerance</span>
                      <span className="text-sm font-mono text-primary">{vtTolerance}</span>
                    </div>
                    <Slider min={5} max={150} step={1} value={[vtTolerance]} onValueChange={v => setVtTolerance(v[0])} />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-muted-foreground">On Pos (matched)</label>
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={vtOnPos}
                        onChange={e => setVtOnPos(Number(e.target.value))}
                        className="w-full bg-input rounded px-2 py-1 text-sm mt-1 border border-border"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground">Off Pos (no match)</label>
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={vtOffPos}
                        onChange={e => setVtOffPos(Number(e.target.value))}
                        className="w-full bg-input rounded px-2 py-1 text-sm mt-1 border border-border"
                      />
                    </div>
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

                  <Button
                    className="w-full"
                    disabled={!vtZone || !vtSampledColor || vtAnalyzing}
                    onClick={runAnalysis}
                    data-testid="button-vt-analyze"
                  >
                    {vtAnalyzing ? `Analyzing... ${vtProgress}%` : "Analyze Video"}
                  </Button>

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
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
