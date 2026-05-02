import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/react";
import { useSubscription } from "@/hooks/use-subscription";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  BookmarkPlus, Download, Play, Trash2, Clock, Link as LinkIcon, HardDrive,
  RefreshCw, Globe, Crown, Loader2, Check,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { Link } from "wouter";
import {
  loadFileHandle,
  storeFileHandle,
  deleteFileHandle,
  verifyHandlePermission,
} from "@/lib/file-handle-store";

const API = import.meta.env.VITE_API_URL ?? "";

interface LibraryEntry {
  id: number;
  title: string;
  video_url: string | null;
  local_file_path: string | null;
  created_at: string;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const d = Math.floor(diff / 86400000);
  if (d > 0) return `${d}d ago`;
  const h = Math.floor(diff / 3600000);
  if (h > 0) return `${h}h ago`;
  const m = Math.floor(diff / 60000);
  if (m > 0) return `${m}m ago`;
  return "just now";
}

interface ShareDialogProps {
  entry: LibraryEntry | null;
  onClose: () => void;
  authHeaders: () => Promise<Record<string, string>>;
  onSuccess: () => void;
}

function ShareToCommunityDialog({ entry, onClose, authHeaders, onSuccess }: ShareDialogProps) {
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const { toast } = useToast();

  if (!entry) return null;

  const hasUrl = Boolean(entry.video_url);

  async function handleShare() {
    if (!entry || !entry.video_url) return;
    setSaving(true);
    try {
      const headers = await authHeaders();
      const funscriptRes = await fetch(`${API}/api/library/${entry.id}/funscript`, { headers });
      if (!funscriptRes.ok) throw new Error("Failed to load funscript");
      const { funscript } = await funscriptRes.json() as { funscript: string };

      const res = await fetch(`${API}/api/community`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          title: entry.title,
          description: description.trim(),
          video_url: entry.video_url,
          funscript,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(d.error ?? "Failed to share");
      }
      setSaved(true);
      toast({ title: "Shared to Community!", description: `"${entry.title}" is now live.` });
      onSuccess();
      setTimeout(() => { setSaved(false); onClose(); setDescription(""); }, 1200);
    } catch (err) {
      toast({
        title: "Could not share",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Share to Community</DialogTitle>
          <DialogDescription>
            Publish "{entry.title}" so others can rate and use it.
          </DialogDescription>
        </DialogHeader>

        {!hasUrl ? (
          <div className="text-sm text-amber-400 bg-amber-400/10 border border-amber-400/30 rounded-md px-3 py-3">
            Community sharing requires an https:// video URL. This script was saved from a local file and cannot be shared publicly.
          </div>
        ) : (
          <div className="space-y-4 pt-1">
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground font-medium">Description (optional)</label>
              <Input
                placeholder="Brief description…"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                autoFocus
              />
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={onClose} disabled={saving}>Cancel</Button>
              <Button size="sm" className="flex-1 gap-2" disabled={saving || saved} onClick={handleShare}>
                {saved ? <><Check className="h-4 w-4" /> Shared!</>
                  : saving ? <><Loader2 className="h-4 w-4 animate-spin" /> Sharing…</>
                  : <><Globe className="h-4 w-4" /> Share to Community</>
                }
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function MyLibrary() {
  const { getToken } = useAuth();
  const { isPro } = useSubscription();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [shareEntry, setShareEntry] = useState<LibraryEntry | null>(null);

  async function authHeaders(): Promise<Record<string, string>> {
    const token = await getToken();
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (token) h["Authorization"] = `Bearer ${token}`;
    return h;
  }

  const { data: entries = [], isLoading } = useQuery<LibraryEntry[]>({
    queryKey: ["my-library"],
    queryFn: async () => {
      const headers = await authHeaders();
      const res = await fetch(`${API}/api/library`, { headers });
      if (!res.ok) throw new Error("Failed to load library");
      return res.json();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const headers = await authHeaders();
      const res = await fetch(`${API}/api/library/${id}`, { method: "DELETE", headers });
      if (!res.ok) throw new Error("Failed to delete");
    },
    onSuccess: (_d, id) => {
      qc.invalidateQueries({ queryKey: ["my-library"] });
      deleteFileHandle(id);
      toast({ title: "Deleted", description: "Entry removed from your library." });
    },
    onError: (err) => toast({
      title: "Delete failed",
      description: err instanceof Error ? err.message : "Unknown error",
      variant: "destructive",
    }),
    onSettled: () => setDeletingId(null),
  });

  async function handleDownload(entry: LibraryEntry) {
    try {
      const headers = await authHeaders();
      const res = await fetch(`${API}/api/library/${entry.id}/funscript`, { headers });
      if (!res.ok) throw new Error("Failed to fetch");
      const { funscript } = await res.json() as { funscript: string };
      const blob = new Blob([funscript], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${entry.title.replace(/[^a-z0-9]/gi, "_")}.funscript`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch {
      toast({ title: "Download failed", variant: "destructive" });
    }
  }

  async function navigateToPlayer(entry: LibraryEntry, videoUrl: string) {
    try {
      const headers = await authHeaders();
      const res = await fetch(`${API}/api/library/${entry.id}/funscript`, { headers });
      if (!res.ok) throw new Error("Failed to fetch funscript");
      const { funscript } = await res.json() as { funscript: string };
      localStorage.setItem("handy_pending_script", funscript);
      localStorage.setItem("handy_pending_script_name", entry.title);
      localStorage.setItem("handy_pending_video_url", videoUrl);
      setLocation("/player");
    } catch {
      toast({ title: "Could not load into player", variant: "destructive" });
    }
  }

  async function handlePlay(entry: LibraryEntry) {
    if (!entry.video_url) {
      toast({
        title: "No video URL",
        description: "This script was saved from a local file. Use \"Re-grant Access\" to load the video.",
        variant: "destructive",
      });
      return;
    }
    await navigateToPlayer(entry, entry.video_url);
  }

  async function handleRegrantAccess(entry: LibraryEntry) {
    // First try to restore from a previously persisted FSA handle
    const stored = await loadFileHandle(entry.id);
    if (stored) {
      const ok = await verifyHandlePermission(stored);
      if (ok) {
        try {
          const file = await stored.getFile();
          const blobUrl = URL.createObjectURL(file);
          await navigateToPlayer(entry, blobUrl);
          return;
        } catch {
          // Handle stale — fall through to manual re-pick
        }
      }
    }

    // Prompt the user to re-select the file
    const fsa = (window as unknown as Record<string, unknown>).showOpenFilePicker;
    if (typeof fsa !== "function") {
      toast({ title: "File System Access not supported in this browser", variant: "destructive" });
      return;
    }
    try {
      const [handle] = await (fsa as (opts: unknown) => Promise<FileSystemFileHandle[]>)({
        types: [{ description: "Video", accept: { "video/*": [".mp4", ".webm", ".mov", ".ogg", ".mkv"] } }],
        id: "library-video-regrant",
      });
      // Persist for next time
      await storeFileHandle(entry.id, handle);
      const file = await handle.getFile();
      const blobUrl = URL.createObjectURL(file);
      await navigateToPlayer(entry, blobUrl);
    } catch (err) {
      if ((err as { name?: string }).name !== "AbortError") {
        toast({ title: "Could not re-grant access", variant: "destructive" });
      }
    }
  }

  return (
    <div className="p-6 h-full flex flex-col max-w-[1200px] mx-auto gap-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">My Library</h1>
          <p className="text-muted-foreground">Your privately saved funscripts.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => qc.invalidateQueries({ queryKey: ["my-library"] })}>
          <RefreshCw className="h-4 w-4 mr-2" /> Refresh
        </Button>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-40 rounded-xl border border-border/50 bg-card/30 animate-pulse" />
          ))}
        </div>
      ) : entries.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center text-muted-foreground gap-3 py-20">
          <BookmarkPlus className="h-12 w-12 opacity-30" />
          <p className="text-lg font-medium text-foreground">No saved scripts yet</p>
          <p className="max-w-xs text-sm">
            After creating a script in the Scripter, use "Save to My Library" to store it here.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {entries.map((entry) => (
            <Card key={entry.id} className="border-border/50 bg-card/50 hover:border-primary/30 transition-colors flex flex-col">
              <CardContent className="pt-5 pb-4 flex flex-col flex-1 gap-3">
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-foreground leading-tight truncate" title={entry.title}>
                      {entry.title}
                    </h3>
                    <div className="flex items-center gap-1.5 mt-1">
                      {entry.video_url ? (
                        <span className="flex items-center gap-1 text-[11px] text-muted-foreground truncate max-w-[200px]">
                          <LinkIcon className="h-3 w-3 shrink-0" />
                          <a
                            href={entry.video_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="hover:text-primary truncate"
                            title={entry.video_url}
                          >
                            {entry.video_url.replace(/^https?:\/\/(www\.)?/, "").slice(0, 40)}
                          </a>
                        </span>
                      ) : entry.local_file_path ? (
                        <span className="flex items-center gap-1 text-[11px] text-muted-foreground truncate">
                          <HardDrive className="h-3 w-3 shrink-0" />
                          <span className="truncate max-w-[200px]" title={entry.local_file_path}>
                            {entry.local_file_path}
                          </span>
                        </span>
                      ) : (
                        <span className="text-[11px] text-muted-foreground italic">No video source</span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1 text-[11px] text-muted-foreground mt-auto">
                  <Clock className="h-3 w-3" />
                  {timeAgo(entry.created_at)}
                </div>

                <div className="flex gap-2 flex-wrap">
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1 text-xs h-8 gap-1.5"
                    onClick={() => handleDownload(entry)}
                  >
                    <Download className="h-3.5 w-3.5" /> Download
                  </Button>

                  {entry.video_url ? (
                    <Button
                      size="sm"
                      className="flex-1 text-xs h-8 gap-1.5"
                      onClick={() => handlePlay(entry)}
                    >
                      <Play className="h-3.5 w-3.5" /> Play
                    </Button>
                  ) : entry.local_file_path ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      className="flex-1 text-xs h-8 gap-1.5"
                      onClick={() => handleRegrantAccess(entry)}
                    >
                      <RefreshCw className="h-3.5 w-3.5" /> Re-grant Access
                    </Button>
                  ) : null}
                </div>

                <div className="flex gap-2">
                  {isPro && entry.video_url ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="flex-1 text-xs h-7 gap-1.5 text-muted-foreground hover:text-primary"
                      onClick={() => setShareEntry(entry)}
                    >
                      <Globe className="h-3 w-3" /> Share to Community
                    </Button>
                  ) : !isPro && entry.video_url ? (
                    <Link href="/upgrade" className="flex-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="w-full text-xs h-7 gap-1.5 text-muted-foreground/50"
                      >
                        <Crown className="h-3 w-3 text-amber-400" /> Share (Pro)
                      </Button>
                    </Link>
                  ) : null}

                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-xs h-7 text-destructive hover:text-destructive hover:bg-destructive/10"
                    disabled={deletingId === entry.id}
                    onClick={() => {
                      if (window.confirm(`Delete "${entry.title}"?`)) {
                        setDeletingId(entry.id);
                        deleteMutation.mutate(entry.id);
                      }
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {shareEntry && (
        <ShareToCommunityDialog
          entry={shareEntry}
          onClose={() => setShareEntry(null)}
          authHeaders={authHeaders}
          onSuccess={() => qc.invalidateQueries({ queryKey: ["community-scripts"] })}
        />
      )}
    </div>
  );
}
