import { useState } from "react";
import { Crown, Check, Zap, Lock, ShieldCheck, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useSubscription } from "@/hooks/use-subscription";
import { useAuth } from "@clerk/react";
import { useToast } from "@/hooks/use-toast";

const FREE_FEATURES = [
  "Video Player with Funscript sync",
  "Basic device control",
  "Local script library",
  "Script editor (Scripter)",
];

const PRO_FEATURES = [
  "Everything in Free",
  "Games with haptic feedback",
  "Live Audio reactive haptics",
  "AI-powered control sessions",
  "Community sharing & discovery",
  "Priority support",
  "Early access to new features",
];

const API_BASE = import.meta.env.VITE_API_URL ?? "";

export default function Upgrade() {
  const { plan } = useSubscription();
  const { getToken } = useAuth();
  const { toast } = useToast();
  const [bootstrapping, setBootstrapping] = useState(false);

  const claimAdmin = async () => {
    setBootstrapping(true);
    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/api/admin/bootstrap`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json() as { message?: string; error?: string };
      if (res.ok) {
        toast({ title: "Admin access granted!", description: "Reloading your session…" });
        // Hard reload so Clerk fetches fresh publicMetadata from the server
        window.location.href = "/";
      } else {
        toast({
          title: "Could not claim admin",
          description: data.error ?? "Unknown error",
          variant: "destructive",
        });
      }
    } catch (e) {
      toast({ title: "Error", description: String(e), variant: "destructive" });
    } finally {
      setBootstrapping(false);
    }
  };

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-8">
      <div className="text-center space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Choose your plan</h1>
        <p className="text-muted-foreground">
          {plan === "free"
            ? "Unlock the full Handy Controller experience with Pro."
            : plan === "pro"
            ? "You're already on Pro — enjoy all features!"
            : "Admin account — all features unlocked."}
        </p>
      </div>

      {/* First-time admin bootstrap — visible only for free users */}
      {plan === "free" && (
        <Card className="border-yellow-500/30 bg-yellow-500/5 max-w-2xl mx-auto">
          <CardHeader>
            <div className="flex items-start gap-3">
              <div className="h-9 w-9 rounded-full bg-yellow-500/10 border border-yellow-500/30 flex items-center justify-center flex-shrink-0 mt-0.5">
                <ShieldCheck className="h-5 w-5 text-yellow-400" />
              </div>
              <div className="flex-1 min-w-0">
                <CardTitle className="text-base text-yellow-300">First-time setup — claim admin access</CardTitle>
                <CardDescription className="text-xs mt-1 leading-relaxed">
                  If no admin account exists yet, you can claim it right now. This unlocks every
                  feature and lets you manage other users' plans from the Admin Panel. Only works
                  once — the first person to click gets it.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <div className="px-6 pb-5">
            <Button
              onClick={claimAdmin}
              disabled={bootstrapping}
              className="gap-2 bg-yellow-500/20 hover:bg-yellow-500/30 text-yellow-300 border border-yellow-500/30 hover:border-yellow-500/50"
              variant="outline"
            >
              {bootstrapping
                ? <><Loader2 className="h-4 w-4 animate-spin" /> Claiming…</>
                : <><ShieldCheck className="h-4 w-4" /> Claim Admin Access</>}
            </Button>
          </div>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-2xl mx-auto">
        {/* Free tier */}
        <Card className={`bg-card/50 border-border/60 ${plan === "free" ? "ring-1 ring-border" : ""}`}>
          <CardHeader>
            <div className="flex items-center gap-2 mb-2">
              <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center">
                <Zap className="h-4 w-4 text-muted-foreground" />
              </div>
              <div>
                <CardTitle className="text-lg">Free</CardTitle>
                <CardDescription className="text-xs">Get started, no card needed</CardDescription>
              </div>
              {plan === "free" && (
                <span className="ml-auto text-[10px] font-semibold px-2 py-0.5 rounded-full bg-muted text-muted-foreground border border-border/60">
                  Current
                </span>
              )}
            </div>
            <p className="text-2xl font-bold">$0 <span className="text-sm font-normal text-muted-foreground">/mo</span></p>
          </CardHeader>
          <div className="px-6 pb-6 space-y-2">
            {FREE_FEATURES.map(f => (
              <div key={f} className="flex items-start gap-2 text-sm text-muted-foreground">
                <Check className="h-4 w-4 text-green-500 flex-shrink-0 mt-0.5" />
                {f}
              </div>
            ))}
            <div className="pt-2">
              <Button variant="outline" className="w-full" disabled>
                {plan === "free" ? "Current plan" : "Downgrade"}
              </Button>
            </div>
          </div>
        </Card>

        {/* Pro tier */}
        <Card className={`relative bg-card/50 border-primary/30 ${plan === "pro" || plan === "admin" ? "ring-1 ring-primary/50" : ""}`}>
          <div className="absolute -top-3 left-1/2 -translate-x-1/2">
            <span className="text-[10px] font-bold px-3 py-1 rounded-full bg-primary text-black tracking-wide uppercase">
              Recommended
            </span>
          </div>
          <CardHeader className="pt-6">
            <div className="flex items-center gap-2 mb-2">
              <div className="h-8 w-8 rounded-full bg-primary/10 border border-primary/30 flex items-center justify-center">
                <Crown className="h-4 w-4 text-primary" />
              </div>
              <div>
                <CardTitle className="text-lg text-primary">Pro</CardTitle>
                <CardDescription className="text-xs">Full access, no limits</CardDescription>
              </div>
              {(plan === "pro" || plan === "admin") && (
                <span className="ml-auto text-[10px] font-semibold px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/30">
                  Active
                </span>
              )}
            </div>
            <p className="text-2xl font-bold text-primary">
              TBD <span className="text-sm font-normal text-muted-foreground">/mo</span>
            </p>
          </CardHeader>
          <div className="px-6 pb-6 space-y-2">
            {PRO_FEATURES.map(f => (
              <div key={f} className="flex items-start gap-2 text-sm">
                <Check className="h-4 w-4 text-primary flex-shrink-0 mt-0.5" />
                {f}
              </div>
            ))}
            <div className="pt-2">
              {plan === "pro" || plan === "admin" ? (
                <Button className="w-full" disabled>
                  <Crown className="h-4 w-4 mr-1.5" />
                  Already subscribed
                </Button>
              ) : (
                <Button className="w-full gap-1.5" disabled>
                  <Lock className="h-4 w-4" />
                  Coming soon — payment not yet set up
                </Button>
              )}
            </div>
          </div>
        </Card>
      </div>

      <p className="text-center text-xs text-muted-foreground">
        Payment processing will be available soon. Your plan can be updated by an admin in the meantime.
      </p>
    </div>
  );
}
