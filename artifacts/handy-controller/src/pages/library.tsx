import { useState, useEffect, useRef } from "react";
import { getAllEntries, addEntry, deleteEntry, LibraryEntry } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Film, FileJson, Trash2, Play, Upload } from "lucide-react";
import { useLocation } from "wouter";

export default function Library() {
  const [entries, setEntries] = useState<LibraryEntry[]>([]);
  const [search, setSearch] = useState("");
  const [, setLocation] = useLocation();

  const loadEntries = async () => {
    const data = await getAllEntries();
    setEntries(data.sort((a, b) => b.addedAt - a.addedAt));
  };

  useEffect(() => {
    loadEntries();
  }, []);

  const handleDelete = async (id: string) => {
    await deleteEntry(id);
    loadEntries();
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const isVideo = file.type.startsWith('video/');
      const entry: LibraryEntry = {
        id: crypto.randomUUID(),
        name: file.name,
        type: isVideo ? "video" : "funscript",
        blob: file,
        addedAt: Date.now()
      };
      await addEntry(entry);
    }
    loadEntries();
  };

  const filtered = entries.filter(e => e.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8 h-full flex flex-col">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Library</h1>
          <p className="text-muted-foreground">Manage your local videos and scripts.</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="w-64">
            <Input 
              placeholder="Search library..." 
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="bg-card"
            />
          </div>
          <Button variant="default" className="relative cursor-pointer" data-testid="button-upload-library">
            <Upload className="h-4 w-4 mr-2" /> Upload
            <input 
              type="file" 
              accept="video/*,.funscript,.json" 
              multiple 
              className="absolute inset-0 opacity-0 cursor-pointer" 
              onChange={handleUpload} 
            />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 flex-1 content-start">
        {filtered.map(entry => (
          <Card key={entry.id} className="bg-card/50 backdrop-blur overflow-hidden group">
            <div className="aspect-video bg-black flex items-center justify-center relative border-b border-border/50">
              {entry.type === 'video' ? (
                <Film className="h-12 w-12 text-primary/50 group-hover:text-primary transition-colors" />
              ) : (
                <FileJson className="h-12 w-12 text-primary/50 group-hover:text-primary transition-colors" />
              )}
              <div className="absolute top-2 right-2 bg-background/80 backdrop-blur px-2 py-1 rounded text-xs font-mono">
                {entry.type.toUpperCase()}
              </div>
            </div>
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-base truncate" title={entry.name}>{entry.name}</CardTitle>
            </CardHeader>
            <CardFooter className="p-4 pt-0 gap-2">
              <Button variant="secondary" size="sm" className="flex-1" onClick={() => setLocation("/player")} data-testid={`button-open-${entry.id}`}>
                <Play className="h-4 w-4 mr-2" /> Open
              </Button>
              <Button variant="destructive" size="icon" className="h-9 w-9" onClick={() => handleDelete(entry.id)} data-testid={`button-delete-${entry.id}`}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </CardFooter>
          </Card>
        ))}
        {filtered.length === 0 && (
          <div className="col-span-full py-12 flex flex-col items-center justify-center text-muted-foreground border-2 border-dashed border-border/50 rounded-xl">
            <Library className="h-12 w-12 mb-4 opacity-20" />
            <p>No entries found in library.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function LibraryIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinelinejoin="round" className={className}>
      <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/>
    </svg>
  );
}
