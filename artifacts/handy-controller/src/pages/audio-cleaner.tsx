import { useState, useRef, useCallback, useEffect } from "react";
import { useLocation } from "wouter";
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Scissors, Upload, Play, Pause, Download, X, Activity, Square, RefreshCw, RotateCcw } from "lucide-react";
import { applyVocalRemoval, applyImpactSuppression, applyScreamSuppression } from "@/lib/audio-dsp";
import { useToast } from "@/hooks/use-toast";

export const AUDIO_CLEANER_SESSION_KEY = "hc_bd_from_cleaner";

// ─── WAV encoder ──────────────────────────────────────────────────────────────
function encodeWav(buffer: AudioBuffer): Blob {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const numSamples = buffer.length;
  const byteLength = 44 + numSamples * numChannels * 2;
  const arrayBuffer = new ArrayBuffer(byteLength);
  const view = new DataView(arrayBuffer);

  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  writeStr(0, "RIFF");
  view.setUint32(4, byteLength - 8, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * 2, true);
  view.setUint16(32, numChannels * 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, numSamples * numChannels * 2, true);

  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const sample = Math.max(-1, Math.min(1, buffer.getChannelData(ch)[i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }

  return new Blob([arrayBuffer], { type: "audio/wav" });
}

// ─── Waveform renderer ────────────────────────────────────────────────────────
function drawWaveform(canvas: HTMLCanvasElement, buffer: AudioBuffer) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const { width, height } = canvas;

  const data = buffer.getChannelData(0);
  const step = Math.ceil(data.length / width);
  const amp = height / 2;

  ctx.fillStyle = "#0f0303";
  ctx.fillRect(0, 0, width, height);

  ctx.beginPath();
  ctx.strokeStyle = "hsl(0,72%,55%)";
  ctx.lineWidth = 1.5;

  for (let i = 0; i < width; i++) {
    let min = 1, max = -1;
    for (let j = 0; j < step; j++) {
      const d = data[i * step + j] ?? 0;
      if (d < min) min = d;
      if (d > max) max = d;
    }
    ctx.moveTo(i, amp + min * amp);
    ctx.lineTo(i, amp + max * amp);
  }
  ctx.stroke();
}

// ─── Component ────────────────────────────────────────────────────────────────
type Step = "idle" | "ready" | "extracting" | "processing" | "done" | "error";

interface Options {
  vocalRemoval: boolean;
  impactSuppression: boolean;
  screamSuppression: boolean;
}

interface FilterParams {
  vocalStrength: number;
  impactRatio: number;
  screamCutoff: number;
  screamPeak: number;
}

const DEFAULT_PARAMS: FilterParams = {
  vocalStrength: 100,
  impactRatio: 4,
  screamCutoff: 8000,
  screamPeak: 0.6,
};

export default function AudioCleaner() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [step, setStep] = useState<Step>("idle");
  const [progress, setProgress] = useState(0);
  const [statusMsg, setStatusMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [options, setOptions] = useState<Options>({
    vocalRemoval: true,
    impactSuppression: true,
    screamSuppression: false,
  });
  const [params, setParams] = useState<FilterParams>({ ...DEFAULT_PARAMS });

  const [cancelling, setCancelling] = useState(false);
  const [processedBuffer, setProcessedBuffer] = useState<AudioBuffer | null>(null);
  const [wavBlob, setWavBlob] = useState<Blob | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [fileName, setFileName] = useState("");

  const [processingTime, setProcessingTime] = useState<number | null>(null);
  const [outputSize, setOutputSize] = useState<number | null>(null);

  const [swapDragOver, setSwapDragOver] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const processingStartRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const changeFileInputRef = useRef<HTMLInputElement>(null);
  const ffmpegRef = useRef<FFmpeg | null>(null);
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const ffmpegLoaded = useRef(false);
  const selectedFileRef = useRef<File | null>(null);
  const runIdRef = useRef(0);

  const loadFFmpeg = useCallback(async () => {
    if (ffmpegLoaded.current) return;
    const ff = new FFmpeg();
    const base = import.meta.env.BASE_URL.replace(/\/$/, "");
    await ff.load({
      coreURL: await toBlobURL(`${base}/ffmpeg/ffmpeg-core.js`, "text/javascript"),
      wasmURL: await toBlobURL(`${base}/ffmpeg/ffmpeg-core.wasm`, "application/wasm"),
    });
    ff.on("progress", ({ progress: p }) => setProgress(Math.round(p * 100)));
    ffmpegRef.current = ff;
    ffmpegLoaded.current = true;
  }, []);

  const stopPlayback = useCallback(() => {
    sourceNodeRef.current?.stop();
    sourceNodeRef.current?.disconnect();
    sourceNodeRef.current = null;
    setIsPlaying(false);
  }, []);

  useEffect(() => {
    return () => {
      stopPlayback();
      audioCtxRef.current?.close();
    };
  }, [stopPlayback]);

  const processFile = useCallback(async (file: File) => {
    const myRunId = ++runIdRef.current;
    const alive = () => runIdRef.current === myRunId;

    const resetAfterCancel = () => {
      setCancelling(false);
      setStep("ready");
      setProgress(0);
      setStatusMsg("");
      setProcessedBuffer(null);
      setWavBlob(null);
      toast({ title: "Processing cancelled", duration: 2000 });
    };

    setStep("extracting");
    setProgress(0);
    setStatusMsg("Loading audio engine…");
    setProcessedBuffer(null);
    setWavBlob(null);
    setProcessingTime(null);
    setOutputSize(null);
    processingStartRef.current = performance.now();
    stopPlayback();

    // Close any previous AudioContext before creating a new one
    if (audioCtxRef.current) {
      audioCtxRef.current.close();
      audioCtxRef.current = null;
    }

    try {
      await loadFFmpeg();
      if (!alive()) { resetAfterCancel(); return; }
      const ff = ffmpegRef.current!;

      setStatusMsg("Extracting audio from video…");
      await ff.writeFile("input", await fetchFile(file));
      if (!alive()) {
        await ff.deleteFile("input").catch(() => {});
        resetAfterCancel();
        return;
      }
      await ff.exec([
        "-i", "input",
        "-vn",
        "-acodec", "pcm_s16le",
        "-ar", "44100",
        "-ac", "2",
        "output.wav",
      ]);
      if (!alive()) {
        await ff.deleteFile("input").catch(() => {});
        await ff.deleteFile("output.wav").catch(() => {});
        resetAfterCancel();
        return;
      }
      const wavData = await ff.readFile("output.wav");
      await ff.deleteFile("input");
      await ff.deleteFile("output.wav");

      if (!alive()) { resetAfterCancel(); return; }

      setStep("processing");
      setStatusMsg("Applying audio processing…");
      setProgress(0);

      // Single shared AudioContext for decoding + all DSP buffer allocations
      const audioCtx = new AudioContext();
      audioCtxRef.current = audioCtx;

      const wavBytes = wavData instanceof Uint8Array ? wavData.buffer : wavData;
      let decoded = await audioCtx.decodeAudioData(wavBytes as ArrayBuffer);
      if (!alive()) { resetAfterCancel(); return; }

      if (options.vocalRemoval) {
        setStatusMsg("Removing vocals…");
        decoded = applyVocalRemoval(decoded, audioCtx, params.vocalStrength / 100);
        if (!alive()) { resetAfterCancel(); return; }
      }
      if (options.impactSuppression) {
        setStatusMsg("Suppressing impact sounds…");
        decoded = applyImpactSuppression(decoded, audioCtx, 512, params.impactRatio);
        if (!alive()) { resetAfterCancel(); return; }
      }
      if (options.screamSuppression) {
        setStatusMsg("Suppressing screaming…");
        decoded = applyScreamSuppression(decoded, audioCtx, params.screamCutoff, params.screamPeak);
        if (!alive()) { resetAfterCancel(); return; }
      }

      setProgress(90);
      setStatusMsg("Encoding output…");
      const blob = encodeWav(decoded);
      if (!alive()) { resetAfterCancel(); return; }
      const elapsedMs = processingStartRef.current !== null
        ? performance.now() - processingStartRef.current
        : null;
      setWavBlob(blob);
      setProcessedBuffer(decoded);
      setOutputSize(blob.size);
      if (elapsedMs !== null) setProcessingTime(Math.round(elapsedMs) / 1000);
      setProgress(100);
      setStep("done");

      if (canvasRef.current) {
        requestAnimationFrame(() => drawWaveform(canvasRef.current!, decoded));
      }
    } catch (err) {
      if (!alive()) { resetAfterCancel(); return; }
      console.error(err);
      setErrorMsg(err instanceof Error ? err.message : "Unknown error");
      setStep("error");
    }
  }, [options, params, loadFFmpeg, stopPlayback, toast]);

  const handleFileSelect = useCallback((file: File | null | undefined) => {
    if (!file) return;
    selectedFileRef.current = file;
    setFileName(file.name);
    setStep("ready");
    setProgress(0);
    setStatusMsg("");
    setErrorMsg("");
    setProcessedBuffer(null);
    setWavBlob(null);
    stopPlayback();
  }, [stopPlayback]);

  const isProcessing = step === "extracting" || step === "processing" || cancelling;

  const runCurrentFile = useCallback(() => {
    if (!selectedFileRef.current || isProcessing) return;
    processFile(selectedFileRef.current);
  }, [processFile, isProcessing]);

  const handleCancel = useCallback(() => {
    runIdRef.current++;
    // Grab the instance before nulling the ref so we can terminate it.
    const ff = ffmpegRef.current;
    ffmpegRef.current = null;
    ffmpegLoaded.current = false;
    // Terminate the worker immediately — this causes the in-flight exec() /
    // writeFile() promise to reject right away so processFile() can exit
    // without waiting for the full ffmpeg run to complete.
    try { ff?.terminate(); } catch { /* ignore if already terminated */ }
    stopPlayback();
    // "Cancelling…" is shown briefly; the catch block in processFile will
    // call resetAfterCancel() once the rejected promise unwinds.
    setCancelling(true);
    setStatusMsg("Cancelling…");
  }, [stopPlayback]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFileSelect(file);
  }, [handleFileSelect]);

  const handleSwapDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setSwapDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFileSelect(file);
  }, [handleFileSelect]);

  const togglePlayback = useCallback(() => {
    if (!processedBuffer || !audioCtxRef.current) return;

    if (isPlaying) {
      stopPlayback();
      return;
    }

    const source = audioCtxRef.current.createBufferSource();
    source.buffer = processedBuffer;
    source.connect(audioCtxRef.current.destination);
    source.onended = () => setIsPlaying(false);
    source.start(0);
    sourceNodeRef.current = source;
    setIsPlaying(true);
  }, [processedBuffer, isPlaying, stopPlayback]);

  const handleDownload = useCallback(() => {
    if (!wavBlob) return;
    const url = URL.createObjectURL(wavBlob);
    const a = document.createElement("a");
    a.href = url;
    const base = fileName.replace(/\.[^.]+$/, "");
    a.download = `${base}_cleaned.wav`;
    a.click();
    URL.revokeObjectURL(url);
  }, [wavBlob, fileName]);

  const sendToScripter = useCallback(() => {
    if (!wavBlob) return;
    const url = URL.createObjectURL(wavBlob);
    sessionStorage.setItem(AUDIO_CLEANER_SESSION_KEY, url);
    navigate("/scripter");
  }, [wavBlob, navigate]);

  const reset = useCallback(() => {
    runIdRef.current++;
    ffmpegRef.current = null;
    ffmpegLoaded.current = false;
    stopPlayback();
    audioCtxRef.current?.close();
    audioCtxRef.current = null;
    selectedFileRef.current = null;
    setCancelling(false);
    setStep("idle");
    setProgress(0);
    setStatusMsg("");
    setErrorMsg("");
    setProcessedBuffer(null);
    setWavBlob(null);
    setProcessingTime(null);
    setOutputSize(null);
    setFileName("");
    setOptions({ vocalRemoval: true, impactSuppression: true, screamSuppression: false });
    setParams({ ...DEFAULT_PARAMS });
  }, [stopPlayback]);

  const formatFileSize = (bytes: number): string => {
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${bytes} B`;
  };

  const toggleOption = (key: keyof Options) => {
    setOptions(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const setParam = <K extends keyof FilterParams>(key: K, value: FilterParams[K]) => {
    setParams(prev => ({ ...prev, [key]: value }));
  };

  return (
    <div className="p-8 max-w-4xl mx-auto flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
          <Scissors className="h-8 w-8 text-primary" />
          Audio Cleaner
        </h1>
        <p className="text-muted-foreground mt-1">
          Extract audio from video and remove vocals, impact sounds, or screaming — all in your browser.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Left column: upload + options */}
        <div className="md:col-span-1 flex flex-col gap-4">
          {/* Drop zone */}
          <Card className="bg-card/50 border-border/50">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Video File</CardTitle>
            </CardHeader>
            <CardContent>
              {step === "idle" || step === "error" ? (
                <div
                  className={`border-2 border-dashed rounded-xl p-6 flex flex-col items-center gap-3 cursor-pointer transition-colors ${
                    dragOver ? "border-primary bg-primary/10" : "border-border/60 hover:border-primary/50 hover:bg-muted/30"
                  }`}
                  onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="h-8 w-8 text-muted-foreground" />
                  <div className="text-center">
                    <p className="text-sm font-medium text-foreground">Drop a video here</p>
                    <p className="text-xs text-muted-foreground mt-1">mp4, mkv, webm, mov, avi…</p>
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="video/*,audio/*"
                    className="hidden"
                    onChange={e => handleFileSelect(e.target.files?.[0])}
                  />
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-2 p-3 rounded-lg bg-muted/40 border border-border/50">
                    <p className="text-sm truncate text-foreground" title={fileName}>{fileName}</p>
                    {(step === "ready" || step === "done") && (
                      <button onClick={reset} className="text-muted-foreground hover:text-foreground transition-colors flex-shrink-0" title="Remove file and reset all settings">
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                  {(step === "ready" || step === "done") && (
                    <div
                      className={`border border-dashed rounded-lg p-3 flex items-center gap-2 cursor-pointer transition-colors ${
                        swapDragOver ? "border-primary bg-primary/10" : "border-border/40 hover:border-primary/40 hover:bg-muted/20"
                      }`}
                      onDragOver={e => { e.preventDefault(); setSwapDragOver(true); }}
                      onDragLeave={() => setSwapDragOver(false)}
                      onDrop={handleSwapDrop}
                      onClick={() => changeFileInputRef.current?.click()}
                    >
                      <RefreshCw className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                      <p className="text-xs text-muted-foreground">Change file — options are kept</p>
                      <input
                        ref={changeFileInputRef}
                        type="file"
                        accept="video/*,audio/*"
                        className="hidden"
                        onChange={e => { handleFileSelect(e.target.files?.[0]); e.target.value = ""; }}
                      />
                    </div>
                  )}
                </div>
              )}
              {step === "error" && (
                <p className="text-xs text-destructive mt-2 leading-snug">{errorMsg}</p>
              )}
            </CardContent>
          </Card>

          {/* Processing options */}
          <Card className="bg-card/50 border-primary/20">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Removal Options</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">

              {/* Vocal Removal */}
              <div className="space-y-2">
                <label className="flex items-start gap-3 cursor-pointer group">
                  <div className="mt-0.5 relative">
                    <input type="checkbox" checked={options.vocalRemoval} onChange={() => toggleOption("vocalRemoval")} disabled={isProcessing} className="sr-only" />
                    <div className={`h-4 w-4 rounded border transition-colors flex items-center justify-center ${options.vocalRemoval ? "bg-primary border-primary" : "border-border bg-background group-hover:border-primary/50"} ${isProcessing ? "opacity-50" : ""}`}>
                      {options.vocalRemoval && (
                        <svg className="h-3 w-3 text-white" viewBox="0 0 12 12" fill="none">
                          <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </div>
                  </div>
                  <div>
                    <p className={`text-sm font-medium ${isProcessing ? "text-muted-foreground" : "text-foreground"}`}>Vocal / Voice Removal</p>
                    <p className="text-xs text-muted-foreground leading-snug">Phase cancellation strips center-panned vocals</p>
                  </div>
                </label>
                {options.vocalRemoval && (
                  <div className="ml-7 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">Strength</span>
                      <span className="text-xs font-medium text-foreground tabular-nums">{params.vocalStrength}%</span>
                    </div>
                    <input
                      type="range"
                      min={0} max={100} step={1}
                      value={params.vocalStrength}
                      disabled={isProcessing}
                      onChange={e => setParam("vocalStrength", Number(e.target.value))}
                      className="w-full h-1.5 accent-primary cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    />
                    <div className="flex justify-between text-[10px] text-muted-foreground/60">
                      <span>Subtle</span><span>Full removal</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Impact Suppression */}
              <div className="space-y-2">
                <label className="flex items-start gap-3 cursor-pointer group">
                  <div className="mt-0.5 relative">
                    <input type="checkbox" checked={options.impactSuppression} onChange={() => toggleOption("impactSuppression")} disabled={isProcessing} className="sr-only" />
                    <div className={`h-4 w-4 rounded border transition-colors flex items-center justify-center ${options.impactSuppression ? "bg-primary border-primary" : "border-border bg-background group-hover:border-primary/50"} ${isProcessing ? "opacity-50" : ""}`}>
                      {options.impactSuppression && (
                        <svg className="h-3 w-3 text-white" viewBox="0 0 12 12" fill="none">
                          <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </div>
                  </div>
                  <div>
                    <p className={`text-sm font-medium ${isProcessing ? "text-muted-foreground" : "text-foreground"}`}>Impact / Slap Suppression</p>
                    <p className="text-xs text-muted-foreground leading-snug">Transient limiter reduces sharp percussive spikes</p>
                  </div>
                </label>
                {options.impactSuppression && (
                  <div className="ml-7 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">Ratio</span>
                      <span className="text-xs font-medium text-foreground tabular-nums">{params.impactRatio.toFixed(1)}:1</span>
                    </div>
                    <input
                      type="range"
                      min={1} max={10} step={0.5}
                      value={params.impactRatio}
                      disabled={isProcessing}
                      onChange={e => setParam("impactRatio", Number(e.target.value))}
                      className="w-full h-1.5 accent-primary cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    />
                    <div className="flex justify-between text-[10px] text-muted-foreground/60">
                      <span>Gentle</span><span>Aggressive</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Scream Suppression */}
              <div className="space-y-2">
                <label className="flex items-start gap-3 cursor-pointer group">
                  <div className="mt-0.5 relative">
                    <input type="checkbox" checked={options.screamSuppression} onChange={() => toggleOption("screamSuppression")} disabled={isProcessing} className="sr-only" />
                    <div className={`h-4 w-4 rounded border transition-colors flex items-center justify-center ${options.screamSuppression ? "bg-primary border-primary" : "border-border bg-background group-hover:border-primary/50"} ${isProcessing ? "opacity-50" : ""}`}>
                      {options.screamSuppression && (
                        <svg className="h-3 w-3 text-white" viewBox="0 0 12 12" fill="none">
                          <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </div>
                  </div>
                  <div>
                    <p className={`text-sm font-medium ${isProcessing ? "text-muted-foreground" : "text-foreground"}`}>Scream Suppression</p>
                    <p className="text-xs text-muted-foreground leading-snug">High-freq rolloff + limiter tames screaming peaks</p>
                  </div>
                </label>
                {options.screamSuppression && (
                  <div className="ml-7 space-y-3">
                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-muted-foreground">Cutoff</span>
                        <span className="text-xs font-medium text-foreground tabular-nums">{params.screamCutoff.toLocaleString()} Hz</span>
                      </div>
                      <input
                        type="range"
                        min={1000} max={18000} step={500}
                        value={params.screamCutoff}
                        disabled={isProcessing}
                        onChange={e => setParam("screamCutoff", Number(e.target.value))}
                        className="w-full h-1.5 accent-primary cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                      />
                      <div className="flex justify-between text-[10px] text-muted-foreground/60">
                        <span>Aggressive</span><span>Subtle</span>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-muted-foreground">Peak Limit</span>
                        <span className="text-xs font-medium text-foreground tabular-nums">{params.screamPeak.toFixed(2)}</span>
                      </div>
                      <input
                        type="range"
                        min={0.1} max={1.0} step={0.05}
                        value={params.screamPeak}
                        disabled={isProcessing}
                        onChange={e => setParam("screamPeak", Number(e.target.value))}
                        className="w-full h-1.5 accent-primary cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                      />
                      <div className="flex justify-between text-[10px] text-muted-foreground/60">
                        <span>Heavy clip</span><span>No clip</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>

            </CardContent>
          </Card>
        </div>

        {/* Right column: progress + waveform + playback */}
        <div className="md:col-span-2 flex flex-col gap-4">
          {/* Ready — Start button */}
          {step === "ready" && (
            <Card className="bg-card/50 border-primary/20">
              <CardContent className="pt-5 flex flex-col gap-3">
                <p className="text-sm text-muted-foreground">File ready. Adjust options then start processing.</p>
                <Button className="w-full gap-2" onClick={runCurrentFile}>
                  <Play className="h-4 w-4" />
                  Start Processing
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Progress card */}
          {isProcessing && (
            <Card className="bg-card/50 border-primary/20">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">
                  {cancelling ? "Cancelling" : step === "extracting" ? "Extracting Audio" : "Processing"}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className={`text-sm ${cancelling ? "text-muted-foreground/70 italic" : "text-muted-foreground"}`}>
                  {statusMsg}
                </p>
                <Progress value={progress} className="h-2" />
                <p className="text-xs text-muted-foreground text-right">{progress}%</p>
                <Button
                  variant="outline"
                  className="w-full gap-2 border-destructive/50 text-destructive hover:bg-destructive/10 hover:text-destructive disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={handleCancel}
                  disabled={cancelling}
                >
                  <Square className="h-4 w-4" />
                  {cancelling ? "Cancelling…" : "Cancel"}
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Waveform */}
          {(step === "done" || isProcessing) && (
            <Card className="bg-black border-border/50 overflow-hidden">
              <CardHeader className="pb-2">
                <CardTitle className="text-base text-muted-foreground">Waveform Preview</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <canvas
                  ref={canvasRef}
                  className="w-full"
                  width={800}
                  height={180}
                  style={{ display: "block" }}
                />
              </CardContent>
            </Card>
          )}

          {/* Playback + download + send to scripter */}
          {step === "done" && processedBuffer && (
            <Card className="bg-card/50 border-primary/20">
              <CardContent className="pt-5 flex flex-col gap-3">
                {(processingTime !== null || outputSize !== null) && (
                  <div className="flex items-center gap-4 px-1 py-1.5 rounded-lg bg-muted/30 border border-border/40 text-xs text-muted-foreground">
                    {processingTime !== null && (
                      <span className="flex items-center gap-1.5">
                        <span className="h-1.5 w-1.5 rounded-full bg-primary/70 inline-block" />
                        Processed in {processingTime.toFixed(1)}s
                      </span>
                    )}
                    {outputSize !== null && (
                      <span className="flex items-center gap-1.5">
                        <span className="h-1.5 w-1.5 rounded-full bg-primary/70 inline-block" />
                        Output: {formatFileSize(outputSize)} WAV
                      </span>
                    )}
                  </div>
                )}
                <div className="flex gap-3">
                  <Button
                    variant="outline"
                    className="flex-1 gap-2"
                    onClick={togglePlayback}
                  >
                    {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                    {isPlaying ? "Pause" : "Play Preview"}
                  </Button>
                  <Button
                    variant="outline-primary"
                    className="flex-1 gap-2"
                    onClick={handleDownload}
                  >
                    <Download className="h-4 w-4" />
                    Download WAV
                  </Button>
                </div>
                <Button
                  variant="outline"
                  className="w-full gap-2"
                  onClick={runCurrentFile}
                >
                  <RotateCcw className="h-4 w-4" />
                  Re-process with current options
                </Button>
                <Button
                  className="w-full gap-2"
                  onClick={sendToScripter}
                >
                  <Activity className="h-4 w-4" />
                  Send to Scripter Beat Detector
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Idle placeholder */}
          {step === "idle" && (
            <Card className="bg-black border-border/30 overflow-hidden flex-1 min-h-[220px] flex items-center justify-center">
              <p className="text-muted-foreground/50 text-sm">Drop a video file to get started</p>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
