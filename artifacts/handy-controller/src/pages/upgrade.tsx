import { useState, useEffect } from "react";
import { Crown, Check, Zap, Loader2, Settings, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useSubscription } from "@/hooks/use-subscription";
import { useAuth } from "@clerk/react";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";

const FREE_FEATURES = [
  "Video Player with Funscript sync",
  "Basic device control",
  "Local file library",
  "Script editor (Scripter) — 1 auto-generation per 23 hours",
];

const SUBSCRIBER_FEATURES = [
  "Everything in Free",
  "Unlimited Scripter auto-generation",
  "Games with haptic feedback",
  "Live Audio reactive haptics",
  "AI-powered control sessions",
  "Community sharing & discovery",
  "Priority support",
  "Early access to new features",
];

const API_BASE = import.meta.env.VITE_API_URL ?? "";
const FALLBACK_PRICE = "$9.99";

export default function Upgrade() {
  const { plan } = useSubscription();
  const { getToken } = useAuth();
  const { toast } = useToast();
  const [location] = useLocation();
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [portalLoading, setPortalLoading] = useState(false);
  const [displayPrice, setDisplayPrice] = useState<string | null>(null);
  const [priceInterval, setPriceInterval] = useState<string>("mo");

  useEffect(() => {
    fetch(`${API_BASE}/api/billing/price`)
      .then(r => r.ok ? r.json() : Promise.reject(r))
      .then((data: { formatted?: string; interval?: string }) => {
        setDisplayPrice(data.formatted ?? FALLBACK_PRICE);
        if (data.interval) {
          const intervalMap: Record<string, string> = { month: "mo", year: "yr", week: "wk", day: "day" };
          setPriceInterval(intervalMap[data.interval] ?? data.interval);
        }
      })
      .catch(() => {
        setDisplayPrice(FALLBACK_PRICE);
      });
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("success") === "1") {
      toast({
        title: "Subscription activated!",
        description: "Welcome to Subscriber. Reload the page if features don't appear yet.",
      });
    } else if (params.get("canceled") === "1") {
      toast({
        title: "Checkout canceled",
        description: "You can subscribe any time from this page.",
        variant: "destructive",
      });
    }
  }, [location]);

  const handleSubscribe = async () => {
    setCheckoutLoading(true);
    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/api/billing/checkout`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      });
      const data = await res.json() as { url?: string; error?: string };
      if (!res.ok || !data.url) {
        toast({
          title: "Checkout failed",
          description: data.error ?? "Could not open checkout",
          variant: "destructive",
        });
        return;
      }
      window.location.href = data.url;
    } catch (e) {
      toast({ title: "Error", description: String(e), variant: "destructive" });
    } finally {
      setCheckoutLoading(false);
    }
  };

  const handleManageSubscription = async () => {
    setPortalLoading(true);
    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/api/billing/portal`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      });
      const data = await res.json() as { url?: string; error?: string };
      if (!res.ok || !data.url) {
        toast({
          title: "Portal failed",
          description: data.error ?? "Could not open subscription portal",
          variant: "destructive",
        });
        return;
      }
      window.location.href = data.url;
    } catch (e) {
      toast({ title: "Error", description: String(e), variant: "destructive" });
    } finally {
      setPortalLoading(false);
    }
  };

  const isSubscriber = plan === "subscriber";
  const isPaidOrAdmin = plan === "pro" || plan === "admin" || plan === "subscriber";

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-8">
      <div className="text-center space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Choose your plan</h1>
        <p className="text-muted-foreground">
          {plan === "free"
            ? "Unlock the full HapticOS experience with a subscription."
            : plan === "subscriber"
            ? "You're subscribed — enjoy full access!"
            : plan === "pro"
            ? "You're on Pro — all features unlocked."
            : "Admin account — all features unlocked."}
        </p>
      </div>

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

        {/* Subscriber tier */}
        <Card className={`relative bg-card/50 border-primary/30 ${isPaidOrAdmin ? "ring-1 ring-primary/50" : ""}`}>
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
                <CardTitle className="text-lg text-primary">Subscriber</CardTitle>
                <CardDescription className="text-xs">Full access, no limits</CardDescription>
              </div>
              {isPaidOrAdmin && (
                <span className="ml-auto text-[10px] font-semibold px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/30">
                  Active
                </span>
              )}
            </div>
            <p className="text-2xl font-bold text-primary">
              {displayPrice ?? <span className="inline-block w-12 h-5 rounded bg-primary/10 animate-pulse align-middle" />}{" "}
              <span className="text-sm font-normal text-muted-foreground">/{priceInterval}</span>
            </p>
          </CardHeader>
          <div className="px-6 pb-6 space-y-2">
            {SUBSCRIBER_FEATURES.map(f => (
              <div key={f} className="flex items-start gap-2 text-sm">
                <Check className="h-4 w-4 text-primary flex-shrink-0 mt-0.5" />
                {f}
              </div>
            ))}
            <div className="pt-2 space-y-2">
              {isPaidOrAdmin ? (
                <>
                  <Button className="w-full" disabled>
                    <Crown className="h-4 w-4 mr-1.5" />
                    {plan === "admin" ? "Admin — all features" : "Already subscribed"}
                  </Button>
                  {isSubscriber && (
                    <Button
                      variant="outline"
                      className="w-full gap-1.5"
                      onClick={handleManageSubscription}
                      disabled={portalLoading}
                    >
                      {portalLoading
                        ? <><Loader2 className="h-4 w-4 animate-spin" /> Opening…</>
                        : <><Settings className="h-4 w-4" /> Manage Subscription</>}
                    </Button>
                  )}
                </>
              ) : (
                <Button
                  className="w-full gap-1.5"
                  onClick={handleSubscribe}
                  disabled={checkoutLoading}
                >
                  {checkoutLoading
                    ? <><Loader2 className="h-4 w-4 animate-spin" /> Opening checkout…</>
                    : <><Crown className="h-4 w-4" /> Subscribe — {displayPrice ?? "…"}/{priceInterval}</>}
                </Button>
              )}
            </div>
          </div>
        </Card>
      </div>

      <div className="flex items-center gap-2 justify-center text-xs text-muted-foreground">
        <AlertCircle className="h-3.5 w-3.5" />
        <span>Payments are processed securely via Stripe. Cancel any time from the portal.</span>
      </div>
    </div>
  );
}
