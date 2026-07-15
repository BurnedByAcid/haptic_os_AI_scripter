import { useState, useEffect, useRef, useCallback } from "react";
import { useAuth } from "@clerk/react";
import { useFeatureTracking } from "@/hooks/use-analytics";
import { usePageMeta } from "@/hooks/use-page-meta";
import { useHandy } from "@/hooks/use-handy";
import { enqueueRetry } from "@/hooks/use-retry-queue";
import { useSubscription } from "@/hooks/use-subscription";
import { syncEngine, hsspEngine, Funscript, HSSPStatus } from "@/lib/scriptSync";
import { stopDevice } from "@/lib/handyApi";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Upload, Link2, Video, Loader2, CheckCircle2, WifiOff } from "lucide-react";
import { VideoControlBar } from "@/components/video-control-bar";
import { useToast } from "@/hooks/use-toast";
import { validateAndParseFunscriptFile } from "@/lib/validation";
import { useBlockedReport } from "@/contexts/blocked-report-context";
import { attachHlsSource, detachHls, isHlsUrl } from "@/lib/hls-video";
import { getEntry, LibraryEntry } from "@/lib/db";
import { PlayerQueue, QueueNav, QueueState } from "@/components/player-queue";

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

// File System Access API types for loading library entries with file handles
interface FSAFileHandle extends FileSystemFileHandle {
  queryPermission(desc: { mode: "read" | "readwrite" }): Promise<PermissionState>;
  requestPermission(desc: { mode: "read" | "readwrite" }): Promise<PermissionState>;
}

export default function Player() {
  useFeatureTracking("player");
  usePageMeta({
    title: "Player — HapticOS",
    description: "Sync haptic scripts with any video and control your device in real time. Paste a URL or load a local file to get started.",
    canonical: `${window.location.origin}/player`,
    og: {
      title: "HapticOS Player — Sync Scripts with Any Video",
      description: "Sync haptic scripts with any video and control your device in real time. Paste a URL or load a local file to get started.",
      type: "website",
      image: "/og-image.png",
    },
    twitter: {
      title: "HapticOS Player — Sync Scripts with Any Video",
      description: "Sync haptic scripts with any video and control your device in real time. Paste a URL or load a local file to get started.",
      image: "/og-image.png",
    },
  });
  const { key, connected, recordAppModeChange } = useHandy();
  const { isPro, isLoaded: planLoaded } = useSubscription();
  const { getToken } = useAuth();
  const { toast } = useToast();
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoMode, setVideoMode] = useState<VideoMode>("file");
  const [urlInput, setUrlInput] = useState("");
  const [embedUrl, setEmbedUrl] = useState<string | null>(null);
  const [videoLabel, setVideoLabel] = useState<string | null>(null);
  const [videoLabelIsFile, setVideoLabelIsFile] = useState(false);
  const [scripts, setScripts] = useState<(Funscript | null)[]>([null, null, null, null]);
  const [activeScriptIdx, setActiveScriptIdx] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [hsspStatus, setHsspStatus] = useState<HSSPStatus>("idle");
  /** True once hsspStatus has reached "error"; cleared after the recovery toast fires. */
  const hadHsspErrorRef = useRef(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  // Cleanup fn returned by attachHlsSource — called when video URL changes or on unmount.
  const hlsCleanupRef = useRef<(() => void) | null>(null);


  // ── Playlist queue state ───────────────────────────────────────────────────
  const [queueState, setQueueState] = useState<QueueState | null>(null);


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

  // ── Resolve a page URL to a direct CDN URL via yt-dlp on the backend ────────
  // Declared here (before loadLibraryEntry) so it is initialized before the
  // useCallback dependency array that references it is evaluated.
  // When `silent` is true, errors are returned as null without showing a toast
  // (used when we intend to fall back gracefully to iframe mode).
  const resolvePageUrl = useCallback(async (pageUrl: string, silent = false): Promise<string | null> => {
    try {
      const token = await getToken();
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch(
        `${API_BASE}/api/video/resolve?url=${encodeURIComponent(pageUrl)}`,
        { headers }
      );
      const data = await res.json() as { token?: string; cdnUrl?: string; isHls?: boolean; error?: string };
      if (!res.ok || !data.cdnUrl) {
        if (!silent) {
          toast({
            title: "Couldn't resolve video URL",
            description: data.error ?? "Paste a direct .mp4 link or load a file instead.",
            variant: "destructive",
          });
        }
        return null;
      }
      if (data.isHls && data.token) {
        return `${API_BASE}/api/video/hls/${data.token}/manifest.m3u8`;
      }
      return data.cdnUrl;
    } catch {
      if (!silent) toast({ title: "Network error resolving video URL", variant: "destructive" });
      return null;
    }
  }, [getToken, toast]);

  // ── Load a LibraryEntry in-memory (for queue navigation) ──────────────────
  // Tries yt-dlp first for ALL http URLs so that generators and script sync
  // get a real <video> element.  Falls back to iframe only when yt-dlp fails.
  const loadLibraryEntry = useCallback(async (entry: LibraryEntry) => {
    if (entry.url) {
      const raw = entry.url;

      // Local blob/file references — use as-is
      if (raw.startsWith("blob:") || raw.startsWith("file:")) {
        setVideoUrl(raw);
        setEmbedUrl(null);
        setVideoMode("file");
        setVideoLabel(entry.name);
        setVideoLabelIsFile(true);
        return;
      }

      const detected = detectEmbedUrl(raw);
      if (!detected) return; // malformed URL

      if (detected.mode === "url") {
        // Direct video file (.mp4 / .webm / etc.)
        setVideoUrl(detected.embedUrl);
        setEmbedUrl(null);
        setVideoMode("url");
        setVideoLabel(entry.name);
        setVideoLabelIsFile(false);
        return;
      }

      // For all page URLs (known platforms + unknown) — try yt-dlp first so
      // we get a real <video> element that supports script sync and generators.
      setUrlResolving(true);
      const cdnUrl = await resolvePageUrl(raw, /* silent */ true);
      setUrlResolving(false);
      if (cdnUrl) {
        setVideoUrl(cdnUrl);
        setEmbedUrl(null);
        setVideoMode("url");
        setVideoLabel(entry.name);
        setVideoLabelIsFile(false);
        return;
      }

      // yt-dlp failed — fall back to iframe if the URL maps to a known platform
      if (detected.embedUrl !== raw) {
        setEmbedUrl(detected.embedUrl);
        setVideoUrl(null);
        setVideoMode("embed");
        setVideoLabel(entry.name);
        setVideoLabelIsFile(false);
      }
      return;
    }

    // ── Local file / blob entry ───────────────────────────────────────────
    let url: string | null = null;

    if (entry.fileHandle) {
      try {
        const fsaHandle = entry.fileHandle as unknown as FSAFileHandle;
        let perm = await fsaHandle.queryPermission({ mode: "read" });
        if (perm !== "granted") {
          perm = await fsaHandle.requestPermission({ mode: "read" });
        }
        if (perm === "granted") {
          const file = await fsaHandle.getFile();
          url = URL.createObjectURL(file);
        }
      } catch { /* fall through to blob */ }
    }

    if (!url && entry.blob) {
      url = URL.createObjectURL(entry.blob);
    }

    if (!url) return;

    if (entry.type === "video") {
      setVideoUrl(url);
      setEmbedUrl(null);
      setVideoMode("file");
      setVideoLabel(entry.name);
      setVideoLabelIsFile(true);
    } else {
      try {
        const file = entry.blob ?? (entry.fileHandle ? await entry.fileHandle.getFile() : null);
        if (file) {
          const text = await (file as Blob).text();
          try {
            const script = parseFunscript(JSON.parse(text));
            setScripts([script, null, null, null]);
            setActiveScriptIdx(0);
          } catch { /* ignore invalid script */ }
        }
      } catch { /* ignore */ }
    }
  }, [resolvePageUrl]);

  // ── Load item passed from Library / Community ──────────────────────────────
  // Runs once on mount.
  useEffect(() => {
    // ── AIScripter handoff ──────────────────────────────────────────────────
    const aiScripterRaw = sessionStorage.getItem("aiscripter_player_import");
    if (aiScripterRaw) {
      sessionStorage.removeItem("aiscripter_player_import");
      try {
        const parsed = JSON.parse(aiScripterRaw) as {
          funscript?: string;
          videoUrl?: string;
          name?: string;
        };
        if (parsed.funscript) {
          try {
            const script = parseFunscript(JSON.parse(parsed.funscript));
            setScripts([script, null, null, null]);
            setActiveScriptIdx(0);
          } catch { /* ignore invalid */ }
        }
        if (parsed.videoUrl) {
          const raw = parsed.videoUrl;
          const detected = detectEmbedUrl(raw);
          if (detected) {
            if (detected.mode === "url") {
              setVideoUrl(detected.embedUrl);
              setEmbedUrl(null);
              setVideoMode("url");
              setVideoLabel(parsed.name ?? raw);
              setVideoLabelIsFile(false);
            } else {
              setEmbedUrl(detected.embedUrl);
              setVideoUrl(null);
              setVideoMode("embed");
              setVideoLabel(parsed.name ?? raw);
              setVideoLabelIsFile(false);
            }
          }
        }
      } catch { /* ignore malformed */ }
      return;
    }

    const pendingVideoUrl  = localStorage.getItem("handy_pending_video_url");
    const pendingVideoName = localStorage.getItem("handy_pending_video_name");
    const pendingScript    = localStorage.getItem("handy_pending_script");
    const pendingPlaylist  = localStorage.getItem("handy_pending_playlist");
    localStorage.removeItem("handy_pending_video_url");
    localStorage.removeItem("handy_pending_video_name");
    localStorage.removeItem("handy_pending_script");
    localStorage.removeItem("handy_pending_script_name");
    localStorage.removeItem("handy_pending_playlist");

    // ── Playlist queue ──────────────────────────────────────────────────────
    if (pendingPlaylist) {
      try {
        const parsed = JSON.parse(pendingPlaylist) as QueueState;
        if (Array.isArray(parsed.itemIds) && parsed.itemIds.length > 0) {
          const startIndex = typeof parsed.index === "number" && parsed.index >= 0 && parsed.index < parsed.itemIds.length
            ? parsed.index
            : 0;
          setQueueState({ itemIds: parsed.itemIds, index: startIndex, playlistName: parsed.playlistName });
          // Load the entry at startIndex
          void getEntry(parsed.itemIds[startIndex]).then(entry => {
            if (entry) loadLibraryEntry(entry);
          });
          return;
        }
      } catch { /* ignore malformed */ }
    }

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
      setVideoLabel(pendingVideoName ?? pendingVideoUrl);
      setVideoLabelIsFile(true);
      return;
    }

    const detected = detectEmbedUrl(pendingVideoUrl);
    if (!detected) return; // malformed URL

    if (detected.mode === "url") {
      // Direct video file — use as-is
      setVideoUrl(detected.embedUrl);
      setEmbedUrl(null);
      setVideoMode("url");
      setVideoLabel(pendingVideoUrl);
      setVideoLabelIsFile(false);
      return;
    }

    // For all page URLs (known platforms + unknown) — try yt-dlp first so
    // we get a real <video> element that supports script sync and generators.
    void (async () => {
      setUrlResolving(true);
      const cdnUrl = await resolvePageUrl(pendingVideoUrl, /* silent */ true);
      setUrlResolving(false);
      if (cdnUrl) {
        setVideoUrl(cdnUrl);
        setEmbedUrl(null);
        setVideoMode("url");
        setVideoLabel(pendingVideoUrl);
        setVideoLabelIsFile(false);
        return;
      }
      // yt-dlp failed — fall back to iframe for known embed platforms
      if (detected.embedUrl !== pendingVideoUrl) {
        setEmbedUrl(detected.embedUrl);
        setVideoUrl(null);
        setVideoMode("embed");
        setVideoLabel(pendingVideoUrl);
        setVideoLabelIsFile(false);
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Queue navigation helpers ───────────────────────────────────────────────
  const jumpToQueueIndex = useCallback(async (idx: number) => {
    if (!queueState) return;
    const entry = await getEntry(queueState.itemIds[idx]);
    if (!entry) return;
    setQueueState(prev => prev ? { ...prev, index: idx } : null);
    await loadLibraryEntry(entry);
  }, [queueState, loadLibraryEntry]);

  const handleQueuePrev = useCallback(() => {
    if (!queueState || queueState.index === 0) return;
    jumpToQueueIndex(queueState.index - 1);
  }, [queueState, jumpToQueueIndex]);

  const handleQueueNext = useCallback(() => {
    if (!queueState || queueState.index >= queueState.itemIds.length - 1) return;
    jumpToQueueIndex(queueState.index + 1);
  }, [queueState, jumpToQueueIndex]);

  const handleQueueJump = useCallback((idx: number, entry: LibraryEntry) => {
    setQueueState(prev => prev ? { ...prev, index: idx } : null);
    loadLibraryEntry(entry);
  }, [loadLibraryEntry]);

  // ── Video ended — auto-advance queue ──────────────────────────────────────
  const queueStateRef = useRef(queueState);
  useEffect(() => { queueStateRef.current = queueState; }, [queueState]);
  const jumpToQueueIndexRef = useRef(jumpToQueueIndex);
  useEffect(() => { jumpToQueueIndexRef.current = jumpToQueueIndex; }, [jumpToQueueIndex]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onEnded = () => {
      const qs = queueStateRef.current;
      if (qs && qs.index < qs.itemIds.length - 1) {
        jumpToQueueIndexRef.current(qs.index + 1);
      }
    };
    video.addEventListener("ended", onEnded);
    return () => video.removeEventListener("ended", onEnded);
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
      if (!navigator.onLine) {
        enqueueRetry("hssp-prepare", () =>
          hsspEngine.prepare(activeScript).then(() => {})
        );
      } else {
        hsspEngine.prepare(activeScript);
      }
    }
  }, [activeScript, key, recordAppModeChange]);

  // ── HLS attachment ─────────────────────────────────────────────────────────
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !videoUrl) return;

    // Tear down any prior HLS instance
    if (hlsCleanupRef.current) {
      hlsCleanupRef.current();
      hlsCleanupRef.current = null;
    }

    if (isHlsUrl(videoUrl)) {
      // Remove the src attribute so hls.js can manage it via MSE
      video.removeAttribute("src");
      video.load();
      // Fetch the Clerk JWT and pass it to hls.js so every manifest, sub-manifest
      // and segment request includes an Authorization header.  This keeps the
      // follow-on proxy routes bound to the authenticated user.
      let cancelled = false;
      getToken().then((tok) => {
        if (cancelled || !videoRef.current) return;
        hlsCleanupRef.current = attachHlsSource(videoRef.current, videoUrl, tok);
      }).catch(() => {
        if (cancelled || !videoRef.current) return;
        hlsCleanupRef.current = attachHlsSource(videoRef.current, videoUrl);
      });
      return () => { cancelled = true; };
    }
    // Non-HLS: the <video src={videoUrl}> attribute handles it
  }, [videoUrl, getToken]);

  useEffect(() => {
    // Clean up HLS on unmount
    return () => {
      if (hlsCleanupRef.current) {
        hlsCleanupRef.current();
        hlsCleanupRef.current = null;
      }
      const video = videoRef.current;
      if (video) detachHls(video);
    };
  }, []);

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
  useEffect(() => {
    if (hsspStatus === "ready" && isPlaying && videoRef.current) {
      const posMs = videoRef.current.currentTime * 1000;
      hsspEngine.play(posMs);
    }

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

  const [urlResolving, setUrlResolving] = useState(false);

  const handleUrlLoad = async () => {
    let raw = urlInput.trim();
    if (!raw) return;

    const embedMatch = raw.match(/src=["']([^"']+)["']/i);
    if (embedMatch) {
      const src = embedMatch[1];
      let parsed: URL;
      try { parsed = new URL(src); } catch { return; }
      const allowedSchemes = ["https:", "http:"];
      if (!allowedSchemes.includes(parsed.protocol)) return;
      setEmbedUrl(src);
      setVideoUrl(null);
      setVideoMode("embed");
      setVideoLabel(raw);
      setVideoLabelIsFile(false);
      return;
    }

    const detected = detectEmbedUrl(raw);
    if (!detected) return;

    if (detected.mode === "url") {
      // Direct video file — use immediately
      setVideoUrl(detected.embedUrl);
      setEmbedUrl(null);
      setVideoMode("url");
      setVideoLabel(raw);
      setVideoLabelIsFile(false);
      return;
    }

    // For all page URLs (known platforms + unknown) — try yt-dlp first so
    // we get a real <video> element that supports script sync and generators.
    setUrlResolving(true);
    const cdnUrl = await resolvePageUrl(raw, /* silent */ true);
    setUrlResolving(false);
    if (cdnUrl) {
      setVideoUrl(cdnUrl);
      setEmbedUrl(null);
      setVideoMode("url");
      setVideoLabel(raw);
      setVideoLabelIsFile(false);
      return;
    }

    // yt-dlp failed — fall back to iframe if it's a known embed platform
    if (detected.embedUrl !== raw) {
      setEmbedUrl(detected.embedUrl);
      setVideoUrl(null);
      setVideoMode("embed");
      setVideoLabel(raw);
      setVideoLabelIsFile(false);
      toast({
        title: "Playing in embedded mode",
        description: "Script sync isn't available for embedded videos. Download the video file and load it locally for full sync.",
      });
      return;
    }

    // Unknown URL — yt-dlp failed and no embed fallback; show error
    toast({
      title: "Couldn't load video",
      description: "This site blocked direct resolution. Try a direct .mp4 link, or download the video and load it as a file.",
      variant: "destructive",
    });
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


  const hasVideo = videoUrl || embedUrl;

  // Queue nav extra controls for the video control bar — only truthy when rendered
  const hasQueueNav = queueState != null && queueState.itemIds.length > 1;
  const queueNavControls = hasQueueNav ? (
    <QueueNav
      queue={queueState}
      onPrev={handleQueuePrev}
      onNext={handleQueueNext}
    />
  ) : undefined;

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
                <Button size="sm" className="h-9 px-4 gap-1.5" onClick={handleUrlLoad} disabled={urlResolving}>
                  {urlResolving ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Resolving…</> : "Load"}
                </Button>
              </>
            ) : (
              <Button className="h-9 relative px-4 text-sm">
                <span>Load Script</span>
                <input type="file" accept=".funscript,.json" className="absolute inset-0 opacity-0 cursor-pointer" onChange={(e) => handleScriptUpload(0, e)} />
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
          {/* Video source label */}
          {(videoUrl || embedUrl) && videoLabel && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground min-w-0">
              {videoLabelIsFile
                ? <Video className="h-3.5 w-3.5 shrink-0" />
                : <Link2 className="h-3.5 w-3.5 shrink-0" />}
              <span className="truncate" title={videoLabel}>{videoLabel}</span>
            </div>
          )}
          {/* Video card */}
          <Card className="bg-black overflow-hidden relative border-border/50 flex flex-col" style={{ minHeight: "380px" }}>
              {videoUrl ? (
                <div className="flex-1 min-h-0 relative group">
                  <video
                    ref={videoRef}
                    src={videoUrl && !isHlsUrl(videoUrl) ? videoUrl : undefined}
                    className="w-full h-full object-contain"
                    onPlay={handlePlay}
                    onPause={handlePause}
                    onSeeking={handleSeeking}
                    onSeeked={handleSeeked}
                    onLoadedData={e => { const v = e.currentTarget; v.currentTime = 0; v.pause(); }}
                    preload="auto"
                    controls={false}
                  />

                </div>
              ) : embedUrl ? (
                <div className="flex-1 min-h-0 relative flex flex-col">
                  <div className="bg-amber-950/60 border-b border-amber-700/40 px-4 py-2 flex items-center gap-2 text-xs text-amber-300 shrink-0">
                    <WifiOff className="h-3.5 w-3.5 shrink-0" />
                    <span>
                      <strong>Embedded mode</strong> — script sync and generators won&apos;t work.
                      For full sync, download the video and load it as a local file.
                    </span>
                  </div>
                  <iframe
                    src={embedUrl}
                    className="flex-1 border-0"
                    allowFullScreen
                    allow="autoplay; fullscreen; picture-in-picture"
                    title="Embedded video"
                    sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-presentation"
                  />
                </div>
              ) : urlResolving ? (
                <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground p-8 text-center gap-3">
                  <Loader2 className="h-10 w-10 animate-spin opacity-60" />
                  <p className="text-sm">Resolving video URL…</p>
                </div>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground p-8 text-center">
                  <Upload className="h-12 w-12 mb-4 opacity-50" />
                  <h3 className="text-xl font-medium text-foreground mb-2">No Video Loaded</h3>
                  <p className="mb-4 max-w-sm text-sm">Use "Load Script" to pick a .funscript file, or switch to Video URL to paste a link from YouTube, Pornhub, xVideos, and more.</p>
                </div>
              )}

              {/* Controls strip — directly below the video, inside the card */}
              {videoUrl && (
                <div className="bg-card/80 border-t border-border/40 px-4 py-2 flex-shrink-0">
                  <VideoControlBar
                    videoRef={videoRef}
                    extraControls={hasQueueNav ? queueNavControls : undefined}
                  />
                </div>
              )}
            </Card>
        </div>

        <div className="flex flex-col gap-4">
          {/* Queue panel — shown only when a playlist is active */}
          {queueState && (
            <PlayerQueue
              queue={queueState}
              onJump={handleQueueJump}
            />
          )}

        </div>
      </div>

    </div>
  );
}
