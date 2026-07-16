import { useEffect, useState, useCallback } from "react";
import { Download, Loader2, Terminal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@clerk/react";

const API = import.meta.env.VITE_API_URL ?? "";

interface AIScripterReleaseMeta {
  tag: string;
  sizeBytes: number;
  platforms: {
    windows: boolean;
    macos: boolean;
    linux: boolean;
  };
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "";
  if (bytes < 1024 * 1024) return ` (${(bytes / 1024).toFixed(0)} KB)`;
  return ` (${(bytes / (1024 * 1024)).toFixed(1)} MB)`;
}

interface AIScripterDownloadProps {
  daemonConnected: boolean;
}

export function AIScripterDownload({ daemonConnected }: AIScripterDownloadProps) {
  const { getToken } = useAuth();
  const [release, setRelease] = useState<AIScripterReleaseMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        const headers: Record<string, string> = {};
        if (token) headers["Authorization"] = `Bearer ${token}`;
        const res = await fetch(`${API}/api/aiscripter/release`, { headers });
        if (!res.ok) {
          const data = (await res.json()) as { error?: string };
          throw new Error(data.error ?? `HTTP ${res.status}`);
        }
        const data = (await res.json()) as AIScripterReleaseMeta;
        if (!cancelled) setRelease(data);
      } catch (err) {
        if (!cancelled)
          setError(err instanceof Error ? err.message : "Failed to load release info.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [getToken]);

  const handleDownload = useCallback(
    async (platform: "windows" | "macos" | "linux") => {
      setDownloading(platform);
      try {
        const token = await getToken();
        const headers: Record<string, string> = {};
        if (token) headers["Authorization"] = `Bearer ${token}`;
        const res = await fetch(
          `${API}/api/aiscripter/release/download?platform=${platform}`,
          { headers },
        );
        if (!res.ok) {
          const data = (await res.json()) as { error?: string };
          throw new Error(data.error ?? `HTTP ${res.status}`);
        }
        const { url, filename } = (await res.json()) as {
          url: string;
          filename: string;
        };
        const fileRes = await fetch(`${API}${url}`, { headers });
        if (!fileRes.ok) {
          let message = `HTTP ${fileRes.status}`;
          try {
            const data = (await fileRes.json()) as { error?: string };
            if (data.error) message = data.error;
          } catch {
            // non-JSON error body — keep status message
          }
          throw new Error(message);
        }
        const blob = await fileRes.blob();
        const objectUrl = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = objectUrl;
        anchor.download = filename || "AIScripter-installer";
        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);
        URL.revokeObjectURL(objectUrl);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Download failed.");
      } finally {
        setDownloading(null);
      }
    },
    [getToken],
  );

  if (daemonConnected) {
    return (
      <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400 bg-green-500/10 border border-green-500/20 rounded-lg px-4 py-3">
        <span className="h-2 w-2 rounded-full bg-green-500 flex-shrink-0" />
        AIScripter is running and connected. Ready to generate scripts.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-4">
      <div className="flex items-center gap-2">
        <Terminal className="h-4 w-4 text-primary" />
        <h3 className="font-semibold text-sm text-foreground">Download AIScripter</h3>
        {release && (
          <span className="inline-flex items-center rounded bg-primary/10 border border-primary/25 px-1.5 py-0.5 text-[10px] font-semibold text-primary leading-none">
            {release.tag}
          </span>
        )}
      </div>

      <p className="text-xs text-muted-foreground leading-relaxed">
        AIScripter is a local application that runs on your computer. Download it below, then
        launch it before generating scripts. It will appear as connected automatically once running.
      </p>

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading download links…
        </div>
      ) : error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : release ? (
        <div className="flex flex-wrap gap-2">
          {release.platforms.windows && (
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 h-8 text-xs"
              disabled={downloading !== null}
              onClick={() => handleDownload("windows")}
            >
              {downloading === "windows" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Download className="h-3.5 w-3.5" />
              )}
              Windows (.exe){formatBytes(release.sizeBytes)}
            </Button>
          )}
          {release.platforms.macos && (
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 h-8 text-xs"
              disabled={downloading !== null}
              onClick={() => handleDownload("macos")}
            >
              {downloading === "macos" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Download className="h-3.5 w-3.5" />
              )}
              macOS (.dmg){formatBytes(release.sizeBytes)}
            </Button>
          )}
          {release.platforms.linux && (
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 h-8 text-xs"
              disabled={downloading !== null}
              onClick={() => handleDownload("linux")}
            >
              {downloading === "linux" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Download className="h-3.5 w-3.5" />
              )}
              Linux (.tar.gz){formatBytes(release.sizeBytes)}
            </Button>
          )}
          {!release.platforms.windows && !release.platforms.macos && !release.platforms.linux && (
            <p className="text-xs text-muted-foreground">
              No downloads available yet. Check back soon.
            </p>
          )}
        </div>
      ) : null}

      <p className="text-xs text-muted-foreground">
        After downloading: open the application, then return here — the connection indicator will
        turn green automatically.
      </p>
    </div>
  );
}
