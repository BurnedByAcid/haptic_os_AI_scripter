import { Link, useLocation } from "wouter";
import { ToastAction } from "@/components/ui/toast";
import { useHandy } from "@/hooks/use-handy";
import { Activity, BookMarked, ChevronLeft, ChevronRight, Crown, ExternalLink, Gamepad2, Home, MessageSquare, Mic, PlaySquare, Settings2, Shield, LogIn, LogOut, User, Users, Pencil, ShieldCheck, Settings, Check, type LucideIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useState, useEffect, useCallback, useRef } from "react";
import { useToast } from "@/hooks/use-toast";
import { useUser, useClerk, Show } from "@clerk/react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { PlanBadge } from "@/components/plan-badge";
import { useSubscription } from "@/hooks/use-subscription";
import { useAppSettings, type Theme, type ScriptOutputFiletype } from "@/hooks/use-app-settings";
import { Textarea } from "@/components/ui/textarea";
import { setMode as apiSetMode } from "@/lib/handyApi";


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

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  requiresPro: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { href: "/",          label: "Dashboard",      icon: Home,      requiresPro: false },
  { href: "/player",    label: "Player",          icon: PlaySquare, requiresPro: false },
  { href: "/scripter",  label: "Scripter",        icon: Mic,       requiresPro: false },
  { href: "/library",   label: "My Library",      icon: BookMarked, requiresPro: false },
  { href: "/community", label: "Community",       icon: Users,     requiresPro: false },
  { href: "/control",   label: "Manual Controls", icon: Settings2, requiresPro: false },
  { href: "/games",     label: "Games",           icon: Gamepad2,  requiresPro: true  },
  { href: "/beat",      label: "Live Audio",       icon: Activity,  requiresPro: true  },
];

// ─── Device mode constants ─────────────────────────────────────────────────────
const MODE_HAMP = 0;
// const MODE_HDSP = 1;  // no dedicated page; no nav suggestion needed
const MODE_HSSP = 2;

const MODE_LABELS: Record<number, string> = { 0: "HAMP", 1: "HDSP", 2: "HSSP" };

/** Pages that are "wrong" when the device is in HAMP mode. */
const HAMP_MISMATCH_PAGES = new Set(["/scripter", "/player"]);

const API = import.meta.env.VITE_API_URL ?? "";

export function Layout({ children }: { children: React.ReactNode }) {
  const [location, navigate] = useLocation();
  const { key, updateKey, connected, checking, battery, charging, deviceModel, firmwareVersion, mode, modeChangedEvent, recordAppModeChange } = useHandy();
  const [inputKey, setInputKey] = useState(key);
  const [keyError, setKeyError] = useState<string | null>(null);

  useEffect(() => {
    if (connected) setKeyError(null);
  }, [connected]);
  const { toast } = useToast();
  const { user } = useUser();
  const { signOut, openSignIn } = useClerk();
  const [collapsed, setCollapsed] = useState(false);
  const { isAdmin, isPro, plan } = useSubscription();
  const appSettings = useAppSettings();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackText, setFeedbackText] = useState("");
  const [feedbackCategory, setFeedbackCategory] = useState<"bug" | "suggestion" | "other">("other");
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false);
  const [modePopoverOpen, setModePopoverOpen] = useState(false);
  const [modeChanging, setModeChanging] = useState(false);

  // ─── Mode selector ────────────────────────────────────────────────────────
  const handleModeSelect = useCallback(async (newMode: number) => {
    if (modeChanging || newMode === mode) { setModePopoverOpen(false); return; }
    setModeChanging(true);
    setModePopoverOpen(false);
    recordAppModeChange(newMode);
    try {
      await apiSetMode(key, newMode);
    } catch {
      toast({ variant: "destructive", title: "Mode change failed", description: "Couldn't switch mode — check your connection." });
    } finally {
      setModeChanging(false);
    }
  }, [modeChanging, mode, key, recordAppModeChange, toast]);

  // ─── Device mode watcher ──────────────────────────────────────────────────
  // Track last interaction time so we can auto-navigate if the user is idle.
  const lastInteractionRef = useRef<number>(Date.now());
  useEffect(() => {
    const onInteraction = () => { lastInteractionRef.current = Date.now(); };
    window.addEventListener("pointerdown", onInteraction);
    window.addEventListener("keydown", onInteraction);
    return () => {
      window.removeEventListener("pointerdown", onInteraction);
      window.removeEventListener("keydown", onInteraction);
    };
  }, []);

  const locationRef = useRef(location);
  useEffect(() => { locationRef.current = location; }, [location]);

  useEffect(() => {
    if (!modeChangedEvent || !modeChangedEvent.external) return;

    const { mode } = modeChangedEvent;

    if (mode === MODE_HAMP) {
      // Only surface a suggestion when the user is on a page that doesn't match HAMP.
      if (!HAMP_MISMATCH_PAGES.has(locationRef.current)) return;

      const idleMs = Date.now() - lastInteractionRef.current;
      if (idleMs > 5_000) {
        // User has been idle for >5 s — navigate automatically.
        navigate("/control");
        toast({
          title: "Switched to Manual Controls",
          description: "The device entered HAMP mode — navigated automatically.",
        });
      } else {
        toast({
          title: "Device switched to HAMP mode",
          description: "Go to Manual Controls to operate it from this page.",
          action: (
            <ToastAction altText="Go to Manual Controls" onClick={() => navigate("/control")}>
              Manual Controls
            </ToastAction>
          ),
        });
      }
    } else if (mode === MODE_HSSP) {
      toast({
        title: "HSSP script sync active",
        description: "The device is now in script-sync mode.",
        duration: 4000,
      });
    }
  // modeChangedEvent.seq changes every time an external mode change fires.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modeChangedEvent?.seq]);

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

  const handleFeedbackSubmit = async () => {
    if (!feedbackText.trim()) return;
    setFeedbackSubmitting(true);
    try {
      const res = await fetch(`${API}/api/block-reports`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "feedback",
          item: "general",
          blockMessage: "",
          reason: feedbackText.trim(),
          category: feedbackCategory,
          userEmail: user?.primaryEmailAddress?.emailAddress ?? null,
          userId: user?.id ?? null,
        }),
      });
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      toast({ title: "Feedback sent", description: "Thanks for letting us know!" });
      setFeedbackOpen(false);
      setFeedbackText("");
      setFeedbackCategory("other");
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Couldn't send feedback",
        description: err instanceof Error ? err.message : "Please try again.",
      });
    } finally {
      setFeedbackSubmitting(false);
    }
  };

  // Display name shown in the sidebar
  const displayName = handle || user?.fullName || user?.primaryEmailAddress?.emailAddress || "Account";
  const displaySub  = handle ? "private handle" : (user?.primaryEmailAddress?.emailAddress ?? "");

  const handleSaveKey = () => {
    const trimmed = inputKey.trim();
    if (trimmed !== inputKey) setInputKey(trimmed);
    setKeyError(null);
    updateKey(trimmed, (reason) => {
      if (reason === "network_error") {
        setKeyError("Network error — check your internet connection and try again.");
        toast({
          title: "Network error",
          description: "Check your internet connection and try again.",
          variant: "destructive",
        });
      } else if (reason === "invalid_key") {
        setKeyError("Invalid key — double-check it at handyfeeling.com/my-handy.");
        toast({
          title: "Invalid connection key",
          description: "That key wasn't accepted — double-check it at handyfeeling.com/my-handy.",
          variant: "destructive",
        });
      } else {
        setKeyError("Device didn't respond — make sure it's powered on and in range.");
        toast({
          title: "Device not connected",
          description: "The key is valid but the device didn't respond — make sure it's powered on and in range.",
          variant: "destructive",
        });
      }
    });
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
              <EmblemGlow />
              {/* Connection dot */}
              <div
                className={`h-3 w-3 rounded-full flex-shrink-0 ${
                  checking ? "dot-checking" :
                  connected ? "bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]" :
                  "bg-red-500"
                }`}
                title={
                  checking ? "Checking..." :
                  connected ? [
                    "Connected",
                    battery !== undefined ? `${battery}%${charging ? " ⚡" : ""}` : null,
                    deviceModel ?? null,
                    firmwareVersion ? `fw ${firmwareVersion}` : null,
                  ].filter(Boolean).join(" · ") :
                  "Disconnected"
                }
              />
              {/* Mode badge (collapsed) */}
              {connected && mode !== undefined && (
                <Popover open={modePopoverOpen} onOpenChange={setModePopoverOpen}>
                  <PopoverTrigger asChild>
                    <button
                      className="text-[9px] font-bold font-mono leading-none px-1 py-0.5 rounded bg-primary/20 text-primary border border-primary/30 hover:bg-primary/30 hover:border-primary/50 transition-colors cursor-pointer"
                      title="Switch device mode"
                      disabled={modeChanging}
                    >
                      {modeChanging ? "…" : (MODE_LABELS[mode] ?? mode)}
                    </button>
                  </PopoverTrigger>
                  <PopoverContent side="right" align="start" className="w-36 p-1">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium px-2 py-1">Switch mode</p>
                    {([0, 1, 2] as const).map(m => (
                      <button
                        key={m}
                        onClick={() => handleModeSelect(m)}
                        className="flex items-center justify-between w-full px-2 py-1.5 rounded text-sm hover:bg-muted transition-colors"
                      >
                        <span className="font-mono font-bold text-xs">{MODE_LABELS[m]}</span>
                        {mode === m && <Check size={12} className="text-primary" />}
                      </button>
                    ))}
                  </PopoverContent>
                </Popover>
              )}
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
                    <span className="text-[#E05252]">Haptic</span><span className="text-foreground">OS</span>
                  </h1>
                </div>
                <div className="flex items-center gap-2">
                  {battery !== undefined && connected && (
                    <span className="text-xs font-mono text-muted-foreground">
                      {battery}%{charging && <span title="Charging"> ⚡</span>}
                    </span>
                  )}
                  <div
                    className={`h-3 w-3 rounded-full flex-shrink-0 ${
                      checking ? "dot-checking" :
                      connected ? "bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]" :
                      "bg-red-500"
                    }`}
                    title={checking ? "Checking..." : connected ? `Connected${battery !== undefined ? ` · ${battery}%${charging ? " ⚡" : ""}` : ""}` : "Disconnected"}
                  />
                  {/* Mode badge (expanded) */}
                  {connected && mode !== undefined && (
                    <Popover open={modePopoverOpen} onOpenChange={setModePopoverOpen}>
                      <PopoverTrigger asChild>
                        <button
                          className="text-[9px] font-bold font-mono leading-none px-1 py-0.5 rounded bg-primary/20 text-primary border border-primary/30 hover:bg-primary/30 hover:border-primary/50 transition-colors cursor-pointer"
                          title="Switch device mode"
                          disabled={modeChanging}
                        >
                          {modeChanging ? "…" : (MODE_LABELS[mode] ?? mode)}
                        </button>
                      </PopoverTrigger>
                      <PopoverContent side="bottom" align="end" className="w-36 p-1">
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium px-2 py-1">Switch mode</p>
                        {([0, 1, 2] as const).map(m => (
                          <button
                            key={m}
                            onClick={() => handleModeSelect(m)}
                            className="flex items-center justify-between w-full px-2 py-1.5 rounded text-sm hover:bg-muted transition-colors"
                          >
                            <span className="font-mono font-bold text-xs">{MODE_LABELS[m]}</span>
                            {mode === m && <Check size={12} className="text-primary" />}
                          </button>
                        ))}
                      </PopoverContent>
                    </Popover>
                  )}
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

              {connected && (deviceModel || firmwareVersion) && (
                <p className="text-[10px] text-muted-foreground leading-snug mt-1">
                  {[deviceModel, firmwareVersion ? `fw ${firmwareVersion}` : null].filter(Boolean).join(" · ")}
                </p>
              )}

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
                    type="text"
                    value={inputKey}
                    onChange={e => { setInputKey(e.target.value); setKeyError(null); }}
                    onKeyDown={e => { if (e.key === "Enter") handleSaveKey(); }}
                    placeholder={device.placeholder}
                    className={`h-8 text-xs font-mono${keyError ? " border-destructive focus-visible:ring-destructive" : ""}`}
                    data-testid="input-connection-key"
                  />
                  <Button size="sm" onClick={handleSaveKey} className="h-8 px-3" data-testid="button-save-key">
                    Save
                  </Button>
                </div>
                {keyError && (
                  <p className="text-[10px] text-destructive leading-snug" data-testid="key-error-message">
                    {keyError}
                  </p>
                )}
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
                        ? "bg-gradient-to-r from-[#DC2626]/20 to-[#EF4444]/10 text-[#E05252] font-medium shadow-[inset_0_0_0_1px_rgba(220,38,38,0.2)]"
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
                          ? "bg-gradient-to-r from-[#DC2626]/20 to-[#EF4444]/10 text-[#E05252] font-medium shadow-[inset_0_0_0_1px_rgba(220,38,38,0.2)]"
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

          {/* Settings gear button */}
          <div className={`mt-1 ${collapsed ? "px-1.5" : "px-2"}`}>
            <button
              className={`flex items-center gap-3 rounded-md cursor-pointer transition-colors w-full text-muted-foreground hover:bg-muted hover:text-foreground ${
                collapsed ? "justify-center px-0 py-2.5" : "px-3 py-2.5"
              }`}
              title={collapsed ? "Settings" : undefined}
              onClick={() => setSettingsOpen(true)}
            >
              <Settings size={18} className="flex-shrink-0" />
              {!collapsed && <span className="text-sm">Settings</span>}
            </button>
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

      {/* App Settings modal */}
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Settings className="h-5 w-5 text-primary" />
              App Settings
            </DialogTitle>
            <DialogDescription className="text-sm">
              Preferences are saved automatically and persist across refreshes.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6 py-2">
            {/* Color scheme */}
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Color Scheme</p>
              <div className="flex gap-2">
                {(["system", "light", "dark"] as Theme[]).map(t => (
                  <button
                    key={t}
                    onClick={() => appSettings.setTheme(t)}
                    className={`flex-1 rounded-md border px-3 py-2 text-sm capitalize transition-colors ${
                      appSettings.theme === t
                        ? "border-primary bg-primary/10 text-primary font-medium"
                        : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground"
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>

            {/* Pulsing icons */}
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-foreground">Pulsing Icons</p>
                <p className="text-xs text-muted-foreground">Animated icon effects throughout the app</p>
              </div>
              <button
                role="switch"
                aria-checked={appSettings.pulsingIcons}
                onClick={() => appSettings.setPulsingIcons(!appSettings.pulsingIcons)}
                className={`relative inline-flex h-6 w-11 flex-shrink-0 rounded-full border-2 border-transparent transition-colors focus:outline-none ${
                  appSettings.pulsingIcons ? "bg-primary" : "bg-muted"
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition-transform ${
                    appSettings.pulsingIcons ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </button>
            </div>

            {/* Script output filetype */}
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Script Output Filetype</p>
              <select
                value={appSettings.scriptOutputFiletype}
                onChange={e => appSettings.setScriptOutputFiletype(e.target.value as ScriptOutputFiletype)}
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="funscript">.funscript</option>
                <option value="csv">.csv</option>
              </select>
            </div>

            {/* Feedback */}
            <div className="border-t border-border pt-4">
              <button
                onClick={() => {
                  setSettingsOpen(false);
                  setFeedbackText("");
                  setFeedbackOpen(true);
                }}
                className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                <MessageSquare size={15} className="flex-shrink-0" />
                Send feedback / report an issue
              </button>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="ghost"
              className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 text-sm"
              onClick={() => {
                appSettings.resetAll();
                toast({ title: "Settings reset to defaults", duration: 2000 });
              }}
            >
              Reset all to default
            </Button>
            <Button onClick={() => setSettingsOpen(false)}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Feedback dialog */}
      <Dialog open={feedbackOpen} onOpenChange={(o) => { if (!feedbackSubmitting) { setFeedbackOpen(o); if (!o) { setFeedbackText(""); setFeedbackCategory("other"); } } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5 text-primary" />
              Send Feedback
            </DialogTitle>
            <DialogDescription className="text-sm">
              What's on your mind? We read every message.
            </DialogDescription>
          </DialogHeader>
          <div className="py-2 space-y-3">
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5">Category</p>
              <div className="flex gap-2">
                {(["bug", "suggestion", "other"] as const).map((cat) => {
                  const labels = { bug: "🐛 Bug", suggestion: "💡 Suggestion", other: "💬 Other" };
                  const active = feedbackCategory === cat;
                  return (
                    <button
                      key={cat}
                      onClick={() => setFeedbackCategory(cat)}
                      className={`flex-1 text-xs py-1.5 px-2 rounded-md border transition-colors ${
                        active
                          ? "border-primary bg-primary/10 text-primary font-semibold"
                          : "border-border/50 text-muted-foreground hover:border-border hover:text-foreground"
                      }`}
                    >
                      {labels[cat]}
                    </button>
                  );
                })}
              </div>
            </div>
            <div>
              <label
                htmlFor="feedback-text"
                className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1 block"
              >
                Your message
              </label>
              <Textarea
                id="feedback-text"
                value={feedbackText}
                onChange={(e) => setFeedbackText(e.target.value)}
                rows={5}
                maxLength={2000}
                placeholder="Tell us what's on your mind…"
                data-testid="textarea-feedback"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => { setFeedbackOpen(false); setFeedbackText(""); setFeedbackCategory("other"); }} disabled={feedbackSubmitting}>
              Cancel
            </Button>
            <Button
              onClick={handleFeedbackSubmit}
              disabled={feedbackSubmitting || !feedbackText.trim()}
              data-testid="button-submit-feedback"
            >
              {feedbackSubmitting ? "Sending…" : "Send"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
