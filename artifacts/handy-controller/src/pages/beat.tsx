import { useState, useEffect, useRef } from "react";
import { useFeatureTracking } from "@/hooks/use-analytics";
import { useHandy } from "@/hooks/use-handy";
import { setHDSP } from "@/lib/handyApi";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Mic, Upload, Square } from "lucide-react";

const BANDS = [
  { label: "Sub",    lo: 20,    hi: 60    },
  { label: "Bass",   lo: 60,    hi: 250   },
  { label: "LowMid", lo: 250,   hi: 500   },
  { label: "Mid",    lo: 500,   hi: 1000  },
  { label: "UpMid",  lo: 1000,  hi: 2000  },
  { label: "Prsnc",  lo: 2000,  hi: 4000  },
  { label: "Brill",  lo: 4000,  hi: 6000  },
  { label: "High",   lo: 6000,  hi: 8000  },
  { label: "VHigh",  lo: 8000,  hi: 12000 },
  { label: "UHigh",  lo: 12000, hi: 16000 },
  { label: "Air",    lo: 16000, hi: 20000 },
] as const;

const NUM_BANDS = BANDS.length;
const HISTORY_SIZE = 43;

const BAND_COLORS = [
  "#7c3aed",
  "#8b36e8",
  "#9d32e0",
  "#b02ed8",
  "#c02bcf",
  "#ce29c4",
  "#d928b6",
  "#e228a6",
  "#e82a95",
  "#ec2d83",
  "#ef3070",
];

function freqToBin(freq: number, sampleRate: number, fftSize: number): number {
  return Math.round((freq / (sampleRate / 2)) * (fftSize / 2));
}

export default function Beat() {
  useFeatureTracking("beat");
  const { key, connected } = useHandy();
  const [isActive, setIsActive] = useState(false);
  const [sensitivity, setSensitivity] = useState(1.5);
  const [bpm, setBpm] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | AudioBufferSourceNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastBeatTimeRef = useRef(0);
  const bandHistoriesRef = useRef<number[][]>(
    Array.from({ length: NUM_BANDS }, () => [])
  );
  const beatIntervalHistoryRef = useRef<number[]>([]);
  const sensitivityRef = useRef(sensitivity);

  useEffect(() => {
    sensitivityRef.current = sensitivity;
  }, [sensitivity]);

  const startMic = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      setupAudio(stream);
      setIsActive(true);
    } catch (e) {
      console.error(e);
    }
  };

  const startFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const arrayBuffer = await file.arrayBuffer();
      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(ctx.destination);

      const analyser = ctx.createAnalyser();
      analyser.fftSize = 4096;
      source.connect(analyser);
      analyserRef.current = analyser;
      sourceRef.current = source;

      source.start(0);
      setIsActive(true);
      loop();
    } catch (err) {
      console.error(err);
    }
  };

  const setupAudio = (stream: MediaStream) => {
    const ctx = new AudioContext();
    audioCtxRef.current = ctx;
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 4096;
    source.connect(analyser);

    sourceRef.current = source;
    analyserRef.current = analyser;
    loop();
  };

  const stop = () => {
    setIsActive(false);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (sourceRef.current instanceof AudioBufferSourceNode) {
      sourceRef.current.stop();
    } else if (sourceRef.current instanceof MediaStreamAudioSourceNode) {
      sourceRef.current.mediaStream.getTracks().forEach(t => t.stop());
    }
    if (audioCtxRef.current) audioCtxRef.current.close();
    bandHistoriesRef.current = Array.from({ length: NUM_BANDS }, () => []);
    beatIntervalHistoryRef.current = [];
    lastBeatTimeRef.current = 0;
  };

  useEffect(() => {
    return stop;
  }, []);

  const loop = () => {
    if (!analyserRef.current || !canvasRef.current) return;

    const analyser = analyserRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const sampleRate = audioCtxRef.current?.sampleRate ?? 44100;
    const fftSize = analyser.fftSize;
    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(dataArray);

    const now = performance.now();
    const sens = sensitivityRef.current;

    const bandEnergies: number[] = [];
    const beatFired: boolean[] = [];

    for (let b = 0; b < NUM_BANDS; b++) {
      const loBin = Math.max(0, freqToBin(BANDS[b].lo, sampleRate, fftSize));
      const hiBin = Math.min(dataArray.length - 1, freqToBin(BANDS[b].hi, sampleRate, fftSize));
      const count = Math.max(1, hiBin - loBin + 1);

      let energy = 0;
      for (let i = loBin; i <= hiBin; i++) {
        const v = dataArray[i] / 255;
        energy += v * v;
      }
      energy /= count;

      bandEnergies.push(energy);

      const history = bandHistoriesRef.current[b];
      history.push(energy);
      if (history.length > HISTORY_SIZE) history.shift();

      const avg = history.reduce((a, c) => a + c, 0) / history.length;
      beatFired.push(energy > avg * sens && energy > 0.01);
    }

    const histories0 = bandHistoriesRef.current[0];
    const histories1 = bandHistoriesRef.current[1];
    const avg0 = histories0.length ? histories0.reduce((a, c) => a + c, 0) / histories0.length : 0;
    const avg1 = histories1.length ? histories1.reduce((a, c) => a + c, 0) / histories1.length : 0;
    const relStrength0 = avg0 > 0 ? bandEnergies[0] / avg0 : 0;
    const relStrength1 = avg1 > 0 ? bandEnergies[1] / avg1 : 0;
    const dominantBassIndex = relStrength0 >= relStrength1 ? 0 : 1;
    const bassBeat = beatFired[dominantBassIndex];

    if (bassBeat && now - lastBeatTimeRef.current > 250) {
      const interval = now - lastBeatTimeRef.current;
      if (interval > 0 && interval < 3000) {
        beatIntervalHistoryRef.current.push(interval);
        if (beatIntervalHistoryRef.current.length > 8) beatIntervalHistoryRef.current.shift();
        const avgInterval =
          beatIntervalHistoryRef.current.reduce((a, b) => a + b, 0) /
          beatIntervalHistoryRef.current.length;
        setBpm(Math.round(60000 / avgInterval));
      }
      lastBeatTimeRef.current = now;

      if (connected && key) {
        setHDSP(key, 100, 87);
        setTimeout(() => setHDSP(key, 0, 87), 120);
      }
    }

    const globalBeat = bassBeat && now - lastBeatTimeRef.current < 50;

    ctx.fillStyle = globalBeat ? "rgba(0, 229, 255, 0.15)" : "rgba(0, 0, 0, 0.35)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const padding = 12;
    const gap = 6;
    const totalGaps = gap * (NUM_BANDS - 1) + padding * 2;
    const barWidth = (canvas.width - totalGaps) / NUM_BANDS;
    const maxBarHeight = canvas.height - 36;

    for (let b = 0; b < NUM_BANDS; b++) {
      const x = padding + b * (barWidth + gap);
      const energy = bandEnergies[b];
      const barHeight = Math.min(maxBarHeight, energy * maxBarHeight * 6);
      const y = canvas.height - 20 - barHeight;

      const isBeat = beatFired[b];
      const color = BAND_COLORS[b];

      if (isBeat) {
        ctx.shadowColor = color;
        ctx.shadowBlur = 16;
      } else {
        ctx.shadowBlur = 0;
      }

      ctx.fillStyle = isBeat ? "#ffffff" : color;
      ctx.fillRect(x, y, barWidth, barHeight);

      ctx.shadowBlur = 0;

      ctx.fillStyle = isBeat ? "#ffffff" : "rgba(180,160,220,0.7)";
      ctx.font = `${Math.max(8, Math.min(11, barWidth - 2))}px sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText(BANDS[b].label, x + barWidth / 2, canvas.height - 4);
    }

    rafRef.current = requestAnimationFrame(loop);
  };

  return (
    <div className="p-8 max-w-4xl mx-auto h-full flex flex-col gap-6">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Live Audio</h1>
          <p className="text-muted-foreground">Audio-reactive haptic feedback.</p>
        </div>
        {!connected && <div className="text-destructive font-medium text-sm">Device Not Connected</div>}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="md:col-span-2 bg-black border-border/50 overflow-hidden relative min-h-[300px]">
          <canvas ref={canvasRef} className="w-full h-full absolute inset-0" width={800} height={400} />
          {!isActive && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/80 z-10 text-muted-foreground">
              Select an input source to begin
            </div>
          )}
        </Card>

        <div className="space-y-6">
          <Card className="bg-card/50 border-primary/20">
            <CardHeader>
              <CardTitle>Input Source</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {isActive ? (
                <Button variant="destructive" className="w-full" onClick={stop}>
                  <Square className="mr-2 h-4 w-4" /> Stop Audio
                </Button>
              ) : (
                <>
                  <Button variant="secondary" className="w-full" onClick={startMic}>
                    <Mic className="mr-2 h-4 w-4" /> Use Microphone
                  </Button>
                  <Button variant="secondary" className="w-full relative cursor-pointer">
                    <Upload className="mr-2 h-4 w-4" /> <span>Upload Audio</span>
                    <input type="file" accept="audio/*" className="absolute inset-0 opacity-0 cursor-pointer" onChange={startFile} />
                  </Button>
                </>
              )}
            </CardContent>
          </Card>

          <Card className="bg-card/50 border-primary/30">
            <CardHeader>
              <CardTitle>BPM</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col items-center">
              <span className="text-5xl font-bold font-mono text-primary" data-testid="bpm-display">
                {bpm > 0 ? bpm : "—"}
              </span>
              <span className="text-xs text-muted-foreground mt-1">beats per minute</span>
            </CardContent>
          </Card>

          <Card className="bg-card/50 border-border/50">
            <CardHeader>
              <CardTitle>Sensitivity</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex justify-between mb-4">
                <span className="text-sm text-muted-foreground">Threshold Mult</span>
                <span className="font-mono text-primary">{sensitivity.toFixed(1)}x</span>
              </div>
              <Slider
                min={1.0} max={3.0} step={0.1}
                value={[sensitivity]}
                onValueChange={v => setSensitivity(v[0])}
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
