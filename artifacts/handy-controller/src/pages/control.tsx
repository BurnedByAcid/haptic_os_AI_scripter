import { useState, useEffect, useRef } from "react";
import { useHandy } from "@/hooks/use-handy";
import { setHAMP, stopDevice } from "@/lib/handyApi";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { Square } from "lucide-react";

export default function Control() {
  const { key, connected } = useHandy();
  const [speed, setSpeed] = useState(0);
  const [min, setMin] = useState(0);
  const [max, setMax] = useState(100);
  
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const updateHandy = (s: number, mn: number, mx: number) => {
    if (!connected || !key) return;
    
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    
    timeoutRef.current = setTimeout(() => {
      if (s === 0) {
        stopDevice(key);
      } else {
        setHAMP(key, { velocity: s, slideMin: mn, slideMax: mx });
      }
    }, 100); // 100ms debounce
  };

  const handleSpeedChange = (val: number[]) => {
    setSpeed(val[0]);
    updateHandy(val[0], min, max);
  };

  const handleMinChange = (val: number[]) => {
    const newVal = Math.min(val[0], max - 1);
    setMin(newVal);
    updateHandy(speed, newVal, max);
  };

  const handleMaxChange = (val: number[]) => {
    const newVal = Math.max(val[0], min + 1);
    setMax(newVal);
    updateHandy(speed, min, newVal);
  };

  const handleStop = () => {
    setSpeed(0);
    if (key && connected) stopDevice(key);
  };

  return (
    <div className="p-8 max-w-3xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Manual Control</h1>
        <p className="text-muted-foreground">Direct control over device parameters.</p>
      </div>

      <Card className="bg-card/50 backdrop-blur border-primary/20">
        <CardHeader>
          <div className="flex justify-between items-center">
            <div>
              <CardTitle>HAMP Mode</CardTitle>
              <CardDescription>Handy Automatic Mode Protocol</CardDescription>
            </div>
            <div className="flex items-center gap-4">
              <div className={`h-3 w-3 rounded-full ${speed > 0 && connected ? 'bg-primary animate-pulse shadow-[0_0_10px_var(--color-primary)]' : 'bg-muted'}`} />
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
              <span className="font-mono text-primary font-bold">{speed} / 87</span>
            </div>
            <Slider 
              value={[speed]} 
              onValueChange={handleSpeedChange} 
              max={87} 
              step={1}
              disabled={!connected}
              className="py-4"
            />
          </div>

          <div className="grid grid-cols-2 gap-8 pt-4 border-t border-border/50">
            <div className="space-y-4">
              <div className="flex justify-between">
                <label className="text-sm font-medium tracking-wider uppercase text-muted-foreground">Bottom Bound</label>
                <span className="font-mono font-bold">{min}%</span>
              </div>
              <Slider 
                value={[min]} 
                onValueChange={handleMinChange} 
                max={99} 
                step={1}
                disabled={!connected}
                className="[&>[role=slider]]:bg-secondary"
              />
            </div>

            <div className="space-y-4">
              <div className="flex justify-between">
                <label className="text-sm font-medium tracking-wider uppercase text-muted-foreground">Top Bound</label>
                <span className="font-mono font-bold">{max}%</span>
              </div>
              <Slider 
                value={[max]} 
                onValueChange={handleMaxChange} 
                max={100} 
                step={1}
                disabled={!connected}
              />
            </div>
          </div>

        </CardContent>
      </Card>
      
      {!connected && (
        <p className="text-center text-destructive text-sm font-medium">
          Connect device to enable controls.
        </p>
      )}
    </div>
  );
}
