import { useState, useEffect, useRef } from "react";
import { getAllEntries, addEntry, deleteEntry, updateEntry, LibraryEntry } from "@/lib/db";
import { Card, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Film, FileJson, Trash2, Play, Upload, FolderOpen, Link, X, Check, Pencil } from "lucide-react";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { validateVideoUrl, validateAndParseFunscriptFile, sanitizeName } from "@/lib/validation";
import { useBlockedReport } from "@/contexts/blocked-report-context";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { getHostLabel } from "@/lib/url-utils";

// File System Access API types (Chrome/Edge, not yet in standard TS lib)
interface FSAFileHandle extends FileSystemFileHandle {
  queryPermission(desc: { mode: "read" | "readwrite" }): Promise<PermissionState>;
  requestPermission(desc: { mode: "read" | "readwrite" }): Promise<PermissionState>;
}
interface FSAWindow {
  showOpenFilePicker(opts: {
    multiple?: boolean;
    types?: { description: string; accept: Record<string, string[]> }[];
  }): Promise<FSAFileHandle[]>;
}

const hasFSA = typeof window !== "undefined" && "showOpenFilePicker" in window;

/** Returns a static SVG data-URI thumbnail for a known platform host, or null. */
function getStaticPlatformThumbnail(url: string): string | null {
  try {
    const h = new URL(url).hostname.replace(/^(www\.|m\.)/, "").toLowerCase();

    type PlatformSpec = { label: string; bg: string; fg: string };
    const platforms: Record<string, PlatformSpec> = {
      "youtube.com": { label: "YT", bg: "#ff0000", fg: "#fff" },
      "youtu.be":    { label: "YT", bg: "#ff0000", fg: "#fff" },
      "pornhub.com": { label: "PH", bg: "#1b1b1b", fg: "#f90" },
      "xvideos.com": { label: "XV", bg: "#d40000", fg: "#fff" },
      "redtube.com": { label: "RT", bg: "#cc0000", fg: "#fff" },
      "vimeo.com":   { label: "Vi", bg: "#1ab7ea", fg: "#fff" },
    };

    if (h.includes("xhamster")) {
      const svg = makeBadgeSvg("xH", "#ff6000", "#fff");
      return `data:image/svg+xml;base64,${btoa(svg)}`;
    }

    const spec = platforms[h];
    if (spec) {
      const svg = makeBadgeSvg(spec.label, spec.bg, spec.fg);
      return `data:image/svg+xml;base64,${btoa(svg)}`;
    }
  } catch { /* ignore */ }
  return null;
}

/** Builds the neutral placeholder SVG used when no platform match exists. */
function getPlaceholderThumbnail(): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180">
    <rect width="320" height="180" fill="#18181b"/>
    <rect x="130" y="55" width="60" height="70" rx="4" fill="#3f3f46"/>
    <polygon points="148,72 148,108 180,90" fill="#71717a"/>
  </svg>`;
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}

function makeBadgeSvg(label: string, bg: string, fg: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="${bg}"/><text x="160" y="105" font-family="Arial,sans-serif" font-size="52" font-weight="bold" fill="${fg}" text-anchor="middle">${label}</text></svg>`;
}

/**
 * Resolves a static thumbnail for a URL entry.
 * Prefers a per-platform bundled SVG; falls back to the neutral placeholder.
 * Does NOT make any network request to third-party hosts.
 */
function getStaticUrlThumbnail(url: string): string {
  return getStaticPlatformThumbnail(url) ?? getPlaceholderThumbnail();
}

/**
 * Resolves a thumbnail for a URL entry at add-time.
 * Always returns a static, bundled result — no network requests to third-party hosts.
 */
function getThumbnailForUrl(url: string): Promise<string> {
  return Promise.resolve(getStaticUrlThumbnail(url));
}

export default function Library() {
  const [entries, setEntries] = useState<LibraryEntry[]>([]);
  const [search, setSearch] = useState("");
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { reportAction } = useBlockedReport();

  const [showUrlForm, setShowUrlForm] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  const [nameInput, setNameInput] = useState("");
  const [addingUrl, setAddingUrl] = useState(false);
  const urlInputRef = useRef<HTMLInputElement>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editUrl, setEditUrl] = useState("");
  const [editSaving, setEditSaving] = useState(false);

  const loadEntries = async () => {
    const data = await getAllEntries();
    setEntries(data.sort((a, b) => b.addedAt - a.addedAt));
  };

  useEffect(() => {
    loadEntries();
  }, []);

  useEffect(() => {
    if (showUrlForm) {
      setTimeout(() => urlInputRef.current?.focus(), 50);
    }
  }, [showUrlForm]);

  const handleDelete = async (id: string) => {
    await deleteEntry(id);
    loadEntries();
  };

  const openEdit = (entry: LibraryEntry) => {
    setEditingId(entry.id);
    setEditName(entry.name);
    setEditUrl(entry.url ?? "");
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditName("");
    setEditUrl("");
  };

  const handleSaveEdit = async (entry: LibraryEntry) => {
    const cleanedName = sanitizeName(editName);
    if (!cleanedName) {
      toast({
        title: "Invalid name",
        description: "Name cannot be empty or contain only HTML/control characters.",
        variant: "destructive",
        action: reportAction({ kind: "library_file", item: editName, blockMessage: "Name is empty after sanitization." }),
      });
      return;
    }

    if (entry.url !== undefined) {
      const trimmedUrl = editUrl.trim();
      if (!trimmedUrl) {
        toast({
          title: "URL required",
          description: "URL entries must have a non-empty URL.",
          variant: "destructive",
        });
        return;
      }
      const urlErr = validateVideoUrl(trimmedUrl);
      if (urlErr) {
        toast({
          title: "Invalid URL",
          description: urlErr.message,
          variant: "destructive",
          action: reportAction({ kind: "library_url", item: trimmedUrl, blockMessage: urlErr.message }),
        });
        return;
      }
    }

    setEditSaving(true);
    try {
      const updated: LibraryEntry = {
        ...entry,
        name: cleanedName,
        ...(entry.url !== undefined ? { url: editUrl.trim() } : {}),
      };
      await updateEntry(updated);
      await loadEntries();
      cancelEdit();
    } finally {
      setEditSaving(false);
    }
  };

  const handleOpen = async (entry: LibraryEntry) => {
    if (entry.url) {
      localStorage.setItem("handy_pending_video_url", entry.url);
      localStorage.setItem("handy_pending_video_name", entry.name);
      setLocation("/player");
      return;
    }

    let url: string | null = null;

    if (entry.fileHandle) {
      try {
        const fsaHandle = entry.fileHandle as unknown as FSAFileHandle;
        let perm = await fsaHandle.queryPermission({ mode: "read" });
        if (perm !== "granted") {
          perm = await fsaHandle.requestPermission({ mode: "read" });
        }
        if (perm === "granted") {
          const file = await fsaHandle.getFile();
          url = URL.createObjectURL(file);
        }
      } catch {
        // fall through to blob if handle failed
      }
    }

    if (!url && entry.blob) {
      url = URL.createObjectURL(entry.blob);
    }

    if (!url) return;

    if (entry.type === "video") {
      localStorage.setItem("handy_pending_video_url", url);
      localStorage.setItem("handy_pending_video_name", entry.name);
    } else {
      try {
        const file = entry.blob ?? (entry.fileHandle ? await (await entry.fileHandle.getFile()) : null);
        if (file) {
          const text = await (file as Blob).text();
          localStorage.setItem("handy_pending_script", text);
          localStorage.setItem("handy_pending_script_name", entry.name);
        }
      } catch { /* ignore */ }
    }
    setLocation("/player");
  };

  const generateThumbnail = (file: File): Promise<string> =>
    new Promise(resolve => {
      const url = URL.createObjectURL(file);
      const video = document.createElement("video");
      video.preload = "metadata";
      video.muted = true;
      video.src = url;
      video.onloadeddata = () => {
        video.currentTime = Math.min(5, video.duration * 0.1);
      };
      video.onseeked = () => {
        const canvas = document.createElement("canvas");
        canvas.width = 320;
        canvas.height = 180;
        const ctx = canvas.getContext("2d");
        if (ctx) ctx.drawImage(video, 0, 0, 320, 180);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.7);
        URL.revokeObjectURL(url);
        resolve(dataUrl);
      };
      video.onerror = () => { URL.revokeObjectURL(url); resolve(""); };
    });

  // File System Access API picker — preferred when available (stores handle, no large blob)
  const handleBrowseFSA = async () => {
    try {
      const handles = await (window as unknown as FSAWindow).showOpenFilePicker({
        multiple: true,
        types: [
          { description: "Videos", accept: { "video/*": [".mp4", ".mkv", ".webm", ".mov", ".avi"] } },
          { description: "Funscripts", accept: { "application/json": [".funscript", ".json"] } }
        ]
      });
      let hadError = false;
      for (const handle of handles) {
        const file = await handle.getFile();
        const isVideo = file.type.startsWith("video/");
        if (!isVideo) {
          try {
            await validateAndParseFunscriptFile(file);
          } catch (err) {
            hadError = true;
            const msg = err instanceof Error ? err.message : "Could not validate file.";
            toast({
              title: `Invalid funscript: ${file.name}`,
              description: msg,
              variant: "destructive",
              action: reportAction({ kind: "library_file", item: file.name, blockMessage: msg }),
            });
            continue;
          }
        }
        const thumbnail = isVideo ? await generateThumbnail(file) : undefined;
        const entry: LibraryEntry = {
          id: crypto.randomUUID(),
          name: file.name,
          type: isVideo ? "video" : "funscript",
          fileHandle: handle,
          addedAt: Date.now(),
          thumbnail
        };
        await addEntry(entry);
      }
      if (!hadError || handles.length > 1) loadEntries();
    } catch {
      // user cancelled or permission denied — no-op
    }
  };

  // Fallback: classic <input type="file"> that stores blob
  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const isVideo = file.type.startsWith("video/");
      if (!isVideo) {
        try {
          await validateAndParseFunscriptFile(file);
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Could not validate file.";
          toast({
            title: `Invalid funscript: ${file.name}`,
            description: msg,
            variant: "destructive",
            action: reportAction({ kind: "library_file", item: file.name, blockMessage: msg }),
          });
          continue;
        }
      }
      const thumbnail = isVideo ? await generateThumbnail(file) : undefined;
      const entry: LibraryEntry = {
        id: crypto.randomUUID(),
        name: file.name,
        type: isVideo ? "video" : "funscript",
        blob: file,
        addedAt: Date.now(),
        thumbnail
      };
      await addEntry(entry);
    }
    loadEntries();
  };

  const handleAddUrl = async () => {
    const trimmedUrl = urlInput.trim();
    if (!trimmedUrl) return;

    const urlErr = validateVideoUrl(trimmedUrl);
    if (urlErr) {
      toast({
        title: "Invalid URL",
        description: urlErr.message,
        variant: "destructive",
        action: reportAction({ kind: "library_url", item: trimmedUrl, blockMessage: urlErr.message }),
      });
      return;
    }

    setAddingUrl(true);
    try {
      const thumbnail = await getThumbnailForUrl(trimmedUrl);
      const name = nameInput.trim() || trimmedUrl;
      const entry: LibraryEntry = {
        id: crypto.randomUUID(),
        name,
        type: "video",
        url: trimmedUrl,
        addedAt: Date.now(),
        thumbnail: thumbnail || undefined,
      };
      await addEntry(entry);
      setUrlInput("");
      setNameInput("");
      setShowUrlForm(false);
      loadEntries();
    } finally {
      setAddingUrl(false);
    }
  };

  const handleUrlKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleAddUrl();
    if (e.key === "Escape") {
      setShowUrlForm(false);
      setUrlInput("");
      setNameInput("");
    }
  };

  const filtered = entries.filter(e => e.name.toLowerCase().includes(search.toLowerCase()));

  const sharedEditProps = {
    editingId,
    editName,
    setEditName,
    editUrl,
    setEditUrl,
    editSaving,
    openEdit,
    cancelEdit,
    handleSaveEdit,
  };

  return (
    <TooltipProvider delayDuration={300}>
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
            <Button variant="outline" onClick={() => setShowUrlForm(v => !v)} data-testid="button-add-url">
              <Link className="h-4 w-4 mr-2" /> Add URL
            </Button>
            {hasFSA ? (
              <Button variant="default" onClick={handleBrowseFSA} data-testid="button-upload-library">
                <FolderOpen className="h-4 w-4 mr-2" /> Browse Files
              </Button>
            ) : (
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
            )}
          </div>
        </div>

        {showUrlForm && (
          <div className="rounded-xl border border-border/60 bg-card/70 backdrop-blur p-4 flex flex-col gap-3 shadow-sm" data-testid="url-form">
            <div className="flex items-center gap-2">
              <Link className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              <span className="text-sm font-medium">Add video from URL</span>
            </div>
            <div className="flex gap-2">
              <Input
                ref={urlInputRef}
                placeholder="Paste video URL (YouTube, Pornhub, xVideos, Vimeo, or direct .mp4/.webm)…"
                value={urlInput}
                onChange={e => setUrlInput(e.target.value)}
                onKeyDown={handleUrlKeyDown}
                className="flex-1 bg-background/50"
                data-testid="url-input"
              />
              <Input
                placeholder="Name (optional)"
                value={nameInput}
                onChange={e => setNameInput(e.target.value)}
                onKeyDown={handleUrlKeyDown}
                className="w-48 bg-background/50"
                data-testid="url-name-input"
              />
              <Button
                onClick={handleAddUrl}
                disabled={!urlInput.trim() || addingUrl}
                data-testid="url-confirm"
              >
                {addingUrl ? (
                  <span className="flex items-center gap-1.5"><span className="animate-spin h-3.5 w-3.5 border-2 border-current border-t-transparent rounded-full inline-block" />Adding…</span>
                ) : (
                  <><Check className="h-4 w-4 mr-1.5" />Add</>
                )}
              </Button>
              <Button variant="ghost" size="icon" onClick={() => { setShowUrlForm(false); setUrlInput(""); setNameInput(""); }} data-testid="url-cancel">
                <X className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground ml-6">
              Supports YouTube, Pornhub, xVideos, xHamster, RedTube, Vimeo, or any direct .mp4/.webm URL
            </p>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 flex-1 content-start">
          {filtered.map(entry => (
            entry.url
              ? <UrlEntryCard key={entry.id} entry={entry} onOpen={handleOpen} onDelete={handleDelete} {...sharedEditProps} />
              : <FileEntryCard key={entry.id} entry={entry} onOpen={handleOpen} onDelete={handleDelete} {...sharedEditProps} />
          ))}
          {filtered.length === 0 && (
            <div className="col-span-full py-12 flex flex-col items-center justify-center text-muted-foreground border-2 border-dashed border-border/50 rounded-xl">
              <LibraryIcon className="h-12 w-12 mb-4 opacity-20" />
              <p>No entries found in library.</p>
            </div>
          )}
        </div>
      </div>
    </TooltipProvider>
  );
}

// ── URL entry card ────────────────────────────────────────────────────────────

interface EntryCardProps {
  entry: LibraryEntry;
  onOpen: (e: LibraryEntry) => void;
  onDelete: (id: string) => void;
  editingId: string | null;
  editName: string;
  setEditName: (v: string) => void;
  editUrl: string;
  setEditUrl: (v: string) => void;
  editSaving: boolean;
  openEdit: (e: LibraryEntry) => void;
  cancelEdit: () => void;
  handleSaveEdit: (e: LibraryEntry) => void;
}

function UrlEntryCard({
  entry,
  onOpen,
  onDelete,
  editingId,
  editName,
  setEditName,
  editUrl,
  setEditUrl,
  editSaving,
  openEdit,
  cancelEdit,
  handleSaveEdit
}: EntryCardProps) {
  const url = entry.url!;
  const hostLabel = getHostLabel(url);
  // Always derive the thumbnail statically — never use the persisted entry.thumbnail
  // for URL entries, as it may contain legacy remote URLs (e.g. YouTube image CDN)
  // that would cause third-party network requests at render time.
  const thumbnail = getStaticUrlThumbnail(url);

  const tooltipContent = (
    <div className="space-y-1 max-w-xs">
      <p className="font-semibold text-xs leading-snug break-words">{entry.name}</p>
      <p className="text-[10px] text-muted-foreground break-all opacity-80">{url}</p>
    </div>
  );

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Card tabIndex={0} className="bg-card/50 backdrop-blur overflow-hidden group outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2">
          {/* Thumbnail */}
          <div className="aspect-video bg-black flex items-center justify-center relative border-b border-border/50 overflow-hidden">
            <img
              src={thumbnail}
              alt={hostLabel || entry.name}
              className="w-full h-full object-cover"
              draggable={false}
            />
            <div className="absolute top-2 right-2 bg-background/80 backdrop-blur px-2 py-1 rounded text-xs font-mono">
              URL
            </div>
          </div>

          {editingId === entry.id ? (
            <div className="p-4 space-y-2">
              <div className="space-y-1.5">
                <label className="text-[11px] text-muted-foreground font-medium uppercase tracking-wide">Name</label>
                <Input
                  value={editName}
                  onChange={e => setEditName(e.target.value)}
                  className="h-8 text-sm"
                  autoFocus
                  onKeyDown={e => {
                    if (e.key === "Enter") handleSaveEdit(entry);
                    if (e.key === "Escape") cancelEdit();
                  }}
                  data-testid={`input-edit-name-${entry.id}`}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-[11px] text-muted-foreground font-medium uppercase tracking-wide">URL</label>
                <Input
                  value={editUrl}
                  onChange={e => setEditUrl(e.target.value)}
                  className="h-8 text-sm"
                  onKeyDown={e => {
                    if (e.key === "Enter") handleSaveEdit(entry);
                    if (e.key === "Escape") cancelEdit();
                  }}
                  data-testid={`input-edit-url-${entry.id}`}
                />
              </div>
              <div className="flex gap-2 pt-1">
                <Button
                  size="sm"
                  className="flex-1 h-8 text-xs gap-1"
                  disabled={
                    editSaving ||
                    !sanitizeName(editName) ||
                    (sanitizeName(editName) === entry.name && editUrl === (entry.url ?? ""))
                  }
                  onClick={() => handleSaveEdit(entry)}
                  data-testid={`button-save-edit-${entry.id}`}
                >
                  {editSaving ? <span className="animate-spin h-3.5 w-3.5 border-2 border-current border-t-transparent rounded-full inline-block" /> : <Check className="h-3.5 w-3.5" />}
                  Save
                </Button>
                <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={cancelEdit} data-testid={`button-cancel-edit-${entry.id}`}>
                  <X className="h-3.5 w-3.5 mr-1" />Cancel
                </Button>
              </div>
            </div>
          ) : (
            <>
              {/* Host label — 2-line clamped, no resting URL text */}
              <div className="px-4 pt-3 pb-1">
                <p
                  className="text-base font-semibold leading-snug line-clamp-2 overflow-hidden"
                  style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}
                >
                  {hostLabel || entry.name}
                </p>
              </div>

              <CardFooter className="p-4 pt-2 gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  className="flex-1"
                  onClick={() => onOpen(entry)}
                  data-testid={`button-open-${entry.id}`}
                >
                  <Play className="h-4 w-4 mr-2" /> Open
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 text-muted-foreground hover:text-foreground"
                  onClick={() => openEdit(entry)}
                  data-testid={`button-edit-${entry.id}`}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  variant="destructive"
                  size="icon"
                  className="h-9 w-9"
                  onClick={() => onDelete(entry.id)}
                  data-testid={`button-delete-${entry.id}`}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </CardFooter>
            </>
          )}
        </Card>
      </TooltipTrigger>
      <TooltipContent
        side="top"
        className="bg-popover text-popover-foreground border border-border shadow-lg px-3 py-2 rounded-lg"
      >
        {tooltipContent}
      </TooltipContent>
    </Tooltip>
  );
}

// ── File entry card (unchanged layout) ───────────────────────────────────────

function FileEntryCard({
  entry,
  onOpen,
  onDelete,
  editingId,
  editName,
  setEditName,
  editUrl,
  editSaving,
  openEdit,
  cancelEdit,
  handleSaveEdit
}: EntryCardProps) {
  return (
    <Card className="bg-card/50 backdrop-blur overflow-hidden group">
      <div className="aspect-video bg-black flex items-center justify-center relative border-b border-border/50 overflow-hidden">
        {entry.thumbnail ? (
          <img src={entry.thumbnail} alt={entry.name} className="w-full h-full object-cover" />
        ) : entry.type === "video" ? (
          <Film className="h-12 w-12 text-primary/50 group-hover:text-primary transition-colors" />
        ) : (
          <FileJson className="h-12 w-12 text-primary/50 group-hover:text-primary transition-colors" />
        )}
        <div className="absolute top-2 right-2 bg-background/80 backdrop-blur px-2 py-1 rounded text-xs font-mono">
          {entry.type.toUpperCase()}
        </div>
        {entry.fileHandle && (
          <div className="absolute top-2 left-2 bg-primary/80 backdrop-blur px-2 py-1 rounded text-xs font-mono text-black font-semibold">
            LINKED
          </div>
        )}
      </div>

      {editingId === entry.id ? (
        <div className="p-4 space-y-2">
          <div className="space-y-1.5">
            <label className="text-[11px] text-muted-foreground font-medium uppercase tracking-wide">Name</label>
            <Input
              value={editName}
              onChange={e => setEditName(e.target.value)}
              className="h-8 text-sm"
              autoFocus
              onKeyDown={e => {
                if (e.key === "Enter") handleSaveEdit(entry);
                if (e.key === "Escape") cancelEdit();
              }}
              data-testid={`input-edit-name-${entry.id}`}
            />
          </div>
          <div className="flex gap-2 pt-1">
            <Button
              size="sm"
              className="flex-1 h-8 text-xs gap-1"
              disabled={
                editSaving ||
                !sanitizeName(editName) ||
                (sanitizeName(editName) === entry.name && editUrl === (entry.url ?? ""))
              }
              onClick={() => handleSaveEdit(entry)}
              data-testid={`button-save-edit-${entry.id}`}
            >
              {editSaving ? <span className="animate-spin h-3.5 w-3.5 border-2 border-current border-t-transparent rounded-full inline-block" /> : <Check className="h-3.5 w-3.5" />}
              Save
            </Button>
            <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={cancelEdit} data-testid={`button-cancel-edit-${entry.id}`}>
              <X className="h-3.5 w-3.5 mr-1" />Cancel
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="px-4 pt-3 pb-1">
            <p className="text-base font-semibold truncate" title={entry.name}>{entry.name}</p>
          </div>
          <CardFooter className="p-4 pt-2 gap-2">
            <Button
              variant="secondary"
              size="sm"
              className="flex-1"
              onClick={() => onOpen(entry)}
              data-testid={`button-open-${entry.id}`}
            >
              <Play className="h-4 w-4 mr-2" /> Open
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 text-muted-foreground hover:text-foreground"
              onClick={() => openEdit(entry)}
              data-testid={`button-edit-${entry.id}`}
            >
              <Pencil className="h-4 w-4" />
            </Button>
            <Button
              variant="destructive"
              size="icon"
              className="h-9 w-9"
              onClick={() => onDelete(entry.id)}
              data-testid={`button-delete-${entry.id}`}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </CardFooter>
        </>
      )}
    </Card>
  );
}

function LibraryIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/>
    </svg>
  );
}
