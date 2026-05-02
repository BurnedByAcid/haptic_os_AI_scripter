import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useUser } from "@clerk/react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Download, Play, Upload, Plus, X, Clock, User } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { validateVideoUrl, validateAndParseFunscriptFile } from "@/lib/validation";

const API = import.meta.env.VITE_API_URL ?? "";

interface SharedScript {
  id: number;
  title: string;
  description: string;
  video_url: string;
  author_name: string;
  tags: string;
  downloads: number;
  created_at: string;
  script_json?: string;
}

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const d = Math.floor(diff / 86400000);
  if (d > 0) return `${d}d ago`;
  const h = Math.floor(diff / 3600000);
  if (h > 0) return `${h}h ago`;
  return "just now";
}

function VideoIcon({ url }: { url: string }) {
  const h = url.toLowerCase();
  if (h.includes("pornhub")) return <span className="text-[10px] font-bold bg-amber-500 text-black px-1.5 py-0.5 rounded">PH</span>;
  if (h.includes("youtube") || h.includes("youtu.be")) return <span className="text-[10px] font-bold bg-red-600 text-white px-1.5 py-0.5 rounded">YT</span>;
  if (h.includes("xvideos")) return <span className="text-[10px] font-bold bg-red-700 text-white px-1.5 py-0.5 rounded">XV</span>;
  if (h.includes("xhamster")) return <span className="text-[10px] font-bold bg-orange-600 text-white px-1.5 py-0.5 rounded">XH</span>;
  if (h.includes("redtube")) return <span className="text-[10px] font-bold bg-red-500 text-white px-1.5 py-0.5 rounded">RT</span>;
  if (h.includes("vimeo")) return <span className="text-[10px] font-bold bg-violet-600 text-white px-1.5 py-0.5 rounded">VI</span>;
  return <span className="text-[10px] font-bold bg-zinc-600 text-white px-1.5 py-0.5 rounded">VID</span>;
}

export default function Community() {
  const { user, isSignedIn } = useUser();
  const qc = useQueryClient();
  const { toast } = useToast();

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: "", description: "", video_url: "", tags: "" });
  const [scriptFile, setScriptFile] = useState<File | null>(null);
  const [search, setSearch] = useState("");

  const { data: scripts = [], isLoading } = useQuery<SharedScript[]>({
    queryKey: ["community-scripts"],
    queryFn: async () => {
      const res = await fetch(`${API}/api/scripts`);
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
    refetchInterval: 30000,
  });

  const submitMutation = useMutation({
    mutationFn: async () => {
      if (!scriptFile) throw new Error("No script file selected.");

      // URL safety check
      const urlErr = validateVideoUrl(form.video_url.trim());
      if (urlErr) throw new Error(urlErr.message);

      // Funscript validation
      const script = await validateAndParseFunscriptFile(scriptFile);

      const body = {
        ...form,
        script_json: JSON.stringify(script),
        author_id: user?.id ?? null,
        author_name: user?.fullName ?? user?.primaryEmailAddress?.emailAddress ?? "Anonymous",
      };
      const res = await fetch(`${API}/api/scripts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string; details?: string };
        throw new Error(data.details ?? data.error ?? "Failed to submit script.");
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["community-scripts"] });
      setShowForm(false);
      setForm({ title: "", description: "", video_url: "", tags: "" });
      setScriptFile(null);
      toast({ title: "Script shared!", description: "Your script is now live in the community." });
    },
    onError: (err) => toast({
      title: "Could not share script",
      description: err instanceof Error ? err.message : "Unknown error.",
      variant: "destructive",
    }),
  });

  const handleDownload = async (s: SharedScript) => {
    const res = await fetch(`${API}/api/scripts/${s.id}`);
    if (!res.ok) return;
    const data = await res.json();
    const blob = new Blob([data.script_json], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${s.title.replace(/[^a-z0-9]/gi, "_")}.funscript`;
    a.click();
    qc.invalidateQueries({ queryKey: ["community-scripts"] });
  };

  const handleUseInPlayer = async (s: SharedScript) => {
    const res = await fetch(`${API}/api/scripts/${s.id}`);
    if (!res.ok) return;
    const data = await res.json();
    localStorage.setItem("handy_pending_script", data.script_json);
    localStorage.setItem("handy_pending_script_name", s.title);
    localStorage.setItem("handy_pending_video_url", s.video_url);
    window.location.href = `${import.meta.env.BASE_URL}player`;
  };

  const filtered = scripts.filter(s =>
    s.title.toLowerCase().includes(search.toLowerCase()) ||
    s.tags.toLowerCase().includes(search.toLowerCase()) ||
    s.author_name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-6 h-full flex flex-col max-w-[1400px] mx-auto gap-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Community Scripts</h1>
          <p className="text-muted-foreground">Browse and share video + funscript pairs with the community.</p>
        </div>
        <Button
          className="gap-2"
          onClick={() => setShowForm(v => !v)}
          variant={showForm ? "outline" : "default"}
        >
          {showForm ? <><X className="h-4 w-4" /> Cancel</> : <><Plus className="h-4 w-4" /> Share a Script</>}
        </Button>
      </div>

      {showForm && (
        <Card className="border-primary/30 bg-primary/5">
          <CardHeader>
            <CardTitle className="text-lg">Share a Script</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {!isSignedIn && (
              <div className="text-sm text-amber-400 bg-amber-400/10 border border-amber-400/30 rounded-md px-3 py-2">
                You're sharing anonymously. Sign in to attach your name and manage your submissions.
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground font-medium">Title *</label>
                <Input
                  placeholder="Scene title…"
                  value={form.title}
                  onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                  className="bg-background/50"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground font-medium">Video URL *</label>
                <Input
                  placeholder="https://www.pornhub.com/view_video.php?viewkey=…"
                  value={form.video_url}
                  onChange={e => setForm(f => ({ ...f, video_url: e.target.value }))}
                  className="bg-background/50"
                />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground font-medium">Description</label>
              <Input
                placeholder="Optional description…"
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                className="bg-background/50"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground font-medium">Tags (comma-separated)</label>
                <Input
                  placeholder="pov, amateur, scripted…"
                  value={form.tags}
                  onChange={e => setForm(f => ({ ...f, tags: e.target.value }))}
                  className="bg-background/50"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground font-medium">Funscript File *</label>
                <div className="relative">
                  <Button variant="outline" className="w-full relative h-10 text-sm justify-start gap-2">
                    <Upload className="h-4 w-4 text-muted-foreground" />
                    {scriptFile ? <span className="truncate text-foreground">{scriptFile.name}</span> : <span className="text-muted-foreground">Choose .funscript file…</span>}
                    <input
                      type="file"
                      accept=".funscript,.json"
                      className="absolute inset-0 opacity-0 cursor-pointer"
                      onChange={e => setScriptFile(e.target.files?.[0] ?? null)}
                    />
                  </Button>
                </div>
              </div>
            </div>
            <Button
              className="gap-2"
              onClick={() => submitMutation.mutate()}
              disabled={!form.title || !form.video_url || !scriptFile || submitMutation.isPending}
            >
              <Upload className="h-4 w-4" />
              {submitMutation.isPending ? "Sharing…" : "Share Script"}
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="flex gap-3 items-center">
        <Input
          placeholder="Search by title, tag, or author…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="max-w-sm bg-background/50 border-border/50"
        />
        <span className="text-sm text-muted-foreground">{filtered.length} script{filtered.length !== 1 ? "s" : ""}</span>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-48 rounded-xl border border-border/50 bg-card/30 animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center text-muted-foreground gap-3 py-20">
          <Upload className="h-12 w-12 opacity-30" />
          <p className="text-lg font-medium text-foreground">No scripts yet</p>
          <p className="max-w-xs text-sm">Be the first to share a video + funscript pair with the community.</p>
          <Button className="mt-2 gap-2" onClick={() => setShowForm(true)}>
            <Plus className="h-4 w-4" /> Share the First Script
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(s => (
            <Card key={s.id} className="border-border/50 bg-card/50 hover:border-primary/30 transition-colors flex flex-col">
              <CardContent className="pt-5 pb-4 flex flex-col flex-1 gap-3">
                <div className="flex items-start gap-2">
                  <VideoIcon url={s.video_url} />
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-foreground leading-tight truncate" title={s.title}>{s.title}</h3>
                    {s.description && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{s.description}</p>}
                  </div>
                </div>

                {s.tags && (
                  <div className="flex flex-wrap gap-1">
                    {s.tags.split(",").map(t => t.trim()).filter(Boolean).slice(0, 4).map(tag => (
                      <span key={tag} className="text-[10px] bg-primary/10 text-primary border border-primary/20 px-2 py-0.5 rounded-full">
                        {tag}
                      </span>
                    ))}
                  </div>
                )}

                <div className="flex items-center gap-3 text-[11px] text-muted-foreground mt-auto">
                  <span className="flex items-center gap-1"><User className="h-3 w-3" />{s.author_name}</span>
                  <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{timeAgo(s.created_at)}</span>
                  <span className="flex items-center gap-1 ml-auto"><Download className="h-3 w-3" />{s.downloads}</span>
                </div>

                <div className="flex gap-2">
                  <Button size="sm" variant="outline" className="flex-1 text-xs h-8 gap-1.5" onClick={() => handleDownload(s)}>
                    <Download className="h-3.5 w-3.5" /> Download
                  </Button>
                  <Button size="sm" className="flex-1 text-xs h-8 gap-1.5" onClick={() => handleUseInPlayer(s)}>
                    <Play className="h-3.5 w-3.5" /> Use in Player
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
