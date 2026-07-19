import { useState, useEffect, useRef, useCallback } from "react";
import { useAuth } from "@clerk/react";
import { PremiumGate } from "@/components/premium-gate";
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
  FileVideo,
  Link2,
  Loader2,
  RefreshCw,
  Upload,
  Wand2,
  X,
} from "lucide-react";
import { useLocation } from "wouter";

const API = import.meta.env.VITE_API_URL ?? "";
const DAEMON_URL = "http://localhost:7860";

type AgreementState = "loading" | "needed" | "accepted";
type InputMode = "url" | "file";

type JobStatus =
  | { state: "idle" }
  | { state: "uploading" }
  | { state: "queued"; jobId: string }
  | { state: "processing"; jobId: string; percent: number }
  | { state: "complete"; jobId: string; funscriptUrl: string }
  | { state: "error"; jobId: string; message: string };

function ConnectionIndicator({
  status,
}: {
  status: "connecting" | "connected" | "unreachable";
}) {
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
      Not running
    </span>
  );
}

export default function AIScripter() {
  const { getToken } = useAuth();
  const [, navigate] = useLocation();
  const { status: daemonStatus, sessionToken } = useAIScripterConnection();

  // ── Agreement state ────────────────────────────────────────────────────────
  const [agreementState, setAgreementState] = useState<AgreementState>("loading");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        const headers: Record<string, string> = {};
        if (token) headers["Authorization"] = `Bearer ${token}`;
        const res = await fetch(`${API}/api/user/aiscripter-status`, { headers });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { agreed: boolean };
        if (!cancelled) setAgreementState(data.agreed ? "accepted" : "needed");
      } catch {
        if (!cancelled) setAgreementState("needed");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [getToken]);

  // ── Input mode ─────────────────────────────────────────────────────────────
  const [inputMode, setInputMode] = useState<InputMode>("url");
  const [videoUrl, setVideoUrl] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Generation settings ────────────────────────────────────────────────────
  const [maxTravel, setMaxTravel] = useState(300);
  const [videoName, setVideoName] = useState<string>("aiscripter-output");

  // ── Job state ──────────────────────────────────────────────────────────────
  const [jobStatus, setJobStatus] = useState<JobStatus>({ state: "idle" });
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const pollJob = useCallback(
    async (jobId: string) => {
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
          });
          setShowSaveDialog(true);
        } else if (data.status === "error") {
          stopPolling();
          setJobStatus({ state: "error", jobId, message: data.error ?? "Unknown error." });
        }
      } catch {
        /* network hiccup — keep polling */
      }
    },
    [sessionToken, stopPolling],
  );

  const startPolling = useCallback(
    (jobId: string) => {
      setJobStatus({ state: "queued", jobId });
      pollRef.current = setInterval(() => pollJob(jobId), 1500);
    },
    [pollJob],
  );

  // ── URL-based job ──────────────────────────────────────────────────────────
  const handleSubmitUrl = useCallback(async () => {
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
        body: JSON.stringify({ url: videoUrl.trim(), max_travel: maxTravel }),
      });
      // Extract video name from URL for the download filename
      try {
        const u = new URL(videoUrl.trim());
        const pathParts = u.pathname.split("/").filter(Boolean);
        const lastPart = pathParts[pathParts.length - 1] || "";
        const cleanName = lastPart.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9\-_\s]/g, "_");
        if (cleanName) setVideoName(cleanName);
      } catch {
        /* ignore URL parse errors */
      }
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setJobStatus({
          state: "error",
          jobId: "",
          message: data.error ?? `HTTP ${res.status}`,
        });
        return;
      }
      const data = (await res.json()) as { job_id: string };
      startPolling(data.job_id);
    } catch (err) {
      setJobStatus({
        state: "error",
        jobId: "",
        message: err instanceof Error ? err.message : "Failed to start job.",
      });
    }
  }, [videoUrl, daemonStatus, sessionToken, stopPolling, startPolling]);

  // ── File-based job ─────────────────────────────────────────────────────────
  const handleSubmitFile = useCallback(
    async (file: File) => {
      if (!file || daemonStatus !== "connected") return;
      stopPolling();
      setJobStatus({ state: "uploading" });
      try {
        const formData = new FormData();
        formData.append("video", file);
        const uploadRes = await fetch(`${DAEMON_URL}/api/upload`, {
          method: "POST",
          headers: sessionToken ? { "X-AIScripter-Token": sessionToken } : {},
          mode: "cors",
          body: formData,
        });
        if (!uploadRes.ok) {
          const data = (await uploadRes.json()) as { error?: string };
          setJobStatus({
            state: "error",
            jobId: "",
            message: data.error ?? `Upload failed: HTTP ${uploadRes.status}`,
          });
          return;
        }
        const uploadData = (await uploadRes.json()) as { job_id: string };
        const jobId = uploadData.job_id;

        const processRes = await fetch(`${DAEMON_URL}/api/process`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(sessionToken ? { "X-AIScripter-Token": sessionToken } : {}),
          },
          mode: "cors",
          body: JSON.stringify({ job_id: jobId, max_travel: maxTravel }),
        });
        if (!processRes.ok) {
          const data = (await processRes.json()) as { error?: string };
          setJobStatus({
            state: "error",
            jobId,
            message: data.error ?? `Processing failed: HTTP ${processRes.status}`,
          });
          return;
        }
        startPolling(jobId);
      } catch (err) {
        setJobStatus({
          state: "error",
          jobId: "",
          message: err instanceof Error ? err.message : "Failed to upload file.",
        });
      }
    },
    [daemonStatus, sessionToken, stopPolling, startPolling, maxTravel],
  );

  const handleGenerate = useCallback(() => {
    if (inputMode === "url") handleSubmitUrl();
    else if (selectedFile) handleSubmitFile(selectedFile);
  }, [inputMode, selectedFile, handleSubmitUrl, handleSubmitFile]);

  useEffect(() => () => stopPolling(), [stopPolling]);

  // ── Drag & drop ────────────────────────────────────────────────────────────
  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith("video/")) {
      setSelectedFile(file);
      setInputMode("file");
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  // ── Funscript helpers ──────────────────────────────────────────────────────
  const fetchFunscript = useCallback(
    async (funscriptUrl: string): Promise<string | null> => {
      try {
        const res = await fetch(funscriptUrl, {
          headers: sessionToken ? { "X-AIScripter-Token": sessionToken } : {},
          mode: "cors",
        });
        return res.ok ? await res.text() : null;
      } catch {
        return null;
      }
    },
    [sessionToken],
  );

  const downloadFunscript = useCallback((funscript: string, name?: string) => {
    const blob = new Blob([funscript], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const safeName = (name || "aiscripter-output").replace(/[^a-zA-Z0-9\-_\s]/g, "_");
    a.download = `${safeName}.funscript`;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const openInScripter = useCallback(
    (funscript: string) => {
      try {
        const channel = new BroadcastChannel("hapticos");
        channel.postMessage({ type: "hapticai_funscript", funscript, name: "AIScripter Script" });
        channel.close();
      } catch {
        sessionStorage.setItem(
          "hapticai_import",
          JSON.stringify({ funscript, name: "AIScripter Script" }),
        );
      }
      navigate("/scripter");
    },
    [navigate],
  );

  // ── Save-dialog actions ────────────────────────────────────────────────────
  const handleSaveAndOpen = useCallback(async () => {
    if (jobStatus.state !== "complete") return;
    setShowSaveDialog(false);
    const funscript = await fetchFunscript(jobStatus.funscriptUrl);
    if (!funscript) return;
    downloadFunscript(funscript, videoName);
    openInScripter(funscript);
  }, [jobStatus, fetchFunscript, downloadFunscript, openInScripter, videoName]);

  const handleOpenScripterOnly = useCallback(async () => {
    if (jobStatus.state !== "complete") return;
    setShowSaveDialog(false);
    const funscript = await fetchFunscript(jobStatus.funscriptUrl);
    if (funscript) openInScripter(funscript);
  }, [jobStatus, fetchFunscript, openInScripter]);

  const handleDownloadOnly = useCallback(async () => {
    if (jobStatus.state !== "complete") return;
    setShowSaveDialog(false);
    const funscript = await fetchFunscript(jobStatus.funscriptUrl);
    if (funscript) downloadFunscript(funscript, videoName);
  }, [jobStatus, fetchFunscript, downloadFunscript, videoName]);

  // ── Render ─────────────────────────────────────────────────────────────────
  const isBusy =
    jobStatus.state === "uploading" ||
    jobStatus.state === "queued" ||
    jobStatus.state === "processing";

  const canGenerate =
    daemonStatus === "connected" &&
    !isBusy &&
    ((inputMode === "url" && videoUrl.trim() !== "") ||
      (inputMode === "file" && selectedFile !== null));

  if (agreementState === "loading") {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (agreementState === "needed") {
    return <AIScripterEuaModal onAccepted={() => setAgreementState("accepted")} />;
  }

  return (
    <PremiumGate feature="AIScripter">
      <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
        {/* Header */}
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
                Generate haptic scripts from video using local AI
              </p>
            </div>
            <div className="ml-auto">
              <ConnectionIndicator status={daemonStatus} />
            </div>
          </div>
        </div>

        {/* Download / setup section */}
        <AIScripterDownload daemonConnected={daemonStatus === "connected"} />

        {/* Job submission — only show when connected */}
        {daemonStatus === "connected" && (
          <div className="rounded-xl border border-border bg-card p-5 space-y-4">
            <h3 className="font-semibold text-sm text-foreground">Generate Script</h3>

            {/* Mode tabs */}
            <div className="flex gap-1 p-1 rounded-lg bg-muted/50 w-fit">
              <button
                onClick={() => setInputMode("url")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                  inputMode === "url"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Link2 className="h-3 w-3" />
                URL / Site
              </button>
              <button
                onClick={() => setInputMode("file")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                  inputMode === "file"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <FileVideo className="h-3 w-3" />
                Local File
              </button>
            </div>

            {/* URL input */}
            {inputMode === "url" && (
              <div className="space-y-2">
                <label className="text-xs text-muted-foreground font-medium">Video URL</label>
                <Input
                  placeholder="https://…"
                  value={videoUrl}
                  onChange={(e) => setVideoUrl(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && canGenerate && handleGenerate()}
                  disabled={isBusy}
                  className="text-sm"
                />
                <p className="text-[11px] text-muted-foreground">
                  Paste a direct video URL or link from a supported site. The daemon uses yt-dlp to download and analyse it locally.
                </p>
              </div>
            )}

            {/* Local file input */}
            {inputMode === "file" && (
              <div className="space-y-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="video/mp4,video/x-matroska,video/avi,video/quicktime,video/webm,video/x-msvideo,.mp4,.mkv,.avi,.mov,.wmv,.webm,.m4v"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0] ?? null;
                    setSelectedFile(file);
                    if (file) {
                      setVideoName(file.name.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9\-_\s]/g, "_"));
                    }
                  }}
                />
                <div
                  className={`relative border-2 border-dashed rounded-lg p-6 text-center cursor-pointer select-none transition-all ${
                    isDragOver
                      ? "border-primary bg-primary/5"
                      : selectedFile
                        ? "border-green-500/50 bg-green-500/5"
                        : "border-border hover:border-primary/50 hover:bg-muted/30"
                  }`}
                  onClick={() => !isBusy && fileInputRef.current?.click()}
                  onDrop={handleDrop}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                >
                  {selectedFile ? (
                    <div className="flex items-center justify-center gap-2">
                      <FileVideo className="h-4 w-4 text-green-500 flex-shrink-0" />
                      <span className="text-sm text-foreground font-medium truncate max-w-xs">
                        {selectedFile.name}
                      </span>
                      <button
                        className="ml-1 text-muted-foreground hover:text-foreground"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedFile(null);
                        }}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <Upload className="h-6 w-6 text-muted-foreground mx-auto" />
                      <div>
                        <p className="text-sm text-foreground font-medium">
                          Drop a video here, or{" "}
                          <span className="text-primary underline underline-offset-2">browse</span>
                        </p>
                        <p className="text-[11px] text-muted-foreground mt-1">
                          MP4, MKV, AVI, MOV, WMV, WebM, M4V — up to 500 MB
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Maximum Travel slider */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs text-muted-foreground font-medium">
                  Maximum Travel
                </label>
                <span className="text-xs font-semibold text-foreground tabular-nums">
                  {maxTravel}
                </span>
              </div>
              <input
                type="range"
                min={200}
                max={500}
                step={50}
                value={maxTravel}
                onChange={(e) => setMaxTravel(Number(e.target.value))}
                disabled={isBusy}
                className="w-full accent-primary h-1.5 rounded-lg appearance-none bg-border cursor-pointer"
              />
              <div className="flex justify-between text-[10px] text-muted-foreground">
                <span>200</span>
                <span>250</span>
                <span>300</span>
                <span>350</span>
                <span>400</span>
                <span>450</span>
                <span>500</span>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Controls the maximum stroke distance between high and low points. Lower = gentler, higher = more intense.
              </p>
            </div>

            {/* Generate button */}
            <Button onClick={handleGenerate} disabled={!canGenerate} className="w-full gap-1.5">
              {isBusy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Wand2 className="h-4 w-4" />
              )}
              {jobStatus.state === "uploading" ? "Uploading…" : "Generate Script"}
            </Button>

            {/* Status panel */}
            {jobStatus.state !== "idle" && (
              <StatusPanel
                status={jobStatus}
                showSaveDialog={showSaveDialog}
                onShowSaveDialog={() => setShowSaveDialog(true)}
                onReset={() => {
                  stopPolling();
                  setJobStatus({ state: "idle" });
                  setShowSaveDialog(false);
                }}
              />
            )}
          </div>
        )}
      </div>

      {/* Script-ready modal */}
      {showSaveDialog && jobStatus.state === "complete" && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-card border border-border rounded-xl shadow-xl p-6 max-w-sm w-full space-y-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-green-500/10 border border-green-500/20 flex items-center justify-center flex-shrink-0">
                <CheckCircle2 className="h-5 w-5 text-green-500" />
              </div>
              <div>
                <h3 className="font-semibold text-sm text-foreground">Script ready!</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Save a copy before opening in Scripter?
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <Button className="w-full gap-1.5" onClick={handleSaveAndOpen}>
                <Download className="h-4 w-4" />
                Save & Open in Scripter
              </Button>
              <Button
                variant="outline"
                className="w-full gap-1.5"
                onClick={handleOpenScripterOnly}
              >
                <FileCode className="h-4 w-4" />
                Open in Scripter
              </Button>
              <Button
                variant="ghost"
                className="w-full gap-1.5 text-xs text-muted-foreground"
                onClick={handleDownloadOnly}
              >
                <Download className="h-3.5 w-3.5" />
                Download .funscript only
              </Button>
              <button
                className="text-xs text-muted-foreground hover:text-foreground transition-colors text-center pt-1"
                onClick={() => setShowSaveDialog(false)}
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}
    </PremiumGate>
  );
}

function StatusPanel({
  status,
  showSaveDialog,
  onShowSaveDialog,
  onReset,
}: {
  status: JobStatus;
  showSaveDialog: boolean;
  onShowSaveDialog: () => void;
  onReset: () => void;
}) {
  const borderColor =
    status.state === "complete"
      ? "border-green-500/40"
      : status.state === "error"
        ? "border-destructive/40"
        : "border-primary/30";

  const bgColor =
    status.state === "complete"
      ? "bg-green-500/5"
      : status.state === "error"
        ? "bg-destructive/5"
        : "bg-primary/5";

  return (
    <div className={`rounded-lg border ${borderColor} ${bgColor} p-4 space-y-3`}>
      <div className="flex items-center gap-2">
        {(status.state === "uploading" ||
          status.state === "queued" ||
          status.state === "processing") && (
          <Loader2 className="h-4 w-4 animate-spin text-primary flex-shrink-0" />
        )}
        {status.state === "complete" && (
          <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0" />
        )}
        {status.state === "error" && (
          <AlertTriangle className="h-4 w-4 text-destructive flex-shrink-0" />
        )}
        <span className="text-sm font-medium text-foreground">
          {status.state === "uploading" && "Uploading video to local daemon…"}
          {status.state === "queued" && "Queued — waiting for the daemon…"}
          {status.state === "processing" && `Processing… ${status.percent}%`}
          {status.state === "complete" && "Script ready"}
          {status.state === "error" && "Generation failed"}
        </span>
        {status.state === "complete" && !showSaveDialog && (
          <button
            className="ml-auto text-xs text-primary hover:underline"
            onClick={onShowSaveDialog}
          >
            Open options
          </button>
        )}
      </div>

      {status.state === "processing" && (
        <div className="h-1.5 rounded-full bg-border overflow-hidden">
          <div
            className="h-full bg-primary rounded-full transition-all duration-500"
            style={{ width: `${status.percent}%` }}
          />
        </div>
      )}

      {status.state === "error" && (
        <p className="text-xs text-destructive">{status.message}</p>
      )}

      {(status.state === "error" || status.state === "complete") && (
        <button
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          onClick={onReset}
        >
          <RefreshCw className="h-3 w-3 inline mr-1" />
          Start over
        </button>
      )}
    </div>
  );
}
