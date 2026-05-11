import { useState, useEffect, useRef } from "react";
import { useFeatureTracking } from "@/hooks/use-analytics";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/react";
import { useSubscription } from "@/hooks/use-subscription";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { TagPicker, ActiveTagChips, CardTagChips } from "@/components/tag-picker";
import { parseTagsFilter, MAX_TAG_FILTERS, type LibraryTag } from "@workspace/validation";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  BookmarkPlus, Download, Play, Trash2, Clock, Link as LinkIcon, HardDrive,
  RefreshCw, Globe, Crown, Loader2, Check, FileJson, Star, Pencil, Plus, X, Upload,
  ChevronDown,
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { useLocation } from "wouter";
import { Link } from "wouter";
import {
  loadFileHandle,
  storeFileHandle,
  deleteFileHandle,
  verifyHandlePermission,
} from "@/lib/file-handle-store";
import { validateAndParseFunscriptFile, validateVideoUrl, sanitizeName, validateVideoFile, PRIVATE_LIBRARY_VIDEO_MAX_BYTES } from "@/lib/validation";
import { useBlockedReport } from "@/contexts/blocked-report-context";
import { useAppSettings } from "@/hooks/use-app-settings";
import { funscriptJsonToCSV, triggerDownload } from "@/lib/script-export";

const API = import.meta.env.VITE_API_URL ?? "";

interface LibraryEntry {
  id: number;
  title: string;
  video_url: string | null;
  local_file_path: string | null;
  created_at: string;
  script_count?: number;
  tags?: string[];
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
  const [tags, setTags] = useState<LibraryTag[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const { toast } = useToast();
  const { reportAction } = useBlockedReport();
  const [, navigate] = useLocation();

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
          tags,
          funscript,
        }),
      });

      if (res.status === 413) {
        const d = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(d.error ?? "Video storage limit reached for this account.");
      }

      if (res.status === 409) {
        const d = await res.json().catch(() => ({})) as { error?: string; existing_title?: string };
        const existingTitle = d.existing_title ?? entry.title;
        toast({
          title: "Already shared",
          description: `"${existingTitle}" is already live in the Community.`,
          action: (
            <ToastAction altText="View in Community" onClick={() => { onClose(); navigate("/community"); }}>
              View in Community
            </ToastAction>
          ),
        });
        return;
      }

      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(d.error ?? "Failed to share");
      }
      setSaved(true);
      toast({ title: "Shared to Community!", description: `"${entry.title}" is now live.` });
      onSuccess();
      setTimeout(() => { setSaved(false); onClose(); setDescription(""); setTags([]); }, 1200);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      toast({
        title: "Could not share",
        description: msg,
        variant: "destructive",
        action: reportAction({
          kind: "community_submission",
          item: entry?.video_url ?? entry?.title ?? "(submission)",
          blockMessage: msg,
        }),
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
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground font-medium">Tags (optional)</label>
              <div className="flex items-center gap-2 flex-wrap">
                <TagPicker
                  mode="edit"
                  selected={tags}
                  onChange={(next) => setTags(next)}
                />
                <ActiveTagChips
                  selected={tags}
                  onRemove={(tag) => setTags((prev) => prev.filter((t) => t !== tag) as LibraryTag[])}
                />
              </div>
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
      qc.invalidateQueries({ queryKey: ["my-library"] });
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

  const replaceMutation = useMutation({
    mutationFn: async (vars: { id: number; funscriptStr: string }) => {
      if (!entry) throw new Error("no entry");
      const headers = await authHeaders();
      const res = await fetch(`${API}/api/library/${entry.id}/funscripts/${vars.id}`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ funscript_json: vars.funscriptStr }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(d.error ?? "Replace failed");
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey }),
    onError: (err) => toast({
      title: "Could not replace script",
      description: err instanceof Error ? err.message : "Unknown error",
      variant: "destructive",
    }),
  });

  async function handleReplaceFile(id: number, file: File) {
    try {
      const parsed = await validateAndParseFunscriptFile(file);
      replaceMutation.mutate({ id, funscriptStr: JSON.stringify(parsed) });
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey });
      qc.invalidateQueries({ queryKey: ["my-library"] });
    },
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
      qc.invalidateQueries({ queryKey: ["my-library"] });
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
                      asChild
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground cursor-pointer"
                      title="Replace file"
                      disabled={replaceMutation.isPending}
                    >
                      <label>
                        {replaceMutation.isPending && replaceMutation.variables?.id === s.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Upload className="h-3.5 w-3.5" />
                        )}
                        <input
                          type="file"
                          accept=".funscript,.json,application/json"
                          className="hidden"
                          disabled={replaceMutation.isPending}
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            e.target.value = "";
                            if (file) handleReplaceFile(s.id, file);
                          }}
                          data-testid={`input-replace-script-${s.id}`}
                        />
                      </label>
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
