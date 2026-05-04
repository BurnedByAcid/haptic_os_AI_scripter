import { useState, useRef, useCallback, useEffect } from "react";
import { useLocation } from "wouter";
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Scissors, Upload, Play, Pause, Download, X, Activity } from "lucide-react";

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

// ─── DSP processing ───────────────────────────────────────────────────────────
// All DSP functions accept the shared AudioContext to avoid allocating extra contexts.

function applyVocalRemoval(buffer: AudioBuffer, ctx: AudioContext): AudioBuffer {
  const numSamples = buffer.length;
  const numCh = buffer.numberOfChannels;

  if (numCh < 2) return buffer;

  const left = buffer.getChannelData(0);
  const right = buffer.getChannelData(1);

  const outBuffer = ctx.createBuffer(2, numSamples, buffer.sampleRate);
  const outL = outBuffer.getChannelData(0);
  const outR = outBuffer.getChannelData(1);

  for (let i = 0; i < numSamples; i++) {
    const side = (left[i] - right[i]) / 2;
    outL[i] = side;
    outR[i] = side;
  }

  return outBuffer;
}

/**
 * Linear-time rolling-RMS transient limiter.
 * Maintains a running sum-of-squares via a sliding window so each sample
 * is processed in O(1) rather than O(windowSize).
 */
function applyImpactSuppression(
  buffer: AudioBuffer,
  ctx: AudioContext,
  windowSize = 512,
  ratio = 4,
): AudioBuffer {
  const numSamples = buffer.length;
  const numCh = buffer.numberOfChannels;
  const outBuffer = ctx.createBuffer(numCh, numSamples, buffer.sampleRate);

  for (let ch = 0; ch < numCh; ch++) {
    const input = buffer.getChannelData(ch);
    const output = outBuffer.getChannelData(ch);

    // Sliding window ring buffer for O(n) rolling RMS
    const ring = new Float32Array(windowSize);
    let sumSq = 0;
    let ringIdx = 0;
    let filled = 0;

    for (let i = 0; i < numSamples; i++) {
      // Remove the oldest value leaving the window
      const outgoing = ring[ringIdx];
      sumSq -= outgoing * outgoing;

      // Add the incoming value
      const incoming = input[i];
      ring[ringIdx] = incoming;
      sumSq += incoming * incoming;
      ringIdx = (ringIdx + 1) % windowSize;
      if (filled < windowSize) filled++;

      const rms = Math.sqrt(sumSq / filled);
      const threshold = rms * ratio;
      if (threshold > 0 && Math.abs(incoming) > threshold) {
        output[i] = Math.sign(incoming) * threshold;
      } else {
        output[i] = incoming;
      }
    }
  }

  return outBuffer;
}

/**
 * First-order IIR low-pass at ~8 kHz followed by a peak hard-limiter.
 * Tames screaming by rolling off high-frequency content and capping peaks.
 */
function applyScreamSuppression(buffer: AudioBuffer, ctx: AudioContext): AudioBuffer {
  const sampleRate = buffer.sampleRate;
  const numSamples = buffer.length;
  const numCh = buffer.numberOfChannels;
  const outBuffer = ctx.createBuffer(numCh, numSamples, buffer.sampleRate);

  const cutoffFreq = 8000;
  const RC = 1 / (2 * Math.PI * cutoffFreq);
  const dt = 1 / sampleRate;
  const alpha = dt / (RC + dt);
  const peakLimit = 0.6;

  for (let ch = 0; ch < numCh; ch++) {
    const input = buffer.getChannelData(ch);
    const output = outBuffer.getChannelData(ch);

    let prev = 0;
    for (let i = 0; i < numSamples; i++) {
      prev = prev + alpha * (input[i] - prev);
      output[i] = Math.abs(prev) > peakLimit ? Math.sign(prev) * peakLimit : prev;
    }
  }

  return outBuffer;
}

// ─── Waveform renderer ────────────────────────────────────────────────────────
function drawWaveform(canvas: HTMLCanvasElement, buffer: AudioBuffer) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const { width, height } = canvas;

  const data = buffer.getChannelData(0);
  const step = Math.ceil(data.length / width);
  const amp = height / 2;

  ctx.fillStyle = "#0D0B12";
  ctx.fillRect(0, 0, width, height);

  ctx.beginPath();
  ctx.strokeStyle = "hsl(270,85%,60%)";
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
type Step = "idle" | "extracting" | "processing" | "done" | "error";

interface Options {
  vocalRemoval: boolean;
  impactSuppression: boolean;
  screamSuppression: boolean;
}

export default function AudioCleaner() {
  const [, navigate] = useLocation();
  const [step, setStep] = useState<Step>("idle");
  const [progress, setProgress] = useState(0);
  const [statusMsg, setStatusMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [options, setOptions] = useState<Options>({
    vocalRemoval: true,
    impactSuppression: true,
    screamSuppression: false,
  });

  const [processedBuffer, setProcessedBuffer] = useState<AudioBuffer | null>(null);
  const [wavBlob, setWavBlob] = useState<Blob | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [fileName, setFileName] = useState("");

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const ffmpegRef = useRef<FFmpeg | null>(null);
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const ffmpegLoaded = useRef(false);

  const loadFFmpeg = useCallback(async () => {
    if (ffmpegLoaded.current) return;
    const ff = new FFmpeg();
    const baseURL = "https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm";
    await ff.load({
      coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript"),
      wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, "application/wasm"),
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
    setStep("extracting");
    setProgress(0);
    setStatusMsg("Loading audio engine…");
    setProcessedBuffer(null);
    setWavBlob(null);
    setFileName(file.name);
    stopPlayback();

    // Close any previous AudioContext before creating a new one
    if (audioCtxRef.current) {
      audioCtxRef.current.close();
      audioCtxRef.current = null;
    }

    try {
      await loadFFmpeg();
      const ff = ffmpegRef.current!;

      setStatusMsg("Extracting audio from video…");
      await ff.writeFile("input", await fetchFile(file));
      await ff.exec([
        "-i", "input",
        "-vn",
        "-acodec", "pcm_s16le",
        "-ar", "44100",
        "-ac", "2",
        "output.wav",
      ]);
      const wavData = await ff.readFile("output.wav");
      await ff.deleteFile("input");
      await ff.deleteFile("output.wav");

      setStep("processing");
      setStatusMsg("Applying audio processing…");
      setProgress(0);

      // Single shared AudioContext for decoding + all DSP buffer allocations
      const audioCtx = new AudioContext();
      audioCtxRef.current = audioCtx;

      const wavBytes = wavData instanceof Uint8Array ? wavData.buffer : wavData;
      let decoded = await audioCtx.decodeAudioData(wavBytes as ArrayBuffer);

      if (options.vocalRemoval) {
        setStatusMsg("Removing vocals…");
        decoded = applyVocalRemoval(decoded, audioCtx);
      }
      if (options.impactSuppression) {
        setStatusMsg("Suppressing impact sounds…");
        decoded = applyImpactSuppression(decoded, audioCtx);
      }
      if (options.screamSuppression) {
        setStatusMsg("Suppressing screaming…");
        decoded = applyScreamSuppression(decoded, audioCtx);
      }

      setProgress(90);
      setStatusMsg("Encoding output…");
      const blob = encodeWav(decoded);
      setWavBlob(blob);
      setProcessedBuffer(decoded);
      setProgress(100);
      setStep("done");

      if (canvasRef.current) {
        requestAnimationFrame(() => drawWaveform(canvasRef.current!, decoded));
      }
    } catch (err) {
      console.error(err);
      setErrorMsg(err instanceof Error ? err.message : "Unknown error");
      setStep("error");
    }
  }, [options, loadFFmpeg, stopPlayback]);

  const handleFileSelect = useCallback((file: File | null | undefined) => {
    if (!file) return;
    processFile(file);
  }, [processFile]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
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
    stopPlayback();
    audioCtxRef.current?.close();
    audioCtxRef.current = null;
    setStep("idle");
    setProgress(0);
    setStatusMsg("");
    setErrorMsg("");
    setProcessedBuffer(null);
    setWavBlob(null);
    setFileName("");
  }, [stopPlayback]);

  const isProcessing = step === "extracting" || step === "processing";

  const toggleOption = (key: keyof Options) => {
    setOptions(prev => ({ ...prev, [key]: !prev[key] }));
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
                <div className="flex items-center justify-between gap-2 p-3 rounded-lg bg-muted/40 border border-border/50">
                  <p className="text-sm truncate text-foreground" title={fileName}>{fileName}</p>
                  {(step === "done" || step === "error") && (
                    <button onClick={reset} className="text-muted-foreground hover:text-foreground transition-colors flex-shrink-0" title="Remove file">
                      <X className="h-4 w-4" />
                    </button>
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
            <CardContent className="space-y-3">
              {(
                [
                  { key: "vocalRemoval" as const, label: "Vocal / Voice Removal", desc: "Phase cancellation strips center-panned vocals" },
                  { key: "impactSuppression" as const, label: "Impact / Slap Suppression", desc: "Transient limiter reduces sharp percussive spikes" },
                  { key: "screamSuppression" as const, label: "Scream Suppression", desc: "High-freq rolloff + limiter tames screaming peaks" },
                ]
              ).map(({ key, label, desc }) => (
                <label key={key} className="flex items-start gap-3 cursor-pointer group">
                  <div className="mt-0.5 relative">
                    <input
                      type="checkbox"
                      checked={options[key]}
                      onChange={() => toggleOption(key)}
                      disabled={isProcessing}
                      className="sr-only"
                    />
                    <div
                      className={`h-4 w-4 rounded border transition-colors flex items-center justify-center ${
                        options[key]
                          ? "bg-primary border-primary"
                          : "border-border bg-background group-hover:border-primary/50"
                      } ${isProcessing ? "opacity-50" : ""}`}
                    >
                      {options[key] && (
                        <svg className="h-3 w-3 text-white" viewBox="0 0 12 12" fill="none">
                          <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </div>
                  </div>
                  <div>
                    <p className={`text-sm font-medium ${isProcessing ? "text-muted-foreground" : "text-foreground"}`}>{label}</p>
                    <p className="text-xs text-muted-foreground leading-snug">{desc}</p>
                  </div>
                </label>
              ))}
            </CardContent>
          </Card>
        </div>

        {/* Right column: progress + waveform + playback */}
        <div className="md:col-span-2 flex flex-col gap-4">
          {/* Progress card */}
          {isProcessing && (
            <Card className="bg-card/50 border-primary/20">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">{step === "extracting" ? "Extracting Audio" : "Processing"}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-muted-foreground">{statusMsg}</p>
                <Progress value={progress} className="h-2" />
                <p className="text-xs text-muted-foreground text-right">{progress}%</p>
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
