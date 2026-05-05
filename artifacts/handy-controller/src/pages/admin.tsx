import { useState, useEffect } from "react";
import {
  Shield, Search, Crown, Zap, ShieldCheck, AlertCircle,
  Users, TrendingUp, FileText, Star, Heart, Eye,
  Gamepad2, Music, Play, BookOpen, Sliders, PenLine,
  Ticket, RefreshCw, BarChart3, UserPlus,
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

export default function Admin() {
  const { isAdmin, isLoaded } = useSubscription();
  const { getToken } = useAuth();
  const { toast } = useToast();
  const { data: analytics, loading: analyticsLoading, error: analyticsError, refresh } = useAdminAnalytics(isLoaded && isAdmin);

  const [targetEmail, setTargetEmail] = useState("");
  const [selectedPlan, setSelectedPlan] = useState<Plan>("pro");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

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
    </div>
  );
}
