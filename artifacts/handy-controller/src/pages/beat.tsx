import { useState, useEffect, useRef } from "react";
import { useHandy } from "@/hooks/use-handy";
import { setHDSP } from "@/lib/handyApi";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Mic, Upload, Square } from "lucide-react";

export default function Beat() {
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
  const energyHistoryRef = useRef<number[]>([]);

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
      analyser.fftSize = 2048;
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
    analyser.fftSize = 2048;
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

    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteTimeDomainData(dataArray);

    // Calc energy
    let energy = 0;
    for (let i = 0; i < dataArray.length; i++) {
      const val = (dataArray[i] - 128) / 128;
      energy += val * val;
    }
    
    const history = energyHistoryRef.current;
    history.push(energy);
    if (history.length > 43) history.shift(); // ~1 second at 43fps
    
    const avgEnergy = history.reduce((a,b) => a+b, 0) / history.length;
    const now = performance.now();
    
    if (energy > avgEnergy * sensitivity && now - lastBeatTimeRef.current > 250) {
      // Beat detected
      lastBeatTimeRef.current = now;
      if (connected && key) {
        setHDSP(key, 100, 87);
        setTimeout(() => setHDSP(key, 0, 87), 120);
      }
      
      // visual flash
      ctx.fillStyle = "rgba(186, 100%, 50%, 0.8)";
      ctx.fillRect(0,0, canvas.width, canvas.height);
    } else {
      ctx.fillStyle = "rgba(0, 0, 0, 0.2)";
      ctx.fillRect(0,0, canvas.width, canvas.height);
    }

    // Draw wave
    ctx.lineWidth = 2;
    ctx.strokeStyle = "hsl(186, 100%, 50%)";
    ctx.beginPath();
    const sliceWidth = canvas.width * 1.0 / dataArray.length;
    let x = 0;
    for(let i = 0; i < dataArray.length; i++) {
      const v = dataArray[i] / 128.0;
      const y = v * canvas.height/2;
      if(i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
      x += sliceWidth;
    }
    ctx.stroke();

    rafRef.current = requestAnimationFrame(loop);
  };

  return (
    <div className="p-8 max-w-4xl mx-auto h-full flex flex-col gap-6">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Beat 2 Beat</h1>
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
                onValueChange={(v) => setSensitivity(v[0])} 
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
