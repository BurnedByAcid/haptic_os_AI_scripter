import { useState, useEffect, useCallback, useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import { useAuth, useUser } from "@clerk/react";
import { useSubscription } from "@/hooks/use-subscription";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Download, Play, Upload, Plus, X, Clock, User, Eye,
  Crown, Loader2, Globe, Trash2, ChevronDown
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { validateVideoUrl, validateAndParseFunscriptFile } from "@/lib/validation";
import { useBlockedReport } from "@/contexts/blocked-report-context";
import { Link, useLocation } from "wouter";

const API = import.meta.env.VITE_API_URL ?? "";
const PAGE_SIZE = 20;

interface CommunityScript {
  id: number;
  user_id: string;
  username: string;
  title: string;
  description: string;
  video_url: string;
  view_count: number;
  created_at: string;
  favorite_count: number;
  avg_rating: number | null;
  rating_count: number;
  user_favorited: boolean;
  user_rating: number | null;
}

interface PageResult {
  scripts: CommunityScript[];
  total: number;
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

function VideoIcon({ url }: { url: string }) {
  const h = url.toLowerCase();
  if (h.includes("pornhub")) return <span className="text-[10px] font-bold bg-amber-500 text-black px-1.5 py-0.5 rounded">PH</span>;
  if (h.includes("youtube") || h.includes("youtu.be")) return <span className="text-[10px] font-bold bg-red-600 text-white px-1.5 py-0.5 rounded">YT</span>;
  if (h.includes("xvideos")) return <span className="text-[10px] font-bold bg-red-700 text-white px-1.5 py-0.5 rounded">XV</span>;
  if (h.includes("xhamster")) return <span className="text-[10px] font-bold bg-orange-600 text-white px-1.5 py-0.5 rounded">XH</span>;
  if (h.includes("redtube")) return <span className="text-[10px] font-bold bg-red-500 text-white px-1.5 py-0.5 rounded">RT</span>;
  if (h.includes("vimeo")) return <span className="text-[10px] font-bold bg-violet-600 text-white px-1.5 py-0.5 rounded">VI</span>;
  return <span className="text-[10px] font-bold bg-zinc-600 text-white px-1.5 py-0.5 rounded">VID</span>;
}

function BananaRating({
  avgRating,
  userRating,
  ratingCount,
  onRate,
  disabled,
}: {
  avgRating: number | null;
  userRating: number | null;
  ratingCount: number;
  onRate: (r: number) => void;
  disabled?: boolean;
}) {
  const [hover, setHover] = useState(0);
  const display = hover || userRating || 0;

  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          className={`text-base leading-none transition-transform hover:scale-110 ${disabled ? "cursor-default" : "cursor-pointer"}`}
          onMouseEnter={() => !disabled && setHover(n)}
          onMouseLeave={() => setHover(0)}
          onClick={() => !disabled && onRate(n)}
          title={disabled ? undefined : `Rate ${n} banana${n !== 1 ? "s" : ""}`}
          aria-label={`${n} banana${n !== 1 ? "s" : ""}`}
        >
          {n <= display ? "🍌" : <span className="opacity-25">🍌</span>}
        </button>
      ))}
      {ratingCount > 0 && avgRating !== null && (
        <span className="text-[11px] text-muted-foreground ml-1">
          {avgRating.toFixed(1)} ({ratingCount})
        </span>
      )}
    </div>
  );
}

function EggplantButton({
  favorited,
  count,
  onClick,
  loading,
}: {
  favorited: boolean;
  count: number;
  onClick: () => void;
  loading?: boolean;
}) {
  return (
    <button
      className={`flex items-center gap-1 text-sm transition-transform hover:scale-110 ${loading ? "opacity-50 cursor-wait" : "cursor-pointer"}`}
      onClick={onClick}
      disabled={loading}
      title={favorited ? "Remove from favorites" : "Add to favorites"}
      aria-label={favorited ? "Unfavorite" : "Favorite"}
    >
      <span className={`text-base ${favorited ? "" : "opacity-40"}`}>🍆</span>
      <span className="text-[11px] text-muted-foreground">{count}</span>
    </button>
  );
}

export default function Community() {
  const { user } = useUser();
  const { getToken } = useAuth();
  const { isPro } = useSubscription();
  const { toast } = useToast();
  const [location, setLocation] = useLocation();
  const { reportAction } = useBlockedReport();

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: "", description: "", video_url: "", tags: "" });
  const [scriptFile, setScriptFile] = useState<File | null>(null);
  const [search, setSearch] = useState("");
  const [favoriteLoadingId, setFavoriteLoadingId] = useState<number | null>(null);
  const [rateLoadingId, setRateLoadingId] = useState<number | null>(null);

  const [allScripts, setAllScripts] = useState<CommunityScript[]>([]);
  const [total, setTotal] = useState(0);
  const [nextOffset, setNextOffset] = useState(0);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  const initializedRef = useRef(false);

  async function authHeaders(): Promise<Record<string, string>> {
    const token = await getToken();
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (token) h["Authorization"] = `Bearer ${token}`;
    return h;
  }

  async function fetchPage(offset: number): Promise<PageResult> {
    const headers = await authHeaders();
    const res = await fetch(`${API}/api/community?limit=${PAGE_SIZE}&offset=${offset}`, { headers });
    if (!res.ok) throw new Error("Failed to load");
    return res.json() as Promise<PageResult>;
  }

  function getUrlOffset(): number {
    const params = new URLSearchParams(window.location.search);
    return Math.max(0, parseInt(params.get("offset") ?? "0", 10));
  }

  function setUrlOffset(offset: number) {
    const params = new URLSearchParams(window.location.search);
    if (offset === 0) {
      params.delete("offset");
    } else {
      params.set("offset", String(offset));
    }
    const search = params.toString();
    const newPath = location.split("?")[0] + (search ? `?${search}` : "");
    setLocation(newPath, { replace: true });
  }

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    const urlOffset = getUrlOffset();
    const pagesToLoad = Math.floor(urlOffset / PAGE_SIZE) + 1;

    async function init() {
      try {
        const offsets = Array.from({ length: pagesToLoad }, (_, i) => i * PAGE_SIZE);
        const results = await Promise.all(offsets.map(fetchPage));
        const accumulated = results.flatMap((r) => r.scripts);
        const lastResult = results[results.length - 1];
        setAllScripts(accumulated);
        setTotal(lastResult.total);
        setNextOffset(pagesToLoad * PAGE_SIZE);
      } catch {
        toast({ title: "Failed to load community scripts", variant: "destructive" });
      } finally {
        setIsInitialLoading(false);
      }
    }

    init();
  }, []);

  const hasMore = nextOffset < total;

  async function loadMore() {
    setIsLoadingMore(true);
    try {
      const result = await fetchPage(nextOffset);
      setAllScripts((prev) => [...prev, ...result.scripts]);
      setTotal(result.total);
      const newNextOffset = nextOffset + PAGE_SIZE;
      setNextOffset(newNextOffset);
      setUrlOffset(nextOffset);
    } catch {
      toast({ title: "Failed to load more scripts", variant: "destructive" });
    } finally {
      setIsLoadingMore(false);
    }
  }

  function updateScript(id: number, updater: (s: CommunityScript) => CommunityScript) {
    setAllScripts((prev) => prev.map((s) => (s.id === id ? updater(s) : s)));
  }

  const submitMutation = useMutation({
    mutationFn: async () => {
      if (!scriptFile) throw new Error("No script file selected.");
      const urlErr = validateVideoUrl(form.video_url.trim());
      if (urlErr) throw new Error(urlErr.message);
      const script = await validateAndParseFunscriptFile(scriptFile);
      const headers = await authHeaders();
      const res = await fetch(`${API}/api/community`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          ...form,
          funscript: JSON.stringify(script),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string; details?: string[] | string };
        const detailsMsg = Array.isArray(data.details) ? data.details.join(" ") : data.details;
        if (res.status === 429) {
          const retryAfter = res.headers.get("Retry-After");
          const waitHint = retryAfter ? ` Try again in ${retryAfter}s.` : "";
          throw new Error(
            (data.error ?? "You're sharing scripts too quickly. Please slow down.") + waitHint,
          );
        }
        throw new Error(detailsMsg ?? data.error ?? "Failed to submit script.");
      }
      return res.json() as Promise<CommunityScript>;
    },
    onSuccess: (newScript) => {
      setAllScripts((prev) => [
        {
          ...newScript,
          favorite_count: 0,
          avg_rating: null,
          rating_count: 0,
          user_favorited: false,
          user_rating: null,
        },
        ...prev,
      ]);
      setTotal((t) => t + 1);
      // The new script is prepended at position 0 in the DB (newest-first order),
      // so all previously loaded items shifted by 1. Advance the cursor so the
      // next "load more" fetch starts at the correct offset.
      setNextOffset((n) => n + 1);
      setShowForm(false);
      setForm({ title: "", description: "", video_url: "", tags: "" });
      setScriptFile(null);
      toast({ title: "Script shared!", description: "Your script is now live in the community." });
    },
    onError: (err) => {
      const msg = err instanceof Error ? err.message : "Unknown error.";
      toast({
        title: "Could not share script",
        description: msg,
        variant: "destructive",
        action: reportAction({
          kind: "community_submission",
          item: form.video_url || form.title || "(submission)",
          blockMessage: msg,
        }),
      });
    },
  });

  async function handleFavorite(s: CommunityScript) {
    setFavoriteLoadingId(s.id);
    try {
      const headers = await authHeaders();
      const res = await fetch(`${API}/api/community/${s.id}/favorite`, { method: "POST", headers });
      if (!res.ok) throw new Error("Failed");
      updateScript(s.id, (sc) => {
        const nowFav = !sc.user_favorited;
        return { ...sc, user_favorited: nowFav, favorite_count: sc.favorite_count + (nowFav ? 1 : -1) };
      });
    } catch {
      toast({ title: "Could not update favorite", variant: "destructive" });
    } finally {
      setFavoriteLoadingId(null);
    }
  }

  async function handleRate(s: CommunityScript, rating: number) {
    setRateLoadingId(s.id);
    try {
      const headers = await authHeaders();
      const res = await fetch(`${API}/api/community/${s.id}/rate`, {
        method: "POST",
        headers,
        body: JSON.stringify({ rating }),
      });
      if (!res.ok) throw new Error("Failed");
      const result = await res.json() as { avg_rating: number; rating_count: number; user_rating: number };
      updateScript(s.id, (sc) => ({
        ...sc,
        user_rating: result.user_rating,
        avg_rating: result.avg_rating,
        rating_count: result.rating_count,
      }));
    } catch {
      toast({ title: "Could not save rating", variant: "destructive" });
    } finally {
      setRateLoadingId(null);
    }
  }

  async function handleUseInPlayer(s: CommunityScript) {
    try {
      const headers = await authHeaders();
      const res = await fetch(`${API}/api/community/${s.id}`, { headers });
      if (!res.ok) throw new Error("Failed");
      const data = await res.json() as CommunityScript & { funscript: string };
      localStorage.setItem("handy_pending_script", data.funscript);
      localStorage.setItem("handy_pending_script_name", s.title);
      localStorage.setItem("handy_pending_video_url", s.video_url);
      setLocation("/player");
    } catch {
      toast({ title: "Could not load into player", variant: "destructive" });
    }
  }

  async function handleDownload(s: CommunityScript) {
    try {
      const headers = await authHeaders();
      const res = await fetch(`${API}/api/community/${s.id}`, { headers });
      if (!res.ok) throw new Error("Failed");
      const data = await res.json() as CommunityScript & { funscript: string };
      const blob = new Blob([data.funscript], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${s.title.replace(/[^a-z0-9]/gi, "_")}.funscript`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch {
      toast({ title: "Download failed", variant: "destructive" });
    }
  }

  async function handleDelete(s: CommunityScript) {
    if (!window.confirm(`Delete "${s.title}"? This cannot be undone.`)) return;
    try {
      const headers = await authHeaders();
      const res = await fetch(`${API}/api/community/${s.id}`, { method: "DELETE", headers });
      if (!res.ok) throw new Error("Failed");
      setAllScripts((prev) => prev.filter((sc) => sc.id !== s.id));
      setTotal((t) => Math.max(0, t - 1));
      // The deleted script was within the loaded window, so items after it in
      // the DB shifted left by 1. Pull the cursor back so the next "load more"
      // fetch doesn't skip an item at the page boundary.
      setNextOffset((n) => Math.max(0, n - 1));
      toast({ title: "Deleted", description: "Your shared script has been removed." });
    } catch {
      toast({ title: "Delete failed", variant: "destructive" });
    }
  }

  const filtered = allScripts.filter((s) =>
    s.title.toLowerCase().includes(search.toLowerCase()) ||
    s.username.toLowerCase().includes(search.toLowerCase()) ||
    s.description.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-6 h-full flex flex-col max-w-[1400px] mx-auto gap-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Community Scripts</h1>
          <p className="text-muted-foreground">Browse, rate, and favorite video + funscript pairs from the community.</p>
        </div>
        {isPro ? (
          <Button
            className="gap-2"
            onClick={() => setShowForm((v) => !v)}
            variant={showForm ? "outline" : "default"}
          >
            {showForm ? <><X className="h-4 w-4" /> Cancel</> : <><Plus className="h-4 w-4" /> Share a Script</>}
          </Button>
        ) : (
          <Link href="/upgrade">
            <Button variant="outline" className="gap-2 opacity-70">
              <Crown className="h-4 w-4 text-amber-400" />
              Upgrade to Share
            </Button>
          </Link>
        )}
      </div>

      {showForm && isPro && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="pt-5 pb-4 space-y-4">
            <h2 className="font-semibold text-base">Share a Script</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground font-medium">Title *</label>
                <Input
                  placeholder="Scene title…"
                  value={form.title}
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                  className="bg-background/50"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground font-medium">Video URL *</label>
                <Input
                  placeholder="https://…"
                  value={form.video_url}
                  onChange={(e) => setForm((f) => ({ ...f, video_url: e.target.value }))}
                  className="bg-background/50"
                />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground font-medium">Description</label>
              <Input
                placeholder="Optional description…"
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                className="bg-background/50"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground font-medium">Funscript File *</label>
              <div className="relative">
                <Button variant="outline" className="w-full relative h-10 text-sm justify-start gap-2">
                  <Upload className="h-4 w-4 text-muted-foreground" />
                  {scriptFile
                    ? <span className="truncate text-foreground">{scriptFile.name}</span>
                    : <span className="text-muted-foreground">Choose .funscript file…</span>
                  }
                  <input
                    type="file"
                    accept=".funscript,.json"
                    className="absolute inset-0 opacity-0 cursor-pointer"
                    onChange={(e) => setScriptFile(e.target.files?.[0] ?? null)}
                  />
                </Button>
              </div>
            </div>
            <Button
              className="gap-2"
              onClick={() => submitMutation.mutate()}
              disabled={!form.title || !form.video_url || !scriptFile || submitMutation.isPending}
            >
              {submitMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Globe className="h-4 w-4" />}
              {submitMutation.isPending ? "Sharing…" : "Share Script"}
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="flex gap-3 items-center flex-wrap">
        <Input
          placeholder="Search by title, author, or description…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm bg-background/50 border-border/50"
        />
        {!isInitialLoading && (
          <span className="text-sm text-muted-foreground">
            {search
              ? `${filtered.length} match${filtered.length !== 1 ? "es" : ""} in ${allScripts.length} loaded`
              : `Showing ${allScripts.length} of ${total} script${total !== 1 ? "s" : ""}`}
          </span>
        )}
      </div>

      {isInitialLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-56 rounded-xl border border-border/50 bg-card/30 animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center text-muted-foreground gap-3 py-20">
          <Globe className="h-12 w-12 opacity-30" />
          <p className="text-lg font-medium text-foreground">
            {search ? "No scripts match your search" : "No scripts yet"}
          </p>
          <p className="max-w-xs text-sm">
            {search
              ? "Try different keywords, or clear the search to see all loaded scripts."
              : isPro
              ? "Be the first to share a video + funscript pair with the community."
              : "Upgrade to Pro to share scripts with the community."}
          </p>
          {!search && isPro && (
            <Button className="mt-2 gap-2" onClick={() => setShowForm(true)}>
              <Plus className="h-4 w-4" /> Share the First Script
            </Button>
          )}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((s) => {
              const isOwner = user?.id === s.user_id;
              return (
                <Card key={s.id} className="border-border/50 bg-card/50 hover:border-primary/30 transition-colors flex flex-col">
                  <CardContent className="pt-5 pb-4 flex flex-col flex-1 gap-3">
                    <div className="flex items-start gap-2">
                      <VideoIcon url={s.video_url} />
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold text-foreground leading-tight truncate" title={s.title}>
                          {s.title}
                        </h3>
                        {s.description && (
                          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{s.description}</p>
                        )}
                      </div>
                      {isOwner && (
                        <button
                          onClick={() => handleDelete(s)}
                          className="shrink-0 text-muted-foreground hover:text-destructive transition-colors"
                          title="Delete your shared script"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>

                    <div className="flex items-center justify-between">
                      <EggplantButton
                        favorited={s.user_favorited}
                        count={s.favorite_count}
                        onClick={() => handleFavorite(s)}
                        loading={favoriteLoadingId === s.id}
                      />
                      <BananaRating
                        avgRating={s.avg_rating}
                        userRating={s.user_rating}
                        ratingCount={s.rating_count}
                        onRate={(r) => handleRate(s, r)}
                        disabled={rateLoadingId === s.id}
                      />
                    </div>

                    <div className="flex items-center gap-3 text-[11px] text-muted-foreground mt-auto flex-wrap">
                      <span className="flex items-center gap-1">
                        <User className="h-3 w-3" />{s.username}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />{timeAgo(s.created_at)}
                      </span>
                      <span className="flex items-center gap-1 ml-auto">
                        <Eye className="h-3 w-3" />{s.view_count}
                      </span>
                    </div>

                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1 text-xs h-8 gap-1.5"
                        onClick={() => handleDownload(s)}
                      >
                        <Download className="h-3.5 w-3.5" /> Download
                      </Button>
                      <Button
                        size="sm"
                        className="flex-1 text-xs h-8 gap-1.5"
                        onClick={() => handleUseInPlayer(s)}
                      >
                        <Play className="h-3.5 w-3.5" /> Use in Player
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {hasMore && !search && (
            <div className="flex flex-col items-center gap-2 py-4">
              <Button
                variant="outline"
                className="gap-2"
                onClick={loadMore}
                disabled={isLoadingMore}
              >
                {isLoadingMore
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : <ChevronDown className="h-4 w-4" />}
                {isLoadingMore ? "Loading…" : `Load more (${total - nextOffset} remaining)`}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
