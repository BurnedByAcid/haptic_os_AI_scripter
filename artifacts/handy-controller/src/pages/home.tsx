import { useHandy } from "@/hooks/use-handy";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Link } from "wouter";
import { Activity, Gamepad2, Library, Mic, PlaySquare, Settings2, Sparkles, Users } from "lucide-react";

const ALL_CARDS = [
  { href: "/player",    label: "Video Player",   desc: "Sync local videos with scripts",        icon: PlaySquare, comingSoon: false },
  { href: "/control",   label: "Manual Control", desc: "Direct slider control",                  icon: Settings2,  comingSoon: false },
  { href: "/library",   label: "Library",        desc: "Manage your local files",                icon: Library,    comingSoon: false },
  { href: "/scripter",  label: "Scripter",       desc: "Create and edit Funscripts",             icon: Mic,        comingSoon: false },
  { href: "/games",     label: "Games",          desc: "Play games with haptic feedback",        icon: Gamepad2,   comingSoon: true  },
  { href: "/beat",      label: "Live Audio",     desc: "Audio-reactive haptics",                 icon: Activity,   comingSoon: true  },
  { href: "/ai",        label: "AI Control",     desc: "Voice-controlled interactive sessions",  icon: Sparkles,   comingSoon: true  },
  { href: "/community", label: "Community",      desc: "Share and discover Funscripts",          icon: Users,      comingSoon: true  },
];

export default function Home() {
  const { connected, checking } = useHandy();

  return (
    <TooltipProvider delayDuration={200}>
      <div className="p-8 max-w-5xl mx-auto space-y-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight mb-2">Dashboard</h1>
          <p className="text-muted-foreground">Welcome to the Handy Control Hub.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card className="md:col-span-2 border-primary/20 bg-card/50 backdrop-blur">
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

          <Card className="bg-card/50 backdrop-blur">
            <CardHeader>
              <CardTitle>Quick Stats</CardTitle>
            </CardHeader>
            <div className="px-6 pb-6 space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground text-sm">Library Items</span>
                <span className="font-mono font-bold text-primary">0</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground text-sm">AI Credits</span>
                <span className="font-mono font-bold text-primary">{localStorage.getItem("handy_ai_credits") || "10"}</span>
              </div>
            </div>
          </Card>
        </div>

        {/* All feature cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {ALL_CARDS.map(item => {
            const Icon = item.icon;

            const cardEl = (
              <Card className={`h-full transition-colors bg-card/50 ${
                item.comingSoon
                  ? "opacity-50 grayscale cursor-not-allowed border-border/30"
                  : "cursor-pointer hover:border-primary/50 hover:bg-card/80 group"
              }`}>
                <CardHeader>
                  <Icon className={`h-8 w-8 mb-2 ${item.comingSoon ? "text-muted-foreground" : "text-primary group-hover:scale-110 transition-transform"}`} />
                  <CardTitle className="text-lg">{item.label}</CardTitle>
                  <CardDescription>{item.desc}</CardDescription>
                </CardHeader>
              </Card>
            );

            if (item.comingSoon) {
              return (
                <Tooltip key={item.href}>
                  <TooltipTrigger asChild>
                    <div>{cardEl}</div>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    <p>Coming Soon</p>
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
    </TooltipProvider>
  );
}
