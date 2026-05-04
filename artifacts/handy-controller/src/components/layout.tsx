import { Link, useLocation } from "wouter";
import { useHandy } from "@/hooks/use-handy";
import { Activity, BookMarked, ChevronLeft, ChevronRight, Crown, ExternalLink, Gamepad2, Home, Mic, PlaySquare, Settings2, Shield, LogIn, LogOut, User, Users, Pencil, ShieldCheck, Scissors } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useState, useEffect, useCallback } from "react";
import { useToast } from "@/hooks/use-toast";
import { useUser, useClerk, Show } from "@clerk/react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { PlanBadge } from "@/components/plan-badge";
import { useSubscription } from "@/hooks/use-subscription";

// ─── Supported devices ────────────────────────────────────────────────────────
// "native" devices work directly via this app's API.
// "intiface" devices need Intiface Central running locally as a WebSocket bridge.
const DEVICES = [
  {
    id: "handy",
    label: "The Handy",
    keyLabel: "Connection Key",
    placeholder: "Paste your Handy key…",
    hint: "Find your key at handyfeeling.com/my-handy",
    siteUrl: "https://www.thehandy.com",
    mode: "native" as const,
  },
  {
    id: "lovense",
    label: "Lovense",
    keyLabel: "Intiface WS URL",
    placeholder: "ws://localhost:12345",
    hint: "Requires Intiface Central + Lovense Connect",
    siteUrl: "https://www.lovense.com",
    mode: "intiface" as const,
  },
  {
    id: "kiiroo",
    label: "Kiiroo",
    keyLabel: "Intiface WS URL",
    placeholder: "ws://localhost:12345",
    hint: "Requires Intiface Central",
    siteUrl: "https://www.kiiroo.com",
    mode: "intiface" as const,
  },
  {
    id: "osr2",
    label: "OSR2 / SR6",
    keyLabel: "Intiface WS URL",
    placeholder: "ws://localhost:12345",
    hint: "Requires Intiface Central + serial port setup",
    siteUrl: "https://github.com/tyrm/osr2",
    mode: "intiface" as const,
  },
  {
    id: "keon",
    label: "Kiiroo Keon",
    keyLabel: "Intiface WS URL",
    placeholder: "ws://localhost:12345",
    hint: "Requires Intiface Central",
    siteUrl: "https://www.kiiroo.com/products/keon",
    mode: "intiface" as const,
  },
  {
    id: "intiface",
    label: "Other (Intiface)",
    keyLabel: "Intiface WS URL",
    placeholder: "ws://localhost:12345",
    hint: "Any device supported by Intiface Central",
    siteUrl: "https://intiface.com/central",
    mode: "intiface" as const,
  },
] as const;

type DeviceId = typeof DEVICES[number]["id"];

const NAV_ITEMS = [
  { href: "/",          label: "Dashboard",      icon: Home,      requiresPro: false },
  { href: "/player",    label: "Player",          icon: PlaySquare, requiresPro: false },
  { href: "/scripter",  label: "Scripter",        icon: Mic,       requiresPro: false },
  { href: "/library",   label: "My Library",      icon: BookMarked, requiresPro: false },
  { href: "/community", label: "Community",       icon: Users,     requiresPro: false },
  { href: "/control",   label: "Manual Controls", icon: Settings2, requiresPro: false },
  { href: "/games",     label: "Games",           icon: Gamepad2,  requiresPro: true  },
  { href: "/beat",      label: "Live Audio",       icon: Activity,  requiresPro: true  },
  { href: "/audio-cleaner", label: "Audio Cleaner",  icon: Scissors,  requiresPro: true  },
];

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { key, updateKey, connected, checking, battery } = useHandy();
  const [inputKey, setInputKey] = useState(key);
  const { toast } = useToast();
  const { user } = useUser();
  const { signOut, openSignIn } = useClerk();
  const [collapsed, setCollapsed] = useState(false);
  const { isAdmin, isPro, plan } = useSubscription();

  // ─── Device selector ──────────────────────────────────────────────────────
  const [deviceId, setDeviceId] = useState<DeviceId>(() =>
    (localStorage.getItem("hc_device_id") as DeviceId) ?? "handy"
  );
  const device = DEVICES.find(d => d.id === deviceId) ?? DEVICES[0];

  const handleDeviceChange = (id: string) => {
    setDeviceId(id as DeviceId);
    localStorage.setItem("hc_device_id", id);
  };

  // ─── Privacy handle ───────────────────────────────────────────────────────
  // Stored per user in localStorage. null = never asked; "" = skipped; "x" = chosen.
  const handleStorageKey = user?.id ? `hc_handle_${user.id}` : null;
  const [handle, setHandle] = useState<string>(() => {
    if (!user?.id) return "";
    return localStorage.getItem(`hc_handle_${user.id}`) ?? "";
  });
  const [handleDialogOpen, setHandleDialogOpen] = useState(false);
  const [handleInput, setHandleInput] = useState("");

  // Open the dialog the first time a user signs in (localStorage key doesn't exist yet)
  useEffect(() => {
    if (!user?.id) return;
    const stored = localStorage.getItem(`hc_handle_${user.id}`);
    if (stored === null) {
      // First time we've seen this user — prompt them
      setHandleInput("");
      setHandleDialogOpen(true);
    } else {
      setHandle(stored);
    }
  }, [user?.id]);

  const saveHandle = useCallback(() => {
    const trimmed = handleInput.trim();
    if (handleStorageKey) localStorage.setItem(handleStorageKey, trimmed);
    setHandle(trimmed);
    setHandleDialogOpen(false);
    if (trimmed) toast({ title: "Handle saved", description: `You'll appear as "${trimmed}"` });
  }, [handleInput, handleStorageKey, toast]);

  const skipHandle = useCallback(() => {
    if (handleStorageKey) localStorage.setItem(handleStorageKey, "");
    setHandle("");
    setHandleDialogOpen(false);
  }, [handleStorageKey]);

  // Display name shown in the sidebar
  const displayName = handle || user?.fullName || user?.primaryEmailAddress?.emailAddress || "Account";
  const displaySub  = handle ? "private handle" : (user?.primaryEmailAddress?.emailAddress ?? "");

  const handleSaveKey = () => {
    // updateKey() persists the key and runs a bounded retry burst. If all
    // attempts fail it stops silently (no toast) per product requirement —
    // the sidebar status dot already reflects connection state.
    updateKey(inputKey);
  };

  const emblemGlowState = checking ? "checking" : connected ? "connected" : "disconnected";

  const EmblemGlow = ({ className = "" }: { className?: string }) => (
    <div className={`emblem-glow-wrap h-8 w-8 flex-shrink-0 ${className}`}>
      <img
        src="/hapticos-logo.jpg"
        alt="HapticOS"
        className={`h-8 w-8 rounded-full emblem-glow-layer emblem-glow-layer--disconnected${emblemGlowState === "disconnected" ? " emblem-glow-layer--active" : ""}`}
      />
      <img
        src="/hapticos-logo.jpg"
        alt=""
        aria-hidden="true"
        className={`h-8 w-8 rounded-full emblem-glow-layer emblem-glow-layer--checking${emblemGlowState === "checking" ? " emblem-glow-layer--active" : ""}`}
      />
      <img
        src="/hapticos-logo.jpg"
        alt=""
        aria-hidden="true"
        className={`h-8 w-8 rounded-full emblem-glow-layer emblem-glow-layer--connected${emblemGlowState === "connected" ? " emblem-glow-layer--active" : ""}`}
      />
    </div>
  );

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
              {/* Purple Fusion icon */}
              <EmblemGlow />
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
                <div className="flex items-center gap-2.5">
                  <EmblemGlow />
                  <h1 className="text-xl font-bold tracking-tight whitespace-nowrap">
                    <span className="text-[#C850F0]">Haptic</span><span className="text-white">OS</span>
                  </h1>
                </div>
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
                {/* Device selector */}
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Device</label>
                  <a
                    href={device.siteUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-0.5 text-[10px] text-primary/70 hover:text-primary transition-colors"
                    title={`${device.label} website`}
                  >
                    <ExternalLink size={10} />
                    <span>site</span>
                  </a>
                </div>
                <select
                  value={deviceId}
                  onChange={e => handleDeviceChange(e.target.value)}
                  className="w-full h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  data-testid="select-device"
                >
                  {DEVICES.map(d => (
                    <option key={d.id} value={d.id}>{d.label}</option>
                  ))}
                </select>

                {/* Dynamic connection key label + input */}
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{device.keyLabel}</label>
                <div className="flex gap-2">
                  <Input
                    type="password"
                    value={inputKey}
                    onChange={e => setInputKey(e.target.value)}
                    placeholder={device.placeholder}
                    className="h-8 text-xs font-mono"
                    data-testid="input-connection-key"
                  />
                  <Button size="sm" onClick={handleSaveKey} className="h-8 px-3" data-testid="button-save-key">
                    Save
                  </Button>
                </div>
                <p className="text-[10px] text-muted-foreground leading-snug">{device.hint}</p>
                {device.mode === "intiface" && (
                  <a
                    href="https://intiface.com/central"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-[10px] text-primary/80 hover:text-primary transition-colors"
                  >
                    <ExternalLink size={10} />
                    Download Intiface Central
                  </a>
                )}
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
              const locked = item.requiresPro && !isPro;

              if (locked) {
                return (
                  <div
                    key={item.href}
                    className={`flex items-center gap-3 rounded-md cursor-not-allowed select-none ${
                      collapsed ? "justify-center px-0 py-2.5" : "px-3 py-2.5"
                    }`}
                    title={collapsed ? `${item.label} — subscribers only` : undefined}
                    data-testid={`link-${item.label.toLowerCase().replace(/\s+/g, '-')}`}
                  >
                    <Icon size={18} className="text-muted-foreground/35 flex-shrink-0" />
                    {!collapsed && <span className="text-sm text-muted-foreground/35">{item.label}</span>}
                  </div>
                );
              }

              return (
                <Link key={item.href} href={item.href}>
                  <div
                    className={`flex items-center gap-3 rounded-md cursor-pointer transition-colors ${
                      collapsed ? "justify-center px-0 py-2.5" : "px-3 py-2.5"
                    } ${
                      isActive
                        ? "bg-gradient-to-r from-[#A855F7]/20 to-[#E040FB]/10 text-[#C850F0] font-medium shadow-[inset_0_0_0_1px_rgba(168,85,247,0.2)]"
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

            {/* Upgrade + Admin links */}
            {user && (
              <>
                {!isPro && (
                  <Link href="/upgrade">
                    <div
                      className={`flex items-center gap-3 rounded-md cursor-pointer transition-colors mt-1 ${
                        collapsed ? "justify-center px-0 py-2.5" : "px-3 py-2.5"
                      } ${
                        location === "/upgrade"
                          ? "bg-gradient-to-r from-[#A855F7]/20 to-[#E040FB]/10 text-[#C850F0] font-medium shadow-[inset_0_0_0_1px_rgba(168,85,247,0.2)]"
                          : "text-primary/70 hover:bg-primary/10 hover:text-primary"
                      }`}
                      title={collapsed ? "Upgrade to Pro" : undefined}
                    >
                      <Crown size={18} className="flex-shrink-0" />
                      {!collapsed && <span className="text-sm font-medium">Upgrade to Pro</span>}
                    </div>
                  </Link>
                )}
                {isAdmin && (
                  <Link href="/admin">
                    <div
                      className={`flex items-center gap-3 rounded-md cursor-pointer transition-colors ${
                        collapsed ? "justify-center px-0 py-2.5" : "px-3 py-2.5"
                      } ${
                        location === "/admin"
                          ? "bg-yellow-500/10 text-yellow-400 font-medium"
                          : "text-yellow-500/60 hover:bg-yellow-500/10 hover:text-yellow-400"
                      }`}
                      title={collapsed ? "Admin Panel" : undefined}
                    >
                      <Shield size={18} className="flex-shrink-0" />
                      {!collapsed && <span className="text-sm">Admin Panel</span>}
                    </div>
                  </Link>
                )}
              </>
            )}
          </nav>
        </div>

        {/* User account section */}
        <div className={`border-t border-border flex-shrink-0 ${collapsed ? "p-2" : "p-3"}`}>
          <Show when="signed-in">
            {collapsed ? (
              <div className="flex flex-col items-center gap-1">
                {user?.imageUrl ? (
                  <img src={user.imageUrl} alt="Account" className="h-8 w-8 rounded-full border border-border" title={displayName} />
                ) : (
                  <div className="h-8 w-8 rounded-full bg-primary/20 border border-primary/30 flex items-center justify-center" title={displayName}>
                    <User className="h-4 w-4 text-primary" />
                  </div>
                )}
                <PlanBadge collapsed />
                <button
                  onClick={() => { setHandleInput(handle); setHandleDialogOpen(true); }}
                  className="h-5 w-5 flex items-center justify-center text-muted-foreground/50 hover:text-muted-foreground transition-colors"
                  title="Change handle"
                >
                  <Pencil className="h-3 w-3" />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2 px-1 py-1 rounded-md">
                {user?.imageUrl ? (
                  <img src={user.imageUrl} alt="Account" className="h-8 w-8 rounded-full border border-border flex-shrink-0" />
                ) : (
                  <div className="h-8 w-8 rounded-full bg-primary/20 border border-primary/30 flex items-center justify-center flex-shrink-0">
                    <User className="h-4 w-4 text-primary" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className="text-xs font-medium text-foreground truncate">{displayName}</p>
                    <PlanBadge />
                  </div>
                  <p className="text-[10px] text-muted-foreground truncate">{displaySub}</p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-muted-foreground/50 hover:text-muted-foreground flex-shrink-0"
                  onClick={() => { setHandleInput(handle); setHandleDialogOpen(true); }}
                  title="Change privacy handle"
                >
                  <Pencil className="h-3 w-3" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-muted-foreground hover:text-foreground flex-shrink-0"
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

      {/* Privacy handle dialog — shown once on first sign-in */}
      <Dialog open={handleDialogOpen} onOpenChange={setHandleDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-primary" />
              Keep your identity private
            </DialogTitle>
            <DialogDescription className="text-sm leading-relaxed">
              Your real name and email are never shown to other users. You can
              choose a handle — a nickname that appears in your place — or skip
              to use the app without one.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Preferred handle (optional)
            </label>
            <Input
              placeholder="e.g. NightOwl, CoolUser99…"
              value={handleInput}
              onChange={e => setHandleInput(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") saveHandle(); }}
              autoFocus
              maxLength={32}
            />
            <p className="text-[11px] text-muted-foreground">
              You can change this any time via the pencil icon in the sidebar.
            </p>
          </div>

          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="ghost" onClick={skipHandle} className="sm:order-first">
              Skip for now
            </Button>
            <Button onClick={saveHandle} disabled={!handleInput.trim()}>
              Save handle
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
