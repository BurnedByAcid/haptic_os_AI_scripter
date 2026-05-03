import { useEffect, useState, useCallback, useRef } from "react";
import { useAuth } from "@clerk/react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Crown, Loader2, Trash2, Save, Download } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useBlockedReport } from "@/contexts/blocked-report-context";

const API = import.meta.env.VITE_API_URL ?? "";
const SLOT_LABELS = ["A", "B", "C"] as const;
const TTL_DAYS = 10;

export interface DraftSummary {
  id: number;
  slot: number;
  name: string;
  updated_at: string;
  expires_at: string;
}

interface Props {
  /** True when the current user is on a paid tier (subscriber/pro/admin). */
  isSubscriber: boolean;
  /** True while subscription state is still resolving. */
  planLoaded: boolean;
  /** Current funscript JSON to be saved. Caller is responsible for shape. */
  buildFunscriptJson: () => string;
  /** Apply a loaded funscript JSON to the editor. */
  applyFunscriptJson: (json: string, draftName: string) => void;
  /** Mark the current editor state as clean (e.g. after a successful save). */
  onSaved: () => void;
  /** Optional: a default name to suggest when saving a new slot. */
  suggestedName?: string;
  /**
   * If true, autosave is enabled. Caller passes a `dirty` flag and the
   * component debounces a PUT to the active slot.
   */
  autosaveDirty: boolean;
  /** Slot id (1-3) currently bound to the editor for autosave. May be null. */
  activeSlot: number | null;
  /** Notify caller when active slot changes (e.g. user picks a slot). */
  onActiveSlotChange: (slot: number | null) => void;
}

function formatRelative(date: Date): string {
  const now = Date.now();
  const diff = date.getTime() - now;
  const abs = Math.abs(diff);
  const mins = Math.round(abs / 60000);
  if (mins < 1) return diff >= 0 ? "in <1m" : "just now";
  if (mins < 60) return diff >= 0 ? `in ${mins}m` : `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return diff >= 0 ? `in ${hrs}h` : `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return diff >= 0 ? `in ${days}d` : `${days}d ago`;
}

export function ScripterDrafts({
  isSubscriber,
  planLoaded,
  buildFunscriptJson,
  applyFunscriptJson,
  onSaved,
  suggestedName,
  autosaveDirty,
  activeSlot,
  onActiveSlotChange,
}: Props) {
  const { getToken } = useAuth();
  const { toast } = useToast();
  const { reportAction } = useBlockedReport();
  const [drafts, setDrafts] = useState<DraftSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<number | null>(null);
  const [savedAt, setSavedAt] = useState<number>(0);

  const headers = useCallback(async (): Promise<Record<string, string>> => {
    const token = await getToken();
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (token) h["Authorization"] = `Bearer ${token}`;
    return h;
  }, [getToken]);

  // Initial load — both free and subscriber users see existing drafts so
  // downgraded subscribers can still recover their data within the 10-day TTL.
  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/scripter-drafts`, { headers: await headers() });
      if (res.ok) setDrafts(await res.json() as DraftSummary[]);
      else if (res.status !== 401) {
        toast({ title: "Couldn't load drafts", variant: "destructive" });
      }
    } catch {
      /* network error — silent on initial load */
    } finally {
      setLoading(false);
    }
  }, [headers, toast]);

  useEffect(() => { loadList(); }, [loadList]);

  /** PUT to a slot (subscriber only). Used by both manual save and autosave. */
  const saveToSlot = useCallback(async (slot: number, opts: { silent?: boolean } = {}) => {
    if (!isSubscriber) return;
    setBusy(slot);
    try {
      const json = buildFunscriptJson();
      const existing = drafts.find(d => d.slot === slot);
      const name = (existing?.name ?? suggestedName ?? `Draft ${SLOT_LABELS[slot - 1]}`).slice(0, 120);
      const res = await fetch(`${API}/api/scripter-drafts/${slot}`, {
        method: "PUT",
        headers: await headers(),
        body: JSON.stringify({ name, funscript_json: json }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        const msg = data.error ?? `Save failed (${res.status})`;
        // Failures must always surface — including from silent autosave —
        // so the user knows their work isn't being persisted and can act on
        // validation/quota errors via the standard report flow.
        toast({
          title: "Couldn't save draft",
          description: msg,
          variant: "destructive",
          action: reportAction({
            kind: "funscript_file",
            item: name,
            blockMessage: msg,
          }),
        });
        return;
      }
      const saved = await res.json() as DraftSummary;
      setDrafts(prev => {
        const without = prev.filter(d => d.slot !== slot);
        return [...without, saved].sort((a, b) => a.slot - b.slot);
      });
      setSavedAt(Date.now());
      onActiveSlotChange(slot);
      onSaved();
      if (!opts.silent) {
        toast({ title: `Saved to slot ${SLOT_LABELS[slot - 1]}` });
      }
    } catch (err) {
      // Network errors must surface for autosave too — silently dropping
      // them would leave the user thinking their work is being saved.
      toast({
        title: "Couldn't save draft",
        description: err instanceof Error ? err.message : "Network error",
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  }, [isSubscriber, buildFunscriptJson, drafts, suggestedName, headers, toast, reportAction, onSaved, onActiveSlotChange]);

  // ─── Debounced autosave (5s) ───
  // If no slot is bound yet we auto-bind to the first empty slot so that
  // brand-new sessions still get the "automatic save" behaviour subscribers
  // pay for. If all 3 slots are full we fall back to slot 1 so the most
  // recent session is the one that gets refreshed.
  const dirtyRef = useRef(autosaveDirty);
  useEffect(() => { dirtyRef.current = autosaveDirty; }, [autosaveDirty]);
  useEffect(() => {
    if (!isSubscriber || !autosaveDirty || loading) return;
    let target = activeSlot;
    if (target === null) {
      const taken = new Set(drafts.map(d => d.slot));
      target = [1, 2, 3].find(s => !taken.has(s)) ?? 1;
    }
    const slotToSave = target;
    const handle = setTimeout(() => {
      if (dirtyRef.current) saveToSlot(slotToSave, { silent: true });
    }, 5000);
    return () => clearTimeout(handle);
  }, [isSubscriber, autosaveDirty, activeSlot, drafts, loading, saveToSlot]);

  const loadSlot = useCallback(async (slot: number) => {
    setBusy(slot);
    try {
      const res = await fetch(`${API}/api/scripter-drafts/${slot}`, { headers: await headers() });
      if (!res.ok) {
        toast({ title: "Couldn't load draft", variant: "destructive" });
        return;
      }
      const d = await res.json() as DraftSummary & { funscript_json: string };
      // applyFunscriptJson is responsible for both committing the imported
      // points AND snapshotting them as the new clean baseline (it has the
      // freshly-parsed array in scope; calling onSaved() here would race
      // against React's async setState and re-snapshot stale points).
      applyFunscriptJson(d.funscript_json, d.name);
      onActiveSlotChange(slot);
      toast({ title: `Loaded draft ${SLOT_LABELS[slot - 1]}` });
    } catch {
      toast({ title: "Network error loading draft", variant: "destructive" });
    } finally {
      setBusy(null);
    }
  }, [headers, applyFunscriptJson, onActiveSlotChange, toast]);

  const deleteSlot = useCallback(async (slot: number) => {
    if (!window.confirm(`Delete draft slot ${SLOT_LABELS[slot - 1]}? This cannot be undone.`)) return;
    setBusy(slot);
    try {
      const res = await fetch(`${API}/api/scripter-drafts/${slot}`, {
        method: "DELETE",
        headers: await headers(),
      });
      if (res.ok) {
        setDrafts(prev => prev.filter(d => d.slot !== slot));
        if (activeSlot === slot) onActiveSlotChange(null);
      } else {
        toast({ title: "Couldn't delete draft", variant: "destructive" });
      }
    } catch {
      toast({ title: "Network error", variant: "destructive" });
    } finally {
      setBusy(null);
    }
  }, [headers, toast, activeSlot, onActiveSlotChange]);

  if (!planLoaded) return null;

  // Free / downgraded users: if they have no drafts on file, show only the
  // upsell badge. If they DO have drafts (i.e. they were a subscriber and
  // got downgraded), show a read-only panel so they can recover their work
  // any time during the 10-day TTL — Save / Delete are disabled, Load
  // remains available, and the upsell ribbon explains the constraint.
  if (!isSubscriber) {
    if (drafts.length === 0) {
      return (
        <div className="flex items-center gap-2 text-[10px]">
          <Link href="/upgrade">
            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-amber-400/10 border border-amber-400/30 text-amber-400 hover:bg-amber-400/20 transition-colors cursor-pointer">
              <Crown className="h-3 w-3" />
              Drafts: subscriber feature
            </span>
          </Link>
        </div>
      );
    }
    return (
      <div className="rounded-lg border border-amber-400/30 bg-amber-400/5 p-2 flex flex-col gap-1.5">
        <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider">
          <span className="text-muted-foreground">Drafts (read-only · {drafts.length}/3)</span>
          <Link href="/upgrade">
            <span className="inline-flex items-center gap-1 text-amber-400 hover:underline normal-case">
              <Crown className="h-3 w-3" /> Resubscribe to edit
            </span>
          </Link>
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          {drafts.map(d => {
            const slotBusy = busy === d.slot;
            return (
              <div
                key={d.slot}
                className="rounded-md border border-amber-400/30 bg-background/60 p-2 flex flex-col gap-1 text-[10px]"
              >
                <div className="font-bold text-xs">{SLOT_LABELS[d.slot - 1]}</div>
                <div className="truncate text-muted-foreground" title={d.name}>{d.name}</div>
                <div className="text-[9px] text-muted-foreground/70">
                  Edited {formatRelative(new Date(d.updated_at))}
                </div>
                <div className="text-[9px] text-amber-400/80">
                  Expires {formatRelative(new Date(d.expires_at))}
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 text-[10px] mt-1"
                  disabled={slotBusy}
                  onClick={() => loadSlot(d.slot)}
                  data-testid={`button-load-draft-${d.slot}`}
                >
                  <Download className="h-3 w-3 mr-1" />Load
                </Button>
              </div>
            );
          })}
        </div>
        <div className="text-[9px] text-amber-400/80">
          Drafts auto-deleted after expiry. Resubscribe to edit, save, or remove.
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border/50 bg-card/40 p-2 flex flex-col gap-1.5">
      <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        <span>Drafts ({drafts.length}/3)</span>
        {savedAt > 0 && (
          <span className="text-emerald-400 normal-case font-normal">
            Auto-saved {formatRelative(new Date(savedAt))}
          </span>
        )}
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        {[1, 2, 3].map(slot => {
          const d = drafts.find(x => x.slot === slot);
          const isActive = activeSlot === slot;
          const slotBusy = busy === slot;
          return (
            <div
              key={slot}
              className={`rounded-md border p-2 flex flex-col gap-1 text-[10px] transition-colors ${
                isActive ? "border-primary/60 bg-primary/10" : "border-border/40 bg-background/60"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-bold text-xs">{SLOT_LABELS[slot - 1]}</span>
                {d && (
                  <button
                    className="text-muted-foreground hover:text-destructive transition-colors disabled:opacity-30"
                    disabled={slotBusy}
                    onClick={() => deleteSlot(slot)}
                    title="Delete this draft"
                    data-testid={`button-delete-draft-${slot}`}
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                )}
              </div>
              {d ? (
                <>
                  <div className="truncate text-muted-foreground" title={d.name}>{d.name}</div>
                  <div className="text-[9px] text-muted-foreground/70">
                    Edited {formatRelative(new Date(d.updated_at))}
                  </div>
                  <div className="text-[9px] text-amber-400/80">
                    Expires {formatRelative(new Date(d.expires_at))}
                  </div>
                  <div className="flex gap-1 mt-1">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 text-[10px] flex-1 px-1"
                      disabled={slotBusy}
                      onClick={() => loadSlot(slot)}
                      data-testid={`button-load-draft-${slot}`}
                    >
                      <Download className="h-3 w-3 mr-1" />Load
                    </Button>
                    <Button
                      size="sm"
                      className="h-6 text-[10px] flex-1 px-1"
                      disabled={slotBusy}
                      onClick={() => saveToSlot(slot)}
                      data-testid={`button-save-draft-${slot}`}
                    >
                      {slotBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <><Save className="h-3 w-3 mr-1" />Save</>}
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <div className="text-muted-foreground/50 italic">empty</div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 text-[10px] mt-auto"
                    disabled={slotBusy || loading}
                    onClick={() => saveToSlot(slot)}
                    data-testid={`button-save-draft-${slot}`}
                  >
                    {slotBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <><Save className="h-3 w-3 mr-1" />Save here</>}
                  </Button>
                </>
              )}
            </div>
          );
        })}
      </div>
      <div className="text-[9px] text-muted-foreground/60">
        Drafts auto-save 5s after edits and expire {TTL_DAYS} days from last edit.
      </div>
    </div>
  );
}

/** Picker shown on Scripter page load when the user has saved drafts. */
export function ResumeDraftPicker({
  drafts,
  onResume,
  onSkip,
}: {
  drafts: DraftSummary[];
  onResume: (slot: number) => void;
  onSkip: () => void;
}) {
  if (drafts.length === 0) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onSkip} />
      <div className="relative bg-card border border-border rounded-xl shadow-2xl w-[440px] max-w-full p-5">
        <h3 className="font-semibold mb-1">Resume a draft?</h3>
        <p className="text-xs text-muted-foreground mb-4">
          You have {drafts.length} saved draft{drafts.length === 1 ? "" : "s"}. Pick one to continue, or start fresh.
        </p>
        <div className="space-y-2">
          {drafts.map(d => (
            <button
              key={d.slot}
              className="w-full text-left rounded-md border border-border/60 hover:border-primary/60 hover:bg-primary/5 px-3 py-2 transition-colors"
              onClick={() => onResume(d.slot)}
              data-testid={`button-resume-draft-${d.slot}`}
            >
              <div className="flex items-center justify-between">
                <span className="font-medium text-sm">
                  Slot {SLOT_LABELS[d.slot - 1]} · {d.name}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  Edited {formatRelative(new Date(d.updated_at))}
                </span>
              </div>
              <div className="text-[10px] text-amber-400/80 mt-0.5">
                Expires {formatRelative(new Date(d.expires_at))}
              </div>
            </button>
          ))}
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="ghost" size="sm" onClick={onSkip} data-testid="button-skip-resume">
            Start fresh
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Reusable confirm dialog used by the exit warning. */
export function ExitWarningDialog({
  open,
  isFree,
  onStay,
  onLeave,
}: {
  open: boolean;
  isFree: boolean;
  onStay: () => void;
  onLeave: () => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onStay} />
      <div className="relative bg-card border border-border rounded-xl shadow-2xl w-[440px] max-w-full p-5">
        <h3 className="font-semibold text-base">Leave Scripter?</h3>
        <p className="text-sm text-muted-foreground mt-2">
          You have unexported changes. They will be lost.
        </p>
        {isFree && (
          <p className="text-xs text-amber-400 bg-amber-400/10 border border-amber-400/30 rounded-md px-3 py-2 mt-3">
            <Crown className="inline h-3 w-3 mr-1" />
            Subscribers can auto-save up to 3 drafts for {TTL_DAYS} days.{" "}
            <Link href="/upgrade" className="underline font-medium">Upgrade</Link>
          </p>
        )}
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="outline" size="sm" onClick={onStay} data-testid="button-exit-stay">
            Stay
          </Button>
          <Button variant="destructive" size="sm" onClick={onLeave} data-testid="button-exit-leave">
            Leave anyway
          </Button>
        </div>
      </div>
    </div>
  );
}
