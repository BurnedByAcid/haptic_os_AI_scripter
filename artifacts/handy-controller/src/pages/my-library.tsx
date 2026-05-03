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
  RefreshCw, Globe, Crown, Loader2, Check, FileJson, Star, Pencil, Plus, X, Upload,
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
import { validateAndParseFunscriptFile } from "@/lib/validation";
import { useBlockedReport } from "@/contexts/blocked-report-context";

const API = import.meta.env.VITE_API_URL ?? "";

interface LibraryEntry {
  id: number;
  title: string;
  video_url: string | null;
  local_file_path: string | null;
  created_at: string;
}

interface AttachedScript {
  id: number;
  name: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface FunscriptListResponse {
  cap: number;
  plan: string;
  funscripts: AttachedScript[];
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

interface ScriptsDialogProps {
  entry: LibraryEntry | null;
  onClose: () => void;
  authHeaders: () => Promise<Record<string, string>>;
}

function ScriptsManagerDialog({ entry, onClose, authHeaders }: ScriptsDialogProps) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { reportAction, upgradeAndReportAction } = useBlockedReport();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingName, setEditingName] = useState("");
  const [adding, setAdding] = useState(false);
  const [addMode, setAddMode] = useState<"file" | "library">("file");
  const [newName, setNewName] = useState("");
  const [copySourceLibraryId, setCopySourceLibraryId] = useState<string>("");
  const [copySourceScriptId, setCopySourceScriptId] = useState<string>("");

  // For "Copy from another media" mode: list user's other library entries.
  const { data: otherEntries = [] } = useQuery<LibraryEntry[]>({
    queryKey: ["my-library"],
    enabled: !!entry && adding && addMode === "library",
    queryFn: async () => {
      const headers = await authHeaders();
      const res = await fetch(`${API}/api/library`, { headers });
      if (!res.ok) throw new Error("Failed to load library");
      return res.json();
    },
  });

  // Scripts attached to the chosen source media (for copy mode).
  const sourceLibraryIdNum = copySourceLibraryId ? Number(copySourceLibraryId) : null;
  const { data: sourceFunscripts } = useQuery<FunscriptListResponse>({
    queryKey: ["media-funscripts", sourceLibraryIdNum],
    enabled: !!sourceLibraryIdNum,
    queryFn: async () => {
      const headers = await authHeaders();
      const res = await fetch(`${API}/api/library/${sourceLibraryIdNum}/funscripts`, { headers });
      if (!res.ok) throw new Error("Failed to load source scripts");
      return res.json();
    },
  });

  const queryKey = ["media-funscripts", entry?.id];

  const { data, isLoading } = useQuery<FunscriptListResponse>({
    queryKey,
    enabled: !!entry,
    queryFn: async () => {
      if (!entry) throw new Error("no entry");
      const headers = await authHeaders();
      const res = await fetch(`${API}/api/library/${entry.id}/funscripts`, { headers });
      if (!res.ok) throw new Error("Failed to load funscripts");
      return res.json();
    },
  });

  const cap = data?.cap ?? 1;
  const plan = data?.plan ?? "free";
  const scripts = data?.funscripts ?? [];
  const atCap = scripts.length >= cap;
  const isSubscriber = plan !== "free";

  const renameMutation = useMutation({
    mutationFn: async (vars: { id: number; name: string }) => {
      if (!entry) throw new Error("no entry");
      const headers = await authHeaders();
      const res = await fetch(`${API}/api/library/${entry.id}/funscripts/${vars.id}`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ name: vars.name }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(d.error ?? "Rename failed");
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey });
      setEditingId(null);
    },
    onError: (err) => toast({
      title: "Could not rename",
      description: err instanceof Error ? err.message : "Unknown error",
      variant: "destructive",
    }),
  });

  const setActiveMutation = useMutation({
    mutationFn: async (id: number) => {
      if (!entry) throw new Error("no entry");
      const headers = await authHeaders();
      const res = await fetch(`${API}/api/library/${entry.id}/funscripts/${id}`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ set_active: true }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(d.error ?? "Failed to set active");
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey }),
    onError: (err) => toast({
      title: "Could not set active",
      description: err instanceof Error ? err.message : "Unknown error",
      variant: "destructive",
    }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      if (!entry) throw new Error("no entry");
      const headers = await authHeaders();
      const res = await fetch(`${API}/api/library/${entry.id}/funscripts/${id}`, {
        method: "DELETE",
        headers,
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(d.error ?? "Delete failed");
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey }),
    onError: (err) => toast({
      title: "Could not delete",
      description: err instanceof Error ? err.message : "Unknown error",
      variant: "destructive",
    }),
  });

  const addMutation = useMutation({
    mutationFn: async (vars: { name: string; funscriptStr: string; setActive: boolean }) => {
      if (!entry) throw new Error("no entry");
      const headers = await authHeaders();
      const res = await fetch(`${API}/api/library/${entry.id}/funscripts`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          name: vars.name,
          funscript_json: vars.funscriptStr,
          set_active: vars.setActive,
        }),
      });
      const body = await res.json().catch(() => ({})) as { error?: string; code?: string };
      if (!res.ok) {
        const err = new Error(body.error ?? "Add failed");
        (err as Error & { code?: string }).code = body.code;
        throw err;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey });
      setAdding(false);
      setNewName("");
      setCopySourceLibraryId("");
      setCopySourceScriptId("");
    },
    onError: (err) => {
      const e = err as Error & { code?: string };
      const isCap = e.code === "CAP_REACHED";
      // Only show the Upgrade CTA when upgrading would actually raise the
      // cap — i.e. for free-tier users. Subscribers/pro/admin already at
      // 5/5 just get the standard report action.
      const showUpgrade = isCap && !isSubscriber;
      toast({
        title: isCap ? "Script cap reached" : "Could not add script",
        description: e.message,
        variant: "destructive",
        action: showUpgrade
          ? upgradeAndReportAction({
              kind: "library_file",
              item: entry?.title ?? "",
              blockMessage: e.message,
            })
          : reportAction({
              kind: "library_file",
              item: entry?.title ?? "",
              blockMessage: e.message,
            }),
      });
    },
  });

  async function handleCopyFromLibrary() {
    if (!copySourceLibraryId || !copySourceScriptId || !newName.trim()) return;
    try {
      const headers = await authHeaders();
      const res = await fetch(
        `${API}/api/library/${copySourceLibraryId}/funscripts/${copySourceScriptId}`,
        { headers },
      );
      if (!res.ok) throw new Error("Failed to load source script");
      const body = await res.json() as { funscript_json: string };
      addMutation.mutate({
        name: newName.trim(),
        funscriptStr: body.funscript_json,
        setActive: scripts.length === 0,
      });
    } catch (err) {
      toast({
        title: "Could not copy script",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    }
  }

  async function handleAddFile(file: File, name: string) {
    try {
      const parsed = await validateAndParseFunscriptFile(file);
      // Default new script to active if there are no scripts yet, else preserve current active
      const setActive = scripts.length === 0;
      addMutation.mutate({
        name,
        funscriptStr: JSON.stringify(parsed),
        setActive,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not parse funscript.";
      toast({
        title: `Invalid funscript: ${file.name}`,
        description: msg,
        variant: "destructive",
        action: reportAction({
          kind: "library_file",
          item: file.name,
          blockMessage: msg,
        }),
      });
    }
  }

  if (!entry) return null;

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileJson className="h-5 w-5 text-primary" />
            Funscripts for "{entry.title}"
          </DialogTitle>
          <DialogDescription>
            {isSubscriber
              ? `Subscribers can attach up to ${cap} scripts per media item.`
              : `Free tier supports ${cap} script per media. Upgrade for up to 5.`}
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="py-10 flex justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-2">
            {scripts.length === 0 && (
              <div className="text-sm text-muted-foreground italic px-3 py-6 text-center border border-dashed border-border/50 rounded-md">
                No scripts attached yet.
              </div>
            )}
            {scripts.map((s) => (
              <div
                key={s.id}
                className={`flex items-center gap-2 px-3 py-2 rounded-md border ${
                  s.is_active ? "border-primary/40 bg-primary/5" : "border-border/40 bg-card/40"
                }`}
              >
                <button
                  onClick={() => !s.is_active && setActiveMutation.mutate(s.id)}
                  disabled={s.is_active || setActiveMutation.isPending}
                  className={`flex-shrink-0 ${s.is_active ? "text-primary" : "text-muted-foreground hover:text-primary"}`}
                  title={s.is_active ? "Active script" : "Set as active"}
                  data-testid={`button-set-active-${s.id}`}
                >
                  <Star className={`h-4 w-4 ${s.is_active ? "fill-primary" : ""}`} />
                </button>

                {editingId === s.id ? (
                  <div className="flex-1 flex items-center gap-2">
                    <Input
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      className="h-7 text-sm"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && editingName.trim()) {
                          renameMutation.mutate({ id: s.id, name: editingName.trim() });
                        } else if (e.key === "Escape") {
                          setEditingId(null);
                        }
                      }}
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2"
                      disabled={!editingName.trim() || renameMutation.isPending}
                      onClick={() => renameMutation.mutate({ id: s.id, name: editingName.trim() })}
                    >
                      <Check className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2"
                      onClick={() => setEditingId(null)}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ) : (
                  <>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{s.name}</div>
                      <div className="text-[10px] text-muted-foreground">
                        {s.is_active && <span className="text-primary mr-2">Active</span>}
                        {timeAgo(s.updated_at)}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                      onClick={() => { setEditingId(s.id); setEditingName(s.name); }}
                      data-testid={`button-rename-script-${s.id}`}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                      disabled={deleteMutation.isPending || scripts.length <= 1}
                      title={scripts.length <= 1 ? "Can't delete the only script" : "Delete script"}
                      onClick={() => {
                        if (window.confirm(`Delete "${s.name}"?`)) {
                          deleteMutation.mutate(s.id);
                        }
                      }}
                      data-testid={`button-delete-script-${s.id}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </>
                )}
              </div>
            ))}

            {atCap && !adding && (
              <div className="text-xs text-muted-foreground bg-muted/40 border border-border/40 rounded-md px-3 py-2 flex items-center gap-2">
                <Crown className="h-3.5 w-3.5 text-amber-400 flex-shrink-0" />
                {isSubscriber
                  ? `You've reached the ${cap}-script limit for this media (${scripts.length}/${cap}).`
                  : (
                    <span>
                      Free tier limit reached ({scripts.length}/{cap}).{" "}
                      <Link href="/upgrade" className="text-primary hover:underline">
                        Upgrade
                      </Link>{" "}
                      for up to 5 scripts per media.
                    </span>
                  )
                }
              </div>
            )}

            {adding ? (
              <div className="border border-primary/30 bg-primary/5 rounded-md p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Add new script
                  </div>
                  <div className="flex rounded-md border border-border/60 overflow-hidden text-[11px]">
                    <button
                      type="button"
                      className={`px-2 py-1 ${addMode === "file" ? "bg-primary/20 text-primary" : "bg-background/40 text-muted-foreground hover:text-foreground"}`}
                      onClick={() => setAddMode("file")}
                      data-testid="button-add-mode-file"
                    >
                      From file
                    </button>
                    <button
                      type="button"
                      className={`px-2 py-1 border-l border-border/60 ${addMode === "library" ? "bg-primary/20 text-primary" : "bg-background/40 text-muted-foreground hover:text-foreground"}`}
                      onClick={() => setAddMode("library")}
                      data-testid="button-add-mode-library"
                    >
                      From library
                    </button>
                  </div>
                </div>

                <Input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Script name (e.g. Soft, Hardcore, Remix)"
                  autoFocus
                  className="h-8 text-sm"
                  data-testid="input-new-script-name"
                />

                {addMode === "file" ? (
                  <div className="flex gap-2">
                    <Button
                      asChild
                      size="sm"
                      className="flex-1 h-8 text-xs gap-1.5 cursor-pointer"
                      disabled={!newName.trim() || addMutation.isPending}
                    >
                      <label>
                        {addMutation.isPending ? (
                          <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Uploading…</>
                        ) : (
                          <><Upload className="h-3.5 w-3.5" /> Choose .funscript file</>
                        )}
                        <input
                          type="file"
                          accept=".funscript,.json,application/json"
                          className="hidden"
                          disabled={!newName.trim() || addMutation.isPending}
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            e.target.value = "";
                            if (file && newName.trim()) handleAddFile(file, newName.trim());
                          }}
                          data-testid="input-new-script-file"
                        />
                      </label>
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 text-xs"
                      onClick={() => { setAdding(false); setNewName(""); }}
                      disabled={addMutation.isPending}
                    >
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <select
                      value={copySourceLibraryId}
                      onChange={(e) => {
                        setCopySourceLibraryId(e.target.value);
                        setCopySourceScriptId("");
                      }}
                      className="w-full h-8 text-xs rounded-md border border-input bg-background px-2"
                      data-testid="select-copy-source-library"
                    >
                      <option value="">Pick a media item…</option>
                      {otherEntries
                        .filter((e) => e.id !== entry.id)
                        .map((e) => (
                          <option key={e.id} value={e.id}>{e.title}</option>
                        ))}
                    </select>
                    {copySourceLibraryId && (
                      <select
                        value={copySourceScriptId}
                        onChange={(e) => setCopySourceScriptId(e.target.value)}
                        className="w-full h-8 text-xs rounded-md border border-input bg-background px-2"
                        data-testid="select-copy-source-script"
                      >
                        <option value="">Pick a script…</option>
                        {(sourceFunscripts?.funscripts ?? []).map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}{s.is_active ? " (active)" : ""}
                          </option>
                        ))}
                      </select>
                    )}
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        className="flex-1 h-8 text-xs gap-1.5"
                        disabled={
                          !newName.trim() ||
                          !copySourceScriptId ||
                          addMutation.isPending
                        }
                        onClick={handleCopyFromLibrary}
                        data-testid="button-copy-script-from-library"
                      >
                        {addMutation.isPending ? (
                          <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Copying…</>
                        ) : (
                          <><FileJson className="h-3.5 w-3.5" /> Copy script</>
                        )}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 text-xs"
                        onClick={() => { setAdding(false); setNewName(""); }}
                        disabled={addMutation.isPending}
                      >
                        Cancel
                      </Button>
                    </div>
                    {otherEntries.filter((e) => e.id !== entry.id).length === 0 && (
                      <div className="text-[11px] text-muted-foreground italic">
                        No other library entries to copy from.
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <Button
                size="sm"
                variant="outline"
                className="w-full h-8 text-xs gap-1.5"
                onClick={() => setAdding(true)}
                data-testid="button-add-funscript"
              >
                <Plus className="h-3.5 w-3.5" />
                {atCap ? "Try to add (will hit cap)" : "Add another script"}
              </Button>
            )}
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
  const [scriptsEntry, setScriptsEntry] = useState<LibraryEntry | null>(null);

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
          // Handle stale — fall through
        }
      }
    }

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

                <Button
                  size="sm"
                  variant="ghost"
                  className="w-full text-xs h-7 gap-1.5 text-muted-foreground hover:text-primary"
                  onClick={() => setScriptsEntry(entry)}
                  data-testid={`button-manage-scripts-${entry.id}`}
                >
                  <FileJson className="h-3 w-3" /> Manage funscripts
                </Button>

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

      {scriptsEntry && (
        <ScriptsManagerDialog
          entry={scriptsEntry}
          onClose={() => setScriptsEntry(null)}
          authHeaders={authHeaders}
        />
      )}
    </div>
  );
}
