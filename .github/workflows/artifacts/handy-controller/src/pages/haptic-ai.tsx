import { useState, useEffect, useRef, useCallback } from "react";
import { useAuth, useUser } from "@clerk/react";
import { PremiumGate } from "@/components/premium-gate";
import { HapticAIEuaModal } from "@/components/hapticai-eua-modal";
import { HapticAIWarningBanner } from "@/components/hapticai-warning-banner";
import { HapticAIConsentDialog } from "@/components/haptic-ai-consent-dialog";
import { useHapticAIConnection } from "@/hooks/use-hapticai-connection";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Circle,
  Download,
  FileCode,
  Loader2,
  RefreshCw,
  Settings2,
  WifiOff,
  X,
} from "lucide-react";
import { useLocation } from "wouter";

const API = import.meta.env.VITE_API_URL ?? "";

type AgreementState = "loading" | "needed" | "accepted";

function detectOS(): "windows" | "other" {
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes("win")) return "windows";
  return "other";
}

function ConnectionDot({ status }: { status: "connecting" | "connected" | "unreachable" }) {
  if (status === "connected") {
    return (
      <span className="flex items-center gap-1.5 text-green-500 text-xs font-medium">
        <CheckCircle2 className="h-3.5 w-3.5" />
        Connected
      </span>
    );
  }
  if (status === "connecting") {
    return (
      <span className="flex items-center gap-1.5 text-yellow-500 text-xs font-medium">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Connecting…
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5 text-muted-foreground text-xs font-medium">
      <Circle className="h-3.5 w-3.5 text-red-500 fill-red-500" />
      Not running — is HapticAI open?
    </span>
  );
}

interface HapticAIRelease {
  available: boolean;
  version?: string;
  windows?: { sizeBytes: number } | null;
}

type ReleaseState = "loading" | "unavailable" | "available" | "error";

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const HAPTICAI_CACHE_KEY = "hapticai_release_v2_cache";
const HAPTICAI_CACHE_TTL_MS = 60 * 60 * 1000;

interface HapticAIReleaseCache {
  release: HapticAIRelease;
  fetchedAt: number;
}

function readReleaseCache(): HapticAIRelease | null {
  try {
    const raw = localStorage.getItem(HAPTICAI_CACHE_KEY);
    if (!raw) return null;
    const parsed: HapticAIReleaseCache = JSON.parse(raw);
    if (Date.now() - parsed.fetchedAt > HAPTICAI_CACHE_TTL_MS) return null;
    return parsed.release;
  } catch {
    return null;
  }
}

function writeReleaseCache(release: HapticAIRelease): void {
  try {
    localStorage.setItem(HAPTICAI_CACHE_KEY, JSON.stringify({ release, fetchedAt: Date.now() }));
  } catch {
  }
}

const HAPTICAI_LAST_DOWNLOADED_KEY = "hapticai_last_downloaded_version";
const HAPTICAI_DISMISSED_UPDATE_KEY = "hapticai_dismissed_update_version";

function readLastDownloadedVersion(): string | null {
  try { return localStorage.getItem(HAPTICAI_LAST_DOWNLOADED_KEY); } catch { return null; }
}

function writeLastDownloadedVersion(version: string): void {
  try { localStorage.setItem(HAPTICAI_LAST_DOWNLOADED_KEY, version); } catch {}
}

function readDismissedUpdateVersion(): string | null {
  try { return localStorage.getItem(HAPTICAI_DISMISSED_UPDATE_KEY); } catch { return null; }
}

function writeDismissedUpdateVersion(version: string): void {
  try { localStorage.setItem(HAPTICAI_DISMISSED_UPDATE_KEY, version); } catch {}
}

function useHapticAIRelease(): { release: HapticAIRelease | null; state: ReleaseState } {
  const [release, setRelease] = useState<HapticAIRelease | null>(() => readReleaseCache());
  const [state, setState] = useState<ReleaseState>(() => {
    const cached = readReleaseCache();
    if (!cached) return "loading";
    return cached.available ? "available" : "unavailable";
  });

  useEffect(() => {
    let cancelled = false;
    fetch(`${API}/api/hapticai/release`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data: HapticAIRelease) => {
        if (cancelled) return;
        writeReleaseCache(data);
        setRelease(data);
        setState(data.available ? "available" : "unavailable");
      })
      .catch(() => {
        if (!cancelled) setState((prev) => (prev === "loading" ? "error" : prev));
      });
    return () => { cancelled = true; };
  }, []);

  return { release, state };
}

function HapticAIUpdateBanner({
  version,
  os,
  release,
  onDownloaded,
  onDismiss,
}: {
  version: string;
  os: "windows" | "other";
  release: HapticAIRelease | null;
  onDownloaded?: (version: string) => void;
  onDismiss: () => void;
}) {
  const platformRelease = os === "windows" ? release?.windows : null;
  const { downloading, progress, downloadError, handleDownload, handleCancel } = useHapticAIDownload({
    os,
    release,
    onDownloaded,
  });

  const canDownload = os === "windows" && !!platformRelease;

  return (
    <div className="flex items-center gap-2 border-b border-primary/30 bg-primary/10 px-4 py-2">
      <Download className="h-3.5 w-3.5 text-primary flex-shrink-0" />
      <span className="text-xs text-foreground flex-1">
        <span className="font-medium">HapticAI {version} is available.</span>
        {downloadError ? (
          <span className="ml-1 text-destructive">{downloadError}</span>
        ) : (
          <> Download the latest version to get new features and fixes.</>
        )}
      </span>
      {canDownload && (
        downloading ? (
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className="inline-flex items-center gap-1.5 text-[11px] text-primary tabular-nums">
              <Loader2 className="h-3 w-3 animate-spin" />
              {progress !== null ? `${progress}%` : "Downloading…"}
            </span>
            <button
              onClick={handleCancel}
              className="text-[10px] text-muted-foreground hover:text-destructive transition-colors"
              aria-label="Cancel download"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={handleDownload}
            className="inline-flex items-center gap-1 rounded bg-primary px-2 py-0.5 text-[11px] font-medium text-primary-foreground hover:bg-primary/90 transition-colors flex-shrink-0"
          >
            <Download className="h-3 w-3" />
            Download now
          </button>
        )
      )}
      <button
        onClick={onDismiss}
        className="text-[10px] text-muted-foreground hover:text-foreground transition-colors flex-shrink-0 ml-2"
        aria-label="Dismiss update notification"
      >
        Dismiss
      </button>
    </div>
  );
}

interface GithubRelease {
  tag: string;
  exeUrl: string | null;
  exe50Url: string | null;
  exeCpuUrl: string | null;
}

const GITHUB_RELEASE_CACHE_KEY = "hapticai_github_release_v1_cache";
const GITHUB_RELEASE_CACHE_TTL_MS = 60 * 60 * 1000;

interface GithubReleaseCache {
  release: GithubRelease;
  fetchedAt: number;
}

function readGithubReleaseCache(): GithubRelease | null {
  try {
    const raw = localStorage.getItem(GITHUB_RELEASE_CACHE_KEY);
    if (!raw) return null;
    const parsed: GithubReleaseCache = JSON.parse(raw);
    if (Date.now() - parsed.fetchedAt > GITHUB_RELEASE_CACHE_TTL_MS) return null;
    return parsed.release;
  } catch {
    return null;
  }
}

function writeGithubReleaseCache(release: GithubRelease): void {
  try {
    localStorage.setItem(GITHUB_RELEASE_CACHE_KEY, JSON.stringify({ release, fetchedAt: Date.now() }));
  } catch {
  }
}

function useGithubRelease(): { githubRelease: GithubRelease | null; githubState: "loading" | "ready" | "error" } {
  const [githubRelease, setGithubRelease] = useState<GithubRelease | null>(() => readGithubReleaseCache());
  const [githubState, setGithubState] = useState<"loading" | "ready" | "error">(() => {
    const cached = readGithubReleaseCache();
    return cached ? "ready" : "loading";
  });

  useEffect(() => {
    let cancelled = false;
    fetch(`${API}/api/hapticai/github-release`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data: GithubRelease) => {
        if (cancelled) return;
        writeGithubReleaseCache(data);
        setGithubRelease(data);
        setGithubState("ready");
      })
      .catch(() => {
        if (!cancelled) setGithubState((prev) => (prev === "loading" ? "error" : prev));
      });
    return () => { cancelled = true; };
  }, []);

  return { githubRelease, githubState };
}

function UnavailableMessage({
  label,
  githubUrl,
  githubTag,
}: {
  label: string;
  githubUrl?: string | null;
  githubTag?: string | null;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <Download className="h-3 w-3" />
          {label}
          {!githubUrl && <span className="text-[10px]">(not yet available)</span>}
        </span>
        {githubTag && (
          <span className="inline-flex items-center rounded bg-primary/10 border border-primary/25 px-1.5 py-0.5 text-[10px] font-semibold text-primary leading-none">
            {githubTag}
          </span>
        )}
      </div>
      {githubUrl ? (
        <p className="text-[11px] text-muted-foreground">
          <a
            href={githubUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-primary underline underline-offset-2 hover:text-primary/80 transition-colors"
          >
            <Download className="h-3 w-3" />
            Download directly from GitHub
          </a>
        </p>
      ) : (
        <p className="text-[11px] text-muted-foreground">
          The download isn&apos;t ready yet.{" "}
          <a
            href="mailto:support@hapticos.app"
            className="underline underline-offset-2 hover:text-foreground transition-colors"
          >
            Contact support
          </a>{" "}
          if you need access.
        </p>
      )}
    </div>
  );
}

function useHapticAIDownload({ os, release, onDownloaded }: {
  os: "windows" | "windows-50series" | "windows-cpu" | "other";
  release: HapticAIRelease | null;
  onDownloaded?: (version: string) => void;
}) {
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [upgradeUrl, setUpgradeUrl] = useState<string | null>(null);
  const { getToken } = useAuth();
  const [progress, setProgress] = useState<number | null>(null);
  const [receivedBytes, setReceivedBytes] = useState(0);
  const [downloadSpeed, setDownloadSpeed] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const speedRef = useRef<{ lastTime: number; lastBytes: number; smoothed: number | null }>({
    lastTime: 0,
    lastBytes: 0,
    smoothed: null,
  });

  const MAX_RANGE_RETRIES = 3;

  const handleCancel = () => {
    abortRef.current?.abort();
  };

  const handleDownload = async (e?: React.MouseEvent) => {
    if (e) e.preventDefault();
    if (downloading) return;
    if (os === "other") return;
    const downloadUrl = `${API}/api/hapticai/download/${os}`;
    const filename =
      os === "windows"
        ? `HapticAI-Setup-${release?.version ?? "latest"}.exe`
        : os === "windows-50series"
        ? `HapticAI-Setup-50series-${release?.version ?? "latest"}.exe`
        : os === "windows-cpu"
        ? `HapticAI-Setup-CPU-${release?.version ?? "latest"}.exe`
        : `HapticAI-${release?.version ?? "latest"}.exe`;
    const controller = new AbortController();
    abortRef.current = controller;
    setDownloading(true);
    setDownloadError(null);
    setUpgradeUrl(null);
    setProgress(null);
    setReceivedBytes(0);
    setDownloadSpeed(null);
    speedRef.current = { lastTime: performance.now(), lastBytes: 0, smoothed: null };

    const chunks: BlobPart[] = [];
    let received = 0;
    let totalBytes = 0;
    let supportsRange = false;
    let retries = 0;

    try {
      while (true) {
        const token = await getToken();
        const headers: Record<string, string> = {};
        if (token) headers["Authorization"] = `Bearer ${token}`;
        if (received > 0 && supportsRange) {
          headers["Range"] = `bytes=${received}-`;
        }

        const res = await fetch(downloadUrl, { headers, signal: controller.signal });

        if (!res.ok && res.status !== 206) {
          let msg = "Download failed — the file may not be available yet.";
          try {
            const data = await res.json() as { message?: string; error?: string; upgradeUrl?: string };
            if (data.message) msg = data.message;
            else if (data.error) msg = data.error;
            if (data.upgradeUrl) setUpgradeUrl(data.upgradeUrl);
          } catch { /* ignore parse failure */ }
          setDownloadError(msg);
          return;
        }

        if (res.status === 200) {
          supportsRange = res.headers.get("accept-ranges") === "bytes";
          const contentLength = res.headers.get("content-length");
          totalBytes = contentLength ? parseInt(contentLength, 10) : 0;
        } else if (res.status === 206) {
          const contentRange = res.headers.get("content-range");
          if (contentRange) {
            const match = /\/(\d+)$/.exec(contentRange);
            if (match) totalBytes = parseInt(match[1], 10);
          }
        }

        const reader = res.body?.getReader();
        if (!reader) {
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = filename;
          a.click();
          URL.revokeObjectURL(url);
          if (release?.version) {
            writeLastDownloadedVersion(release.version);
            onDownloaded?.(release.version);
          }
          return;
        }

        let streamError = false;
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
            received += value.length;
            setReceivedBytes(received);
            if (totalBytes > 0) {
              setProgress(Math.min(100, Math.round((received / totalBytes) * 100)));
            }
            const now = performance.now();
            const elapsed = (now - speedRef.current.lastTime) / 1000;
            if (elapsed >= 1) {
              const bytesDelta = received - speedRef.current.lastBytes;
              const rawMBps = bytesDelta / elapsed / (1024 * 1024);
              const prev = speedRef.current.smoothed;
              const smoothed = prev === null ? rawMBps : prev * 0.6 + rawMBps * 0.4;
              speedRef.current = { lastTime: now, lastBytes: received, smoothed };
              setDownloadSpeed(smoothed);
            }
          }
        } catch {
          streamError = true;
        }

        if (!streamError) break;

        if (supportsRange && retries < MAX_RANGE_RETRIES) {
          retries++;
          continue;
        }

        setDownloadError("Download failed. Please check your connection or contact support.");
        return;
      }

      const blob = new Blob(chunks);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      if (release?.version) {
        writeLastDownloadedVersion(release.version);
        onDownloaded?.(release.version);
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        // User cancelled — reset silently, no error message
      } else {
        setDownloadError("Download failed. Please check your connection or contact support.");
      }
    } finally {
      abortRef.current = null;
      setDownloading(false);
      setProgress(null);
      setReceivedBytes(0);
      setDownloadSpeed(null);
    }
  };

  return {
    downloading,
    downloadError,
    upgradeUrl,
    progress,
    receivedBytes,
    downloadSpeed,
    handleDownload,
    handleCancel,
  };
}

function DownloadLink({ os, release, state, onDownloaded, githubRelease, githubState }: {
  os: "windows" | "other";
  release: HapticAIRelease | null;
  state: ReleaseState;
  onDownloaded?: (version: string) => void;
  githubRelease: GithubRelease | null;
  githubState: "loading" | "ready" | "error";
}) {
  const {
    downloading,
    downloadError,
    upgradeUrl,
    progress,
    receivedBytes,
    downloadSpeed,
    handleDownload,
    handleCancel,
  } = useHapticAIDownload({ os, release, onDownloaded });

  const {
    downloading: downloading50,
    downloadError: downloadError50,
    upgradeUrl: upgradeUrl50,
    progress: progress50,
    receivedBytes: receivedBytes50,
    downloadSpeed: downloadSpeed50,
    handleDownload: handleDownload50,
    handleCancel: handleCancel50,
  } = useHapticAIDownload({ os: os === "windows" ? "windows-50series" : "other", release, onDownloaded });

  const {
    downloading: downloadingCpu,
    downloadError: downloadErrorCpu,
    upgradeUrl: upgradeUrlCpu,
    progress: progressCpu,
    receivedBytes: receivedBytesCpu,
    downloadSpeed: downloadSpeedCpu,
    handleDownload: handleDownloadCpu,
    handleCancel: handleCancelCpu,
  } = useHapticAIDownload({ os: os === "windows" ? "windows-cpu" : "other", release, onDownloaded });

  if (os === "other") {
    return (
      <p className="text-xs text-muted-foreground">
        HapticAI is available for Windows. Check back soon for other platforms.
      </p>
    );
  }

  const platformRelease = os === "windows" ? release?.windows : null;
  const label = "Download for Windows — RTX 30/40 Series";
  const label50  = "Download for Windows — RTX 50 Series";
  const labelCpu = "Download for Windows — CPU Only (no GPU needed)";

  if (state === "loading") {
    return (
      <div className="space-y-1">
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          {label}
        </span>
        {os === "windows" && (
          <>
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              {label50}
            </span>
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              {labelCpu}
            </span>
          </>
        )}
      </div>
    );
  }

  const githubFallbackUrl =
    githubState === "ready" && githubRelease
      ? os === "windows" ? githubRelease.exeUrl : null
      : null;

  const github50FallbackUrl =
    githubState === "ready" && githubRelease ? githubRelease.exe50Url : null;

  const githubCpuFallbackUrl =
    githubState === "ready" && githubRelease ? githubRelease.exeCpuUrl : null;

  const githubTagForLabel =
    githubState === "ready" && githubRelease ? githubRelease.tag : null;

  if (state !== "available" || !platformRelease) {
    return (
      <div className="space-y-1.5">
        <UnavailableMessage
          label={label}
          githubUrl={githubFallbackUrl}
          githubTag={githubTagForLabel}
        />
        {os === "windows" && (
          <>
            <UnavailableMessage
              label={label50}
              githubUrl={github50FallbackUrl}
              githubTag={githubTagForLabel}
            />
            <UnavailableMessage
              label={labelCpu}
              githubUrl={githubCpuFallbackUrl}
              githubTag={githubTagForLabel}
            />
          </>
        )}
      </div>
    );
  }

  const totalBytes = platformRelease.sizeBytes;
  const githubDirectUrl = githubFallbackUrl;
  const githubTag = githubTagForLabel;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={handleDownload}
          disabled={downloading}
          className="inline-flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {downloading
            ? <Loader2 className="h-3 w-3 animate-spin" />
            : <Download className="h-3 w-3" />
          }
          {downloading ? "Downloading…" : label}
          {!downloading && (
            <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground leading-none">
              {formatBytes(platformRelease.sizeBytes)}
            </span>
          )}
        </button>
        {githubTag && (
          <span className="inline-flex items-center rounded bg-primary/10 border border-primary/25 px-1.5 py-0.5 text-[10px] font-semibold text-primary leading-none">
            {githubTag}
          </span>
        )}
      </div>

      {downloading && (
        <div className="space-y-1 pt-0.5">
          <div className="flex items-center gap-2">
            <div className="h-1.5 w-full max-w-[220px] rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-primary transition-all duration-150"
                style={{ width: progress !== null ? `${progress}%` : "0%" }}
              />
            </div>
            <button
              onClick={handleCancel}
              className="text-[10px] text-muted-foreground hover:text-destructive transition-colors leading-none flex-shrink-0"
              aria-label="Cancel download"
            >
              Cancel
            </button>
          </div>
          <p className="text-[10px] text-muted-foreground tabular-nums">
            {progress !== null
              ? `${formatBytes(receivedBytes)} of ${formatBytes(totalBytes)} — ${progress}%`
              : `${formatBytes(receivedBytes)} received…`}
            {downloadSpeed !== null && (
              <span className="ml-2 text-muted-foreground/70">{downloadSpeed.toFixed(1)} MB/s</span>
            )}
          </p>
        </div>
      )}

      {downloadError && (
        <p className="text-[11px] text-destructive">
          {downloadError}{" "}
          {upgradeUrl ? (
            <a
              href={upgradeUrl}
              className="underline underline-offset-2 hover:text-destructive/80 transition-colors"
            >
              Upgrade now
            </a>
          ) : (
            <a
              href="mailto:support@hapticos.app"
              className="underline underline-offset-2 hover:text-destructive/80 transition-colors"
            >
              Contact support
            </a>
          )}
          {githubDirectUrl && (
            <>
              {" "}or{" "}
              <a
                href={githubDirectUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2 hover:text-destructive/80 transition-colors"
              >
                download directly from GitHub
              </a>
            </>
          )}
        </p>
      )}

      {!downloading && !downloadError && githubDirectUrl && (
        <p className="text-[10px] text-muted-foreground">
          or{" "}
          <a
            href={githubDirectUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2 hover:text-foreground transition-colors"
          >
            download directly from GitHub
          </a>
        </p>
      )}

      {os === "windows" && (
        <div className="space-y-1 pt-0.5">
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={handleDownload50}
              disabled={downloading50}
              className="inline-flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {downloading50
                ? <Loader2 className="h-3 w-3 animate-spin" />
                : <Download className="h-3 w-3" />
              }
              {downloading50 ? "Downloading…" : label50}
              {!downloading50 && (
                <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground leading-none">
                  {formatBytes(platformRelease.sizeBytes)}
                </span>
              )}
            </button>
          </div>

          {downloading50 && (
            <div className="space-y-1 pt-0.5">
              <div className="flex items-center gap-2">
                <div className="h-1.5 w-full max-w-[220px] rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full bg-primary transition-all duration-150"
                    style={{ width: progress50 !== null ? `${progress50}%` : "0%" }}
                  />
                </div>
                <button
                  onClick={handleCancel50}
                  className="text-[10px] text-muted-foreground hover:text-destructive transition-colors leading-none flex-shrink-0"
                  aria-label="Cancel download"
                >
                  Cancel
                </button>
              </div>
              <p className="text-[10px] text-muted-foreground tabular-nums">
                {progress50 !== null
                  ? `${formatBytes(receivedBytes50)} of ${formatBytes(totalBytes)} — ${progress50}%`
                  : `${formatBytes(receivedBytes50)} received…`}
                {downloadSpeed50 !== null && (
                  <span className="ml-2 text-muted-foreground/70">{downloadSpeed50.toFixed(1)} MB/s</span>
                )}
              </p>
            </div>
          )}

          {downloadError50 && (
            <p className="text-[11px] text-destructive">
              {downloadError50}{" "}
              {upgradeUrl50 ? (
                <a
                  href={upgradeUrl50}
                  className="underline underline-offset-2 hover:text-destructive/80 transition-colors"
                >
                  Upgrade now
                </a>
              ) : (
                <a
                  href="mailto:support@hapticos.app"
                  className="underline underline-offset-2 hover:text-destructive/80 transition-colors"
                >
                  Contact support
                </a>
              )}
              {github50FallbackUrl && (
                <>
                  {" "}or{" "}
                  <a
                    href={github50FallbackUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline underline-offset-2 hover:text-destructive/80 transition-colors"
                  >
                    download directly from GitHub
                  </a>
                </>
              )}
            </p>
          )}

          {!downloading50 && !downloadError50 && github50FallbackUrl && (
            <p className="text-[10px] text-muted-foreground">
              or{" "}
              <a
                href={github50FallbackUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2 hover:text-foreground transition-colors"
              >
                download directly from GitHub
              </a>
            </p>
          )}
        </div>
      )}

      {os === "windows" && (
        <div className="space-y-1 pt-0.5">
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={handleDownloadCpu}
              disabled={downloadingCpu}
              className="inline-flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {downloadingCpu
                ? <Loader2 className="h-3 w-3 animate-spin" />
                : <Download className="h-3 w-3" />
              }
              {downloadingCpu ? "Downloading…" : labelCpu}
              {!downloadingCpu && (
                <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground leading-none">
                  {formatBytes(platformRelease.sizeBytes)}
                </span>
              )}
            </button>
          </div>

          {downloadingCpu && (
            <div className="space-y-1 pt-0.5">
              <div className="flex items-center gap-2">
                <div className="h-1.5 w-full max-w-[220px] rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full bg-primary transition-all duration-150"
                    style={{ width: progressCpu !== null ? `${progressCpu}%` : "0%" }}
                  />
                </div>
                <button
                  onClick={handleCancelCpu}
                  className="text-[10px] text-muted-foreground hover:text-destructive transition-colors leading-none flex-shrink-0"
                  aria-label="Cancel download"
                >
                  Cancel
                </button>
              </div>
              <p className="text-[10px] text-muted-foreground tabular-nums">
                {progressCpu !== null
                  ? `${formatBytes(receivedBytesCpu)} of ${formatBytes(totalBytes)} — ${progressCpu}%`
                  : `${formatBytes(receivedBytesCpu)} received…`}
                {downloadSpeedCpu !== null && (
                  <span className="ml-2 text-muted-foreground/70">{downloadSpeedCpu.toFixed(1)} MB/s</span>
                )}
              </p>
            </div>
          )}

          {downloadErrorCpu && (
            <p className="text-[11px] text-destructive">
              {downloadErrorCpu}{" "}
              {upgradeUrlCpu ? (
                <a
                  href={upgradeUrlCpu}
                  className="underline underline-offset-2 hover:text-destructive/80 transition-colors"
                >
                  Upgrade now
                </a>
              ) : (
                <a
                  href="mailto:support@hapticos.app"
                  className="underline underline-offset-2 hover:text-destructive/80 transition-colors"
                >
                  Contact support
                </a>
              )}
              {githubCpuFallbackUrl && (
                <>
                  {" "}or{" "}
                  <a
                    href={githubCpuFallbackUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline underline-offset-2 hover:text-destructive/80 transition-colors"
                  >
                    download directly from GitHub
                  </a>
                </>
              )}
            </p>
          )}

          {!downloadingCpu && !downloadErrorCpu && githubCpuFallbackUrl && (
            <p className="text-[10px] text-muted-foreground">
              or{" "}
              <a
                href={githubCpuFallbackUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2 hover:text-foreground transition-colors"
              >
                download directly from GitHub
              </a>
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function SetupPanel({ os, serverUrl, onUrlChange, onDownloaded, release, state, githubRelease, githubState }: {
  os: "windows" | "other";
  serverUrl: string;
  onUrlChange: (url: string) => void;
  onDownloaded?: (version: string) => void;
  release: HapticAIRelease | null;
  state: ReleaseState;
  githubRelease: GithubRelease | null;
  githubState: "loading" | "ready" | "error";
}) {
  const [urlInput, setUrlInput] = useState(serverUrl);
  const [expanded, setExpanded] = useState(true);

  const handleSaveUrl = () => {
    const trimmed = urlInput.trim().replace(/\/$/, "");
    if (trimmed) onUrlChange(trimmed);
  };

  return (
    <Card className="border-border/60">
      <CardContent className="p-0">
        {/* Always-visible header — click to collapse/expand */}
        <button
          onClick={() => setExpanded((e) => !e)}
          className="w-full flex items-center gap-2 px-5 py-4 text-left hover:bg-muted/30 transition-colors rounded-t-lg"
          aria-expanded={expanded}
        >
          <AlertTriangle className="h-4 w-4 text-yellow-500 flex-shrink-0" />
          <h3 className="font-semibold text-sm text-foreground flex-1">HapticAI is not running</h3>
          {expanded
            ? <ChevronUp className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            : <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          }
        </button>

        {expanded && (
        <div className="px-5 pb-5 space-y-5 border-t border-border">
        <p className="text-sm text-muted-foreground pt-4">
          HapticAI requires a local app to be running on your computer. Follow the steps below to get started.
        </p>

        <ol className="space-y-4">
          <li className="flex gap-3">
            <span className="flex-shrink-0 h-6 w-6 rounded-full bg-primary/15 border border-primary/30 text-primary text-xs font-bold flex items-center justify-center">
              1
            </span>
            <div className="space-y-1.5">
              <p className="text-sm text-foreground font-medium">Download HapticAI</p>
              <p className="text-xs text-muted-foreground">
                Download the HapticAI executable for your operating system. It is self-contained — no installation required.
              </p>
              <DownloadLink os={os} release={release} state={state} onDownloaded={onDownloaded} githubRelease={githubRelease} githubState={githubState} />
            </div>
          </li>

          <li className="flex gap-3">
            <span className="flex-shrink-0 h-6 w-6 rounded-full bg-primary/15 border border-primary/30 text-primary text-xs font-bold flex items-center justify-center">
              2
            </span>
            <div className="space-y-1">
              <p className="text-sm text-foreground font-medium">Launch HapticAI</p>
              <p className="text-xs text-muted-foreground">
                {os === "windows"
                  ? "Double-click the downloaded .exe file. Windows may show a security prompt — click \"More info\" then \"Run anyway\"."
                  : "Open the downloaded executable. Your OS may require you to grant permission to run it."}
              </p>
              <p className="text-xs text-muted-foreground">
                HapticAI will start a local server automatically. You'll see a small status window confirming it's running.
              </p>
            </div>
          </li>

          <li className="flex gap-3">
            <span className="flex-shrink-0 h-6 w-6 rounded-full bg-primary/15 border border-primary/30 text-primary text-xs font-bold flex items-center justify-center">
              3
            </span>
            <div className="space-y-1">
              <p className="text-sm text-foreground font-medium">Wait for the status indicator to turn green</p>
              <p className="text-xs text-muted-foreground">
                HapticOS polls HapticAI every few seconds. Once it connects, the generation interface will unlock automatically.
              </p>
            </div>
          </li>
        </ol>

        <div className="pt-1 border-t border-border space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Server URL</p>
          <p className="text-xs text-muted-foreground">
            By default HapticAI runs at <code className="bg-muted px-1 py-0.5 rounded text-[11px]">http://localhost:8000</code>.
            Change this only if you configured a different port.
          </p>
          <div className="flex gap-2">
            <Input
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleSaveUrl(); }}
              className="h-8 text-xs font-mono flex-1"
              placeholder="http://localhost:8000"
            />
            <Button size="sm" onClick={handleSaveUrl} className="h-8 px-3 text-xs">
              Save
            </Button>
          </div>
        </div>
        </div>
        )}
      </CardContent>
    </Card>
  );
}


function HapticAIContent() {
  const { getToken } = useAuth();
  const { user } = useUser();
  const [, navigate] = useLocation();
  const [agreementState, setAgreementState] = useState<AgreementState>("loading");
  const checkedRef = useRef(false);
  const { status, capabilities, serverUrl, setServerUrl, retry } = useHapticAIConnection();
  const os = detectOS();
  const { release, state: releaseState } = useHapticAIRelease();
  const { githubRelease, githubState } = useGithubRelease();
  const [lastDownloadedVersion, setLastDownloadedVersion] = useState<string | null>(
    () => readLastDownloadedVersion()
  );
  const [dismissedUpdateVersion, setDismissedUpdateVersion] = useState<string | null>(
    () => readDismissedUpdateVersion()
  );
  const [hasEverConnected, setHasEverConnected] = useState(false);
  const [urlSettingsOpen, setUrlSettingsOpen] = useState(false);
  const [urlInput, setUrlInput] = useState(serverUrl);
  const [pendingScript, setPendingScript] = useState<{ funscript: string; name: string } | null>(null);

  useEffect(() => {
    if (status === "connected") setHasEverConnected(true);
  }, [status]);

  useEffect(() => {
    setUrlInput(serverUrl);
  }, [serverUrl]);

  const handleSaveUrl = useCallback(() => {
    const trimmed = urlInput.trim().replace(/\/$/, "");
    if (trimmed) {
      setServerUrl(trimmed);
      setUrlSettingsOpen(false);
    }
  }, [urlInput, setServerUrl]);

  const handleDownloaded = useCallback((version: string) => {
    setLastDownloadedVersion(version);
  }, []);

  const handleDismissUpdate = useCallback((version: string) => {
    writeDismissedUpdateVersion(version);
    setDismissedUpdateVersion(version);
  }, []);

  // ─── postMessage bridge: receive scripts from the HapticAI iframe ───────────
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      try {
        const expectedOrigin = new URL(serverUrl).origin;
        if (event.origin !== expectedOrigin) return;
      } catch {
        return;
      }
      const data = event.data as unknown;
      if (
        typeof data !== "object" ||
        data === null ||
        (data as Record<string, unknown>).type !== "hapticai_script_ready"
      ) return;
      const msg = data as Record<string, unknown>;
      const funscript = typeof msg.funscript === "string" ? msg.funscript : null;
      if (!funscript) return;
      const name = typeof msg.name === "string" && msg.name.trim() ? msg.name.trim() : "HapticAI";
      setPendingScript({ funscript, name });
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [serverUrl]);

  const handleOpenInScripter = useCallback(() => {
    if (!pendingScript) return;
    try {
      sessionStorage.setItem(
        "hapticai_import",
        JSON.stringify({ funscript: pendingScript.funscript, name: pendingScript.name }),
      );
    } catch { /* ignore */ }
    setPendingScript(null);
    navigate("/scripter");
  }, [pendingScript, navigate]);

  const showUpdateBanner =
    lastDownloadedVersion !== null &&
    release?.available === true &&
    release.version !== undefined &&
    release.version !== lastDownloadedVersion &&
    release.version !== dismissedUpdateVersion;

  useEffect(() => {
    if (checkedRef.current) return;
    checkedRef.current = true;

    const meta = user?.publicMetadata as Record<string, unknown>;
    const localAgreed = meta?.hapticaiAgreed === true;
    if (localAgreed) {
      setAgreementState("accepted");
      return;
    }

    (async () => {
      try {
        const token = await getToken();
        const headers: Record<string, string> = {};
        if (token) headers["Authorization"] = `Bearer ${token}`;
        const res = await fetch(`${API}/api/user/hapticai-status`, { headers });
        if (!res.ok) {
          setAgreementState("needed");
          return;
        }
        const data = await res.json() as { agreed: boolean };
        setAgreementState(data.agreed ? "accepted" : "needed");
      } catch {
        setAgreementState("needed");
      }
    })();
  }, [getToken, user]);

  const handleAccepted = useCallback(async () => {
    setAgreementState("accepted");
    try {
      await user?.reload();
    } catch { /* silent */ }
  }, [user]);

  if (agreementState === "loading") {
    return (
      <div className="flex items-center justify-center h-48">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const showIframe = hasEverConnected;
  const showDisconnectedOverlay = hasEverConnected && status !== "connected";

  return (
    <div className="flex flex-col h-full">
      {agreementState === "needed" && (
        <HapticAIEuaModal onAccepted={handleAccepted} />
      )}

      {showUpdateBanner && release?.version && (
        <HapticAIUpdateBanner
          version={release.version}
          os={os}
          release={release}
          onDownloaded={handleDownloaded}
          onDismiss={() => handleDismissUpdate(release!.version!)}
        />
      )}

      <HapticAIWarningBanner />

      {/* Script-ready banner — shown when HapticAI sends a generated script via postMessage */}
      {pendingScript && (
        <div className="flex-shrink-0 flex items-center gap-2 border-b border-green-500/30 bg-green-500/10 px-4 py-2">
          <FileCode className="h-3.5 w-3.5 text-green-500 flex-shrink-0" />
          <span className="text-xs text-foreground flex-1 min-w-0">
            <span className="font-medium">Script ready:</span>{" "}
            <span className="text-muted-foreground truncate">{pendingScript.name}</span>
          </span>
          <button
            onClick={handleOpenInScripter}
            className="inline-flex items-center gap-1 rounded bg-green-600 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-green-700 transition-colors flex-shrink-0"
          >
            <FileCode className="h-3 w-3" />
            Open in Scripter
          </button>
          <button
            onClick={() => setPendingScript(null)}
            className="text-muted-foreground hover:text-foreground transition-colors flex-shrink-0 ml-1"
            aria-label="Dismiss"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Connection status bar */}
      <div className="flex-shrink-0 flex items-center justify-between border-b border-border bg-card/60 px-4 py-2">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">HapticAI:</span>
          <ConnectionDot status={status} />
          {capabilities.version && (
            <span className="text-[10px] text-muted-foreground font-mono">v{capabilities.version}</span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-muted-foreground font-mono hidden sm:inline">{serverUrl}</span>
          <button
            onClick={() => setUrlSettingsOpen((o) => !o)}
            className="flex items-center gap-1 rounded px-1.5 py-1 text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
            aria-label="Change server URL"
            title="Change server URL"
          >
            <Settings2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Collapsible URL settings panel */}
      {urlSettingsOpen && (
        <div className="flex-shrink-0 border-b border-border bg-muted/30 px-4 py-2.5 flex items-center gap-2">
          <span className="text-xs text-muted-foreground whitespace-nowrap">Server URL</span>
          <Input
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleSaveUrl(); if (e.key === "Escape") setUrlSettingsOpen(false); }}
            className="h-7 text-xs font-mono flex-1 min-w-0"
            placeholder="http://localhost:8000"
            autoFocus
          />
          <Button size="sm" onClick={handleSaveUrl} className="h-7 px-2.5 text-xs flex-shrink-0">
            Save
          </Button>
          <button
            onClick={() => setUrlSettingsOpen(false)}
            className="text-[11px] text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Main content area */}
      <div className="flex-1 relative overflow-hidden">
        {showIframe ? (
          <>
            <iframe
              src={serverUrl}
              className="w-full h-full border-0"
              title="HapticAI"
              allow="clipboard-read; clipboard-write"
            />
            {showDisconnectedOverlay && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-background/90 backdrop-blur-sm">
                <div className="flex flex-col items-center gap-3 text-center px-6">
                  <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center">
                    <WifiOff className="h-6 w-6 text-muted-foreground" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-foreground">HapticAI is not reachable</p>
                    <p className="text-xs text-muted-foreground">
                      Make sure the HapticAI app is still running on your computer at{" "}
                      <code className="bg-muted px-1 py-0.5 rounded text-[11px]">{serverUrl}</code>
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={retry}
                    className="gap-1.5"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    Retry
                  </Button>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="overflow-y-auto h-full">
            <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">
              {/* Header */}
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <h1 className="text-xl font-bold text-foreground">HapticAI</h1>
                  <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-primary/15 text-primary border border-primary/30">
                    Beta
                  </span>
                </div>
                <p className="text-sm text-muted-foreground">
                  Generate haptic scripts from natural language using the HapticAI local engine.
                </p>
              </div>

              {/* Connecting spinner */}
              {status === "connecting" && (
                <div className="rounded-lg border border-border bg-muted/20 px-4 py-8 text-center space-y-2">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground mx-auto" />
                  <p className="text-sm text-muted-foreground">Connecting to HapticAI…</p>
                </div>
              )}

              {/* Setup panel — shown when unreachable / never connected */}
              <SetupPanel
                os={os}
                serverUrl={serverUrl}
                onUrlChange={setServerUrl}
                onDownloaded={handleDownloaded}
                release={release}
                state={releaseState}
                githubRelease={githubRelease}
                githubState={githubState}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

type ConsentState = "loading" | "needed" | "dismissed";

export default function HapticAI() {
  const { getToken } = useAuth();
  const { user, isLoaded } = useUser();
  const [, navigate] = useLocation();
  const [consentState, setConsentState] = useState<ConsentState>("loading");
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (!isLoaded) return;
    if (!user?.id) {
      setConsentState("dismissed");
      return;
    }
    try {
      if (sessionStorage.getItem("hapticAiConsentAcknowledged") === "1") {
        setConsentState("dismissed");
        return;
      }
    } catch { /* ignore */ }
    if (fetchedRef.current) return;
    fetchedRef.current = true;

    getToken()
      .then((token) => {
        const headers: Record<string, string> = {};
        if (token) headers["Authorization"] = `Bearer ${token}`;
        return fetch(`${API}/api/user/preferences`, { headers });
      })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { hapticAiWarnDismissed?: boolean } | null) => {
        setConsentState(data?.hapticAiWarnDismissed === true ? "dismissed" : "needed");
      })
      .catch(() => setConsentState("needed"));
  }, [isLoaded, user?.id, getToken]);

  const handleConsentConfirm = useCallback(
    async (dontShowAgain: boolean) => {
      try { sessionStorage.setItem("hapticAiConsentAcknowledged", "1"); } catch { /* ignore */ }
      if (dontShowAgain) {
        try {
          const token = await getToken();
          const headers: Record<string, string> = { "Content-Type": "application/json" };
          if (token) headers["Authorization"] = `Bearer ${token}`;
          await fetch(`${API}/api/user/preferences`, {
            method: "POST",
            headers,
            body: JSON.stringify({ hapticAiWarnDismissed: true }),
          });
        } catch { /* silent */ }
      }
      setConsentState("dismissed");
    },
    [getToken],
  );

  const handleConsentCancel = useCallback(() => {
    navigate("/");
  }, [navigate]);

  if (consentState === "loading") {
    return (
      <div className="flex items-center justify-center h-48">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (consentState === "needed") {
    return (
      <HapticAIConsentDialog
        open={true}
        onConfirm={handleConsentConfirm}
        onCancel={handleConsentCancel}
      />
    );
  }

  return (
    <PremiumGate feature="HapticAI">
      <HapticAIContent />
    </PremiumGate>
  );
}
