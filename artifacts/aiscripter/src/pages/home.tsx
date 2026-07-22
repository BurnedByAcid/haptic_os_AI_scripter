import { useState, useEffect, useRef, useCallback } from "react";
import { useAuth } from "@clerk/react";
import { AIScripterEuaModal } from "@/components/aiscripter-eua-modal";
import { AIScripterDownload } from "@/components/aiscripter-download";
import { useAIScripterConnection } from "@/hooks/use-aiscripter-connection";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  Download,
  FileCode,
  Loader2,
  PlaySquare,
  RefreshCw,
  Volume2,
  Wand2,
} from "lucide-react";

const API = import.meta.env.VITE_API_URL ?? "";
const DAEMON_URL = "http://localhost:7860";

type AgreementState = "loading" | "needed" | "accepted";
type PlanState = "loading" | "subscriber" | "free";

type JobStatus =
  | { state: "idle" }
  | { state: "queued"; jobId: string }
  | { state: "processing"; jobId: string; percent: number }
  | { state: "complete"; jobId: string; funscriptUrl: string; scriptSource?: string }
  | { state: "error"; jobId: string; message: string };

function ConnectionIndicator({ status }: { status: "connecting" | "connected" | "unreachable" }) {
  if (status === "connected") {
    return (
      <span className="flex items-center gap-1.5 text-green-500 text-xs font-medium">
        <CheckCircle2 className="h-3.5 w-3.5" />Connected
      </span>
    );
  }
  if (status === "connecting") {
    return (
      <span className="flex items-center gap-1.5 text-yellow-500 text-xs font-medium">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />Connecting…
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5 text-muted-foreground text-xs font-medium">
      <Circle className="h-3.5 w-3.5 text-red-500 fill-red-500" />Not running
    </span>
  );
}

export default function Home() {
  const { getToken } = useAuth();
  const { status: daemonStatus, sessionToken } = useAIScripterConnection();

  const [planState, setPlanState] = useState<PlanState>("loading");
  const [agreementState, setAgreementState] = useState<AgreementState>("loading");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        const headers: Record<string, string> = {};
        if (token) headers["Authorization"] = `Bearer ${token}`;
        const [statusRes, planRes] = await Promise.all([
          fetch(`${API}/api/user/aiscripter-status`, { headers }),
          fetch(`${API}/api/users/me`, { headers }),
        ]);
        if (!cancelled) {
          if (statusRes.ok) {
            const data = (await statusRes.json()) as { agreed: boolean };
            setAgreementState(data.agreed ? "accepted" : "needed");
          } else {
            setAgreementState("needed");
          }
          if (planRes.ok) {
            const data = (await planRes.json()) as { plan?: string };
            setPlanState(data.plan && data.plan !== "free" ? "subscriber" : "free");
          } else {
            setPlanState("free");
          }
        }
      } catch {
        if (!cancelled) {
          setAgreementState("needed");
          setPlanState("free");
        }
      }
    })();
    return () => { cancelled = true; };
  }, [getToken]);

  const [videoUrl, setVideoUrl] = useState("");
  const [jobStatus, setJobStatus] = useState<JobStatus>({ state: "idle" });
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);

  const pollJob = useCallback(async (jobId: string) => {
    try {
      const res = await fetch(`${DAEMON_URL}/api/jobs/${jobId}`, {
        headers: sessionToken ? { "X-AIScripter-Token": sessionToken } : {},
        mode: "cors",
      });
      if (!res.ok) return;
      const data = (await res.json()) as {
        status: "queued" | "processing" | "complete" | "error";
        percent?: number;
        error?: string;
        script_source?: string;
      };
      if (data.status === "queued") {
        setJobStatus({ state: "queued", jobId });
      } else if (data.status === "processing") {
        setJobStatus({ state: "processing", jobId, percent: data.percent ?? 0 });
      } else if (data.status === "complete") {
        stopPolling();
        setJobStatus({
          state: "complete",
          jobId,
          funscriptUrl: `${DAEMON_URL}/api/jobs/${jobId}/funscript`,
          scriptSource: data.script_source,
        });
      } else if (data.status === "error") {
        stopPolling();
        setJobStatus({ state: "error", jobId, message: data.error ?? "Unknown error." });
      }
    } catch { }
  }, [sessionToken, stopPolling]);

  const handleSubmit = useCallback(async () => {
    if (!videoUrl.trim() || daemonStatus !== "connected") return;
    stopPolling();
    setJobStatus({ state: "queued", jobId: "" });
    try {
      const res = await fetch(`${DAEMON_URL}/api/jobs/trigger`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(sessionToken ? { "X-AIScripter-Token": sessionToken } : {}),
        },
        mode: "cors",
        body: JSON.stringify({ url: videoUrl.trim() }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setJobStatus({ state: "error", jobId: "", message: data.error ?? `HTTP ${res.status}` });
        return;
      }
      const data = (await res.json()) as { job_id: string };
      const jobId = data.job_id;
      setJobStatus({ state: "queued", jobId });
      pollRef.current = setInterval(() => pollJob(jobId), 1500);
    } catch (err) {
      setJobStatus({ state: "error", jobId: "", message: err instanceof Error ? err.message : "Failed to start job." });
    }
  }, [videoUrl, daemonStatus, sessionToken, stopPolling, pollJob]);

  useEffect(() => () => stopPolling(), [stopPolling]);

  const handleDownloadFunscript = useCallback(async () => {
    if (jobStatus.state !== "complete") return;
    try {
      const res = await fetch(jobStatus.funscriptUrl, {
        headers: sessionToken ? { "X-AIScripter-Token": sessionToken } : {},
        mode: "cors",
      });
      if (!res.ok) return;
      const text = await res.text();
      const blob = new Blob([text], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "aiscripter-output.funscript";
      a.click();
      URL.revokeObjectURL(url);
    } catch { }
  }, [jobStatus, sessionToken]);

  const handleOpenInScripter = useCallback(async () => {
    if (jobStatus.state !== "complete") return;
    try {
      const res = await fetch(jobStatus.funscriptUrl, {
        headers: sessionToken ? { "X-AIScripter-Token": sessionToken } : {},
        mode: "cors",
      });
      if (!res.ok) return;
      const funscript = await res.text();
      const channel = new BroadcastChannel("hapticos");
      channel.postMessage({ type: "hapticai_funscript", funscript, name: "AIScripter Script" });
      channel.close();
      window.location.href = "/";
    } catch { }
  }, [jobStatus, sessionToken]);

  const handleOpenInPlayer = useCallback(async () => {
    if (jobStatus.state !== "complete") return;
    try {
      const res = await fetch(jobStatus.funscriptUrl, {
        headers: sessionToken ? { "X-AIScripter-Token": sessionToken } : {},
        mode: "cors",
      });
      if (!res.ok) return;
      const funscript = await res.text();
      sessionStorage.setItem(
        "aiscripter_player_import",
        JSON.stringify({ funscript, videoUrl, name: "AIScripter Script" }),
      );
      window.location.href = "/player";
    } catch { }
  }, [jobStatus, sessionToken, videoUrl]);

  if (planState === "loading" || agreementState === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (planState === "free") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <div className="max-w-md w-full text-center space-y-4">
          <div className="h-12 w-12 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center mx-auto">
            <Wand2 className="h-6 w-6 text-primary" />
          </div>
          <h1 className="text-xl font-bold text-foreground">AIScripter requires a subscription</h1>
          <p className="text-sm text-muted-foreground">
            AIScripter is a subscriber-only feature. Upgrade your plan to access AI-powered funscript generation.
          </p>
          <a href="/" target="_self">
            <Button className="gap-2">Upgrade on HapticOS</Button>
          </a>
        </div>
      </div>
    );
  }

  if (agreementState === "needed") {
    return <AIScripterEuaModal onAccepted={() => setAgreementState("accepted")} />;
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
              <Wand2 className="h-5 w-5 text-primary" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold text-foreground">AIScripter</h1>
                <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-primary/10 border border-primary/25 text-primary leading-none">
                  Beta
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Generate haptic scripts from video URLs using local AI
              </p>
            </div>
            <div className="ml-auto">
              <ConnectionIndicator status={daemonStatus} />
            </div>
          </div>
        </div>

        <AIScripterDownload daemonConnected={daemonStatus === "connected"} />

        {daemonStatus === "connected" && (
          <div className="rounded-xl border border-border bg-card p-5 space-y-4">
            <h3 className="font-semibold text-sm text-foreground">Generate Script</h3>
            <div className="space-y-2">
              <label className="text-xs text-muted-foreground font-medium">Video URL</label>
              <div className="flex gap-2">
                <Input
                  placeholder="https://…"
                  value={videoUrl}
                  onChange={(e) => setVideoUrl(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
                  disabled={jobStatus.state === "queued" || jobStatus.state === "processing"}
                  className="flex-1 text-sm"
                />
                <Button
                  onClick={handleSubmit}
                  disabled={!videoUrl.trim() || jobStatus.state === "queued" || jobStatus.state === "processing"}
                  className="gap-1.5"
                >
                  {jobStatus.state === "queued" || jobStatus.state === "processing" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Wand2 className="h-4 w-4" />
                  )}
                  Generate
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Paste a video URL. The AIScripter daemon will download and analyse it locally on your machine.
              </p>
            </div>

            {jobStatus.state !== "idle" && (
              <StatusPanel
                status={jobStatus}
                scriptSource={jobStatus.state === "complete" ? jobStatus.scriptSource : undefined}
                onDownload={handleDownloadFunscript}
                onOpenInScripter={handleOpenInScripter}
                onOpenInPlayer={handleOpenInPlayer}
                onReset={() => { stopPolling(); setJobStatus({ state: "idle" }); }}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function StatusPanel({
  status,
  scriptSource,
  onDownload,
  onOpenInScripter,
  onOpenInPlayer,
  onReset,
}: {
  status: JobStatus;
  scriptSource?: string;
  onDownload: () => void;
  onOpenInScripter: () => void;
  onOpenInPlayer: () => void;
  onReset: () => void;
}) {
  const borderColor =
    status.state === "complete" ? "border-green-500/40" :
    status.state === "error" ? "border-destructive/40" :
    "border-primary/30";
  const bgColor =
    status.state === "complete" ? "bg-green-500/5" :
    status.state === "error" ? "bg-destructive/5" :
    "bg-primary/5";

  return (
    <div className={`rounded-lg border ${borderColor} ${bgColor} p-4 space-y-3`}>
      <div className="flex items-center gap-2">
        {(status.state === "queued" || status.state === "processing") && (
          <Loader2 className="h-4 w-4 animate-spin text-primary flex-shrink-0" />
        )}
        {status.state === "complete" && <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0" />}
        {status.state === "error" && <AlertTriangle className="h-4 w-4 text-destructive flex-shrink-0" />}
        <span className="text-sm font-medium text-foreground">
          {status.state === "queued" && "Queued — waiting for the daemon…"}
          {status.state === "processing" && `Processing… ${status.percent}%`}
          {status.state === "complete" && "Complete — your script is ready"}
          {status.state === "error" && "Generation failed"}
        </span>
      </div>

      {status.state === "processing" && (
        <div className="h-1.5 rounded-full bg-border overflow-hidden">
          <div className="h-full bg-primary rounded-full transition-all duration-500" style={{ width: `${status.percent}%` }} />
        </div>
      )}

      {status.state === "error" && (
        <div className="space-y-1.5">
          <p className="text-xs text-destructive">{status.message}</p>
          {(status.message?.includes("not currently supported") || status.message?.includes("code 1")) && (
            <p className="text-xs text-muted-foreground">
              Some sites (e.g. RedTube) have broken extractors in older versions of yt-dlp. The daemon auto-updates yt-dlp on each job — if this persists, try downloading the video manually and uploading it instead.
            </p>
          )}
        </div>
      )}

      {status.state === "complete" && scriptSource === "audio_rms" && (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/8 px-3 py-2">
          <Volume2 className="h-3.5 w-3.5 text-amber-500 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-amber-600 dark:text-amber-400 leading-snug">
            <span className="font-semibold">Audio-only script</span> — video couldn't be downloaded (unsupported site, geo-block, or private video). Script was generated from the audio track and may be less accurate.
          </p>
        </div>
      )}

      {status.state === "complete" && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" className="gap-1.5 h-8 text-xs" onClick={onDownload}>
            <Download className="h-3.5 w-3.5" />Download .funscript
          </Button>
          <Button size="sm" variant="outline" className="gap-1.5 h-8 text-xs" onClick={onOpenInScripter}>
            <FileCode className="h-3.5 w-3.5" />Open in Scripter
          </Button>
          <Button size="sm" variant="outline" className="gap-1.5 h-8 text-xs" onClick={onOpenInPlayer}>
            <PlaySquare className="h-3.5 w-3.5" />Open in Player
          </Button>
        </div>
      )}

      {(status.state === "error" || status.state === "complete") && (
        <button className="text-xs text-muted-foreground hover:text-foreground transition-colors" onClick={onReset}>
          <RefreshCw className="h-3 w-3 inline mr-1" />Start over
        </button>
      )}
    </div>
  );
}
