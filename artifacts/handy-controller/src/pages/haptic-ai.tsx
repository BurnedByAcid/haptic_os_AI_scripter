import { useState, useEffect, useRef, useCallback } from "react";
import { useAuth, useUser } from "@clerk/react";
import { useSubscription } from "@/hooks/use-subscription";
import { PremiumGate } from "@/components/premium-gate";
import { HapticAIEuaModal } from "@/components/hapticai-eua-modal";
import { HapticAIWarningBanner } from "@/components/hapticai-warning-banner";
import { HapticAIConsentDialog } from "@/components/haptic-ai-consent-dialog";
import { useHapticAIConnection } from "@/hooks/use-hapticai-connection";
import type { HapticAIOption } from "@/hooks/use-hapticai-connection";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Circle,
  Download,
  Loader2,
  Wand2,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";

const API = import.meta.env.VITE_API_URL ?? "";

type AgreementState = "loading" | "needed" | "accepted";

function detectOS(): "windows" | "mac" | "other" {
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes("win")) return "windows";
  if (ua.includes("mac")) return "mac";
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
  mac?: { sizeBytes: number } | null;
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

function UnavailableMessage({ label }: { label: string }) {
  return (
    <div className="space-y-1">
      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <Download className="h-3 w-3" />
        {label}
        <span className="text-[10px]">(not yet available)</span>
      </span>
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
    </div>
  );
}

function DownloadLink({ os, release, state }: {
  os: "windows" | "mac" | "other";
  release: HapticAIRelease | null;
  state: ReleaseState;
}) {
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [upgradeUrl, setUpgradeUrl] = useState<string | null>(null);
  const { getToken } = useAuth();
  const [progress, setProgress] = useState<number | null>(null);
  const [receivedBytes, setReceivedBytes] = useState(0);

  if (os === "other") {
    return (
      <p className="text-xs text-muted-foreground">
        HapticAI is available for Windows and macOS. Check back soon for Linux support.
      </p>
    );
  }

  const platformRelease = os === "windows" ? release?.windows : release?.mac;
  const downloadUrl = `${API}/api/hapticai/download/${os}`;
  const filename = os === "windows"
    ? `HapticAI-Setup-${release?.version ?? "latest"}.exe`
    : `HapticAI-${release?.version ?? "latest"}.dmg`;
  const label = os === "windows" ? "Download HapticAI for Windows (.exe)" : "Download HapticAI for macOS";

  if (state === "loading") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        {label}
      </span>
    );
  }

  if (state !== "available" || !platformRelease) {
    return <UnavailableMessage label={label} />;
  }

  const handleDownload = async (e: React.MouseEvent) => {
    e.preventDefault();
    if (downloading) return;
    setDownloading(true);
    setDownloadError(null);
    setUpgradeUrl(null);
    setProgress(null);
    setReceivedBytes(0);
    try {
      const token = await getToken();
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch(downloadUrl, { headers });
      if (!res.ok) {
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

      const contentLength = res.headers.get("content-length");
      const totalBytes = contentLength ? parseInt(contentLength, 10) : 0;
      const reader = res.body?.getReader();
      if (!reader) {
        // Fallback: no streaming support
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
        return;
      }

      const chunks: BlobPart[] = [];
      let received = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
        setReceivedBytes(received);
        if (totalBytes > 0) {
          setProgress(Math.min(100, Math.round((received / totalBytes) * 100)));
        }
      }

      const blob = new Blob(chunks);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setDownloadError("Download failed. Please check your connection or contact support.");
    } finally {
      setDownloading(false);
      setProgress(null);
      setReceivedBytes(0);
    }
  };

  const totalBytes = platformRelease.sizeBytes;

  return (
    <div className="space-y-1.5">
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

      {downloading && (
        <div className="space-y-1 pt-0.5">
          <div className="h-1.5 w-full max-w-[220px] rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full bg-primary transition-all duration-150"
              style={{ width: progress !== null ? `${progress}%` : "0%" }}
            />
          </div>
          <p className="text-[10px] text-muted-foreground tabular-nums">
            {progress !== null
              ? `${formatBytes(receivedBytes)} of ${formatBytes(totalBytes)} — ${progress}%`
              : `${formatBytes(receivedBytes)} received…`}
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
        </p>
      )}
    </div>
  );
}

function SetupPanel({ os, serverUrl, onUrlChange }: {
  os: "windows" | "mac" | "other";
  serverUrl: string;
  onUrlChange: (url: string) => void;
}) {
  const [urlInput, setUrlInput] = useState(serverUrl);
  const [expanded, setExpanded] = useState(true);
  const { release, state } = useHapticAIRelease();

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
              <DownloadLink os={os} release={release} state={state} />
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
                  : os === "mac"
                  ? "Open the downloaded .app file. macOS may ask you to confirm — go to System Settings → Privacy & Security and click \"Open Anyway\"."
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

function OptionControl({
  option,
  value,
  onChange,
}: {
  option: HapticAIOption;
  value: unknown;
  onChange: (key: string, val: unknown) => void;
}) {
  if (option.type === "boolean") {
    return (
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id={`opt-${option.key}`}
          checked={!!value}
          onChange={(e) => onChange(option.key, e.target.checked)}
          className="h-4 w-4 rounded border-input accent-primary"
        />
        <label htmlFor={`opt-${option.key}`} className="text-sm text-foreground cursor-pointer">
          {option.label}
        </label>
      </div>
    );
  }
  if (option.type === "select" && Array.isArray(option.choices)) {
    return (
      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">{option.label}</label>
        <select
          value={String(value ?? option.default ?? "")}
          onChange={(e) => onChange(option.key, e.target.value)}
          className="w-full h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        >
          {option.choices.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </div>
    );
  }
  return (
    <div className="space-y-1">
      <label className="text-xs text-muted-foreground">{option.label}</label>
      <input
        type="number"
        value={Number(value ?? option.default ?? 0)}
        min={option.min}
        max={option.max}
        step={option.step ?? 1}
        onChange={(e) => onChange(option.key, Number(e.target.value))}
        className="w-full h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
      />
    </div>
  );
}

function initOptionValues(options: HapticAIOption[]): Record<string, unknown> {
  const stored = (() => {
    try {
      const raw = localStorage.getItem("hapticai_option_values");
      return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    } catch { return {}; }
  })();
  const result: Record<string, unknown> = {};
  for (const opt of options) {
    result[opt.key] = opt.key in stored ? stored[opt.key] : opt.default;
  }
  return result;
}

function GenerationUI({ serverUrl, sessionToken, options }: { serverUrl: string; sessionToken: string; options: HapticAIOption[] }) {
  const [prompt, setPrompt] = useState("");
  const [optionValues, setOptionValues] = useState<Record<string, unknown>>(() => initOptionValues(options));
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<{ funscript: string; name: string } | null>(null);
  const [genError, setGenError] = useState<string | null>(null);
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const { getToken } = useAuth();

  useEffect(() => {
    setOptionValues(initOptionValues(options));
  }, [options]);

  const handleOptionChange = (key: string, val: unknown) => {
    setOptionValues((prev) => {
      const next = { ...prev, [key]: val };
      try { localStorage.setItem("hapticai_option_values", JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  };

  const hasCustomValues = options.some(
    (opt) => optionValues[opt.key] !== undefined && optionValues[opt.key] !== opt.default,
  );

  const handleResetOptions = () => {
    const defaults: Record<string, unknown> = {};
    for (const opt of options) defaults[opt.key] = opt.default;
    try { localStorage.removeItem("hapticai_option_values"); } catch { /* ignore */ }
    setOptionValues(defaults);
  };

  const handleGenerate = async () => {
    if (!prompt.trim() || generating) return;
    setGenerating(true);
    setResult(null);
    setGenError(null);
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000);
      const body: Record<string, unknown> = { prompt: prompt.trim() };
      if (options.length > 0) body.options = optionValues;
      const genHeaders: Record<string, string> = { "Content-Type": "application/json" };
      if (sessionToken) genHeaders["X-HapticAI-Token"] = sessionToken;
      const res = await fetch(`${serverUrl}/generate`, {
        method: "POST",
        headers: genHeaders,
        body: JSON.stringify(body),
        signal: controller.signal,
        mode: "cors",
      });
      clearTimeout(timeoutId);
      if (!res.ok) {
        const errData = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(errData.error ?? `Server returned ${res.status}`);
      }
      const data = await res.json() as { funscript?: string; actions?: unknown[] };
      const funscriptStr = typeof data.funscript === "string"
        ? data.funscript
        : JSON.stringify(data);
      const name = `hapticai-${Date.now()}`;
      setResult({ funscript: funscriptStr, name });
    } catch (err) {
      const msg = err instanceof Error
        ? (err.name === "AbortError" ? "Generation timed out — HapticAI took too long to respond." : err.message)
        : "Generation failed.";
      setGenError(msg);
    } finally {
      setGenerating(false);
    }
  };

  const handleOpenInScripter = () => {
    if (!result) return;
    try {
      sessionStorage.setItem("hapticai_import", JSON.stringify({ funscript: result.funscript, name: result.name }));
      navigate("/scripter");
      toast({ title: "Opening in Scripter…", description: "Your generated script is ready to edit." });
    } catch {
      toast({ title: "Couldn't open in Scripter", variant: "destructive" });
    }
  };

  const handleSaveToLibrary = async () => {
    if (!result) return;
    try {
      const token = await getToken();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;

      let parsed: unknown;
      try { parsed = JSON.parse(result.funscript); } catch { parsed = result.funscript; }

      const res = await fetch(`${API}/api/scripter-sessions`, {
        method: "POST",
        headers,
        body: JSON.stringify({ name: result.name, funscript_json: parsed }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(errData.error ?? `Server returned ${res.status}`);
      }
      toast({ title: "Saved to library", description: `"${result.name}" is now in your script library.` });
    } catch (err) {
      toast({
        title: "Couldn't save to library",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleDownload = () => {
    if (!result) return;
    const blob = new Blob([result.funscript], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${result.name}.funscript`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Describe what you want
        </label>

        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="e.g. A slow build-up that intensifies over 2 minutes with short rapid bursts at the peak…"
          rows={4}
          maxLength={1000}
          className="resize-none text-sm"
          disabled={generating}
        />
        <p className="text-[11px] text-muted-foreground text-right">
          {prompt.length}/1000
        </p>
      </div>

      {options.length > 0 && (
        <div className="space-y-3 rounded-lg border border-border bg-muted/20 p-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Generation Options</p>
            {hasCustomValues && (
              <button
                type="button"
                onClick={handleResetOptions}
                className="text-[11px] text-muted-foreground hover:text-foreground transition-colors underline underline-offset-2"
              >
                Reset to defaults
              </button>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {options.map((opt) => (
              <OptionControl
                key={opt.key}
                option={opt}
                value={optionValues[opt.key] ?? opt.default}
                onChange={handleOptionChange}
              />
            ))}
          </div>
        </div>
      )}

      <Button
        onClick={handleGenerate}
        disabled={!prompt.trim() || generating}
        className="w-full gap-2"
      >
        {generating ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Generating…
          </>
        ) : (
          <>
            <Wand2 className="h-4 w-4" />
            Generate Script
          </>
        )}
      </Button>

      {generating && (
        <div className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground text-center">
          HapticAI is processing your request. This may take a moment…
        </div>
      )}

      {genError && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {genError}
        </div>
      )}

      {result && (
        <div className="rounded-lg border border-green-500/30 bg-green-500/5 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-green-500" />
            <p className="text-sm font-medium text-foreground">Script generated successfully</p>
          </div>
          <p className="text-xs text-muted-foreground">
            Your funscript is ready. You can open it in the Scripter to review and edit, save it to your library, or download it directly.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={handleOpenInScripter} className="gap-1.5 text-xs h-8">
              Open in Scripter
            </Button>
            <Button size="sm" variant="outline" onClick={handleSaveToLibrary} className="gap-1.5 text-xs h-8">
              Save to Library
            </Button>
            <Button size="sm" variant="ghost" onClick={handleDownload} className="gap-1.5 text-xs h-8">
              <Download className="h-3 w-3" />
              Download .funscript
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function HapticAIContent() {
  const { getToken } = useAuth();
  const { user } = useUser();
  const [agreementState, setAgreementState] = useState<AgreementState>("loading");
  const checkedRef = useRef(false);
  const { status, capabilities, serverUrl, sessionToken, setServerUrl } = useHapticAIConnection();
  const os = detectOS();

  useEffect(() => {
    if (checkedRef.current) return;
    checkedRef.current = true;

    const meta = user?.publicMetadata as Record<string, unknown>;
    const localAgreed = meta?.hapticaiAgreed === true || meta?.fungenAgreed === true;
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

  return (
    <div className="flex flex-col h-full">
      {agreementState === "needed" && (
        <HapticAIEuaModal onAccepted={handleAccepted} />
      )}

      <HapticAIWarningBanner />

      <div className="flex-1 overflow-y-auto">
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

          {/* Connection status bar */}
          <div className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-2.5">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">HapticAI status:</span>
              <ConnectionDot status={status} />
            </div>
            <div className="flex items-center gap-2">
              {capabilities.version && (
                <span className="text-[10px] text-muted-foreground font-mono">v{capabilities.version}</span>
              )}
              <span className="text-[10px] text-muted-foreground">
                {serverUrl}
              </span>
            </div>
          </div>

          {/* Setup panel — shown when unreachable */}
          {status !== "connected" && (
            <SetupPanel os={os} serverUrl={serverUrl} onUrlChange={setServerUrl} />
          )}

          {/* Generation UI — shown when connected */}
          {status === "connected" && (
            <Card className="border-border/60">
              <CardContent className="p-5">
                <GenerationUI serverUrl={serverUrl} sessionToken={sessionToken} options={capabilities.options ?? []} />
              </CardContent>
            </Card>
          )}

          {/* Placeholder when connecting */}
          {status === "connecting" && (
            <div className="rounded-lg border border-border bg-muted/20 px-4 py-8 text-center space-y-2">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground mx-auto" />
              <p className="text-sm text-muted-foreground">Connecting to HapticAI…</p>
            </div>
          )}
        </div>
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
