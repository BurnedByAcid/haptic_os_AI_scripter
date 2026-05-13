import { useState, useEffect, useRef } from "react";
import {
  Shield, Search, Crown, Zap, ShieldCheck, AlertCircle,
  Users, TrendingUp, FileText, Star, Heart, Eye,
  Gamepad2, Music, Play, BookOpen, Sliders, PenLine,
  Ticket, RefreshCw, BarChart3, UserPlus, MessageSquare, Bug, Lightbulb, MessageCircle,
  Upload, Monitor, Apple, CheckCircle2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useSubscription, type Plan } from "@/hooks/use-subscription";
import { useAuth } from "@clerk/react";
import { useToast } from "@/hooks/use-toast";

const PLAN_OPTIONS: { plan: Plan; label: string; icon: typeof Crown; desc: string; classes: string }[] = [
  {
    plan: "free",
    label: "Free",
    icon: Zap,
    desc: "Basic access — device control & player",
    classes: "border-border/60 hover:border-border text-muted-foreground",
  },
  {
    plan: "pro",
    label: "Pro",
    icon: Crown,
    desc: "Full access — all features unlocked",
    classes: "border-primary/40 hover:border-primary text-primary",
  },
  {
    plan: "admin",
    label: "Admin",
    icon: ShieldCheck,
    desc: "Admin access — can manage user plans",
    classes: "border-yellow-500/40 hover:border-yellow-500 text-yellow-400",
  },
];

const FEATURE_META: Record<string, { label: string; icon: typeof Play; color: string }> = {
  scripter:  { label: "Scripter",    icon: PenLine,   color: "text-red-400" },
  player:    { label: "Player",      icon: Play,      color: "text-blue-400" },
  community: { label: "Community",   icon: Users,     color: "text-green-400" },
  library:   { label: "Library",     icon: BookOpen,  color: "text-yellow-400" },
  games:     { label: "Games",       icon: Gamepad2,  color: "text-pink-400" },
  beat:      { label: "Live Audio",  icon: Music,     color: "text-orange-400" },
  control:   { label: "Control",     icon: Sliders,   color: "text-cyan-400" },
};

const API_BASE = import.meta.env.VITE_API_URL ?? "";

interface AnalyticsData {
  users: {
    total: number;
    byPlan: Record<string, number>;
    newLast7Days: number;
    newLast30Days: number;
  };
  content: {
    scripterSessions: number;
    communityScripts: number;
    communityViews: number;
    communityRatings: number;
    communityFavorites: number;
    libraryEntries: number;
  };
  features: Record<string, { total: number; last30: number }>;
  earlyBird: {
    configured: boolean;
    couponId?: string;
    percentOff?: number;
    timesRedeemed?: number;
    maxRedemptions?: number;
    remaining?: number;
    valid?: boolean;
    error?: string;
  };
}

function StatCard({
  label, value, sub, icon: Icon, color = "text-foreground",
}: {
  label: string; value: string | number; sub?: string;
  icon: typeof Users; color?: string;
}) {
  return (
    <div className="rounded-lg border border-border/50 bg-card/40 p-4 flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
        <Icon className="h-3 w-3" />{label}
      </div>
      <div className={`text-2xl font-bold tabular-nums ${color}`}>{value.toLocaleString()}</div>
      {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

function useAdminAnalytics(isAdmin: boolean) {
  const { getToken } = useAuth();
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    if (!isAdmin) return;
    setLoading(true);
    setError(null);
    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/api/admin/analytics`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to load analytics");
      setData(await res.json() as AnalyticsData);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [isAdmin]); // eslint-disable-line react-hooks/exhaustive-deps

  return { data, loading, error, refresh: load };
}

interface FeedbackEntry {
  id: number;
  user_id: string | null;
  user_email: string | null;
  category: "bug" | "suggestion" | "other";
  message: string;
  created_at: string;
}

function useAdminFeedback(isAdmin: boolean) {
  const { getToken } = useAuth();
  const [data, setData] = useState<FeedbackEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "bug" | "suggestion" | "other">("all");

  const load = async () => {
    if (!isAdmin) return;
    setLoading(true);
    setError(null);
    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/api/admin/feedback`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to load feedback");
      setData(await res.json() as FeedbackEntry[]);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [isAdmin]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = filter === "all" ? data : data.filter((f) => f.category === filter);
  const counts = {
    all: data.length,
    bug: data.filter((f) => f.category === "bug").length,
    suggestion: data.filter((f) => f.category === "suggestion").length,
    other: data.filter((f) => f.category === "other").length,
  };
  return { data: filtered, total: data.length, counts, loading, error, refresh: load, filter, setFilter };
}

interface HapticAIRelease {
  id: number;
  platform: string;
  version: string;
  sizeBytes: number;
  storageKey: string;
  uploadedAt: string;
}

function useHapticAIReleases(isAdmin: boolean) {
  const { getToken } = useAuth();
  const [data, setData] = useState<HapticAIRelease[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    if (!isAdmin) return;
    setLoading(true);
    setError(null);
    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/api/admin/hapticai/releases`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to load releases");
      setData(await res.json() as HapticAIRelease[]);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [isAdmin]); // eslint-disable-line react-hooks/exhaustive-deps

  return { data, loading, error, refresh: load };
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

export default function Admin() {
  const { isAdmin, isLoaded } = useSubscription();
  const { getToken } = useAuth();
  const { toast } = useToast();
  const { data: analytics, loading: analyticsLoading, error: analyticsError, refresh } = useAdminAnalytics(isLoaded && isAdmin);
  const { data: feedbackList, total: feedbackTotal, counts: feedbackCounts, loading: feedbackLoading, error: feedbackError, refresh: refreshFeedback, filter: feedbackFilter, setFilter: setFeedbackFilter } = useAdminFeedback(isLoaded && isAdmin);
  const { data: releases, loading: releasesLoading, error: releasesError, refresh: refreshReleases } = useHapticAIReleases(isLoaded && isAdmin);

  const [targetEmail, setTargetEmail] = useState("");
  const [selectedPlan, setSelectedPlan] = useState<Plan>("pro");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const [uploadPlatform, setUploadPlatform] = useState<"windows" | "mac">("windows");
  const [uploadVersion, setUploadVersion] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleUpload = async () => {
    if (!uploadFile || !uploadVersion.trim()) return;
    setUploadProgress(0);
    setUploadError(null);
    setUploadSuccess(false);

    const CHUNK_SIZE = 2 * 1024 * 1024; // 2 MB — safely under any proxy limit
    const totalChunks = Math.max(1, Math.ceil(uploadFile.size / CHUNK_SIZE));
    const version = uploadVersion.trim();

    try {
      for (let i = 0; i < totalChunks; i++) {
        const start = i * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, uploadFile.size);
        const chunkBlob = uploadFile.slice(start, end);

        // Refresh the token before every chunk so it never expires mid-upload
        const token = await getToken({ skipCache: true });

        const formData = new FormData();
        formData.append("platform", uploadPlatform);
        formData.append("version", version);
        formData.append("chunkIndex", String(i));
        formData.append("totalChunks", String(totalChunks));
        formData.append("chunk", chunkBlob, uploadFile.name);

        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open("POST", `${API_BASE}/api/hapticai/upload-chunk`);
          xhr.setRequestHeader("Authorization", `Bearer ${token ?? ""}`);

          // Show per-chunk byte progress blended with overall chunk progress
          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) {
              const chunksDone = i * CHUNK_SIZE;
              const chunkBytes = (e.loaded / e.total) * (end - start);
              setUploadProgress(Math.round(((chunksDone + chunkBytes) / uploadFile.size) * 100));
            }
          };

          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              resolve();
            } else {
              let msg = `Chunk ${i + 1}/${totalChunks} failed.`;
              try { msg = (JSON.parse(xhr.responseText) as { error?: string }).error ?? msg; } catch {}
              reject(new Error(msg));
            }
          };
          xhr.onerror = () => reject(new Error(`Network error on chunk ${i + 1}/${totalChunks}.`));
          xhr.send(formData);
        });

        // Update progress between chunks
        setUploadProgress(Math.round(((i + 1) / totalChunks) * 100));
      }

      setUploadSuccess(true);
      setUploadProgress(100);
      setUploadFile(null);
      setUploadVersion("");
      if (fileInputRef.current) fileInputRef.current.value = "";
      toast({ title: "Release uploaded", description: `${uploadPlatform} ${version} is now live.` });
      refreshReleases();
    } catch (e) {
      setUploadError(String(e instanceof Error ? e.message : e));
      setUploadProgress(null);
    }
  };

  if (!isLoaded) return null;

  if (!isAdmin) {
    return (
      <div className="p-8 flex flex-col items-center justify-center gap-4 text-center min-h-[60vh]">
        <div className="h-16 w-16 rounded-full bg-red-500/10 border border-red-500/30 flex items-center justify-center">
          <AlertCircle className="h-8 w-8 text-red-400" />
        </div>
        <h1 className="text-xl font-bold">Access denied</h1>
        <p className="text-muted-foreground text-sm max-w-sm">
          This page is only accessible to admin accounts.
        </p>
      </div>
    );
  }

  const handleSetPlan = async () => {
    if (!targetEmail.trim()) return;
    setLoading(true);
    setResult(null);
    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/api/admin/set-plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ email: targetEmail.trim(), plan: selectedPlan }),
      });
      const data = await res.json() as { message?: string; error?: string };
      if (res.ok) {
        setResult({ ok: true, message: data.message ?? "Plan updated." });
        toast({ title: "Plan updated", description: `${targetEmail} is now on the ${selectedPlan} plan.` });
        setTargetEmail("");
      } else {
        setResult({ ok: false, message: data.error ?? "Unknown error" });
      }
    } catch (e) {
      setResult({ ok: false, message: String(e) });
    } finally {
      setLoading(false);
    }
  };

  const planColors: Record<string, string> = {
    free: "text-muted-foreground",
    subscriber: "text-primary",
    pro: "text-primary",
    admin: "text-yellow-400",
  };

  const totalFeatureEvents = Object.values(analytics?.features ?? {}).reduce((s, f) => s + f.last30, 0);

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-full bg-yellow-500/10 border border-yellow-500/30 flex items-center justify-center">
            <Shield className="h-5 w-5 text-yellow-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Admin Panel</h1>
            <p className="text-muted-foreground text-sm">Analytics & user management</p>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={refresh} disabled={analyticsLoading} className="gap-1.5 text-muted-foreground">
          <RefreshCw className={`h-3.5 w-3.5 ${analyticsLoading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* Analytics */}
      {analyticsError ? (
        <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-4 text-sm text-red-400">
          Failed to load analytics: {analyticsError}
        </div>
      ) : (
        <div className="space-y-4">

          {/* Users section */}
          <div>
            <div className="flex items-center gap-2 mb-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              <Users className="h-3.5 w-3.5" /> Users
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <StatCard
                label="Total Users"
                value={analytics?.users.total ?? "—"}
                icon={Users}
                color="text-foreground"
              />
              <StatCard
                label="Free"
                value={analytics?.users.byPlan.free ?? 0}
                sub={analytics ? `${Math.round(((analytics.users.byPlan.free ?? 0) / Math.max(analytics.users.total, 1)) * 100)}% of users` : undefined}
                icon={Zap}
                color={planColors.free}
              />
              <StatCard
                label="Subscribers"
                value={(analytics?.users.byPlan.subscriber ?? 0) + (analytics?.users.byPlan.pro ?? 0)}
                sub={analytics ? `${Math.round((((analytics.users.byPlan.subscriber ?? 0) + (analytics.users.byPlan.pro ?? 0)) / Math.max(analytics.users.total, 1)) * 100)}% of users` : undefined}
                icon={Crown}
                color={planColors.subscriber}
              />
              <StatCard
                label="Admins"
                value={analytics?.users.byPlan.admin ?? 0}
                icon={ShieldCheck}
                color={planColors.admin}
              />
            </div>
            <div className="grid grid-cols-2 gap-2 mt-2">
              <StatCard label="New (7 days)" value={analytics?.users.newLast7Days ?? "—"} icon={UserPlus} color="text-green-400" />
              <StatCard label="New (30 days)" value={analytics?.users.newLast30Days ?? "—"} icon={TrendingUp} color="text-green-400" />
            </div>
          </div>

          {/* Content section */}
          <div>
            <div className="flex items-center gap-2 mb-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              <FileText className="h-3.5 w-3.5" /> Content
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              <StatCard label="Scripter Sessions" value={analytics?.content.scripterSessions ?? "—"} icon={PenLine} color="text-red-400" />
              <StatCard label="Community Scripts" value={analytics?.content.communityScripts ?? "—"} icon={FileText} color="text-green-400" />
              <StatCard label="Script Views" value={analytics?.content.communityViews ?? "—"} icon={Eye} color="text-blue-400" />
              <StatCard label="Ratings" value={analytics?.content.communityRatings ?? "—"} icon={Star} color="text-yellow-400" />
              <StatCard label="Favorites" value={analytics?.content.communityFavorites ?? "—"} icon={Heart} color="text-pink-400" />
              <StatCard label="Library Entries" value={analytics?.content.libraryEntries ?? "—"} icon={BookOpen} color="text-cyan-400" />
            </div>
          </div>

          {/* Feature usage */}
          <div>
            <div className="flex items-center gap-2 mb-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              <BarChart3 className="h-3.5 w-3.5" /> Feature Usage (last 30 days)
            </div>
            <div className="rounded-lg border border-border/50 bg-card/40 p-4 space-y-2.5">
              {Object.entries(FEATURE_META).map(([key, meta]) => {
                const Icon = meta.icon;
                const count = analytics?.features[key]?.last30 ?? 0;
                const pct = totalFeatureEvents > 0 ? (count / totalFeatureEvents) * 100 : 0;
                return (
                  <div key={key} className="flex items-center gap-3">
                    <div className={`flex items-center gap-1.5 w-28 shrink-0 text-xs font-medium ${meta.color}`}>
                      <Icon className="h-3.5 w-3.5" />
                      {meta.label}
                    </div>
                    <div className="flex-1 h-2 rounded-full bg-muted/40 overflow-hidden">
                      <div
                        className={`h-full rounded-full bg-current transition-all duration-500 ${meta.color}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <div className="w-14 text-right text-xs tabular-nums text-muted-foreground">
                      {count.toLocaleString()}
                    </div>
                  </div>
                );
              })}
              {!analytics && (
                <p className="text-xs text-muted-foreground text-center py-2">
                  {analyticsLoading ? "Loading…" : "No data yet — feature events will appear as users navigate the app."}
                </p>
              )}
            </div>
          </div>

          {/* Early bird coupon */}
          {analytics?.earlyBird.configured && (
            <div>
              <div className="flex items-center gap-2 mb-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                <Ticket className="h-3.5 w-3.5" /> Early Bird Coupon
              </div>
              {analytics.earlyBird.error ? (
                <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3 text-xs text-red-400">
                  {analytics.earlyBird.error}
                </div>
              ) : (
                <div className="rounded-lg border border-border/50 bg-card/40 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">
                      {analytics.earlyBird.percentOff}% off first month
                      <span className="ml-2 text-xs text-muted-foreground">({analytics.earlyBird.couponId})</span>
                    </span>
                    <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${
                      analytics.earlyBird.valid
                        ? "border-green-500/30 bg-green-500/10 text-green-400"
                        : "border-red-500/30 bg-red-500/10 text-red-400"
                    }`}>
                      {analytics.earlyBird.valid ? "Active" : "Expired"}
                    </span>
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>{analytics.earlyBird.timesRedeemed} redeemed</span>
                      <span>{analytics.earlyBird.remaining} remaining of {analytics.earlyBird.maxRedemptions}</span>
                    </div>
                    <div className="h-2 rounded-full bg-muted/40 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-primary transition-all duration-500"
                        style={{ width: `${((analytics.earlyBird.timesRedeemed ?? 0) / (analytics.earlyBird.maxRedemptions ?? 100)) * 100}%` }}
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Set User Plan */}
      <Card className="bg-card/50">
        <CardHeader>
          <CardTitle className="text-base">Set User Plan</CardTitle>
          <CardDescription>Enter an email address and choose the plan to assign.</CardDescription>
        </CardHeader>
        <div className="px-6 pb-6 space-y-5">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              User Email
            </label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  type="email"
                  placeholder="user@example.com"
                  value={targetEmail}
                  onChange={e => setTargetEmail(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") handleSetPlan(); }}
                  className="pl-8 h-9 text-sm"
                />
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Assign Plan
            </label>
            <div className="grid grid-cols-3 gap-2">
              {PLAN_OPTIONS.map(opt => {
                const Icon = opt.icon;
                return (
                  <button
                    key={opt.plan}
                    onClick={() => setSelectedPlan(opt.plan)}
                    className={`flex flex-col items-center gap-1.5 p-3 rounded-lg border-2 transition-all text-center ${
                      selectedPlan === opt.plan
                        ? `${opt.classes} bg-current/5`
                        : "border-border/30 text-muted-foreground/50 hover:border-border/60"
                    }`}
                  >
                    <Icon className="h-5 w-5" />
                    <span className="text-xs font-semibold">{opt.label}</span>
                    <span className="text-[9px] leading-tight opacity-70">{opt.desc}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {result && (
            <div className={`text-sm px-3 py-2 rounded-md border ${
              result.ok
                ? "bg-green-500/10 border-green-500/30 text-green-400"
                : "bg-red-500/10 border-red-500/30 text-red-400"
            }`}>
              {result.message}
            </div>
          )}

          <Button
            onClick={handleSetPlan}
            disabled={loading || !targetEmail.trim()}
            className="w-full gap-2"
          >
            {loading ? "Updating..." : `Set plan to ${selectedPlan}`}
          </Button>
        </div>
      </Card>

      {/* HapticAI Releases */}
      <Card className="border-border/40 bg-card/60">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <Upload className="h-4 w-4 text-primary" />
              HapticAI Releases
            </CardTitle>
            <Button variant="ghost" size="sm" onClick={refreshReleases} disabled={releasesLoading} className="h-7 w-7 p-0">
              <RefreshCw className={`h-3.5 w-3.5 ${releasesLoading ? "animate-spin" : ""}`} />
            </Button>
          </div>
          <CardDescription>Current uploads per platform and upload history.</CardDescription>
        </CardHeader>

        <div className="px-6 pb-4">
          {releasesError && (
            <p className="text-sm text-red-400 py-2">{releasesError}</p>
          )}
          {!releasesError && releases.length === 0 && !releasesLoading && (
            <p className="text-sm text-muted-foreground py-2 text-center">No releases uploaded yet.</p>
          )}
          {releases.length > 0 && (
            <div className="rounded-lg border border-border/50 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/40 bg-muted/20">
                    <th className="text-left px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Platform</th>
                    <th className="text-left px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Version</th>
                    <th className="text-left px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Size</th>
                    <th className="text-left px-3 py-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Uploaded</th>
                  </tr>
                </thead>
                <tbody>
                  {releases.map((r, i) => (
                    <tr key={r.id} className={`border-b border-border/30 last:border-0 ${i === 0 || releases[i - 1]?.platform !== r.platform ? "bg-card/40" : ""}`}>
                      <td className="px-3 py-2.5">
                        <span className="flex items-center gap-1.5 font-medium">
                          {r.platform === "windows"
                            ? <Monitor className="h-3.5 w-3.5 text-blue-400" />
                            : <Apple className="h-3.5 w-3.5 text-muted-foreground" />}
                          <span className="capitalize text-xs">{r.platform}</span>
                        </span>
                      </td>
                      <td className="px-3 py-2.5 font-mono text-xs text-foreground/90">{r.version}</td>
                      <td className="px-3 py-2.5 text-xs text-muted-foreground tabular-nums">{formatBytes(r.sizeBytes)}</td>
                      <td className="px-3 py-2.5 text-xs text-muted-foreground">
                        {new Date(r.uploadedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Upload form */}
        <div className="px-6 pb-6 space-y-4 border-t border-border/30 pt-4">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Upload New Release</p>

          {/* Platform toggle */}
          <div className="flex gap-2">
            {(["windows", "mac"] as const).map((p) => (
              <button
                key={p}
                onClick={() => { setUploadPlatform(p); setUploadFile(null); setUploadError(null); setUploadSuccess(false); setUploadProgress(null); if (fileInputRef.current) fileInputRef.current.value = ""; }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-xs font-medium transition-colors ${
                  uploadPlatform === p
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border/40 text-muted-foreground hover:border-border"
                }`}
              >
                {p === "windows" ? <Monitor className="h-3.5 w-3.5" /> : <Apple className="h-3.5 w-3.5" />}
                {p === "windows" ? "Windows (.exe)" : "macOS (.dmg)"}
              </button>
            ))}
          </div>

          {/* Version + file */}
          <div className="flex gap-3 items-start flex-wrap">
            <div className="flex-1 min-w-36 space-y-1">
              <p className="text-[11px] font-medium text-muted-foreground">Version <span className="text-destructive">*</span></p>
              <Input
                placeholder="e.g. v1.2.0"
                value={uploadVersion}
                onChange={(e) => setUploadVersion(e.target.value)}
                className="h-9 text-sm font-mono"
              />
            </div>
            <div className="flex-1 min-w-48 space-y-1">
              <p className="text-[11px] font-medium text-muted-foreground">File <span className="text-destructive">*</span></p>
              <input
                ref={fileInputRef}
                type="file"
                accept={uploadPlatform === "windows" ? ".exe" : ".dmg"}
                onChange={(e) => { setUploadFile(e.target.files?.[0] ?? null); setUploadError(null); setUploadSuccess(false); setUploadProgress(null); }}
                className="block w-full text-xs text-muted-foreground file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border file:border-border/60 file:bg-muted/30 file:text-xs file:font-medium file:text-foreground hover:file:bg-muted/60 file:cursor-pointer cursor-pointer pt-1.5"
              />
              {uploadFile && (
                <p className="text-[10px] text-muted-foreground">{uploadFile.name} · {formatBytes(uploadFile.size)}</p>
              )}
            </div>
          </div>
          {(!uploadFile || !uploadVersion.trim()) && (
            <p className="text-[11px] text-muted-foreground">
              {!uploadVersion.trim() && !uploadFile
                ? "Enter a version number and choose a file to enable upload."
                : !uploadVersion.trim()
                  ? "Enter a version number (e.g. v1.2.0) to enable upload."
                  : "Choose a file to enable upload."}
            </p>
          )}

          {/* Progress bar */}
          {uploadProgress !== null && (
            <div className="space-y-1">
              <div className="h-2 rounded-full bg-muted/40 overflow-hidden">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-200"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
              <p className="text-[10px] text-muted-foreground text-right">{uploadProgress}%</p>
            </div>
          )}

          {/* Status messages */}
          {uploadError && (
            <div className="text-sm px-3 py-2 rounded-md border bg-red-500/10 border-red-500/30 text-red-400">
              {uploadError}
            </div>
          )}
          {uploadSuccess && (
            <div className="text-sm px-3 py-2 rounded-md border bg-green-500/10 border-green-500/30 text-green-400 flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              Release uploaded successfully.
            </div>
          )}

          <Button
            onClick={handleUpload}
            disabled={!uploadFile || !uploadVersion.trim() || uploadProgress !== null}
            className="w-full gap-2"
          >
            <Upload className="h-4 w-4" />
            {uploadProgress !== null && uploadProgress < 100 ? `Uploading… ${uploadProgress}%` : "Upload Release"}
          </Button>
        </div>
      </Card>

      {/* Feedback */}
      <Card className="border-border/40 bg-card/60">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <MessageSquare className="h-4 w-4 text-primary" />
              User Feedback
              <span className="text-xs font-normal text-muted-foreground ml-1">
                {feedbackFilter === "all"
                  ? `(${feedbackTotal})`
                  : `(${feedbackList.length} of ${feedbackTotal})`}
              </span>
            </CardTitle>
            <Button variant="ghost" size="sm" onClick={refreshFeedback} disabled={feedbackLoading} className="h-7 w-7 p-0">
              <RefreshCw className={`h-3.5 w-3.5 ${feedbackLoading ? "animate-spin" : ""}`} />
            </Button>
          </div>
          <CardDescription>All submitted feedback, newest first.</CardDescription>
        </CardHeader>
        <div className="px-6 pb-2">
          <div className="flex gap-1.5 flex-wrap">
            {(["all", "bug", "suggestion", "other"] as const).map((cat) => {
              const icons = { all: null, bug: Bug, suggestion: Lightbulb, other: MessageCircle };
              const labels = { all: "All", bug: "Bug", suggestion: "Suggestion", other: "Other" };
              const Icon = icons[cat];
              return (
                <button
                  key={cat}
                  onClick={() => setFeedbackFilter(cat)}
                  className={`flex items-center gap-1 text-xs py-1 px-2.5 rounded-full border transition-colors ${
                    feedbackFilter === cat
                      ? "border-primary bg-primary/10 text-primary font-semibold"
                      : "border-border/40 text-muted-foreground hover:border-border"
                  }`}
                >
                  {Icon && <Icon className="h-3 w-3" />}
                  {labels[cat]} ({feedbackCounts[cat]})
                </button>
              );
            })}
          </div>
        </div>
        <div className="px-6 pb-6">
          {feedbackError && (
            <p className="text-sm text-red-400 py-4">{feedbackError}</p>
          )}
          {!feedbackError && feedbackList.length === 0 && (
            <p className="text-sm text-muted-foreground py-4 text-center">
              {feedbackLoading ? "Loading…" : "No feedback yet."}
            </p>
          )}
          <div className="space-y-2 mt-2">
            {feedbackList.map((entry) => {
              const catIcon = { bug: Bug, suggestion: Lightbulb, other: MessageCircle }[entry.category];
              const CatIcon = catIcon;
              const catColor = { bug: "text-red-400", suggestion: "text-yellow-400", other: "text-blue-400" }[entry.category];
              const catBg = { bug: "bg-red-500/10 border-red-500/20", suggestion: "bg-yellow-500/10 border-yellow-500/20", other: "bg-blue-500/10 border-blue-500/20" }[entry.category];
              return (
                <div key={entry.id} className={`rounded-lg border p-3 text-sm space-y-1.5 ${catBg}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className={`flex items-center gap-1 text-xs font-semibold capitalize ${catColor}`}>
                      <CatIcon className="h-3 w-3" />
                      {entry.category}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {entry.user_email ?? "anonymous"} · {new Date(entry.created_at).toLocaleDateString()}
                    </span>
                  </div>
                  <p className="text-foreground/90 whitespace-pre-wrap leading-snug">{entry.message}</p>
                </div>
              );
            })}
          </div>
        </div>
      </Card>
    </div>
  );
}
