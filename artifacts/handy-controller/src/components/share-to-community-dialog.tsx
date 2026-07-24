import { useState, useEffect } from "react";
import { useAuth } from "@clerk/react";
import { useToast } from "@/hooks/use-toast";
import { useBlockedReport } from "@/contexts/blocked-report-context";
import { type LibraryEntry } from "@/lib/db";
import { validateVideoUrl, validateAndParseFunscriptFile } from "@/lib/validation";
import { TagPicker, ActiveTagChips } from "@/components/tag-picker";
import { type LibraryTag } from "@workspace/validation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Globe, Upload, FileJson, Loader2 } from "lucide-react";

const API = import.meta.env.VITE_API_URL ?? "";

interface FSAFileHandle extends FileSystemFileHandle {
  queryPermission(desc: { mode: "read" | "readwrite" }): Promise<PermissionState>;
  requestPermission(desc: { mode: "read" | "readwrite" }): Promise<PermissionState>;
}

/** Reads a funscript blob from a library entry, or returns null if unavailable. */
async function readFunscriptFromEntry(entry: LibraryEntry): Promise<string | null> {
  try {
    if (entry.fileHandle) {
      const fsaHandle = entry.fileHandle as unknown as FSAFileHandle;
      let perm = await fsaHandle.queryPermission({ mode: "read" });
      if (perm !== "granted") perm = await fsaHandle.requestPermission({ mode: "read" });
      if (perm === "granted") {
        const file = await fsaHandle.getFile();
        return file.text();
      }
    }
    if (entry.blob) {
      return (entry.blob as Blob).text();
    }
  } catch { /* ignore — will fall through to null */ }
  return null;
}

/** Extract a plain URL from either a bare URL or an <iframe src="…"> embed code. */
function normalizeVideoInput(raw: string): string {
  const m = raw.match(/src=["']([^"']+)["']/i);
  return m ? m[1].trim() : raw.trim();
}

export interface ShareToCommunityDialogProps {
  entry: LibraryEntry | null;
  open: boolean;
  onClose: () => void;
  onShared: (entry: LibraryEntry, communityId: number) => void;
}

export function ShareToCommunityDialog({
  entry,
  open,
  onClose,
  onShared,
}: ShareToCommunityDialogProps) {
  const { getToken } = useAuth();
  const { toast } = useToast();
  const { reportAction } = useBlockedReport();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [tags, setTags] = useState<LibraryTag[]>([]);
  const [scriptFile, setScriptFile] = useState<File | null>(null);
  const [preloadedFunscript, setPreloadedFunscript] = useState<string | null>(null);
  const [loadingFunscript, setLoadingFunscript] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const isFunscriptEntry = entry?.type === "funscript";
  const isUrlEntry = !!entry?.url;
  const isLocalVideo = entry?.type === "video" && !entry?.url;

  useEffect(() => {
    if (!open || !entry) return;
    setTitle(entry.name.replace(/\.(funscript|json)$/i, ""));
    setDescription("");
    setVideoUrl(entry.url ?? "");
    setTags([]);
    setScriptFile(null);
    setPreloadedFunscript(null);

    if (isFunscriptEntry) {
      setLoadingFunscript(true);
      readFunscriptFromEntry(entry).then((text) => {
        setPreloadedFunscript(text);
        setLoadingFunscript(false);
      });
    }
  }, [open, entry?.id]);

  async function handleSubmit() {
    if (!entry) return;

    const normalizedUrl = normalizeVideoInput(videoUrl);
    const urlErr = validateVideoUrl(normalizedUrl);
    if (urlErr) {
      toast({ title: "Invalid video URL", description: urlErr.message, variant: "destructive" });
      return;
    }

    let funscriptStr: string | null = null;

    if (isFunscriptEntry) {
      if (!preloadedFunscript) {
        toast({ title: "Could not read funscript", description: "Please re-add the file to your library and try again.", variant: "destructive" });
        return;
      }
      funscriptStr = preloadedFunscript;
    } else {
      if (!scriptFile) {
        toast({ title: "Funscript required", description: "Please attach a .funscript file.", variant: "destructive" });
        return;
      }
      try {
        const parsed = await validateAndParseFunscriptFile(scriptFile);
        funscriptStr = JSON.stringify(parsed);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Invalid funscript file.";
        toast({ title: "Invalid funscript", description: msg, variant: "destructive" });
        return;
      }
    }

    setSubmitting(true);
    try {
      const token = await getToken();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;

      const res = await fetch(`${API}/api/community`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          title: title.trim() || entry.name,
          description: description.trim(),
          video_url: normalizedUrl,
          tags,
          funscript: funscriptStr,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string; existing_title?: string };
        if (res.status === 409) {
          throw new Error(
            data.existing_title
              ? `Already shared as "${data.existing_title}".`
              : "This script is already in the community."
          );
        }
        if (res.status === 403) throw new Error("Community sharing requires a Pro subscription.");
        if (res.status === 429) {
          const retryAfter = res.headers.get("Retry-After");
          throw new Error(`Sharing too quickly. Try again${retryAfter ? ` in ${retryAfter}s` : " shortly"}.`);
        }
        if (res.status === 413) throw new Error("Video storage limit reached. Remove some community entries first.");
        throw new Error(data.error ?? "Failed to share script.");
      }

      const result = await res.json() as { id: number };
      toast({ title: "Script shared!", description: "It's now live in the community feed." });
      onShared(entry, result.id);
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error.";
      toast({
        title: "Could not share script",
        description: msg,
        variant: "destructive",
        action: reportAction({
          kind: "community_submission",
          item: videoUrl || title || "(library share)",
          blockMessage: msg,
        }),
      });
    } finally {
      setSubmitting(false);
    }
  }

  if (!entry) return null;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v && !submitting) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Globe className="h-4 w-4 text-primary" />
            Share to Community
          </DialogTitle>
        </DialogHeader>

        {isLocalVideo ? (
          <div className="py-4 text-sm text-muted-foreground text-center space-y-2">
            <FileJson className="h-8 w-8 mx-auto opacity-30" />
            <p>Local video files can't be shared — community scripts need a public video URL.</p>
            <p className="text-xs">Add the video as a URL entry in your library instead.</p>
          </div>
        ) : (
          <div className="space-y-4 py-1">
            {/* Title */}
            <div className="space-y-1.5">
              <Label htmlFor="share-title">Title</Label>
              <Input
                id="share-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Give your script a name…"
                maxLength={255}
              />
            </div>

            {/* Description */}
            <div className="space-y-1.5">
              <Label htmlFor="share-desc" className="flex items-center gap-1">
                Description <span className="text-muted-foreground text-xs font-normal">(optional)</span>
              </Label>
              <Input
                id="share-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Brief description, video source, notes…"
                maxLength={2000}
              />
            </div>

            {/* Video URL — pre-filled for URL entries */}
            <div className="space-y-1.5">
              <Label htmlFor="share-url" className="flex items-center gap-1.5">
                <Globe className="h-3.5 w-3.5" /> Video URL
              </Label>
              <Input
                id="share-url"
                value={videoUrl}
                onChange={(e) => setVideoUrl(e.target.value)}
                placeholder="https://…"
                readOnly={isUrlEntry}
                className={isUrlEntry ? "opacity-70 cursor-default" : ""}
              />
              {isUrlEntry && (
                <p className="text-[11px] text-muted-foreground">Taken from your library entry.</p>
              )}
            </div>

            {/* Funscript — auto-loaded for funscript entries, uploaded for URL entries */}
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5">
                <FileJson className="h-3.5 w-3.5" /> Funscript
              </Label>
              {isFunscriptEntry ? (
                <div className={`flex items-center gap-2 rounded-md border border-border/60 bg-muted/40 px-3 py-2 text-sm ${loadingFunscript ? "opacity-60" : ""}`}>
                  {loadingFunscript ? (
                    <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Reading from library…</>
                  ) : preloadedFunscript ? (
                    <><FileJson className="h-3.5 w-3.5 text-primary" /> Loaded from your library file</>
                  ) : (
                    <span className="text-destructive text-xs">Could not read file — please re-add it to your library.</span>
                  )}
                </div>
              ) : (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    className="relative w-full justify-start gap-2 cursor-pointer"
                    type="button"
                  >
                    <Upload className="h-3.5 w-3.5" />
                    {scriptFile ? scriptFile.name : "Attach .funscript file…"}
                    <input
                      type="file"
                      accept=".funscript,.json"
                      className="absolute inset-0 opacity-0 cursor-pointer"
                      onChange={(e) => {
                        const f = e.target.files?.[0] ?? null;
                        setScriptFile(f);
                        e.target.value = "";
                      }}
                    />
                  </Button>
                  <p className="text-[11px] text-muted-foreground">
                    The funscript that matches your video.
                  </p>
                </>
              )}
            </div>

            {/* Tags */}
            <div className="space-y-1.5">
              <Label>Tags <span className="text-muted-foreground text-xs font-normal">(optional)</span></Label>
              <div className="flex items-center gap-2 flex-wrap">
                <TagPicker selected={tags} onChange={setTags} mode="edit" buttonLabel="Add tags" />
                <ActiveTagChips selected={tags} onRemove={(t) => setTags(tags.filter((x) => x !== t))} />
              </div>
            </div>
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          {!isLocalVideo && (
            <Button
              onClick={handleSubmit}
              disabled={
                submitting ||
                loadingFunscript ||
                !title.trim() ||
                !normalizeVideoInput(videoUrl) ||
                (isFunscriptEntry ? !preloadedFunscript : !scriptFile)
              }
            >
              {submitting ? (
                <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Sharing…</>
              ) : (
                <><Globe className="h-3.5 w-3.5 mr-1.5" /> Share to Community</>
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
