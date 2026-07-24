import { useState, useEffect, useRef } from "react";
import { getAllEntries, addEntry, deleteEntry, updateEntry, LibraryEntry, Playlist, getAllPlaylists, addPlaylist, updatePlaylist, deletePlaylist } from "@/lib/db";
import { Card, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Film, FileJson, Trash2, Play, Upload, FolderOpen, Link, X, Check, Pencil, ListVideo, Plus, Crown, Lock, Globe } from "lucide-react";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { validateVideoUrl, validateAndParseFunscriptFile, sanitizeName } from "@/lib/validation";
import { useBlockedReport } from "@/contexts/blocked-report-context";
import { useSubscription } from "@/hooks/use-subscription";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { getHostLabel } from "@/lib/url-utils";
import { PlaylistEditorDialog } from "@/components/playlist-editor-dialog";
import { ShareToCommunityDialog } from "@/components/share-to-community-dialog";

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

/**
 * Reads a CSS custom property from the document root and returns it as an
 * `hsl(...)` color string so it can be embedded directly in SVG markup.
 * Falls back to the provided default if the DOM is unavailable or the variable
 * is not set.
 */
function readCssColor(varName: string, fallback: string): string {
  try {
    const val = getComputedStyle(document.documentElement)
      .getPropertyValue(varName)
      .trim();
    if (val) {
      // If the value is already a complete color expression, use it as-is.
      const isComplete = /^(#|rgb|hsl|oklch|color\()/i.test(val);
      return isComplete ? val : `hsl(${val})`;
    }
  } catch { /* ignore — SSR or tests */ }
  return fallback;
}

/** Builds the neutral placeholder SVG used when no platform match exists. */
function getPlaceholderThumbnail(): string {
  const bg   = readCssColor("--card",             "hsl(0 40% 7%)");
  const box  = readCssColor("--muted",            "hsl(0 20% 11%)");
  const icon = readCssColor("--muted-foreground", "hsl(0 10% 60%)");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180">
    <rect width="320" height="180" fill="${bg}"/>
    <rect x="130" y="55" width="60" height="70" rx="4" fill="${box}"/>
    <polygon points="148,72 148,108 180,90" fill="${icon}"/>
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

type LibraryTab = "library" | "playlists";

const FREE_LIMIT = 10;
const SUBSCRIBER_LIMIT = 100;

export default function Library() {
  const [entries, setEntries] = useState<LibraryEntry[]>([]);
  const [search, setSearch] = useState("");
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { reportAction } = useBlockedReport();
  const { isPro } = useSubscription();

  const entryLimit = isPro ? SUBSCRIBER_LIMIT : FREE_LIMIT;
  const atLimit = entries.length >= entryLimit;

  const showLimitToast = (remaining: number) => {
    if (remaining > 0) return;
    toast({
      variant: "destructive",
      title: isPro ? "Library full (100 items)" : "Free library full (10 items)",
      description: isPro
        ? "Remove some entries to add more."
        : "Remove some entries or upgrade to a subscription (100 items).",
    });
  };

  const [activeTab, setActiveTab] = useState<LibraryTab>("library");

  const [showUrlForm, setShowUrlForm] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  const [nameInput, setNameInput] = useState("");
  const [addingUrl, setAddingUrl] = useState(false);
  const urlInputRef = useRef<HTMLInputElement>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editUrl, setEditUrl] = useState("");
  const [editSaving, setEditSaving] = useState(false);

  // Playlist state
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingPlaylist, setEditingPlaylist] = useState<Playlist | null>(null);

  // Share to Community state
  const [shareEntry, setShareEntry] = useState<LibraryEntry | null>(null);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);

  const loadEntries = async () => {
    const data = await getAllEntries();
    setEntries(data.sort((a, b) => b.addedAt - a.addedAt));
  };

  const loadPlaylists = async () => {
    const data = await getAllPlaylists();
    setPlaylists(data.sort((a, b) => b.createdAt - a.createdAt));
  };

  useEffect(() => {
    loadEntries();
    loadPlaylists();
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
      const current = await getAllEntries();
      let remaining = entryLimit - current.length;
      if (remaining <= 0) { showLimitToast(0); return; }
      for (const handle of handles) {
        if (remaining <= 0) { showLimitToast(0); break; }
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
        remaining--;
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
    const current = await getAllEntries();
    let remaining = entryLimit - current.length;
    if (remaining <= 0) { showLimitToast(0); return; }
    for (let i = 0; i < files.length; i++) {
      if (remaining <= 0) { showLimitToast(0); break; }
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
      remaining--;
    }
    loadEntries();
  };

  const handleAddUrl = async () => {
    const trimmedUrl = urlInput.trim();
    if (!trimmedUrl) return;

    if (atLimit) { showLimitToast(0); return; }

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

  // ── Playlist handlers ───────────────────────────────────────────────────────

  const handleSavePlaylist = async (name: string, itemIds: string[]) => {
    if (editingPlaylist) {
      await updatePlaylist({ ...editingPlaylist, name, itemIds });
    } else {
      await addPlaylist({ id: crypto.randomUUID(), name, itemIds, createdAt: Date.now() });
    }
    await loadPlaylists();
    setEditorOpen(false);
    setEditingPlaylist(null);
  };

  const handleDeletePlaylist = async (id: string) => {
    await deletePlaylist(id);
    await loadPlaylists();
  };

  const openNewPlaylist = () => {
    setEditingPlaylist(null);
    setEditorOpen(true);
  };

  const openEditPlaylist = (pl: Playlist) => {
    setEditingPlaylist(pl);
    setEditorOpen(true);
  };

  const handlePlayPlaylist = (pl: Playlist) => {
    if (pl.itemIds.length === 0) {
      toast({ title: "Playlist is empty", description: "Add some items before playing.", variant: "destructive" });
      return;
    }
    const pendingPlaylist = { itemIds: pl.itemIds, index: 0, playlistName: pl.name };
    localStorage.setItem("handy_pending_playlist", JSON.stringify(pendingPlaylist));
    setLocation("/player");
  };

  const openShare = (entry: LibraryEntry) => {
    setShareEntry(entry);
    setShareDialogOpen(true);
  };

  const handleShared = async (entry: LibraryEntry, communityId: number) => {
    const updated: LibraryEntry = { ...entry, sharedCommunityId: communityId };
    await updateEntry(updated);
    await loadEntries();
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
    onShare: openShare,
    isPro,
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
            {activeTab === "library" && (
              <>
                {/* Entry count / limit indicator */}
                <div className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border ${
                  atLimit
                    ? "border-destructive/40 bg-destructive/10 text-destructive"
                    : entries.length >= entryLimit * 0.8
                      ? "border-yellow-500/40 bg-yellow-500/10 text-yellow-500"
                      : "border-border/50 bg-muted/50 text-muted-foreground"
                }`}>
                  {atLimit ? <Lock className="h-3 w-3" /> : null}
                  {entries.length}/{entryLimit} items
                </div>

                <div className="w-64">
                  <Input
                    placeholder="Search library..."
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    className="bg-card"
                  />
                </div>
                <Button onClick={() => setShowUrlForm(v => !v)} disabled={atLimit} data-testid="button-add-url">
                  <Link className="h-4 w-4 mr-2" /> Add URL
                </Button>
                {hasFSA ? (
                  <Button variant="default" onClick={handleBrowseFSA} disabled={atLimit} data-testid="button-upload-library">
                    <FolderOpen className="h-4 w-4 mr-2" /> Browse Files
                  </Button>
                ) : (
                  <Button variant="default" className="relative cursor-pointer" disabled={atLimit} data-testid="button-upload-library">
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
              </>
            )}
            {activeTab === "playlists" && (
              <Button onClick={openNewPlaylist}>
                <Plus className="h-4 w-4 mr-2" /> New Playlist
              </Button>
            )}
          </div>
        </div>

        {/* Upgrade prompt when free user hits the limit */}
        {!isPro && atLimit && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 flex items-center gap-3 -mt-4">
            <Lock className="h-5 w-5 text-destructive flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-destructive">Library full (10/10 items)</p>
              <p className="text-xs text-muted-foreground">Delete some entries to add more, or upgrade to get 100 slots.</p>
            </div>
            <a href="/upgrade">
              <Button size="sm" variant="destructive" className="gap-1.5 flex-shrink-0">
                <Crown className="h-4 w-4" /> Upgrade
              </Button>
            </a>
          </div>
        )}

        {/* Tab switcher */}
        <div className="flex items-center gap-1 border-b border-border/50 -mt-4">
          <button
            onClick={() => setActiveTab("library")}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
              activeTab === "library"
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <Film className="h-3.5 w-3.5 inline mr-1.5 -mt-0.5" />
            Library
          </button>
          <button
            onClick={() => setActiveTab("playlists")}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
              activeTab === "playlists"
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <ListVideo className="h-3.5 w-3.5 inline mr-1.5 -mt-0.5" />
            Playlists
            {playlists.length > 0 && (
              <span className="ml-1.5 text-xs bg-muted px-1.5 py-0.5 rounded-full">{playlists.length}</span>
            )}
          </button>
        </div>

        {/* Library tab */}
        {activeTab === "library" && (
          <>
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
          </>
        )}

        {/* Playlists tab */}
        {activeTab === "playlists" && (
          <div className="flex-1">
            {playlists.length === 0 ? (
              <div className="py-16 flex flex-col items-center justify-center text-muted-foreground border-2 border-dashed border-border/50 rounded-xl">
                <ListVideo className="h-12 w-12 mb-4 opacity-20" />
                <p className="mb-4">No playlists yet.</p>
                <Button onClick={openNewPlaylist} variant="outline">
                  <Plus className="h-4 w-4 mr-2" /> Create your first playlist
                </Button>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
                {playlists.map(pl => {
                  const count = pl.itemIds.length;
                  return (
                    <Card key={pl.id} className="bg-card/50 backdrop-blur overflow-hidden flex flex-col">
                      {/* Header area */}
                      <div className="flex-1 p-5 flex flex-col gap-2">
                        <div className="flex items-start gap-3">
                          <div className="bg-primary/10 rounded-lg p-2.5 shrink-0">
                            <ListVideo className="h-5 w-5 text-primary" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-semibold text-base leading-snug truncate">{pl.name}</p>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {count} {count === 1 ? "item" : "items"}
                            </p>
                          </div>
                        </div>

                        {/* Preview of first few items */}
                        {count > 0 && (
                          <div className="mt-1 space-y-1">
                            {pl.itemIds.slice(0, 3).map((id, idx) => {
                              const entry = entries.find(e => e.id === id);
                              return (
                                <div key={id} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                  <span className="w-4 text-right shrink-0">{idx + 1}.</span>
                                  {entry ? (
                                    <>
                                      {entry.type === "video"
                                        ? <Film className="h-3 w-3 shrink-0" />
                                        : <FileJson className="h-3 w-3 shrink-0" />}
                                      <span className="truncate">{entry.name}</span>
                                    </>
                                  ) : (
                                    <span className="opacity-50 italic">Missing</span>
                                  )}
                                </div>
                              );
                            })}
                            {count > 3 && (
                              <p className="text-xs text-muted-foreground pl-5">+{count - 3} more…</p>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Actions */}
                      <CardFooter className="p-4 pt-0 gap-2 border-t border-border/30 mt-auto">
                        <Button
                          size="sm"
                          className="flex-1"
                          onClick={() => handlePlayPlaylist(pl)}
                          disabled={count === 0}
                        >
                          <Play className="h-4 w-4 mr-1.5" /> Play
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-9 w-9 text-muted-foreground hover:text-foreground"
                          onClick={() => openEditPlaylist(pl)}
                          title="Edit playlist"
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="destructive"
                          size="icon"
                          className="h-9 w-9"
                          onClick={() => handleDeletePlaylist(pl.id)}
                          title="Delete playlist"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </CardFooter>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      <PlaylistEditorDialog
        open={editorOpen}
        onClose={() => { setEditorOpen(false); setEditingPlaylist(null); }}
        onSave={handleSavePlaylist}
        playlist={editingPlaylist}
        allEntries={entries}
      />

      <ShareToCommunityDialog
        entry={shareEntry}
        open={shareDialogOpen}
        onClose={() => { setShareDialogOpen(false); setShareEntry(null); }}
        onShared={handleShared}
      />
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
  onShare: (e: LibraryEntry) => void;
  isPro: boolean;
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
  handleSaveEdit,
  onShare,
  isPro,
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
            {entry.sharedCommunityId && (
              <div className="absolute bottom-2 left-2 flex items-center gap-1 bg-primary/90 backdrop-blur text-primary-foreground px-2 py-0.5 rounded text-[10px] font-semibold">
                <Globe className="h-2.5 w-2.5" /> Community
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
                  size="sm"
                  className="flex-1"
                  onClick={() => onOpen(entry)}
                  data-testid={`button-open-${entry.id}`}
                >
                  <Play className="h-4 w-4 mr-2" /> Open
                </Button>
                {isPro ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant={entry.sharedCommunityId ? "outline" : "ghost"}
                        size="icon"
                        className={`h-9 w-9 ${entry.sharedCommunityId ? "text-primary border-primary/40" : "text-muted-foreground hover:text-foreground"}`}
                        onClick={() => onShare(entry)}
                        data-testid={`button-share-${entry.id}`}
                      >
                        <Globe className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="top">
                      {entry.sharedCommunityId ? "Already shared — share again" : "Share to Community"}
                    </TooltipContent>
                  </Tooltip>
                ) : (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-9 w-9 text-muted-foreground/40 cursor-default"
                          disabled
                        >
                          <Globe className="h-4 w-4" />
                        </Button>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="top">
                      <div className="flex items-center gap-1.5">
                        <Crown className="h-3 w-3 text-yellow-400" /> Subscribers only
                      </div>
                    </TooltipContent>
                  </Tooltip>
                )}
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

// ── File entry card ───────────────────────────────────────────────────────────

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
  handleSaveEdit,
  onShare,
  isPro,
}: EntryCardProps) {
  const isLocalVideo = entry.type === "video" && !entry.url;
  const canShare = !isLocalVideo;

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
        {entry.sharedCommunityId && (
          <div className="absolute bottom-2 left-2 flex items-center gap-1 bg-primary/90 backdrop-blur text-primary-foreground px-2 py-0.5 rounded text-[10px] font-semibold">
            <Globe className="h-2.5 w-2.5" /> Community
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
              size="sm"
              className="flex-1"
              onClick={() => onOpen(entry)}
              data-testid={`button-open-${entry.id}`}
            >
              <Play className="h-4 w-4 mr-2" /> Open
            </Button>
            {canShare && (
              isPro ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant={entry.sharedCommunityId ? "outline" : "ghost"}
                      size="icon"
                      className={`h-9 w-9 ${entry.sharedCommunityId ? "text-primary border-primary/40" : "text-muted-foreground hover:text-foreground"}`}
                      onClick={() => onShare(entry)}
                      data-testid={`button-share-${entry.id}`}
                    >
                      <Globe className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    {entry.sharedCommunityId ? "Already shared — share again" : "Share to Community"}
                  </TooltipContent>
                </Tooltip>
              ) : (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9 text-muted-foreground/40 cursor-default"
                        disabled
                      >
                        <Globe className="h-4 w-4" />
                      </Button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    <div className="flex items-center gap-1.5">
                      <Crown className="h-3 w-3 text-yellow-400" /> Subscribers only
                    </div>
                  </TooltipContent>
                </Tooltip>
              )
            )}
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
