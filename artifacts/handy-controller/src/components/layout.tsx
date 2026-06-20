import { Link, useLocation } from "wouter";
import { ToastAction } from "@/components/ui/toast";
import { useHandy } from "@/hooks/use-handy";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { useRetryQueue } from "@/hooks/use-retry-queue";
import { Activity, BookMarked, ChevronLeft, ChevronRight, Crown, ExternalLink, Gamepad2, Home, MessageSquare, Mic, PlaySquare, Settings2, Shield, LogIn, LogOut, User, Users, Settings, Check, WifiOff, Sparkles, type LucideIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useState, useEffect, useCallback, useRef } from "react";
import { useToast } from "@/hooks/use-toast";
import { useUser, useClerk, useAuth, Show } from "@clerk/react";
import { HapticAIConsentDialog } from "@/components/haptic-ai-consent-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { useProfile } from "@/hooks/use-profile";
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
  subscriberOnly?: boolean;
  badge?: string;
  preNavWarning?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { href: "/",          label: "Dashboard",      icon: Home,      requiresPro: false },
  { href: "/player",    label: "Player",          icon: PlaySquare, requiresPro: false },
  { href: "/scripter",  label: "Scripter",        icon: Mic,       requiresPro: false },
  { href: "/haptic-ai", label: "HapticAI",        icon: Sparkles,  requiresPro: false, badge: "Beta", preNavWarning: true },
  { href: "/library",   label: "My Library",      icon: BookMarked, requiresPro: false },
  { href: "/community", label: "Community",       icon: Users,     requiresPro: true  },
  { href: "/control",   label: "Manual Controls", icon: Settings2, requiresPro: true  },
  { href: "/games",     label: "Games",           icon: Gamepad2,  requiresPro: true  },
  { href: "/beat",      label: "Live Audio",       icon: Activity,  requiresPro: true  },
];

// ─── Device mode constants ─────────────────────────────────────────────────────
const MODE_HAMP = 0;
// const MODE_HDSP = 1;  // no dedicated page; no nav suggestion needed
const MODE_HSSP = 2;

const MODE_LABELS: Record<number, string> = { 0: "HAMP", 1: "HDSP", 2: "HSSP" };
const MODE_DESCRIPTIONS: Record<number, string> = {
  0: "Oscillating stroke",
  1: "Direct position",
  2: "Script sync",
};

/** Pages that are "wrong" when the device is in HAMP mode. */
const HAMP_MISMATCH_PAGES = new Set(["/scripter", "/player"]);

const API = import.meta.env.VITE_API_URL ?? "";

export function Layout({ children }: { children: React.ReactNode }) {
  const [location, navigate] = useLocation();
  const isOnline = useOnlineStatus();
  useRetryQueue();
  const { key, updateKey, connected, checking, battery, charging, deviceModel, firmwareVersion, mode, modeChangedEvent, recordAppModeChange } = useHandy();
  const [inputKey, setInputKey] = useState(key);
  const [keyError, setKeyError] = useState<string | null>(null);

  useEffect(() => {
    if (connected) setKeyError(null);
  }, [connected]);
  const { toast } = useToast();
  const { user } = useUser();
  const { getToken } = useAuth();
  const { signOut, openSignIn } = useClerk();
  const [collapsed, setCollapsed] = useState(false);
  const { isAdmin, isPro, plan } = useSubscription();
  const { username: dbUsername } = useProfile();
  const appSettings = useAppSettings();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackText, setFeedbackText] = useState("");
  const [feedbackCategory, setFeedbackCategory] = useState<"bug" | "suggestion" | "other">("other");
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false);
  const [modePopoverOpen, setModePopoverOpen] = useState(false);
  const [modeChanging, setModeChanging] = useState(false);

  // ─── HapticAI consent dialog ──────────────────────────────────────────────
  const [hapticAiConsentOpen, setHapticAiConsentOpen] = useState(false);
  const [hapticAiWarnDismissed, setHapticAiWarnDismissed] = useState<boolean | null>(null);

  useEffect(() => {
    if (!user?.id) return;
    getToken().then((token) => {
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      fetch(`${API}/api/user/preferences`, { headers })
        .then((r) => r.ok ? r.json() : null)
        .then((data) => {
          if (data && typeof data.hapticAiWarnDismissed === "boolean") {
            setHapticAiWarnDismissed(data.hapticAiWarnDismissed);
          } else {
            setHapticAiWarnDismissed(false);
          }
        })
        .catch(() => setHapticAiWarnDismissed(false));
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // ─── BroadcastChannel: receive funscripts from HapticAI (cross-tab) ──────────
  // The new HapticAI browser app posts:
  //   { type: "hapticai_funscript", funscript: "<JSON string>", name?: string }
  // We store it in sessionStorage using the existing hapticai_import key, then
  // navigate to /scripter where it is picked up automatically on mount.
  useEffect(() => {
    if (!("BroadcastChannel" in window)) return;
    const channel = new BroadcastChannel("hapticos");
    channel.onmessage = (event: MessageEvent) => {
      try {
        const msg = event.data as { type?: string; funscript?: string; name?: string };
        if (msg?.type !== "hapticai_funscript" || !msg.funscript) return;
        sessionStorage.setItem(
          "hapticai_import",
          JSON.stringify({ funscript: msg.funscript, name: msg.name ?? "HapticAI Script" }),
        );
        navigate("/scripter");
        toast({
          title: "HapticAI script received",
          description: "Your generated script has been loaded in the editor.",
          duration: 4000,
        });
      } catch {
        // Ignore malformed messages
      }
    };
    return () => channel.close();
  }, [navigate, toast]);

  const handleHapticAiNavClick = useCallback(() => {
    if (!isAdmin) {
      navigate("/haptic-ai-soon");
      return;
    }
    if (hapticAiWarnDismissed) {
      navigate("/haptic-ai");
    } else {
      setHapticAiConsentOpen(true);
    }
  }, [isAdmin, hapticAiWarnDismissed, navigate]);

  const handleHapticAiConsentConfirm = useCallback(async (dontShowAgain: boolean) => {
    setHapticAiConsentOpen(false);
    try { sessionStorage.setItem("hapticAiConsentAcknowledged", "1"); } catch { /* ignore */ }
    if (dontShowAgain) {
      try {
        const token = await getToken();
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (token) headers["Authorization"] = `Bearer ${token}`;
        const res = await fetch(`${API}/api/user/preferences`, {
          method: "POST",
          headers,
          body: JSON.stringify({ hapticAiWarnDismissed: true }),
        });
        if (res.ok) {
          setHapticAiWarnDismissed(true);
        } else {
          toast({ variant: "destructive", title: "Preference not saved", description: "Could not save \"Don't show again\" — the warning will reappear next time." });
        }
      } catch {
        toast({ variant: "destructive", title: "Preference not saved", description: "Could not save \"Don't show again\" — the warning will reappear next time." });
      }
    }
    navigate("/haptic-ai");
  }, [getToken, navigate, toast]);

  const handleHapticAiConsentCancel = useCallback(() => {
    setHapticAiConsentOpen(false);
  }, []);

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
    setKeyError(null);
  };

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

  // Display name — always uses the permanent DB username chosen at registration
  const displayName = dbUsername ?? user?.primaryEmailAddress?.emailAddress ?? "Account";
  const displaySub  = user?.primaryEmailAddress?.emailAddress ?? "";

  const handleSaveKey = () => {
    const trimmed = inputKey.trim();
    if (trimmed !== inputKey) setInputKey(trimmed);
    setKeyError(null);
    const isIntiface = device.mode === "intiface";
    updateKey(trimmed, (reason) => {
      if (reason === "network_error") {
        const msg = isIntiface
          ? "Network error — ensure Intiface Central is running and reachable at that address."
          : "Network error — check your internet connection and try again.";
        setKeyError(msg);
        toast({
          title: "Network error",
          description: isIntiface
            ? "Couldn't reach Intiface Central — check that it's running and the URL is correct."
            : "Check your internet connection and try again.",
          variant: "destructive",
        });
      } else if (reason === "invalid_key") {
        const msg = isIntiface
          ? "Invalid URL — ensure Intiface Central is running at that address."
          : "Invalid key — double-check it at handyfeeling.com/my-handy.";
        setKeyError(msg);
        toast({
          title: isIntiface ? "Invalid Intiface URL" : "Invalid connection key",
          description: isIntiface
            ? "That URL wasn't accepted — make sure Intiface Central is running and the address is correct."
            : "That key wasn't accepted — double-check it at handyfeeling.com/my-handy.",
          variant: "destructive",
        });
      } else {
        const msg = isIntiface
          ? "Device didn't respond — ensure Intiface Central is running and your device is connected."
          : "Device didn't respond — make sure it's powered on and in range.";
        setKeyError(msg);
        toast({
          title: "Device not connected",
          description: isIntiface
            ? "Intiface Central is reachable but no device responded — check that your device is paired in Intiface Central."
            : "The key is valid but the device didn't respond — make sure it's powered on and in range.",
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
              <button
                title="Send feedback or report an issue"
                onClick={() => { setFeedbackText(""); setFeedbackCategory("other"); setFeedbackOpen(true); }}
                className="hover:opacity-80 transition-opacity"
              >
                <EmblemGlow />
              </button>
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
                  <PopoverContent side="right" align="start" className="w-44 p-1">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium px-2 py-1">Switch mode</p>
                    {([0, 1, 2] as const).map(m => (
                      <button
                        key={m}
                        onClick={() => handleModeSelect(m)}
                        className="flex items-start justify-between w-full px-2 py-1.5 rounded hover:bg-muted transition-colors"
                      >
                        <span className="flex flex-col items-start gap-0.5">
                          <span className="font-mono font-bold text-xs">{MODE_LABELS[m]}</span>
                          <span className="text-[10px] text-muted-foreground leading-tight">{MODE_DESCRIPTIONS[m]}</span>
                        </span>
                        {mode === m && <Check size={12} className="text-primary mt-0.5 flex-shrink-0" />}
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
                <button
                  className="flex items-center gap-2.5 group"
                  title="Send feedback or report an issue"
                  onClick={() => { setFeedbackText(""); setFeedbackCategory("other"); setFeedbackOpen(true); }}
                >
                  <EmblemGlow />
                  <h1 className="text-xl font-bold tracking-tight whitespace-nowrap group-hover:opacity-80 transition-opacity">
                    <span className="text-[#E05252]">Haptic</span><span className="text-foreground">OS</span>
                  </h1>
                </button>
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
                      <PopoverContent side="bottom" align="end" className="w-44 p-1">
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium px-2 py-1">Switch mode</p>
                        {([0, 1, 2] as const).map(m => (
                          <button
                            key={m}
                            onClick={() => handleModeSelect(m)}
                            className="flex items-start justify-between w-full px-2 py-1.5 rounded hover:bg-muted transition-colors"
                          >
                            <span className="flex flex-col items-start gap-0.5">
                              <span className="font-mono font-bold text-xs">{MODE_LABELS[m]}</span>
                              <span className="text-[10px] text-muted-foreground leading-tight">{MODE_DESCRIPTIONS[m]}</span>
                            </span>
                            {mode === m && <Check size={12} className="text-primary mt-0.5 flex-shrink-0" />}
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
            {NAV_ITEMS.filter(item => !(item.subscriberOnly && !isPro)).map((item) => {
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
                    {!collapsed && (
                      <span className="flex items-center gap-1.5 flex-1 min-w-0">
                        <span className="text-sm text-muted-foreground/35">{item.label}</span>
                        {item.badge && (
                          <span className="text-[8px] font-bold uppercase tracking-wider px-1 py-0.5 rounded bg-muted/50 text-muted-foreground/40 border border-muted-foreground/20 leading-none flex-shrink-0">
                            {item.badge}
                          </span>
                        )}
                      </span>
                    )}
                  </div>
                );
              }

              if (item.preNavWarning) {
                return (
                  <button
                    key={item.href}
                    className={`w-full flex items-center gap-3 rounded-md cursor-pointer transition-colors ${
                      collapsed ? "justify-center px-0 py-2.5" : "px-3 py-2.5"
                    } ${
                      isActive
                        ? "bg-gradient-to-r from-[#DC2626]/20 to-[#EF4444]/10 text-[#E05252] font-medium shadow-[inset_0_0_0_1px_rgba(220,38,38,0.2)]"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    }`}
                    title={collapsed ? item.label : undefined}
                    data-testid={`link-${item.label.toLowerCase().replace(/\s+/g, '-')}`}
                    onClick={handleHapticAiNavClick}
                  >
                    <Icon size={18} className="flex-shrink-0" />
                    {!collapsed && (
                      <span className="flex items-center gap-1.5 flex-1 min-w-0">
                        <span className="text-sm">{item.label}</span>
                        {item.badge && (
                          <span className={`text-[8px] font-bold uppercase tracking-wider px-1 py-0.5 rounded border leading-none flex-shrink-0 ${
                            isActive
                              ? "bg-primary/20 text-primary border-primary/40"
                              : "bg-primary/10 text-primary/70 border-primary/25"
                          }`}>
                            {item.badge}
                          </span>
                        )}
                      </span>
                    )}
                  </button>
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
                    {!collapsed && (
                      <span className="flex items-center gap-1.5 flex-1 min-w-0">
                        <span className="text-sm">{item.label}</span>
                        {item.badge && (
                          <span className={`text-[8px] font-bold uppercase tracking-wider px-1 py-0.5 rounded border leading-none flex-shrink-0 ${
                            isActive
                              ? "bg-primary/20 text-primary border-primary/40"
                              : "bg-primary/10 text-primary/70 border-primary/25"
                          }`}>
                            {item.badge}
                          </span>
                        )}
                      </span>
                    )}
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
        {/* Offline banner */}
        <div
          className={`flex items-center gap-2 px-4 py-2 text-sm font-medium bg-yellow-500/10 border-b border-yellow-500/30 text-yellow-600 dark:text-yellow-400 transition-all duration-300 overflow-hidden ${
            isOnline ? "max-h-0 py-0 opacity-0 border-b-0" : "max-h-10 opacity-100"
          }`}
          aria-live="polite"
          aria-atomic="true"
        >
          <WifiOff size={14} className="flex-shrink-0" />
          <span>You're offline — live features like device syncing and script downloads won't work until you reconnect.</span>
        </div>
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

            {/* HapticAI warning reset */}
            {hapticAiWarnDismissed === true && (
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-foreground">HapticAI Setup Warning</p>
                  <p className="text-xs text-muted-foreground">You've dismissed this — click to show it again next time</p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-shrink-0"
                  onClick={async () => {
                    try {
                      const token = await getToken();
                      const headers: Record<string, string> = { "Content-Type": "application/json" };
                      if (token) headers["Authorization"] = `Bearer ${token}`;
                      const res = await fetch(`${API}/api/user/preferences`, {
                        method: "POST",
                        headers,
                        body: JSON.stringify({ hapticAiWarnDismissed: false }),
                      });
                      if (res.ok) {
                        setHapticAiWarnDismissed(false);
                        toast({ title: "Warning restored", description: "The HapticAI setup warning will show on your next visit.", duration: 3000 });
                      } else {
                        toast({ variant: "destructive", title: "Couldn't reset preference", description: "Please try again." });
                      }
                    } catch {
                      toast({ variant: "destructive", title: "Couldn't reset preference", description: "Please try again." });
                    }
                  }}
                >
                  Reset warning
                </Button>
              </div>
            )}

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

      {/* HapticAI consent dialog */}
      <HapticAIConsentDialog
        open={hapticAiConsentOpen}
        onConfirm={handleHapticAiConsentConfirm}
        onCancel={handleHapticAiConsentCancel}
      />
    </div>
  );
}
