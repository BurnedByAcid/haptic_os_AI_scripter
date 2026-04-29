import { useHandy } from "@/hooks/use-handy";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Link } from "wouter";
import { Activity, Gamepad2, Library, PlaySquare, Settings2, Sparkles } from "lucide-react";

export default function Home() {
  const { connected, checking } = useHandy();

  return (
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
          <CardContent>
            <div className="flex items-center gap-4">
              <div className={`h-16 w-16 rounded-full flex items-center justify-center ${
                checking ? "bg-yellow-500/20 text-yellow-500" :
                connected ? "bg-green-500/20 text-green-500 shadow-[0_0_30px_rgba(34,197,94,0.2)]" : 
                "bg-red-500/20 text-red-500"
              }`}>
                {checking ? (
                  <Activity className="h-8 w-8 animate-pulse" />
                ) : connected ? (
                  <Activity className="h-8 w-8" />
                ) : (
                  <Activity className="h-8 w-8 opacity-50" />
                )}
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
          </CardContent>
        </Card>

        <Card className="bg-card/50 backdrop-blur">
          <CardHeader>
            <CardTitle>Quick Stats</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground text-sm">Library Items</span>
              <span className="font-mono font-bold text-primary">0</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground text-sm">AI Credits</span>
              <span className="font-mono font-bold text-primary">{localStorage.getItem("handy_ai_credits") || "10"}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {[
          { href: "/player", label: "Video Player", desc: "Sync local videos with scripts", icon: PlaySquare },
          { href: "/control", label: "Manual Control", desc: "Direct slider control", icon: Settings2 },
          { href: "/games", label: "Fappy Bird", desc: "Play games with haptic feedback", icon: Gamepad2 },
          { href: "/beat", label: "Beat 2 Beat", desc: "Audio-reactive haptics", icon: Activity },
          { href: "/library", label: "Library", desc: "Manage your local files", icon: Library },
          { href: "/ai", label: "AI Control", desc: "Voice-controlled interactive sessions", icon: Sparkles },
        ].map(item => {
          const Icon = item.icon;
          return (
            <Link key={item.href} href={item.href}>
              <Card className="cursor-pointer hover:border-primary/50 transition-colors bg-card/50 hover:bg-card/80 group">
                <CardHeader>
                  <Icon className="h-8 w-8 text-primary mb-2 group-hover:scale-110 transition-transform" />
                  <CardTitle className="text-lg">{item.label}</CardTitle>
                  <CardDescription>{item.desc}</CardDescription>
                </CardHeader>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
