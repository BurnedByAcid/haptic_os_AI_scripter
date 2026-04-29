import { useState, useRef, useEffect, useMemo } from "react";
import { useHandy } from "@/hooks/use-handy";
import { setHDSP } from "@/lib/handyApi";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Trash2 } from "lucide-react";

interface Point {
  id: string;
  time: number;
  pos: number;
}

export default function Scripter() {
  const { key, connected } = useHandy();
  const [points, setPoints] = useState<Point[]>([]);
  const [selectedPointId, setSelectedPointId] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [realtimeTest, setRealtimeTest] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  
  // Dragging state
  const isDragging = useRef(false);
  
  const drawTimeline = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Grid
    ctx.strokeStyle = "rgba(255,255,255,0.05)";
    ctx.lineWidth = 1;
    for(let i=0; i<=10; i++) {
      ctx.beginPath();
      ctx.moveTo(0, (canvas.height/10)*i);
      ctx.lineTo(canvas.width, (canvas.height/10)*i);
      ctx.stroke();
    }

    const duration = videoRef.current?.duration ? videoRef.current.duration * 1000 : 10000;
    const maxTime = Math.max(duration, points.length ? Math.max(...points.map(p=>p.time)) + 1000 : 10000);
    
    if (points.length > 0) {
      const sorted = [...points].sort((a,b) => a.time - b.time);
      ctx.strokeStyle = "hsl(186, 100%, 50%)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      
      sorted.forEach((p, i) => {
        const x = (p.time / maxTime) * canvas.width;
        const y = canvas.height - (p.pos / 100) * canvas.height;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
      
      sorted.forEach(p => {
        const x = (p.time / maxTime) * canvas.width;
        const y = canvas.height - (p.pos / 100) * canvas.height;
        ctx.fillStyle = p.id === selectedPointId ? "hsl(186, 100%, 50%)" : "white";
        ctx.beginPath();
        ctx.arc(x, y, p.id === selectedPointId ? 6 : 4, 0, Math.PI*2);
        ctx.fill();
        if (p.id === selectedPointId) {
          ctx.strokeStyle = "white";
          ctx.stroke();
        }
      });
    }

    // Playhead
    if (videoRef.current) {
      const x = (currentTime / maxTime) * canvas.width;
      ctx.strokeStyle = "rgba(255, 255, 255, 0.5)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvas.height);
      ctx.stroke();
    }
  };

  useEffect(() => {
    drawTimeline();
  }, [points, selectedPointId, currentTime]);

  const getPointAtCursor = (x: number, y: number, canvas: HTMLCanvasElement) => {
    const duration = videoRef.current?.duration ? videoRef.current.duration * 1000 : 10000;
    const maxTime = Math.max(duration, points.length ? Math.max(...points.map(p=>p.time)) + 1000 : 10000);
    
    for (let i = points.length - 1; i >= 0; i--) {
      const p = points[i];
      const px = (p.time / maxTime) * canvas.width;
      const py = canvas.height - (p.pos / 100) * canvas.height;
      const dist = Math.hypot(x - px, y - py);
      if (dist < 10) return p;
    }
    return null;
  };

  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    const clickedPoint = getPointAtCursor(x, y, canvas);
    if (clickedPoint) {
      setSelectedPointId(clickedPoint.id);
      isDragging.current = true;
    } else {
      setSelectedPointId(null);
      const duration = videoRef.current?.duration ? videoRef.current.duration * 1000 : 10000;
      const maxTime = Math.max(duration, points.length ? Math.max(...points.map(p=>p.time)) + 1000 : 10000);
      const time = (x / canvas.width) * maxTime;
      const pos = Math.round(100 - (y / canvas.height) * 100);
      
      const newPoint = { id: crypto.randomUUID(), time, pos };
      setPoints([...points, newPoint]);
      setSelectedPointId(newPoint.id);
    }
  };

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDragging.current || !selectedPointId) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    const duration = videoRef.current?.duration ? videoRef.current.duration * 1000 : 10000;
    const maxTime = Math.max(duration, points.length ? Math.max(...points.map(p=>p.time)) + 1000 : 10000);
    
    const newTime = Math.max(0, (x / canvas.width) * maxTime);
    const newPos = Math.max(0, Math.min(100, Math.round(100 - (y / canvas.height) * 100)));
    
    setPoints(pts => pts.map(p => p.id === selectedPointId ? { ...p, time: newTime, pos: newPos } : p));

    if (realtimeTest && connected && key) {
      setHDSP(key, newPos, 87);
    }
  };

  const handleCanvasMouseUp = () => {
    isDragging.current = false;
  };

  const exportScript = () => {
    const sorted = [...points].sort((a,b) => a.time - b.time);
    const script = { actions: sorted.map(p => ({ at: Math.round(p.time), pos: p.pos })) };
    const blob = new Blob([JSON.stringify(script, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "script.funscript";
    a.click();
  };

  const deleteSelected = () => {
    if (selectedPointId) {
      setPoints(points.filter(p => p.id !== selectedPointId));
      setSelectedPointId(null);
    }
  };

  const handleVideoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setVideoUrl(URL.createObjectURL(file));
    }
  };

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    
    const updateTime = () => setCurrentTime(video.currentTime * 1000);
    video.addEventListener("timeupdate", updateTime);
    return () => video.removeEventListener("timeupdate", updateTime);
  }, [videoUrl]);

  return (
    <div className="p-6 h-full flex flex-col max-w-[1600px] mx-auto gap-6">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Scripter</h1>
          <p className="text-muted-foreground">Create and edit Funscripts.</p>
        </div>
        <Button onClick={exportScript} disabled={points.length === 0} data-testid="button-export-script">Export .funscript</Button>
      </div>

      <Tabs defaultValue="timeline" className="flex-1 flex flex-col min-h-0">
        <TabsList className="bg-card/50 w-fit">
          <TabsTrigger value="timeline">Timeline Editor</TabsTrigger>
          <TabsTrigger value="visual">Visual Trigger (Beta)</TabsTrigger>
        </TabsList>
        
        <TabsContent value="timeline" className="flex-1 flex flex-col gap-4 mt-4 min-h-0">
          <div className="flex gap-4 items-center bg-card/50 p-4 rounded-lg border border-border">
            <Button variant="secondary" className="relative cursor-pointer" size="sm">
              <span>Load Reference Video</span>
              <input type="file" accept="video/*" className="absolute inset-0 opacity-0 cursor-pointer" onChange={handleVideoUpload} />
            </Button>
            
            <label className="flex items-center gap-2 text-sm cursor-pointer ml-auto">
              <input 
                type="checkbox" 
                checked={realtimeTest} 
                onChange={(e) => setRealtimeTest(e.target.checked)} 
                className="rounded border-border bg-black"
              />
              Real-time Test (Handy)
            </label>
          </div>

          <Card className="bg-black border-border/50 relative overflow-hidden flex-shrink-0 group">
            <canvas 
              ref={canvasRef} 
              width={1600} 
              height={300} 
              className="w-full h-[300px] cursor-crosshair"
              onMouseDown={handleCanvasMouseDown}
              onMouseMove={handleCanvasMouseMove}
              onMouseUp={handleCanvasMouseUp}
              onMouseLeave={handleCanvasMouseUp}
            />
            {points.length === 0 && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none text-muted-foreground">
                Click anywhere to add control points
              </div>
            )}
            
            {selectedPointId && (
              <div className="absolute top-4 right-4 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <Button variant="destructive" size="icon" onClick={deleteSelected} title="Delete selected point">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            )}
          </Card>
          
          <div className="flex justify-between text-sm text-muted-foreground px-2">
            <span>Points: {points.length}</span>
            <Button variant="ghost" size="sm" onClick={() => setPoints([])} className="text-destructive hover:text-destructive h-8">Clear All</Button>
          </div>

          {videoUrl && (
            <div className="flex-1 min-h-0 bg-black rounded-lg border border-border/50 overflow-hidden mt-4">
               <video 
                  ref={videoRef}
                  src={videoUrl} 
                  className="w-full h-full object-contain"
                  controls
                />
            </div>
          )}
        </TabsContent>
        
        <TabsContent value="visual" className="flex-1 bg-card/30 rounded-lg border border-border p-8 flex flex-col items-center justify-center text-center">
          <div className="max-w-md space-y-4">
            <h3 className="text-xl font-bold">Visual Trigger Generator</h3>
            <p className="text-muted-foreground">
              Automatically generate scripts by analyzing video frame colors. This feature is currently in beta.
            </p>
            <div className="p-4 bg-muted/20 rounded border border-border mt-8 text-left text-sm space-y-2">
              <p><strong>Coming soon:</strong></p>
              <ul className="list-disc pl-5 text-muted-foreground">
                <li>Pin sampling zone on video</li>
                <li>Set target color tolerance</li>
                <li>Auto-generate stroke events</li>
              </ul>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
