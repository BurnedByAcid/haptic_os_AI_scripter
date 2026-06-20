import { useHandy } from "@/hooks/use-handy";
import { useSubscription } from "@/hooks/use-subscription";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { Activity, Crown, Gamepad2, Library, Lock, Mic, PlaySquare, Settings2, Users } from "lucide-react";
import { useAuth } from "@clerk/react";
import { useState, useEffect } from "react";

const API_BASE = import.meta.env.VITE_API_URL ?? "";

type CardState = "available" | "premium" | "coming-soon";

const ALL_CARDS: { href: string; label: string; desc: string; icon: typeof PlaySquare; state: CardState }[] = [
  { href: "/player",    label: "Video Player",   desc: "Sync local videos with scripts",   icon: PlaySquare, state: "available" },
  { href: "/scripter",  label: "Scripter",       desc: "Create and edit Funscripts",       icon: Mic,        state: "available" },
  { href: "/library",   label: "Library",        desc: "Manage your local files",           icon: Library,    state: "available" },
  { href: "/community", label: "Community",      desc: "Share and discover Funscripts",    icon: Users,      state: "premium"   },
  { href: "/control",   label: "Manual Controls", desc: "Direct slider control",           icon: Settings2,  state: "premium"   },
  { href: "/games",     label: "Games",          desc: "Play games with haptic feedback",  icon: Gamepad2,   state: "premium"   },
  { href: "/beat",      label: "Live Audio",     desc: "Audio-reactive haptics",           icon: Activity,   state: "premium"   },
];

export default function Home() {
  const { connected, checking } = useHandy();
  const { isPro, isFree, plan, isLoaded } = useSubscription();
  const { getToken } = useAuth();
  const [scripterUsed, setScripterUsed] = useState<number | null>(null);
  const SCRIPTER_LIMIT = 1;

  useEffect(() => {
    if (!isLoaded || !isFree) return;
    (async () => {
      try {
        const token = await getToken();
        const res = await fetch(`${API_BASE}/api/usage/scripter/today`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (res.ok) {
          const data = await res.json() as { count: number };
          setScripterUsed(data.count);
        }
      } catch { /* non-fatal */ }
    })();
  }, [isLoaded, isFree, getToken]);

  return (
    <TooltipProvider delayDuration={200}>
      <div className="p-8 max-w-5xl mx-auto space-y-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight mb-2">Dashboard</h1>
          <p className="text-muted-foreground">Welcome to HapticOS.</p>
        </div>

        <Card className="border-primary/20 bg-card/50 backdrop-blur">
          <CardHeader>
            <CardTitle>Device Status</CardTitle>
            <CardDescription>Current connection state</CardDescription>
          </CardHeader>
          <div className="px-6 pb-6">
            <div className="flex items-center gap-4">
              <div className={`h-16 w-16 rounded-full flex items-center justify-center ${
                checking ? "bg-yellow-500/20 text-yellow-500" :
                connected ? "bg-green-500/20 text-green-500 shadow-[0_0_30px_rgba(34,197,94,0.2)]" :
                "bg-red-500/20 text-red-500"
              }`}>
                <Activity className={`h-8 w-8 ${checking ? "animate-pulse" : connected ? "" : "opacity-50"}`} />
              </div>
              <div>
                <h3 className="text-2xl font-bold">
                  {checking ? "Checking..." : connected ? "Online & Ready" : "Offline"}
                </h3>
                <p className="text-muted-foreground">
                  {connected
                    ? "Your device is connected and ready to receive commands."
                    : "Enter your connection key in the sidebar to connect."}
                </p>
              </div>
            </div>
          </div>
        </Card>

        {/* Scripter limit warning for free users */}
        {isFree && scripterUsed !== null && scripterUsed >= SCRIPTER_LIMIT && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 flex items-center gap-3">
            <Lock className="h-5 w-5 text-destructive flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-destructive">Scripter limit reached</p>
              <p className="text-xs text-muted-foreground">You've used all {SCRIPTER_LIMIT} free Scripter sessions today. Upgrade to get unlimited access.</p>
            </div>
            <Link href="/upgrade">
              <Button size="sm" variant="destructive" className="gap-1.5 flex-shrink-0">
                <Crown className="h-4 w-4" /> Upgrade
              </Button>
            </Link>
          </div>
        )}

        {/* All feature cards */}
        <div>
          <h2 className="text-base font-semibold text-muted-foreground mb-3 uppercase tracking-wider text-xs">Features</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {ALL_CARDS.map(item => {
              const Icon = item.icon;
              const locked = item.state === "premium" && !isPro;
              const comingSoon = item.state === "coming-soon";
              const disabled = locked || comingSoon;

              const cardEl = (
                <Card className={`h-full transition-colors bg-card/50 relative ${
                  disabled
                    ? "opacity-60 cursor-not-allowed border-border/30"
                    : "cursor-pointer hover:border-primary/50 hover:bg-card/80 group card-gradient-shimmer"
                }`}>
                  {locked && (
                    <div className="absolute top-2 right-2 h-5 w-5 rounded-full bg-primary/10 border border-primary/30 flex items-center justify-center">
                      <Lock className="h-2.5 w-2.5 text-primary" />
                    </div>
                  )}
                  <CardHeader>
                    <Icon className={`h-8 w-8 mb-2 ${disabled ? "text-muted-foreground" : "text-primary group-hover:scale-110 transition-transform"}`} />
                    <CardTitle className="text-lg">{item.label}</CardTitle>
                    <CardDescription>{item.desc}</CardDescription>
                  </CardHeader>
                </Card>
              );

              if (comingSoon) {
                return (
                  <Tooltip key={item.href}>
                    <TooltipTrigger asChild><div>{cardEl}</div></TooltipTrigger>
                    <TooltipContent side="top"><p>Coming Soon</p></TooltipContent>
                  </Tooltip>
                );
              }

              if (locked) {
                return (
                  <Tooltip key={item.href}>
                    <TooltipTrigger asChild><div>{cardEl}</div></TooltipTrigger>
                    <TooltipContent side="top" className="flex flex-col gap-1.5 p-3">
                      <p className="font-semibold text-xs flex items-center gap-1.5">
                        <Crown className="h-3.5 w-3.5 text-primary" />
                        Subscriber feature
                      </p>
                      <p className="text-[11px] text-muted-foreground">Subscribe to unlock {item.label}.</p>
                      <Link href="/upgrade">
                        <Button size="sm" className="h-6 text-[10px] px-2 gap-1 mt-0.5 w-full">
                          <Crown className="h-3 w-3" /> Upgrade
                        </Button>
                      </Link>
                    </TooltipContent>
                  </Tooltip>
                );
              }

              return (
                <Link key={item.href} href={item.href}>
                  {cardEl}
                </Link>
              );
            })}
          </div>
        </div>

        {/* Compact quick stats */}
        <div className="flex items-center gap-4 px-1">
          <span className="text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-wider whitespace-nowrap">Quick Stats</span>
          <div className="h-px flex-1 bg-border/40" />
          <div className="flex items-center gap-3">
            <span className="text-[11px] text-muted-foreground">Plan</span>
            <span className={`text-[11px] font-semibold font-mono capitalize ${
              plan === "admin"      ? "text-yellow-400" :
              plan === "pro"        ? "text-primary" :
              plan === "subscriber" ? "text-primary" :
                                      "text-muted-foreground"
            }`}>{plan}</span>
          </div>
          <div className="h-3 w-px bg-border/60" />
          <div className="flex items-center gap-3">
            <span className="text-[11px] text-muted-foreground">Library</span>
            <span className="text-[11px] font-semibold font-mono text-primary">0</span>
          </div>
          {isFree && scripterUsed !== null && (
            <>
              <div className="h-3 w-px bg-border/60" />
              <div className="flex items-center gap-3">
                <span className="text-[11px] text-muted-foreground">Scripter today</span>
                <span className={`text-[11px] font-semibold font-mono ${scripterUsed >= SCRIPTER_LIMIT ? "text-destructive" : "text-primary"}`}>
                  {scripterUsed}/{SCRIPTER_LIMIT}
                </span>
              </div>
            </>
          )}
        </div>

        {/* Upgrade CTA for free users */}
        {!isPro && (
          <div className="rounded-xl border border-primary/20 bg-primary/5 p-5 flex items-center gap-4">
            <div className="h-10 w-10 rounded-full bg-primary/10 border border-primary/30 flex items-center justify-center flex-shrink-0">
              <Crown className="h-5 w-5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold">Unlock the full experience</p>
              <p className="text-xs text-muted-foreground">Games, Live Audio, AI Control, Community sharing, and unlimited Scripter sessions.</p>
            </div>
            <Link href="/upgrade">
              <Button size="sm" className="gap-1.5 flex-shrink-0">
                <Crown className="h-4 w-4" /> View Plans
              </Button>
            </Link>
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}
