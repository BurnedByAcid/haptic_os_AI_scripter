import { Link, useLocation } from "wouter";
import { useHandy } from "@/hooks/use-handy";
import { Activity, ChevronLeft, ChevronRight, Gamepad2, Home, Library, Mic, PlaySquare, Settings2, Sparkles, LogIn, LogOut, User, Users } from "lucide-react";
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

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { key, updateKey, connected, checking, battery } = useHandy();
  const [inputKey, setInputKey] = useState(key);
  const { toast } = useToast();
  const { user } = useUser();
  const { signOut, openSignIn } = useClerk();
  const [collapsed, setCollapsed] = useState(false);

  const handleSaveKey = () => {
    updateKey(inputKey);
    toast({ title: "Key updated", description: "Attempting to connect to Handy..." });
  };

  return (
    <div className="flex h-screen w-full bg-background text-foreground overflow-hidden">
      {/* Sidebar */}
      <div
        className={`${collapsed ? "w-14" : "w-64"} border-r border-border bg-card flex flex-col flex-shrink-0 transition-[width] duration-200 ease-in-out overflow-hidden`}
      >
        {/* Header */}
        <div className={`border-b border-border flex-shrink-0 ${collapsed ? "p-2" : "p-4"}`}>
          {collapsed ? (
            <div className="flex flex-col items-center gap-3">
              {/* Connection dot */}
              <div
                className={`h-3 w-3 rounded-full flex-shrink-0 ${
                  checking ? "bg-yellow-500 animate-pulse" :
                  connected ? "bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]" :
                  "bg-red-500"
                }`}
                title={checking ? "Checking..." : connected ? `Connected${battery !== undefined ? ` · ${battery}% battery` : ""}` : "Disconnected"}
              />
              {/* Expand button */}
              <button
                className="h-7 w-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                onClick={() => setCollapsed(false)}
                title="Expand sidebar"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between mb-4">
                <h1 className="text-xl font-bold tracking-tight text-primary whitespace-nowrap">HANDY<span className="text-foreground">CTRL</span></h1>
                <div className="flex items-center gap-2">
                  {battery !== undefined && connected && (
                    <span className="text-xs font-mono text-muted-foreground">{battery}%</span>
                  )}
                  <div
                    className={`h-3 w-3 rounded-full flex-shrink-0 ${
                      checking ? "bg-yellow-500 animate-pulse" :
                      connected ? "bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]" :
                      "bg-red-500"
                    }`}
                    title={checking ? "Checking..." : connected ? `Connected${battery !== undefined ? ` · ${battery}% battery` : ""}` : "Disconnected"}
                  />
                  {/* Collapse button */}
                  <button
                    className="h-6 w-6 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                    onClick={() => setCollapsed(true)}
                    title="Collapse sidebar"
                  >
                    <ChevronLeft size={15} />
                  </button>
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
            </>
          )}
        </div>

        {/* Nav */}
        <div className="flex-1 overflow-y-auto py-3">
          <nav className={`space-y-0.5 ${collapsed ? "px-1.5" : "px-2"}`}>
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = location === item.href;
              return (
                <Link key={item.href} href={item.href}>
                  <div
                    className={`flex items-center gap-3 rounded-md cursor-pointer transition-colors ${
                      collapsed ? "justify-center px-0 py-2.5" : "px-3 py-2.5"
                    } ${
                      isActive
                        ? "bg-primary/10 text-primary font-medium"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    }`}
                    title={collapsed ? item.label : undefined}
                    data-testid={`link-${item.label.toLowerCase().replace(/\s+/g, '-')}`}
                  >
                    <Icon size={18} className="flex-shrink-0" />
                    {!collapsed && <span className="text-sm">{item.label}</span>}
                  </div>
                </Link>
              );
            })}

            {/* Coming Soon group */}
            <div className={`mt-2 rounded-lg border border-border/40 bg-white/[0.04] space-y-0.5 ${collapsed ? "p-1" : "p-1.5"}`}>
              {COMING_SOON_ITEMS.map((item) => {
                const Icon = item.icon;
                return (
                  <div
                    key={item.href}
                    className={`group/soon relative flex items-center gap-3 rounded-md cursor-not-allowed select-none ${
                      collapsed ? "justify-center px-0 py-2.5" : "px-3 py-2.5"
                    }`}
                    title={collapsed ? `${item.label} — coming soon` : undefined}
                    data-testid={`link-${item.label.toLowerCase().replace(/\s+/g, '-')}`}
                  >
                    <Icon size={18} className="text-muted-foreground/40 flex-shrink-0" />
                    {!collapsed && <span className="text-sm text-muted-foreground/40">{item.label}</span>}
                    <div className="absolute inset-0 flex items-center justify-center rounded-md opacity-0 group-hover/soon:opacity-100 transition-opacity bg-muted/70 backdrop-blur-[2px]">
                      <span className="text-[10px] font-semibold text-foreground/70 tracking-wide">
                        {collapsed ? "Soon" : "Coming soon!"}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </nav>
        </div>

        {/* User account section */}
        <div className={`border-t border-border flex-shrink-0 ${collapsed ? "p-2" : "p-3"}`}>
          <Show when="signed-in">
            {collapsed ? (
              <div className="flex justify-center">
                {user?.imageUrl ? (
                  <img src={user.imageUrl} alt={user.fullName ?? "User"} className="h-8 w-8 rounded-full border border-border" title={user.fullName ?? user.primaryEmailAddress?.emailAddress ?? "Account"} />
                ) : (
                  <div className="h-8 w-8 rounded-full bg-primary/20 border border-primary/30 flex items-center justify-center" title="Account">
                    <User className="h-4 w-4 text-primary" />
                  </div>
                )}
              </div>
            ) : (
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
            )}
          </Show>
          <Show when="signed-out">
            {collapsed ? (
              <button
                className="w-full flex items-center justify-center h-9 text-muted-foreground hover:text-foreground transition-colors"
                onClick={() => openSignIn()}
                title="Sign In"
              >
                <LogIn className="h-4 w-4" />
              </button>
            ) : (
              <Button
                variant="outline"
                className="w-full h-9 text-sm gap-2 border-border/60 text-muted-foreground hover:text-foreground hover:border-primary/50"
                onClick={() => openSignIn()}
              >
                <LogIn className="h-4 w-4" />
                Sign In / Create Account
              </Button>
            )}
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
