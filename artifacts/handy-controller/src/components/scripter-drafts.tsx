import { useEffect, useState } from "react";
import { useAuth } from "@clerk/react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Crown, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const API = import.meta.env.VITE_API_URL ?? "";
const TTL_DAYS = 10;

export interface DraftSummary {
  id: number;
  slot: number;
  name: string;
  updated_at: string;
  expires_at: string;
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

function formatExpiry(dateStr: string): string {
  const now = Date.now();
  const diff = new Date(dateStr).getTime() - now;
  const days = Math.round(diff / 86400000);
  if (days < 0) return "expired";
  if (days === 0) return "expires today";
  if (days === 1) return "expires tomorrow";
  return `expires in ${days}d`;
}

type ExitPhase = "prompt" | "saving" | "conflict" | "conflict-saving";

/**
 * Exit-warning dialog shown when the user navigates away with unsaved changes.
 *
 * Subscriber flow:
 *   - "Continue Now"   → stay on the page
 *   - "Continue Later" → save draft to slot 1, then leave
 *                        if slot 1 is taken → conflict picker (keep older / keep current)
 *   - "Discard"        → leave without saving
 *
 * Free-user flow:
 *   - Upgrade upsell + "Stay" / "Leave anyway"
 */
export function ExitWarningDialog({
  open,
  isFree,
  buildFunscriptJson,
  draftName,
  onStay,
  onLeave,
}: {
  open: boolean;
  isFree: boolean;
  buildFunscriptJson: () => string;
  draftName?: string;
  onStay: () => void;
  onLeave: () => void;
}) {
  const { getToken } = useAuth();
  const { toast } = useToast();
  const [phase, setPhase] = useState<ExitPhase>("prompt");
  const [existingDraft, setExistingDraft] = useState<DraftSummary | null>(null);

  useEffect(() => {
    if (open) setPhase("prompt");
  }, [open]);

  async function authHeaders(): Promise<Record<string, string>> {
    const token = await getToken();
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (token) h["Authorization"] = `Bearer ${token}`;
    return h;
  }

  async function saveToSlot1(): Promise<void> {
    const h = await authHeaders();
    const json = buildFunscriptJson();
    const name = (draftName ?? "Unfinished script").slice(0, 120);
    const res = await fetch(`${API}/api/scripter-drafts/1`, {
      method: "PUT",
      headers: h,
      body: JSON.stringify({ name, funscript_json: json }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({})) as { error?: string };
      throw new Error(data.error ?? "Save failed");
    }
  }

  async function handleContinueLater() {
    setPhase("saving");
    try {
      const h = await authHeaders();
      const listRes = await fetch(`${API}/api/scripter-drafts`, { headers: h });
      if (listRes.ok) {
        const drafts = (await listRes.json()) as DraftSummary[];
        const slot1 = drafts.find((d) => d.slot === 1);
        if (slot1) {
          setExistingDraft(slot1);
          setPhase("conflict");
          return;
        }
      }
      await saveToSlot1();
      onLeave();
    } catch (err) {
      toast({
        title: "Couldn't save draft",
        description: err instanceof Error ? err.message : "Network error",
        variant: "destructive",
      });
      setPhase("prompt");
    }
  }

  async function handleKeepCurrent() {
    setPhase("conflict-saving");
    try {
      await saveToSlot1();
      onLeave();
    } catch (err) {
      toast({
        title: "Couldn't save draft",
        description: err instanceof Error ? err.message : "Network error",
        variant: "destructive",
      });
      setPhase("conflict");
    }
  }

  if (!open) return null;

  const backdrop = (
    <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onStay} />
  );

  if (isFree) {
    return (
      <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
        {backdrop}
        <div className="relative bg-card border border-border rounded-xl shadow-2xl w-[440px] max-w-full p-6 space-y-4">
          <h3 className="font-semibold text-base">Leave Scripter?</h3>
          <p className="text-sm text-muted-foreground">
            You have an unfinished script. It will be lost if you leave.
          </p>
          <div className="flex items-start gap-2 text-xs text-amber-400 bg-amber-400/10 border border-amber-400/30 rounded-md px-3 py-2.5">
            <Crown className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>
              Subscribers can save a draft for up to {TTL_DAYS} days and resume later.{" "}
              <Link href="/upgrade" className="underline font-medium">
                Upgrade
              </Link>
            </span>
          </div>
          <div className="flex justify-end gap-2 pt-1">
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

  if (phase === "saving" || phase === "conflict-saving") {
    return (
      <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
        <div className="relative bg-card border border-border rounded-xl shadow-2xl w-[440px] max-w-full p-8 flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Saving draft…</p>
        </div>
      </div>
    );
  }

  if (phase === "conflict" && existingDraft) {
    return (
      <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
        {backdrop}
        <div className="relative bg-card border border-border rounded-xl shadow-2xl w-[440px] max-w-full p-6 space-y-4">
          <h3 className="font-semibold text-base">Replace existing draft?</h3>
          <p className="text-sm text-muted-foreground">
            You already have a saved draft{" "}
            <span className="font-medium text-foreground">"{existingDraft.name}"</span>{" "}
            from {formatRelative(existingDraft.updated_at)}.
          </p>
          <div className="flex flex-col gap-2">
            <button
              className="w-full text-left rounded-lg border border-border/60 hover:border-border bg-card/40 hover:bg-card/60 px-4 py-3 transition-colors"
              onClick={onLeave}
              data-testid="button-keep-older"
            >
              <div className="font-medium text-sm">Keep older draft</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                Leave without overwriting — your saved draft stays intact.
              </div>
            </button>
            <button
              className="w-full text-left rounded-lg border border-primary/40 hover:border-primary/60 bg-primary/5 hover:bg-primary/10 px-4 py-3 transition-colors"
              onClick={handleKeepCurrent}
              data-testid="button-keep-current"
            >
              <div className="font-medium text-sm text-primary">Keep current script</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                Overwrite the old draft with what you're working on now.
              </div>
            </button>
          </div>
          <div className="flex justify-end">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { setPhase("prompt"); onStay(); }}
              data-testid="button-conflict-cancel"
            >
              Cancel — stay in Scripter
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      {backdrop}
      <div className="relative bg-card border border-border rounded-xl shadow-2xl w-[440px] max-w-full p-6 space-y-4">
        <h3 className="font-semibold text-base">You have an unfinished script</h3>
        <p className="text-sm text-muted-foreground">
          What would you like to do before leaving?
        </p>
        <div className="flex flex-col gap-2">
          <button
            className="w-full text-left rounded-lg border border-primary/50 bg-primary/10 hover:bg-primary/15 px-4 py-3 transition-colors"
            onClick={onStay}
            data-testid="button-exit-stay"
          >
            <div className="font-medium text-sm text-primary">Continue now</div>
            <div className="text-xs text-muted-foreground mt-0.5">Stay and keep working on this script.</div>
          </button>
          <button
            className="w-full text-left rounded-lg border border-border/60 hover:border-border bg-card/40 hover:bg-card/60 px-4 py-3 transition-colors"
            onClick={handleContinueLater}
            data-testid="button-continue-later"
          >
            <div className="font-medium text-sm">Continue later</div>
            <div className="text-xs text-muted-foreground mt-0.5">
              Save as a draft and come back within {TTL_DAYS} days.
            </div>
          </button>
          <button
            className="w-full text-left rounded-lg border border-transparent hover:border-destructive/30 hover:bg-destructive/5 px-4 py-3 transition-colors"
            onClick={onLeave}
            data-testid="button-exit-leave"
          >
            <div className="font-medium text-sm text-destructive">Discard script</div>
            <div className="text-xs text-muted-foreground mt-0.5">Leave without saving. This cannot be undone.</div>
          </button>
        </div>
      </div>
    </div>
  );
}

/** Shown on Scripter page load when the user has a saved draft. */
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
  const d = drafts[0];
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onSkip} />
      <div className="relative bg-card border border-border rounded-xl shadow-2xl w-[440px] max-w-full p-6 space-y-4">
        <h3 className="font-semibold">Resume your draft?</h3>
        <p className="text-sm text-muted-foreground">
          You have an unfinished script saved. Would you like to continue where you left off?
        </p>
        <button
          className="w-full text-left rounded-lg border border-border/60 hover:border-primary/60 hover:bg-primary/5 px-4 py-3 transition-colors"
          onClick={() => onResume(d.slot)}
          data-testid={`button-resume-draft-${d.slot}`}
        >
          <div className="font-medium text-sm">{d.name}</div>
          <div className="text-xs text-muted-foreground mt-0.5">
            Last edited {formatRelative(d.updated_at)}
          </div>
          <div className="text-xs text-amber-400/80 mt-0.5">
            {formatExpiry(d.expires_at)}
          </div>
        </button>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onSkip} data-testid="button-skip-resume">
            Start fresh
          </Button>
          <Button size="sm" onClick={() => onResume(d.slot)}>
            Resume draft
          </Button>
        </div>
      </div>
    </div>
  );
}
