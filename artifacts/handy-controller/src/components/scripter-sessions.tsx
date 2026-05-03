import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@clerk/react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Crown,
  Loader2,
  Trash2,
  Save,
  Download,
  Copy,
  Pencil,
  Plus,
  FolderOpen,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useBlockedReport } from "@/contexts/blocked-report-context";

const API = import.meta.env.VITE_API_URL ?? "";

export interface SessionSummary {
  id: number;
  name: string;
  created_at: string;
  updated_at: string;
}

interface Props {
  isSubscriber: boolean;
  planLoaded: boolean;
  dirty: boolean;
  buildFunscriptJson: () => string;
  applyFunscriptJson: (json: string, name: string) => void;
  onSaved: () => void;
  suggestedName?: string;
  activeSessionId: number | null;
  onActiveSessionChange: (id: number | null) => void;
}

function formatRelative(dateStr: string): string {
  const now = Date.now();
  const diff = now - new Date(dateStr).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

export function ScripterSessions({
  isSubscriber,
  planLoaded,
  dirty,
  buildFunscriptJson,
  applyFunscriptJson,
  onSaved,
  suggestedName,
  activeSessionId,
  onActiveSessionChange,
}: Props) {
  const { getToken } = useAuth();
  const { toast } = useToast();
  const { reportAction } = useBlockedReport();

  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<number | "new" | null>(null);

  // Create dialog state
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");

  // Rename dialog state
  const [renameTarget, setRenameTarget] = useState<SessionSummary | null>(null);
  const [renameName, setRenameName] = useState("");

  // Dirty-load confirm dialog state
  const [loadTarget, setLoadTarget] = useState<SessionSummary | null>(null);

  const headers = useCallback(async (): Promise<Record<string, string>> => {
    const token = await getToken();
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (token) h["Authorization"] = `Bearer ${token}`;
    return h;
  }, [getToken]);

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/scripter-sessions`, { headers: await headers() });
      if (res.ok) setSessions(await res.json() as SessionSummary[]);
      else if (res.status !== 401 && res.status !== 403) {
        toast({ title: "Couldn't load sessions", variant: "destructive" });
      }
    } catch {
      /* network error — silent on initial load */
    } finally {
      setLoading(false);
    }
  }, [headers, toast]);

  useEffect(() => { loadList(); }, [loadList]);

  // ─── Create new session ───
  const handleCreate = useCallback(async () => {
    const name = createName.trim();
    if (!name) return;
    setBusy("new");
    try {
      const json = buildFunscriptJson();
      const res = await fetch(`${API}/api/scripter-sessions`, {
        method: "POST",
        headers: await headers(),
        body: JSON.stringify({ name, funscript_json: json }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        const msg = data.error ?? `Save failed (${res.status})`;
        toast({
          title: "Couldn't save session",
          description: msg,
          variant: "destructive",
          action: reportAction({ kind: "funscript_file", item: name, blockMessage: msg }),
        });
        return;
      }
      const created = await res.json() as SessionSummary;
      setSessions(prev => [created, ...prev]);
      onActiveSessionChange(created.id);
      onSaved();
      setCreateOpen(false);
      setCreateName("");
      toast({ title: `Session "${created.name}" saved` });
    } catch (err) {
      toast({
        title: "Couldn't save session",
        description: err instanceof Error ? err.message : "Network error",
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  }, [createName, buildFunscriptJson, headers, toast, reportAction, onActiveSessionChange, onSaved]);

  // ─── Save (overwrite) active or specified session ───
  const handleSave = useCallback(async (session: SessionSummary, opts: { silent?: boolean } = {}) => {
    if (!isSubscriber) return;
    setBusy(session.id);
    try {
      const json = buildFunscriptJson();
      const res = await fetch(`${API}/api/scripter-sessions/${session.id}`, {
        method: "PUT",
        headers: await headers(),
        body: JSON.stringify({ name: session.name, funscript_json: json }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        const msg = data.error ?? `Save failed (${res.status})`;
        toast({
          title: "Couldn't save session",
          description: msg,
          variant: "destructive",
          action: reportAction({ kind: "funscript_file", item: session.name, blockMessage: msg }),
        });
        return;
      }
      const updated = await res.json() as SessionSummary;
      setSessions(prev => prev.map(s => s.id === updated.id ? updated : s).sort((a, b) =>
        new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
      ));
      onSaved();
      if (!opts.silent) toast({ title: `Session "${updated.name}" saved` });
    } catch (err) {
      toast({
        title: "Couldn't save session",
        description: err instanceof Error ? err.message : "Network error",
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  }, [isSubscriber, buildFunscriptJson, headers, toast, reportAction, onSaved]);

  // ─── Load a session ───
  const doLoad = useCallback(async (session: SessionSummary) => {
    setBusy(session.id);
    try {
      const res = await fetch(`${API}/api/scripter-sessions/${session.id}`, {
        headers: await headers(),
      });
      if (!res.ok) {
        toast({ title: "Couldn't load session", variant: "destructive" });
        return;
      }
      const d = await res.json() as SessionSummary & { funscript_json: string };
      applyFunscriptJson(d.funscript_json, d.name);
      onActiveSessionChange(session.id);
      toast({ title: `Loaded "${session.name}"` });
    } catch {
      toast({ title: "Network error loading session", variant: "destructive" });
    } finally {
      setBusy(null);
    }
  }, [headers, applyFunscriptJson, onActiveSessionChange, toast]);

  const handleLoad = useCallback((session: SessionSummary) => {
    if (dirty) {
      setLoadTarget(session);
      return;
    }
    doLoad(session);
  }, [dirty, doLoad]);

  // ─── Rename ───
  const handleRenameOpen = useCallback((session: SessionSummary) => {
    setRenameTarget(session);
    setRenameName(session.name);
  }, []);

  const handleRenameConfirm = useCallback(async () => {
    if (!renameTarget) return;
    const name = renameName.trim();
    if (!name) return;
    setBusy(renameTarget.id);
    try {
      const res = await fetch(`${API}/api/scripter-sessions/${renameTarget.id}`, {
        method: "PATCH",
        headers: await headers(),
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        const msg = data.error ?? `Rename failed (${res.status})`;
        toast({
          title: "Couldn't rename session",
          description: msg,
          variant: "destructive",
          action: reportAction({ kind: "funscript_file", item: renameTarget.name, blockMessage: msg }),
        });
        return;
      }
      const updated = await res.json() as SessionSummary;
      setSessions(prev => prev.map(s => s.id === updated.id ? updated : s));
      setRenameTarget(null);
      toast({ title: `Renamed to "${updated.name}"` });
    } catch (err) {
      toast({
        title: "Couldn't rename session",
        description: err instanceof Error ? err.message : "Network error",
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  }, [renameTarget, renameName, headers, toast, reportAction]);

  // ─── Duplicate ───
  const handleDuplicate = useCallback(async (session: SessionSummary) => {
    setBusy(session.id);
    try {
      const res = await fetch(`${API}/api/scripter-sessions/${session.id}/duplicate`, {
        method: "POST",
        headers: await headers(),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        toast({
          title: "Couldn't duplicate session",
          description: data.error ?? `Failed (${res.status})`,
          variant: "destructive",
        });
        return;
      }
      const created = await res.json() as SessionSummary;
      setSessions(prev => [created, ...prev]);
      toast({ title: `Duplicated as "${created.name}"` });
    } catch (err) {
      toast({
        title: "Couldn't duplicate session",
        description: err instanceof Error ? err.message : "Network error",
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  }, [headers, toast]);

  // ─── Delete ───
  const handleDelete = useCallback(async (session: SessionSummary) => {
    if (!window.confirm(`Delete session "${session.name}"? This cannot be undone.`)) return;
    setBusy(session.id);
    try {
      const res = await fetch(`${API}/api/scripter-sessions/${session.id}`, {
        method: "DELETE",
        headers: await headers(),
      });
      if (res.ok) {
        setSessions(prev => prev.filter(s => s.id !== session.id));
        if (activeSessionId === session.id) onActiveSessionChange(null);
      } else {
        toast({ title: "Couldn't delete session", variant: "destructive" });
      }
    } catch {
      toast({ title: "Network error", variant: "destructive" });
    } finally {
      setBusy(null);
    }
  }, [headers, toast, activeSessionId, onActiveSessionChange]);

  if (!planLoaded) return null;

  // Free users — show upsell (no sessions)
  if (!isSubscriber) {
    return (
      <div className="flex items-center gap-2 text-[10px]">
        <Link href="/upgrade">
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-amber-400/10 border border-amber-400/30 text-amber-400 hover:bg-amber-400/20 transition-colors cursor-pointer">
            <Crown className="h-3 w-3" />
            Sessions: subscriber feature
          </span>
        </Link>
      </div>
    );
  }

  const activeSession = sessions.find(s => s.id === activeSessionId) ?? null;

  return (
    <>
      <div className="rounded-lg border border-border/50 bg-card/40 p-2 flex flex-col gap-2">
        {/* Header row */}
        <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <FolderOpen className="h-3 w-3" />
            Sessions ({sessions.length})
          </span>
          <Button
            size="sm"
            variant="outline"
            className="h-6 text-[10px] px-2 gap-1 normal-case font-normal"
            onClick={() => {
              setCreateName(suggestedName ?? "");
              setCreateOpen(true);
            }}
            disabled={busy !== null || loading}
          >
            <Plus className="h-3 w-3" />
            Save as new
          </Button>
        </div>

        {/* Active session bar */}
        {activeSession && (
          <div className="flex items-center gap-2 rounded-md border border-primary/50 bg-primary/10 px-2 py-1.5 text-[11px]">
            <span className="flex-1 truncate font-medium" title={activeSession.name}>
              {activeSession.name}
            </span>
            <span className="text-muted-foreground/60 shrink-0">
              {formatRelative(activeSession.updated_at)}
            </span>
            <Button
              size="sm"
              className="h-6 text-[10px] px-2 gap-1 shrink-0"
              disabled={busy === activeSession.id}
              onClick={() => handleSave(activeSession)}
              title="Save current editor state to this session"
            >
              {busy === activeSession.id
                ? <Loader2 className="h-3 w-3 animate-spin" />
                : <><Save className="h-3 w-3" /> Save</>}
            </Button>
          </div>
        )}

        {/* Session list */}
        {loading ? (
          <div className="flex items-center justify-center py-3 text-muted-foreground/50">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        ) : sessions.length === 0 ? (
          <div className="text-[10px] text-muted-foreground/50 italic text-center py-2">
            No sessions yet — click "Save as new" to create one.
          </div>
        ) : (
          <div className="flex flex-col gap-1 max-h-44 overflow-y-auto pr-0.5">
            {sessions.map(s => {
              const isActive = s.id === activeSessionId;
              const isBusy = busy === s.id;
              return (
                <div
                  key={s.id}
                  className={`flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-[10px] transition-colors ${
                    isActive
                      ? "border-primary/40 bg-primary/5"
                      : "border-border/30 bg-background/40 hover:border-border/60"
                  }`}
                >
                  <span
                    className="flex-1 truncate cursor-pointer hover:text-foreground text-muted-foreground"
                    title={s.name}
                    onClick={() => handleLoad(s)}
                  >
                    {s.name}
                  </span>
                  <span className="text-[9px] text-muted-foreground/50 shrink-0">
                    {formatRelative(s.updated_at)}
                  </span>
                  <div className="flex items-center gap-0.5 shrink-0">
                    <button
                      className="p-0.5 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-30"
                      disabled={isBusy}
                      onClick={() => handleLoad(s)}
                      title="Load this session"
                    >
                      <Download className="h-3 w-3" />
                    </button>
                    <button
                      className="p-0.5 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-30"
                      disabled={isBusy}
                      onClick={() => handleRenameOpen(s)}
                      title="Rename"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                    <button
                      className="p-0.5 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-30"
                      disabled={isBusy}
                      onClick={() => handleDuplicate(s)}
                      title="Duplicate"
                    >
                      <Copy className="h-3 w-3" />
                    </button>
                    <button
                      className="p-0.5 text-muted-foreground hover:text-destructive transition-colors disabled:opacity-30"
                      disabled={isBusy}
                      onClick={() => handleDelete(s)}
                      title="Delete"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Create session dialog */}
      <Dialog open={createOpen} onOpenChange={v => { if (!v) { setCreateOpen(false); setCreateName(""); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Save as new session</DialogTitle>
            <DialogDescription>
              Give this session a name to save the current script.
            </DialogDescription>
          </DialogHeader>
          <Input
            placeholder="e.g. Clip A v1"
            value={createName}
            onChange={e => setCreateName(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") handleCreate(); }}
            autoFocus
            maxLength={120}
          />
          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={() => { setCreateOpen(false); setCreateName(""); }}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={!createName.trim() || busy === "new"}
              onClick={handleCreate}
              className="gap-1.5"
            >
              {busy === "new" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename dialog */}
      <Dialog open={!!renameTarget} onOpenChange={v => { if (!v) setRenameTarget(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Rename session</DialogTitle>
            <DialogDescription>
              Enter a new name for "{renameTarget?.name}".
            </DialogDescription>
          </DialogHeader>
          <Input
            placeholder="New name…"
            value={renameName}
            onChange={e => setRenameName(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") handleRenameConfirm(); }}
            autoFocus
            maxLength={120}
          />
          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={() => setRenameTarget(null)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={!renameName.trim() || busy === renameTarget?.id}
              onClick={handleRenameConfirm}
            >
              Rename
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dirty-load confirm dialog */}
      <Dialog open={!!loadTarget} onOpenChange={v => { if (!v) setLoadTarget(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Load session?</DialogTitle>
            <DialogDescription>
              You have unsaved changes. Loading "{loadTarget?.name}" will discard them.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={() => setLoadTarget(null)}>
              Keep editing
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                const target = loadTarget;
                setLoadTarget(null);
                if (target) doLoad(target);
              }}
            >
              Load anyway
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
