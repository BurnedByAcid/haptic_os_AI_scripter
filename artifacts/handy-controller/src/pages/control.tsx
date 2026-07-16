import { useState, useRef, useEffect } from "react";
import { useFeatureTracking } from "@/hooks/use-analytics";
import { useHandy } from "@/hooks/use-handy";
import { setHAMP, setHDSP, stopDevice } from "@/lib/handyApi";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { Square, Move } from "lucide-react";

export default function Control() {
  useFeatureTracking("control");
  const { key, connected, battery, recordAppModeChange } = useHandy();
  const [speed, setSpeed] = useState(0);
  const [min, setMin] = useState(0);
  const [max, setMax] = useState(100);
  const [position, setPosition] = useState(50);
  const [directMode, setDirectMode] = useState(false);

  const hampTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hdspTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const updateHAMP = (s: number, mn: number, mx: number) => {
    if (!connected || !key) return;
    if (hampTimeout.current) clearTimeout(hampTimeout.current);
    recordAppModeChange(0);
    hampTimeout.current = setTimeout(() => {
      if (s === 0) stopDevice(key);
      else setHAMP(key, { velocity: s, slideMin: mn, slideMax: mx });
    }, 100);
  };

  const updateHDSP = (pos: number) => {
    if (!connected || !key) return;
    if (hdspTimeout.current) clearTimeout(hdspTimeout.current);
    recordAppModeChange(1);
    hdspTimeout.current = setTimeout(() => {
      setHDSP(key, pos, 50);
    }, 50);
  };

  useEffect(() => {
    return () => {
      if (hampTimeout.current) clearTimeout(hampTimeout.current);
      if (hdspTimeout.current) clearTimeout(hdspTimeout.current);
    };
  }, []);

  const handleStop = () => {
    setSpeed(0);
    if (key && connected) stopDevice(key);
  };

  return (
    <div className="p-8 max-w-3xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Manual Control</h1>
        <p className="text-muted-foreground">Direct control over device parameters.</p>
        {battery !== undefined && (
          <p className="text-xs text-muted-foreground mt-1">Battery: {battery}%</p>
        )}
      </div>

      {/* HAMP Mode */}
      <Card className="bg-card/50 backdrop-blur border-primary/20">
        <CardHeader>
          <div className="flex justify-between items-center">
            <div>
              <CardTitle>HAMP Mode — Automatic Stroking</CardTitle>
              <CardDescription>Continuous oscillation at set speed and stroke range</CardDescription>
            </div>
            <div className="flex items-center gap-4">
              <div className={`h-3 w-3 rounded-full ${speed > 0 && connected ? "bg-primary animate-pulse shadow-[0_0_10px_var(--color-primary)]" : "bg-muted"}`} />
              <Button
                variant="destructive"
                size="sm"
                onClick={handleStop}
                disabled={speed === 0 || !connected}
                className="gap-2"
              >
                <Square className="h-4 w-4" /> Stop
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-10 py-6">
          <div className="space-y-4">
            <div className="flex justify-between">
              <label className="text-sm font-medium tracking-wider uppercase">Stroke Speed</label>
              <span className="font-mono text-primary font-bold">{speed}%</span>
            </div>
            <Slider
              value={[speed]}
              onValueChange={val => { setSpeed(val[0]); updateHAMP(val[0], min, max); }}
              max={100}
              step={1}
              disabled={!connected}
              className="py-4"
            />
          </div>

          <div className="grid grid-cols-2 gap-8 pt-4 border-t border-border/50">
            <div className="space-y-4">
              <div className="flex justify-between">
                <label className="text-sm font-medium uppercase text-muted-foreground">Stroke Min</label>
                <span className="font-mono font-bold">{min}%</span>
              </div>
              <Slider
                value={[min]}
                onValueChange={val => { const v = Math.min(val[0], max - 1); setMin(v); updateHAMP(speed, v, max); }}
                max={99}
                step={1}
                disabled={!connected}
                className="[&>[role=slider]]:bg-secondary"
              />
            </div>
            <div className="space-y-4">
              <div className="flex justify-between">
                <label className="text-sm font-medium uppercase text-muted-foreground">Stroke Max</label>
                <span className="font-mono font-bold">{max}%</span>
              </div>
              <Slider
                value={[max]}
                onValueChange={val => { const v = Math.max(val[0], min + 1); setMax(v); updateHAMP(speed, min, v); }}
                max={100}
                step={1}
                disabled={!connected}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* HDSP — Direct Position */}
      <Card className={`bg-card/50 border-border/50 ${directMode ? "border-primary/50" : ""}`}>
        <CardHeader>
          <div className="flex justify-between items-center">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Move className="h-4 w-4" /> Direct Position (HDSP)
              </CardTitle>
              <CardDescription>Move to an exact stroke position instantly</CardDescription>
            </div>
            <Button
              variant={directMode ? "default" : "secondary"}
              size="sm"
              onClick={() => setDirectMode(d => !d)}
              disabled={!connected}
            >
              {directMode ? "Active" : "Enable"}
            </Button>
          </div>
        </CardHeader>
        {directMode && (
          <CardContent className="space-y-4 py-4">
            <div className="flex justify-between">
              <label className="text-sm font-medium tracking-wider uppercase">Position</label>
              <span className="font-mono text-primary font-bold">{position}%</span>
            </div>
            <Slider
              value={[position]}
              onValueChange={val => { setPosition(val[0]); updateHDSP(val[0]); }}
              max={100}
              step={1}
              disabled={!connected}
              className="py-4"
            />
            <p className="text-xs text-muted-foreground">Drag to move device to exact position. Best for scripting and testing.</p>
          </CardContent>
        )}
      </Card>

      {!connected && (
        <p className="text-center text-destructive text-sm font-medium">
          Connect device to enable controls.
        </p>
      )}
    </div>
  );
}
