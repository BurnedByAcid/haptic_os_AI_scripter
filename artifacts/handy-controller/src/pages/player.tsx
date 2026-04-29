import { useState, useEffect, useRef } from "react";
import { useHandy } from "@/hooks/use-handy";
import { syncEngine, Funscript } from "@/lib/scriptSync";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Play, Pause, Upload, Maximize } from "lucide-react";

export default function Player() {
  const { key, connected } = useHandy();
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [scripts, setScripts] = useState<(Funscript | null)[]>([null, null, null, null]);
  const [activeScriptIdx, setActiveScriptIdx] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    syncEngine.setKey(key);
  }, [key]);

  useEffect(() => {
    syncEngine.setScript(scripts[activeScriptIdx]);
  }, [scripts, activeScriptIdx]);

  useEffect(() => {
    if (videoRef.current) {
      syncEngine.setVideo(videoRef.current);
    }
  }, [videoUrl]);

  useEffect(() => {
    if (isPlaying) {
      syncEngine.start();
    } else {
      syncEngine.stop();
    }
    return () => syncEngine.stop();
  }, [isPlaying]);

  const handleVideoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const url = URL.createObjectURL(file);
      setVideoUrl(url);
    }
  };

  const handleScriptUpload = async (idx: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      try {
        const text = await file.text();
        const json = JSON.parse(text);
        const newScripts = [...scripts];
        newScripts[idx] = json;
        setScripts(newScripts);
      } catch (err) {
        console.error("Failed to parse script", err);
      }
    }
  };

  const handlePlayPause = () => {
    if (videoRef.current) {
      if (videoRef.current.paused) {
        videoRef.current.play();
        setIsPlaying(true);
      } else {
        videoRef.current.pause();
        setIsPlaying(false);
      }
    }
  };

  return (
    <div className="p-6 h-full flex flex-col max-w-[1600px] mx-auto gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Player</h1>
          <p className="text-muted-foreground">Sync local video with Funscripts.</p>
        </div>
        {!connected && (
          <div className="bg-destructive/10 text-destructive px-4 py-2 rounded-md font-medium text-sm">
            Device Not Connected
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 flex-1 min-h-0">
        <div className="lg:col-span-2 flex flex-col gap-4">
          <Card className="flex-1 bg-black overflow-hidden relative border-border/50">
            {videoUrl ? (
              <div className="w-full h-full relative group">
                <video 
                  ref={videoRef}
                  src={videoUrl} 
                  className="w-full h-full object-contain"
                  onPlay={() => setIsPlaying(true)}
                  onPause={() => setIsPlaying(false)}
                  controls={false}
                />
                
                {/* Custom Controls Overlay */}
                <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/80 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-4">
                  <Button variant="ghost" size="icon" onClick={handlePlayPause} className="text-white hover:bg-white/20">
                    {isPlaying ? <Pause /> : <Play />}
                  </Button>
                  <div className="flex-1 h-2 bg-white/20 rounded-full cursor-pointer relative overflow-hidden" onClick={(e) => {
                    if (videoRef.current) {
                      const rect = e.currentTarget.getBoundingClientRect();
                      const pos = (e.clientX - rect.left) / rect.width;
                      videoRef.current.currentTime = pos * videoRef.current.duration;
                    }
                  }}>
                    <div className="h-full bg-primary" style={{ 
                      width: videoRef.current ? `${(videoRef.current.currentTime / videoRef.current.duration) * 100}%` : '0%' 
                    }} />
                  </div>
                </div>
              </div>
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center text-muted-foreground p-8 text-center border-2 border-dashed border-border/50 rounded-xl m-4 w-[calc(100%-2rem)] h-[calc(100%-2rem)]">
                <Upload className="h-12 w-12 mb-4 opacity-50" />
                <h3 className="text-xl font-medium text-foreground mb-2">Load Video</h3>
                <p className="mb-6 max-w-sm">Select a local video file to begin playback.</p>
                <Button variant="secondary" className="relative cursor-pointer">
                  <span>Browse Files</span>
                  <input type="file" accept="video/*" className="absolute inset-0 opacity-0 cursor-pointer" onChange={handleVideoUpload} />
                </Button>
              </div>
            )}
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <Card className="flex-1 border-primary/20 bg-card/50">
            <CardHeader>
              <CardTitle>Scripts</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {[0, 1, 2, 3].map(idx => (
                <div 
                  key={idx} 
                  className={`p-4 rounded-lg border-2 transition-all cursor-pointer flex flex-col gap-2 ${
                    activeScriptIdx === idx 
                      ? "border-primary bg-primary/10" 
                      : "border-border hover:border-primary/50"
                  }`}
                  onClick={() => setActiveScriptIdx(idx)}
                >
                  <div className="flex justify-between items-center">
                    <span className="font-mono font-bold">SLOT 0{idx + 1}</span>
                    <span className="text-xs text-muted-foreground uppercase tracking-wider">
                      {["Low", "Med", "High", "Max"][idx]} Intensity
                    </span>
                  </div>
                  
                  {scripts[idx] ? (
                    <div className="text-sm text-primary">
                      Loaded ({scripts[idx]?.actions.length} points)
                    </div>
                  ) : (
                    <Button variant="outline" size="sm" className="w-full relative text-xs h-8">
                      <span>Load Script</span>
                      <input 
                        type="file" 
                        accept=".funscript,.json" 
                        className="absolute inset-0 opacity-0 cursor-pointer" 
                        onChange={(e) => handleScriptUpload(idx, e)} 
                      />
                    </Button>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
