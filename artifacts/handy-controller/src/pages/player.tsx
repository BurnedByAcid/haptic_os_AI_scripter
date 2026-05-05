import { useState, useEffect, useRef, useCallback } from "react";
import { useAuth } from "@clerk/react";
import { useFeatureTracking } from "@/hooks/use-analytics";
import { useHandy } from "@/hooks/use-handy";
import { syncEngine, hsspEngine, Funscript, HSSPStatus } from "@/lib/scriptSync";
import { setHDSP, stopDevice } from "@/lib/handyApi";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Upload, Zap, Link2, Video, Circle, StopCircle, Download, Loader2, CheckCircle2, WifiOff } from "lucide-react";
import { FunscriptWaveform } from "@/components/funscript-waveform";
import { VideoControlBar } from "@/components/video-control-bar";
import { useToast } from "@/hooks/use-toast";
import { validateAndParseFunscriptFile } from "@/lib/validation";
import { useBlockedReport } from "@/contexts/blocked-report-context";
import { useAppSettings } from "@/hooks/use-app-settings";
import { buildScriptExport, triggerDownload } from "@/lib/script-export";

const API_BASE = import.meta.env.VITE_API_URL ?? "";

function parseFunscript(json: unknown): Funscript {
  if (typeof json !== "object" || json === null) throw new Error("Not an object");
  const obj = json as Record<string, unknown>;
  if (!Array.isArray(obj.actions)) throw new Error("Missing actions array");
  for (let i = 0; i < Math.min(obj.actions.length, 10); i++) {
    const a = obj.actions[i] as Record<string, unknown>;
    if (typeof a.at !== "number" || typeof a.pos !== "number")
      throw new Error(`actions[${i}] must have numeric at and pos`);
  }
  return obj as unknown as Funscript;
}

type VideoMode = "file" | "url" | "embed";

function detectEmbedUrl(raw: string): { embedUrl: string; mode: VideoMode } | null {
  try {
    const url = new URL(raw);
    const h = url.hostname.replace("www.", "");

    if (h === "youtube.com" || h === "youtu.be") {
      const vid = h === "youtu.be" ? url.pathname.slice(1) : url.searchParams.get("v");
      if (vid) return { embedUrl: `https://www.youtube.com/embed/${vid}?autoplay=0&rel=0`, mode: "embed" };
    }
    if (h === "pornhub.com") {
      const key = url.searchParams.get("viewkey");
      if (key) return { embedUrl: `https://www.pornhub.com/embed/${key}`, mode: "embed" };
      const m = url.pathname.match(/\/embed\/(\w+)/);
      if (m) return { embedUrl: raw, mode: "embed" };
    }
    if (h === "xvideos.com") {
      const m = url.pathname.match(/\/video(\d+)\//);
      if (m) return { embedUrl: `https://www.xvideos.com/embedframe/${m[1]}`, mode: "embed" };
    }
    if (h === "xhamster.com" || h === "xhamster.desi") {
      const m = url.pathname.match(/\/(videos|xhamster)\/.*-(\d+)/);
      if (m) return { embedUrl: `https://xhamster.com/xembed.php?video=${m[2]}`, mode: "embed" };
    }
    if (h === "redtube.com") {
      const m = url.pathname.match(/\/(\d+)/);
      if (m) return { embedUrl: `https://embed.redtube.com/?id=${m[1]}&bgcolor=000000`, mode: "embed" };
    }
    if (h === "vimeo.com") {
      const m = url.pathname.match(/\/(\d+)/);
      if (m) return { embedUrl: `https://player.vimeo.com/video/${m[1]}`, mode: "embed" };
    }
    if (/\.(mp4|webm|ogg|mov)(\?.*)?$/.test(url.pathname)) {
      return { embedUrl: raw, mode: "url" };
    }
    return { embedUrl: raw, mode: "embed" };
  } catch {
    return null;
  }
}

interface RecordedAction { at: number; pos: number }

function SyncBadge({ status }: { status: HSSPStatus }) {
  if (status === "uploading") {
    return (
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-muted/60 px-3 py-1.5 rounded-full">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Syncing script…
      </div>
    );
  }
  if (status === "ready") {
    return (
      <div className="flex items-center gap-1.5 text-xs text-green-600 bg-green-500/10 px-3 py-1.5 rounded-full">
        <CheckCircle2 className="h-3.5 w-3.5" />
        HSSP Synced
      </div>
    );
  }
  if (status === "error") {
    return (
      <div className="flex items-center gap-1.5 text-xs text-amber-500 bg-amber-500/10 px-3 py-1.5 rounded-full">
        <WifiOff className="h-3.5 w-3.5" />
        HDSP Fallback
      </div>
    );
  }
  return null;
}

export default function Player() {
  useFeatureTracking("player");
  const { key, connected, recordAppModeChange } = useHandy();
  const { getToken } = useAuth();
  const { toast } = useToast();
  const { scriptOutputFiletype } = useAppSettings();
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoMode, setVideoMode] = useState<VideoMode>("file");
  const [urlInput, setUrlInput] = useState("");
  const [embedUrl, setEmbedUrl] = useState<string | null>(null);
  const [scripts, setScripts] = useState<(Funscript | null)[]>([null, null, null, null]);
  const [activeScriptIdx, setActiveScriptIdx] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [finishMode, setFinishMode] = useState(false);
  const [hsspStatus, setHsspStatus] = useState<HSSPStatus>("idle");
  /** True once hsspStatus has reached "error"; cleared after the recovery toast fires. */
  const hadHsspErrorRef = useRef(false);
  const finishTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Script recording state
  const [isRecording, setIsRecording] = useState(false);
  const [recordedActions, setRecordedActions] = useState<RecordedAction[]>([]);
  const recordRef = useRef({ isRecording: false, actions: [] as RecordedAction[] });

  // Keep engine keys in sync
  useEffect(() => {
    syncEngine.setKey(key);
    hsspEngine.setKey(key);
  }, [key]);

  // Keep a stable ref to toast so the subscription effect never needs to re-run.
  const toastRef = useRef(toast);
  useEffect(() => { toastRef.current = toast; }, [toast]);

  // Subscribe to HSSP status changes and errors — registered once, never re-registered.
  useEffect(() => {
    hsspEngine.onStatus(setHsspStatus);
    hsspEngine.onError((msg) => {
      toastRef.current({
        title: "Script upload failed — using direct sync instead",
        description: msg,
        variant: "destructive",
      });
    });
    // Empty deps: register exactly once. toastRef always holds the latest toast.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load item passed from Library / Community.
  // Runs once on mount. For unknown page URLs (e.g. txxx.com, spankbang.com) we
  // resolve via yt-dlp rather than falling back to a broken iframe embed.
  useEffect(() => {
    const pendingVideoUrl = localStorage.getItem("handy_pending_video_url");
    const pendingScript   = localStorage.getItem("handy_pending_script");

    localStorage.removeItem("handy_pending_video_url");
    localStorage.removeItem("handy_pending_video_name");
    localStorage.removeItem("handy_pending_script");
    localStorage.removeItem("handy_pending_script_name");

    if (pendingScript) {
      try {
        const script = parseFunscript(JSON.parse(pendingScript));
        setScripts([script, null, null, null]);
        setActiveScriptIdx(0);
      } catch (e) { console.error("Invalid funscript from library:", e); }
    }

    if (!pendingVideoUrl) return;

    // Local blob / file references — use as-is
    if (pendingVideoUrl.startsWith("blob:") || pendingVideoUrl.startsWith("file:")) {
      setVideoUrl(pendingVideoUrl);
      setEmbedUrl(null);
      setVideoMode("file");
      return;
    }

    const detected = detectEmbedUrl(pendingVideoUrl);
    if (!detected) return; // malformed URL

    if (detected.mode === "url") {
      // Direct video file
      setVideoUrl(detected.embedUrl);
      setEmbedUrl(null);
      setVideoMode("url");
      return;
    }

    if (detected.embedUrl !== pendingVideoUrl) {
      // Known embed platform — rewritten to embed URL
      setEmbedUrl(detected.embedUrl);
      setVideoUrl(null);
      setVideoMode("embed");
      return;
    }

    // Unknown page URL — resolve via yt-dlp for direct playback (async)
    void (async () => {
      setUrlResolving(true);
      const cdnUrl = await resolvePageUrl(pendingVideoUrl);
      setUrlResolving(false);
      if (cdnUrl) {
        setVideoUrl(cdnUrl);
        setEmbedUrl(null);
        setVideoMode("url");
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeScript = scripts[activeScriptIdx];

  // Sync HDSP engine with active script
  useEffect(() => {
    syncEngine.setScript(activeScript);
  }, [activeScript]);

  // When active script changes, upload to HSSP
  useEffect(() => {
    hsspEngine.reset();
    setHsspStatus("idle");
    // Note: hadHsspErrorRef is intentionally NOT cleared here — if a previous
    // prepare() failed, a retry (same or new script) that succeeds should still
    // fire the recovery toast to close the UX loop.
    if (activeScript && key) {
      recordAppModeChange(2);
      hsspEngine.prepare(activeScript);
    }
  }, [activeScript, key, recordAppModeChange]);

  useEffect(() => {
    if (videoRef.current) {
      syncEngine.setVideo(videoRef.current);
    }
  }, [videoUrl]);

  // HDSP fallback loop — only active when HSSP is not ready
  useEffect(() => {
    if (isPlaying && hsspStatus !== "ready") {
      syncEngine.start();
    } else {
      syncEngine.stop();
    }
    return () => syncEngine.stop();
  }, [isPlaying, hsspStatus]);

  // When HSSP becomes ready mid-playback, migrate from HDSP fallback to HSSP immediately.
  // This effect only fires on hsspStatus changes to avoid running on every isPlaying toggle.
  useEffect(() => {
    if (hsspStatus === "ready" && isPlaying && videoRef.current) {
      const posMs = videoRef.current.currentTime * 1000;
      hsspEngine.play(posMs);
    }

    // Track whether we've ever hit an error so we can detect recovery even
    // though prepare() transitions error → uploading → ready (not directly).
    if (hsspStatus === "error") {
      hadHsspErrorRef.current = true;
    }

    // Fire a success toast when recovering from a previous error state
    if (hsspStatus === "ready" && hadHsspErrorRef.current) {
      hadHsspErrorRef.current = false;
      toastRef.current({
        title: "Script re-synced successfully",
        description: "HSSP sync is back online — the device is now server-synced.",
      });
    }

    // isPlaying intentionally omitted: we only want to fire on status transition
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hsspStatus]);

  const handleVideoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) { setVideoUrl(URL.createObjectURL(file)); setVideoMode("file"); setEmbedUrl(null); }
  };

  const [urlResolving, setUrlResolving] = useState(false);

  // Resolve a page URL to a direct CDN URL via yt-dlp on the backend.
  // Returns the CDN URL on success, or null on failure (toast shown).
  const resolvePageUrl = useCallback(async (pageUrl: string): Promise<string | null> => {
    try {
      const token = await getToken();
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch(
        `${API_BASE}/api/video/resolve?url=${encodeURIComponent(pageUrl)}`,
        { headers }
      );
      const data = await res.json() as { cdnUrl?: string; error?: string };
      if (!res.ok || !data.cdnUrl) {
        toast({
          title: "Couldn't resolve video URL",
          description: data.error ?? "Paste a direct .mp4 link or load a file instead.",
          variant: "destructive",
        });
        return null;
      }
      return data.cdnUrl;
    } catch {
      toast({ title: "Network error resolving video URL", variant: "destructive" });
      return null;
    }
  }, [getToken, toast]);

  const handleUrlLoad = async () => {
    let raw = urlInput.trim();
    if (!raw) return;

    // ── Embed-code handling ───────────────────────────────────────────────────
    // If the user pasted an <iframe src="…"> snippet (copied from a site's
    // share/embed menu), extract the src and use it directly as the embed URL.
    const embedMatch = raw.match(/src=["']([^"']+)["']/i);
    if (embedMatch) {
      const src = embedMatch[1];
      try { new URL(src); } catch { return; } // malformed src — ignore
      setEmbedUrl(src);
      setVideoUrl(null);
      setVideoMode("embed");
      return;
    }

    const detected = detectEmbedUrl(raw);
    if (!detected) return; // malformed URL

    // Direct video file (.mp4 / .webm / etc.) — load immediately.
    if (detected.mode === "url") {
      setVideoUrl(detected.embedUrl);
      setEmbedUrl(null);
      setVideoMode("url");
      return;
    }

    // Known embed platform: detectEmbedUrl rewrote the URL to an embed form.
    if (detected.embedUrl !== raw) {
      setEmbedUrl(detected.embedUrl);
      setVideoUrl(null);
      setVideoMode("embed");
      return;
    }

    // Unknown page URL — try yt-dlp resolution for direct playback.
    setUrlResolving(true);
    const cdnUrl = await resolvePageUrl(raw);
    setUrlResolving(false);
    if (cdnUrl) {
      setVideoUrl(cdnUrl);
      setEmbedUrl(null);
      setVideoMode("url");
    }
    // If resolution fails, resolvePageUrl already shows a toast.
  };

  const { reportAction } = useBlockedReport();

  const handleScriptUpload = async (idx: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    try {
      const script = await validateAndParseFunscriptFile(file);
      const newScripts = [...scripts];
      newScripts[idx] = script as Funscript;
      setScripts(newScripts);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not load script.";
      toast({
        title: "Invalid funscript",
        description: msg,
        variant: "destructive",
        action: reportAction({ kind: "player_file", item: file.name, blockMessage: msg }),
      });
    }
  };

  const handlePlayPause = () => {
    if (videoRef.current) {
      if (videoRef.current.paused) {
        videoRef.current.play();
      } else {
        videoRef.current.pause();
      }
    }
  };

  const handlePlay = useCallback(async () => {
    setIsPlaying(true);
    if (hsspStatus === "ready" && videoRef.current) {
      const posMs = videoRef.current.currentTime * 1000;
      await hsspEngine.play(posMs);
    }
    // HDSP fallback loop is started by the effect above
  }, [hsspStatus]);

  const handlePause = useCallback(async () => {
    setIsPlaying(false);
    syncEngine.stop();
    if (hsspStatus === "ready") {
      await hsspEngine.pause();
    } else if (connected && key) {
      stopDevice(key);
    }
  }, [hsspStatus, connected, key]);

  const handleSeeking = useCallback(() => {
    syncEngine.stop();
  }, []);

  const handleSeeked = useCallback(async () => {
    if (!isPlaying) return;
    if (hsspStatus === "ready" && videoRef.current) {
      const posMs = videoRef.current.currentTime * 1000;
      await hsspEngine.seek(posMs);
    } else {
      syncEngine.start();
    }
  }, [isPlaying, hsspStatus]);

  const triggerFinishMode = useCallback(() => {
    if (!connected || !key) return;
    setFinishMode(true);
    let count = 0;
    const burst = () => {
      if (count >= 10) { stopDevice(key); setFinishMode(false); return; }
      setHDSP(key, count % 2 === 0 ? 100 : 0, 87);
      count++;
      finishTimerRef.current = setTimeout(burst, 80);
    };
    burst();
  }, [connected, key]);

  useEffect(() => () => { if (finishTimerRef.current) clearTimeout(finishTimerRef.current); }, []);

  // Recording
  const startRecording = () => {
    recordRef.current = { isRecording: true, actions: [] };
    setRecordedActions([]);
    setIsRecording(true);
  };

  const recordPoint = () => {
    if (!videoRef.current || !recordRef.current.isRecording) return;
    const at = Math.round(videoRef.current.currentTime * 1000);
    const action = { at, pos: recordRef.current.actions.length % 2 === 0 ? 100 : 0 };
    recordRef.current.actions = [...recordRef.current.actions, action];
    setRecordedActions([...recordRef.current.actions]);
  };

  const stopRecording = () => {
    setIsRecording(false);
    recordRef.current.isRecording = false;
    const actions = recordRef.current.actions;
    if (actions.length < 2) return;
    const script: Funscript = { actions };
    const newScripts = [...scripts];
    newScripts[activeScriptIdx] = script;
    setScripts(newScripts);
  };

  const downloadRecordedScript = () => {
    const actions = recordedActions;
    if (!actions.length) return;
    const { content, mimeType, ext } = buildScriptExport(actions, scriptOutputFiletype);
    triggerDownload(content, `recorded.${ext}`, mimeType);
  };

  const hasVideo = videoUrl || embedUrl;

  return (
    <div className="p-6 h-full flex flex-col max-w-[1600px] mx-auto gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Player</h1>
          <p className="text-muted-foreground">Sync video with Funscripts — local files or external sites.</p>
        </div>
        <div className="flex items-center gap-3">
          <SyncBadge status={hsspStatus} />
          {!connected && (
            <div className="bg-destructive/10 text-destructive px-4 py-2 rounded-md font-medium text-sm">
              Device Not Connected
            </div>
          )}
        </div>
      </div>

      {/* URL input bar */}
      <Card className="border-border/50 bg-card/50">
        <CardContent className="pt-4 pb-3">
          <div className="flex gap-2">
            <div className="flex rounded-md border border-border/50 overflow-hidden text-xs">
              <button
                className={`px-3 py-1.5 flex items-center gap-1.5 transition-colors ${videoMode === "file" ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-foreground"}`}
                onClick={() => setVideoMode("file")}
              >
                <Video className="h-3.5 w-3.5" /> Local File
              </button>
              <button
                className={`px-3 py-1.5 flex items-center gap-1.5 border-l border-border/50 transition-colors ${videoMode !== "file" ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-foreground"}`}
                onClick={() => setVideoMode("url")}
              >
                <Link2 className="h-3.5 w-3.5" /> Video URL
              </button>
            </div>
            {videoMode !== "file" ? (
              <>
                <Input
                  className="flex-1 h-9 text-sm bg-background/50 border-border/50"
                  placeholder="Paste a URL or an <iframe src=…> embed code…"
                  value={urlInput}
                  onChange={e => setUrlInput(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && handleUrlLoad()}
                />
                <Button size="sm" className="h-9 px-4" onClick={handleUrlLoad}>Load</Button>
              </>
            ) : (
              <Button className="h-9 relative px-4 text-sm">
                <span>Browse Files</span>
                <input type="file" accept="video/*" className="absolute inset-0 opacity-0 cursor-pointer" onChange={handleVideoUpload} />
              </Button>
            )}
          </div>
          {videoMode !== "file" && (
            <p className="text-[11px] text-muted-foreground mt-1.5 ml-1">
  Supports page URLs (YouTube, Pornhub, xVideos, xHamster, RedTube, Vimeo) and embed codes — paste the &lt;iframe&gt; from any site&apos;s share menu
            </p>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 flex-1 min-h-0">
        <div className="lg:col-span-2 flex flex-col gap-4">
          <Card className="flex-1 bg-black overflow-hidden relative border-border/50 min-h-[300px] flex flex-col">
            {videoUrl ? (
              <div className="flex-1 min-h-0 relative group">
                <video
                  ref={videoRef}
                  src={videoUrl}
                  className="w-full h-full object-contain"
                  onPlay={handlePlay}
                  onPause={handlePause}
                  onSeeking={handleSeeking}
                  onSeeked={handleSeeked}
                  onLoadedData={e => { const v = e.currentTarget; v.currentTime = 0; v.pause(); }}
                  preload="auto"
                  controls={false}
                />

                {/* Tap-anywhere Finish Mode zone */}
                {isPlaying && connected && !finishMode && !isRecording && (
                  <div
                    className="absolute inset-0 flex items-end justify-center pb-6 cursor-pointer select-none"
                    onClick={e => { e.stopPropagation(); triggerFinishMode(); }}
                    title="Tap anywhere to trigger Finish Mode"
                  >
                    <div className="opacity-0 hover:opacity-100 transition-opacity duration-200 bg-black/60 backdrop-blur text-white text-sm font-bold px-6 py-3 rounded-full border border-white/30 flex items-center gap-2 pointer-events-none">
                      <Zap className="h-4 w-4 text-primary" /> Tap anywhere → Finish Mode
                    </div>
                  </div>
                )}

                {/* Recording overlay */}
                {isRecording && (
                  <div className="absolute inset-0 border-4 border-red-500 pointer-events-none">
                    <div className="absolute top-3 left-3 flex items-center gap-2 bg-red-600/90 text-white text-sm font-bold px-3 py-1.5 rounded-full">
                      <Circle className="h-3 w-3 fill-white animate-pulse" /> RECORDING
                    </div>
                    <div className="absolute bottom-6 left-1/2 -translate-x-1/2 text-white text-xs bg-black/60 backdrop-blur px-3 py-1.5 rounded-full">
                      {recordedActions.length} strokes recorded
                    </div>
                  </div>
                )}

                {finishMode && (
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className="bg-primary/20 border border-primary rounded-full px-8 py-4 text-primary font-bold text-xl animate-pulse">
                      <Zap className="inline mr-2 h-6 w-6" /> FINISHING...
                    </div>
                  </div>
                )}
              </div>
            ) : embedUrl ? (
              <div className="flex-1 min-h-0 relative">
                <iframe
                  src={embedUrl}
                  className="w-full h-full border-0"
                  allowFullScreen
                  allow="autoplay; fullscreen; picture-in-picture"
                  title="Embedded video"
                />
                {recordedActions.length > 0 && (
                  <div className="absolute top-3 right-3 bg-black/80 text-white text-xs px-3 py-1.5 rounded-full">
                    {recordedActions.length} strokes recorded
                  </div>
                )}
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground p-8 text-center">
                <Upload className="h-12 w-12 mb-4 opacity-50" />
                <h3 className="text-xl font-medium text-foreground mb-2">No Video Loaded</h3>
                <p className="mb-4 max-w-sm text-sm">Load a local file or paste a URL from YouTube, Pornhub, xVideos, and more.</p>
              </div>
            )}

            {/* Controls strip — directly below the video, inside the card */}
            {videoUrl && (
              <div className="bg-card/80 border-t border-border/40 px-4 py-2 flex-shrink-0">
                <VideoControlBar
                  videoRef={videoRef}
                  extraControls={isRecording ? (
                    <Button size="sm" variant="destructive" onClick={recordPoint} className="text-xs h-7 gap-1.5 font-bold">
                      ● STROKE
                    </Button>
                  ) : undefined}
                />
              </div>
            )}
          </Card>

          {/* Funscript waveform */}
          <Card className="border-border/50 bg-card/50 overflow-hidden">
            <div className="px-4 pt-3 pb-1 flex items-center justify-between">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Waveform</span>
              {activeScript && (
                <span className="text-[10px] text-muted-foreground">{activeScript.actions.length} points · click to seek</span>
              )}
            </div>
            <FunscriptWaveform
              script={activeScript ?? null}
              videoRef={videoRef}
              className="w-full"
              style={{ height: "96px" }}
            />
          </Card>

          {/* Script recorder */}
          <Card className="border-border/50 bg-card/50">
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-semibold text-foreground">Script Recorder</span>
                <span className="text-xs text-muted-foreground">
                  {isRecording ? `${recordedActions.length} strokes` : recordedActions.length > 0 ? `${recordedActions.length} strokes saved to Slot 0${activeScriptIdx + 1}` : "Click record, then tap STROKE while watching"}
                </span>
              </div>
              <div className="flex gap-2">
                {!isRecording ? (
                  <Button size="sm" variant="outline" className="gap-1.5 text-xs border-red-500/50 text-red-400 hover:bg-red-500/10 hover:text-red-300" onClick={startRecording} disabled={!hasVideo}>
                    <Circle className="h-3 w-3 fill-red-400" /> Start Recording
                  </Button>
                ) : (
                  <>
                    <Button size="sm" variant="destructive" onClick={recordPoint} className="text-xs gap-1.5 font-bold">
                      ● STROKE
                    </Button>
                    <Button size="sm" variant="outline" onClick={stopRecording} className="text-xs gap-1.5">
                      <StopCircle className="h-3.5 w-3.5" /> Stop & Save
                    </Button>
                  </>
                )}
                {!isRecording && recordedActions.length > 0 && (
                  <Button size="sm" variant="ghost" className="text-xs gap-1.5 text-muted-foreground hover:text-foreground ml-auto" onClick={downloadRecordedScript}>
                    <Download className="h-3.5 w-3.5" /> Download .funscript
                  </Button>
                )}
              </div>
              {embedUrl && (
                <p className="text-[11px] text-amber-400/80 mt-2">
                  Note: Embedded players don't expose playback time. Use the STROKE button to manually mark stroke moments.
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <Card className="border-primary/20 bg-card/50">
            <CardHeader>
              <CardTitle>Finish Mode</CardTitle>
            </CardHeader>
            <CardContent>
              <Button
                variant={finishMode ? "destructive" : "default"}
                className="w-full h-14 text-base font-bold"
                onClick={triggerFinishMode}
                disabled={!connected || finishMode}
                data-testid="button-finish-mode"
              >
                <Zap className="mr-2 h-5 w-5" />
                {finishMode ? "Burst Active..." : "Trigger Finish"}
              </Button>
              {!connected && <p className="text-xs text-muted-foreground mt-2">Connect device to use Finish Mode</p>}
            </CardContent>
          </Card>
          <Card className="flex-1 border-primary/20 bg-card/50">
            <CardHeader>
              <CardTitle>Scripts</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {[0, 1, 2, 3].map(idx => (
                <div
                  key={idx}
                  className={`p-4 rounded-lg border-2 transition-all cursor-pointer flex flex-col gap-2 ${
                    activeScriptIdx === idx
                      ? "border-primary bg-primary/10"
                      : "border-border hover:border-primary/50"
                  }`}
                  onClick={() => setActiveScriptIdx(idx)}
                >
                  <div className="flex justify-between items-center">
                    <span className="font-mono font-bold">SLOT 0{idx + 1}</span>
                    <span className="text-xs text-muted-foreground uppercase tracking-wider">
                      {["Low", "Med", "High", "Max"][idx]} Intensity
                    </span>
                  </div>

                  {scripts[idx] ? (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-primary">
                        Loaded ({scripts[idx]?.actions.length} points)
                      </span>
                      {idx === activeScriptIdx && hsspStatus !== "idle" && (
                        <SyncBadge status={hsspStatus} />
                      )}
                    </div>
                  ) : (
                    <Button size="sm" className="w-full relative text-xs h-8">
                      <span>Load Script</span>
                      <input
                        type="file"
                        accept=".funscript,.json"
                        className="absolute inset-0 opacity-0 cursor-pointer"
                        onChange={(e) => handleScriptUpload(idx, e)}
                      />
                    </Button>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
