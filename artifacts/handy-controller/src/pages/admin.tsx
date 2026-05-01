import { useState } from "react";
import { Shield, Search, Crown, Zap, ShieldCheck, AlertCircle } from "lucide-react";
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

const API_BASE = import.meta.env.VITE_API_URL ?? "";

export default function Admin() {
  const { isAdmin, isLoaded } = useSubscription();
  const { getToken } = useAuth();
  const { toast } = useToast();

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
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
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

  return (
    <div className="p-8 max-w-2xl mx-auto space-y-8">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-full bg-yellow-500/10 border border-yellow-500/30 flex items-center justify-center">
          <Shield className="h-5 w-5 text-yellow-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Admin Panel</h1>
          <p className="text-muted-foreground text-sm">Manage user subscription plans</p>
        </div>
      </div>

      <Card className="bg-card/50">
        <CardHeader>
          <CardTitle className="text-base">Set User Plan</CardTitle>
          <CardDescription>Enter an email address and choose the plan to assign.</CardDescription>
        </CardHeader>
        <div className="px-6 pb-6 space-y-5">
          {/* Email input */}
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

          {/* Plan selector */}
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

          {/* Result */}
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

      <Card className="bg-card/50 border-yellow-500/10">
        <CardHeader>
          <CardTitle className="text-base text-yellow-400">How this works</CardTitle>
          <CardDescription className="text-xs leading-relaxed">
            Plans are stored in Clerk's <code className="text-primary">publicMetadata.plan</code> field
            and are read server-side — they cannot be spoofed by the client. When payment
            processing is integrated (e.g. Stripe), webhooks will update this field automatically.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
