import { useState } from "react";
import { useAuth } from "@clerk/react";
import { useSubscription } from "@/hooks/use-subscription";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Download, BookmarkPlus, Globe, Loader2, Crown, Check } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import {
  isLocalBlob,
  isRemoteUrl,
  storeFileHandle,
} from "@/lib/file-handle-store";

const API = import.meta.env.VITE_API_URL ?? "";

interface SaveScriptDialogProps {
  open: boolean;
  onClose: () => void;
  scriptJson: string;
  /** blob: URL when a local file is loaded, https: URL when remote, null when no video. */
  videoUrl: string | null;
  /** Filename of the local video (when videoUrl is a blob). */
  videoFileName: string | null;
  suggestedTitle?: string;
  onDownload: () => void;
  /** Called after a successful Save-to-Library or Share-to-Community write
   * so the parent can clear its dirty/unsaved-work flag. */
  onSavedSuccess?: () => void;
}

type SaveMode = "idle" | "library" | "community";

export function SaveScriptDialog({
  open,
  onClose,
  scriptJson,
  videoUrl,
  videoFileName,
  suggestedTitle = "",
  onDownload,
  onSavedSuccess,
}: SaveScriptDialogProps) {
  const { getToken } = useAuth();
  const { isPro, isLoaded: planLoaded } = useSubscription();
  const { toast } = useToast();

  const [mode, setMode] = useState<SaveMode>("idle");
  const [title, setTitle] = useState(suggestedTitle);
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  /** True when the current video source is a local file (blob URL). */
  const localSource = isLocalBlob(videoUrl);
  /** True when the current video source is a real remote HTTPS/HTTP URL. */
  const remoteSource = isRemoteUrl(videoUrl);

  async function authHeaders(): Promise<Record<string, string>> {
    const token = await getToken();
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;
    return headers;
  }

  /**
   * After saving a local-file entry, try to persist an FSA handle so the
   * library can offer Play without Re-grant Access on the same device/session.
   */
  async function tryPersistFsaHandle(entryId: number) {
    const fsa = (window as unknown as Record<string, unknown>).showOpenFilePicker;
    if (typeof fsa !== "function") return;
    try {
      const [handle] = await (fsa as (opts: unknown) => Promise<FileSystemFileHandle[]>)({
        startIn: "videos",
        types: [{ description: "Video", accept: { "video/*": [".mp4", ".webm", ".mov", ".ogg", ".mkv"] } }],
        id: "library-video-save",
      });
      await storeFileHandle(entryId, handle);
    } catch {
      // User cancelled or FSA not available — fine; Re-grant Access covers this case
    }
  }

  async function handleSaveToLibrary() {
    if (!title.trim()) { toast({ title: "Title required", variant: "destructive" }); return; }
    setSaving(true);
    try {
      const headers = await authHeaders();
      const body: Record<string, unknown> = {
        title: title.trim(),
        funscript: scriptJson,
      };

      if (remoteSource) {
        // Real remote URL — store as video_url for playback
        body.video_url = videoUrl;
      } else if (localSource || videoFileName) {
        // Local file (blob URL or bare file name) — store filename only, never the blob URL
        body.local_file_path = videoFileName ?? "local file";
      }

      const res = await fetch(`${API}/api/library`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error ?? "Failed to save");
      }
      const saved_entry = await res.json() as { id: number };

      // Attempt FSA handle persistence for local-file sources so playback can
      // work without always prompting Re-grant Access.
      if ((localSource || videoFileName) && saved_entry?.id) {
        await tryPersistFsaHandle(saved_entry.id);
      }

      setSaved(true);
      onSavedSuccess?.();
      toast({ title: "Saved to My Library", description: `"${title.trim()}" has been saved.` });
      setTimeout(() => { setSaved(false); onClose(); setMode("idle"); }, 1200);
    } catch (err) {
      toast({
        title: "Could not save",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleShareToCommunity() {
    if (!title.trim()) { toast({ title: "Title required", variant: "destructive" }); return; }
    if (!remoteSource) {
      toast({
        title: "Remote URL required for community sharing",
        description: "Only scripts with an https:// video URL can be shared publicly. Local-file scripts cannot be shared.",
        variant: "destructive",
      });
      return;
    }

    setSaving(true);
    try {
      const headers = await authHeaders();
      const res = await fetch(`${API}/api/community`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim(),
          video_url: videoUrl,
          funscript: scriptJson,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error ?? "Failed to share");
      }
      setSaved(true);
      onSavedSuccess?.();
      toast({ title: "Shared to Community!", description: `"${title.trim()}" is now live.` });
      setTimeout(() => { setSaved(false); onClose(); setMode("idle"); }, 1200);
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

  function handleClose() {
    onClose();
    setMode("idle");
    setSaved(false);
    setSaving(false);
    setTitle(suggestedTitle);
    setDescription("");
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Save Script</DialogTitle>
          <DialogDescription>
            Choose how you'd like to save your funscript.
          </DialogDescription>
        </DialogHeader>

        {mode === "idle" && (
          <div className="flex flex-col gap-3 pt-1">
            <Button
              variant="outline"
              className="h-auto py-4 flex flex-col items-start gap-1 text-left"
              onClick={() => {
                onDownload();
                handleClose();
              }}
            >
              <div className="flex items-center gap-2 font-semibold">
                <Download className="h-4 w-4 text-primary" />
                Download .funscript
              </div>
              <span className="text-xs text-muted-foreground font-normal">
                Save the file directly to your computer.
              </span>
            </Button>

            <Button
              variant="outline"
              className="h-auto py-4 flex flex-col items-start gap-1 text-left"
              onClick={() => setMode("library")}
            >
              <div className="flex items-center gap-2 font-semibold">
                <BookmarkPlus className="h-4 w-4 text-primary" />
                Save to My Library
              </div>
              <span className="text-xs text-muted-foreground font-normal">
                Store privately in your account — play or re-download later.
              </span>
            </Button>

            {planLoaded && (
              isPro ? (
                <Button
                  variant="outline"
                  className="h-auto py-4 flex flex-col items-start gap-1 text-left"
                  onClick={() => setMode("community")}
                  disabled={!remoteSource}
                >
                  <div className="flex items-center gap-2 font-semibold">
                    <Globe className="h-4 w-4 text-primary" />
                    Share to Community
                  </div>
                  <span className="text-xs text-muted-foreground font-normal">
                    {remoteSource
                      ? "Publish so others can rate, favorite, and use this script."
                      : localSource
                        ? "Local-file scripts can't be shared publicly — requires an https:// URL."
                        : "Add a video URL first to share with the community."}
                  </span>
                </Button>
              ) : (
                <Link href="/upgrade" onClick={handleClose}>
                  <Button
                    variant="outline"
                    className="w-full h-auto py-4 flex flex-col items-start gap-1 text-left opacity-60"
                  >
                    <div className="flex items-center gap-2 font-semibold">
                      <Crown className="h-4 w-4 text-amber-400" />
                      Share to Community
                      <span className="text-[10px] bg-amber-400/20 text-amber-400 border border-amber-400/30 px-1.5 py-0.5 rounded-full ml-auto">Pro</span>
                    </div>
                    <span className="text-xs text-muted-foreground font-normal">
                      Upgrade to Pro to share scripts with the community.
                    </span>
                  </Button>
                </Link>
              )
            )}
          </div>
        )}

        {(mode === "library" || mode === "community") && (
          <div className="flex flex-col gap-4 pt-1">
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground font-medium">Script Title *</label>
              <Input
                placeholder="My awesome script…"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                autoFocus
              />
            </div>

            {mode === "community" && (
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground font-medium">Description (optional)</label>
                <Input
                  placeholder="Brief description…"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>
            )}

            {mode === "library" && localSource && (
              <p className="text-xs text-blue-400 bg-blue-400/10 border border-blue-400/30 rounded-md px-3 py-2">
                This script is linked to a local video file. After saving, you may be asked to confirm file access so playback works seamlessly later.
              </p>
            )}

            {mode === "community" && !remoteSource && (
              <p className="text-xs text-amber-400 bg-amber-400/10 border border-amber-400/30 rounded-md px-3 py-2">
                Community sharing requires an https:// video URL. Local-file scripts cannot be shared publicly.
              </p>
            )}

            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setMode("idle")} disabled={saving}>
                Back
              </Button>
              <Button
                size="sm"
                className="flex-1 gap-2"
                disabled={saving || saved || !title.trim() || (mode === "community" && !remoteSource)}
                onClick={mode === "library" ? handleSaveToLibrary : handleShareToCommunity}
              >
                {saved ? (
                  <><Check className="h-4 w-4" /> Saved!</>
                ) : saving ? (
                  <><Loader2 className="h-4 w-4 animate-spin" /> Saving…</>
                ) : mode === "library" ? (
                  <><BookmarkPlus className="h-4 w-4" /> Save to Library</>
                ) : (
                  <><Globe className="h-4 w-4" /> Share to Community</>
                )}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
