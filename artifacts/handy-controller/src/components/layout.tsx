import { Link, useLocation } from "wouter";
import { useHandy } from "@/hooks/use-handy";
import { Activity, Gamepad2, Home, Library, Mic, PlaySquare, Settings2, Sparkles, LogIn, LogOut, User, Users } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { useUser, useClerk, Show } from "@clerk/react";

const NAV_ITEMS = [
  { href: "/", label: "Dashboard", icon: Home },
  { href: "/player", label: "Player", icon: PlaySquare },
  { href: "/control", label: "Control", icon: Settings2 },
  { href: "/library", label: "Library", icon: Library },
  { href: "/scripter", label: "Scripter", icon: Mic },
];

const COMING_SOON_ITEMS = [
  { href: "/games", label: "Games", icon: Gamepad2 },
  { href: "/beat", label: "Beat 2 Beat", icon: Activity },
  { href: "/ai", label: "AI Control", icon: Sparkles },
  { href: "/community", label: "Community", icon: Users },
];

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { key, updateKey, connected, checking, battery } = useHandy();
  const [inputKey, setInputKey] = useState(key);
  const { toast } = useToast();
  const { user } = useUser();
  const { signOut, openSignIn } = useClerk();

  const handleSaveKey = () => {
    updateKey(inputKey);
    toast({ title: "Key updated", description: "Attempting to connect to Handy..." });
  };

  return (
    <div className="flex h-screen w-full bg-background text-foreground overflow-hidden">
      {/* Sidebar */}
      <div className="w-64 border-r border-border bg-card flex flex-col flex-shrink-0">
        <div className="p-4 border-b border-border">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-xl font-bold tracking-tight text-primary">HANDY<span className="text-foreground">CTRL</span></h1>
            <div className="flex items-center gap-2">
              {battery !== undefined && connected && (
                <span className="text-xs font-mono text-muted-foreground">{battery}%</span>
              )}
              <div
                className={`h-3 w-3 rounded-full ${
                  checking ? "bg-yellow-500 animate-pulse" :
                  connected ? "bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]" :
                  "bg-red-500"
                }`}
                title={checking ? "Checking..." : connected ? `Connected${battery !== undefined ? ` · ${battery}% battery` : ""}` : "Disconnected"}
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Connection Key</label>
            <div className="flex gap-2">
              <Input
                type="password"
                value={inputKey}
                onChange={e => setInputKey(e.target.value)}
                placeholder="Key..."
                className="h-8 text-xs font-mono"
                data-testid="input-connection-key"
              />
              <Button size="sm" onClick={handleSaveKey} className="h-8 px-3" data-testid="button-save-key">
                Save
              </Button>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto py-4">
          <nav className="space-y-1 px-2">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = location === item.href;
              return (
                <Link key={item.href} href={item.href}>
                  <div
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-md cursor-pointer transition-colors ${
                      isActive
                        ? "bg-primary/10 text-primary font-medium"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    }`}
                    data-testid={`link-${item.label.toLowerCase().replace(/\s+/g, '-')}`}
                  >
                    <Icon size={18} />
                    <span className="text-sm">{item.label}</span>
                  </div>
                </Link>
              );
            })}

            {/* Coming Soon group */}
            <div className="mt-3 rounded-lg border border-border/40 bg-white/[0.04] p-1.5 space-y-0.5">
              {COMING_SOON_ITEMS.map((item) => {
                const Icon = item.icon;
                return (
                  <div
                    key={item.href}
                    className="group/soon relative flex items-center gap-3 px-3 py-2.5 rounded-md cursor-not-allowed select-none"
                    data-testid={`link-${item.label.toLowerCase().replace(/\s+/g, '-')}`}
                  >
                    <Icon size={18} className="text-muted-foreground/40" />
                    <span className="text-sm text-muted-foreground/40">{item.label}</span>
                    <div className="absolute inset-0 flex items-center justify-center rounded-md opacity-0 group-hover/soon:opacity-100 transition-opacity bg-muted/70 backdrop-blur-[2px]">
                      <span className="text-xs font-semibold text-foreground/70 tracking-wide">Coming soon!</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </nav>
        </div>

        {/* User account section at bottom of sidebar */}
        <div className="p-3 border-t border-border">
          <Show when="signed-in">
            <div className="flex items-center gap-3 px-2 py-2 rounded-md">
              {user?.imageUrl ? (
                <img src={user.imageUrl} alt={user.fullName ?? "User"} className="h-8 w-8 rounded-full border border-border flex-shrink-0" />
              ) : (
                <div className="h-8 w-8 rounded-full bg-primary/20 border border-primary/30 flex items-center justify-center flex-shrink-0">
                  <User className="h-4 w-4 text-primary" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-foreground truncate">{user?.fullName ?? user?.primaryEmailAddress?.emailAddress ?? "Account"}</p>
                <p className="text-xs text-muted-foreground truncate">{user?.primaryEmailAddress?.emailAddress}</p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-foreground flex-shrink-0"
                onClick={() => signOut()}
                title="Sign out"
              >
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          </Show>
          <Show when="signed-out">
            <Button
              variant="outline"
              className="w-full h-9 text-sm gap-2 border-border/60 text-muted-foreground hover:text-foreground hover:border-primary/50"
              onClick={() => openSignIn()}
            >
              <LogIn className="h-4 w-4" />
              Sign In / Create Account
            </Button>
          </Show>
        </div>
      </div>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden bg-background">
        <div className="flex-1 overflow-y-auto">
          {children}
        </div>
      </main>
    </div>
  );
}
