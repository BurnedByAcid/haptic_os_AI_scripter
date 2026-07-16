import { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import { getStatus, type HandyFailureReason } from "@/lib/handyApi";
import { BASE } from "@/lib/handyApi";
import { enqueueRetry } from "@/hooks/use-retry-queue";

// Back-off constants for SSE reconnection
const SSE_RETRY_MIN_MS = 5_000;
const SSE_RETRY_MAX_MS = 30_000;

// Spacing between the burst of attempts triggered by a Save click.
const SAVE_RETRY_SPACING_MS = 1500;
const SAVE_MAX_ATTEMPTS = 3;

interface HandyStatus {
  connected: boolean;
  checking: boolean;
  battery?: number;
  charging: boolean;
  deviceModel?: string;
  firmwareVersion?: string;
}

/** Fired when the device mode changes via the physical button or another app. */
export interface ModeChangedEvent {
  mode: number;
  /** true = the change came from an external source (physical button / other app) */
  external: boolean;
  /** Monotonically-increasing sequence number for useEffect dependency tracking */
  seq: number;
}

interface HandyContextType extends HandyStatus {
  key: string;
  updateKey: (k: string, onFailure?: (reason: HandyFailureReason) => void) => void;
  /** Current device mode: 0=HAMP, 1=HDSP, 2=HSSP. undefined if unknown. */
  mode: number | undefined;
  /**
   * Call this BEFORE sending a mode-change command to the device so the next
   * SSE mode_changed event for that mode is treated as app-initiated (no toast).
   */
  recordAppModeChange: (mode: number) => void;
  /** Latest mode-changed event (null until the first event fires). */
  modeChangedEvent: ModeChangedEvent | null;
}

const HandyContext = createContext<HandyContextType>({
  key: "",
  updateKey: () => {},
  connected: false,
  checking: false,
  charging: false,
  mode: undefined,
  recordAppModeChange: () => {},
  modeChangedEvent: null,
});

export function HandyProvider({ children }: { children: React.ReactNode }) {
  const [key, setKey] = useState(() => localStorage.getItem("handy_connection_key") || "");
  const [connected, setConnected] = useState(false);
  const [checking, setChecking] = useState(false);
  const [battery, setBattery] = useState<number | undefined>(undefined);
  const [charging, setCharging] = useState(false);
  const [deviceModel, setDeviceModel] = useState<string | undefined>(undefined);
  const [firmwareVersion, setFirmwareVersion] = useState<string | undefined>(undefined);
  const [mode, setMode] = useState<number | undefined>(undefined);
  const [modeChangedEvent, setModeChangedEvent] = useState<ModeChangedEvent | null>(null);

  const mountedRef = useRef(true);
  /** The mode the app is about to set — used to suppress the echoed SSE event. */
  const pendingAppModeRef = useRef<number | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  /**
   * Call before sending a mode-change to the device.
   * The next SSE mode_changed event carrying this mode will be suppressed.
   */
  const recordAppModeChange = useCallback((m: number) => {
    pendingAppModeRef.current = m;
  }, []);

  // Single status check via REST. Used for:
  //   1. The initial state snapshot before SSE is established
  //   2. The fallback triggered when SSE drops
  const checkOnce = useCallback(async (k: string): Promise<{ connected: boolean; failureReason?: HandyFailureReason }> => {
    if (!k || !mountedRef.current) return { connected: false };
    setChecking(true);
    try {
      const res = await getStatus(k);
      if (!mountedRef.current) return { connected: false };
      setConnected(res.connected);
      if (typeof res.mode === "number") setMode(res.mode);
      // Populate model/firmware from REST as a fallback — SSE device_connected
      // will overwrite these if it fires, giving SSE natural precedence.
      if (res.connected) {
        if (res.deviceModel) setDeviceModel(res.deviceModel);
        if (res.firmwareVersion) setFirmwareVersion(res.firmwareVersion);
      }
      // If the check succeeded with a network error while offline, queue a retry.
      if (res.failureReason === "network_error" && !navigator.onLine) {
        enqueueRetry("device-sync", () => checkOnce(k).then(() => {}));
      }
      return { connected: res.connected, failureReason: res.failureReason };
    } catch {
      if (mountedRef.current) setConnected(false);
      // Network fetch threw entirely — queue a retry if we're offline.
      if (!navigator.onLine) {
        enqueueRetry("device-sync", () => checkOnce(k).then(() => {}));
      }
      return { connected: false, failureReason: "network_error" };
    } finally {
      if (mountedRef.current) setChecking(false);
    }
  }, []);

  // ─── SSE connection manager ────────────────────────────────────────────────
  useEffect(() => {
    if (!key) {
      setConnected(false);
      setBattery(undefined);
      setCharging(false);
      setDeviceModel(undefined);
      setFirmwareVersion(undefined);
      setMode(undefined);
      return;
    }

    let sse: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let retryDelay = SSE_RETRY_MIN_MS;
    let cancelled = false;

    const cleanup = () => {
      if (sse) { sse.close(); sse = null; }
      if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
    };

    const connect = () => {
      if (cancelled) return;
      // SSE requires credentials as query params — EventSource doesn't support headers
      const ck = encodeURIComponent(key);
      const url = `${BASE}/events?ck=${ck}`;
      sse = new EventSource(url);

      sse.onopen = () => {
        if (!mountedRef.current || cancelled) return;
        // Reset back-off on successful connection
        retryDelay = SSE_RETRY_MIN_MS;
        setChecking(false);
      };

      // Handler: device connected (model/firmware from payload when present)
      const onDeviceConnected = (e: MessageEvent) => {
        if (!mountedRef.current || cancelled) return;
        setConnected(true);
        // Only overwrite model/firmware when the SSE payload actually carries them;
        // preserve any REST fallback values set by checkOnce() when fields are absent.
        try {
          const data = JSON.parse(e.data as string) as {
            hardware?: string;
            info?: { fw_version?: string };
          };
          if (data.hardware) setDeviceModel(data.hardware);
          if (data.info?.fw_version) setFirmwareVersion(data.info.fw_version);
        } catch {
          // Ignore malformed or missing payload
        }
      };
      // v3 name + v4/new-firmware alias
      sse.addEventListener("device_connected", onDeviceConnected);
      sse.addEventListener("connected", onDeviceConnected);

      // Handler: device disconnected
      const onDeviceDisconnected = () => {
        if (!mountedRef.current || cancelled) return;
        setConnected(false);
        setBattery(undefined);
        setCharging(false);
        setDeviceModel(undefined);
        setFirmwareVersion(undefined);
      };
      // v3 name + v4/new-firmware alias
      sse.addEventListener("device_disconnected", onDeviceDisconnected);
      sse.addEventListener("disconnected", onDeviceDisconnected);

      // Handler: battery state
      const onBatteryChanged = (e: MessageEvent) => {
        if (!mountedRef.current || cancelled) return;
        try {
          const data = JSON.parse(e.data as string) as {
            battery_level?: number;
            level?: number;
            charger_connected?: boolean;
            charging?: boolean;
            charging_complete?: boolean;
          };
          const level = data.battery_level ?? data.level;
          if (typeof level === "number") {
            setBattery(level);
          }
          // charging = plugged in (regardless of whether already full)
          setCharging(!!(data.charger_connected ?? data.charging));
        } catch {
          // Ignore malformed events
        }
      };
      // v3 name + v4/new-firmware alias
      sse.addEventListener("battery_changed", onBatteryChanged);
      sse.addEventListener("battery", onBatteryChanged);

      // Handler: mode changed
      const onModeChanged = (e: MessageEvent) => {
        if (!mountedRef.current || cancelled) return;
        try {
          const data = JSON.parse(e.data as string) as { mode?: number };
          if (typeof data.mode === "number") {
            const newMode = data.mode;
            // If the app triggered this mode change, suppress the toast
            const external = pendingAppModeRef.current !== newMode;
            pendingAppModeRef.current = null;
            setMode(newMode);
            setModeChangedEvent({ mode: newMode, external, seq: Date.now() });
          }
        } catch {
          // Ignore malformed events
        }
      };
      // v3 name + v4/new-firmware alias
      sse.addEventListener("mode_changed", onModeChanged);
      sse.addEventListener("mode", onModeChanged);

      sse.onerror = () => {
        if (cancelled) return;
        // SSE dropped — close, fall back to a single REST check, then retry
        sse?.close();
        sse = null;
        void checkOnce(key); // result used only for side-effects (setConnected)
        retryTimer = setTimeout(() => {
          retryDelay = Math.min(retryDelay * 2, SSE_RETRY_MAX_MS);
          connect();
        }, retryDelay);
      };
    };

    // Initial REST check before SSE stream delivers its first event
    void checkOnce(key);
    connect();

    return () => {
      cancelled = true;
      cleanup();
    };
  }, [key, checkOnce]);

  // Called when the user clicks Save (or presses Enter) next to the connection
  // key. Persists the new key, then runs up to SAVE_MAX_ATTEMPTS attempts
  // spaced by SAVE_RETRY_SPACING_MS. If all attempts fail the optional
  // onFailure callback is invoked with the failure reason (used by layout.tsx to show an error toast).
  const updateKey = useCallback((newKey: string, onFailure?: (reason: HandyFailureReason) => void) => {
    localStorage.setItem("handy_connection_key", newKey);
    setKey(newKey);
    setConnected(false);
    setBattery(undefined);
    setCharging(false);
    setDeviceModel(undefined);
    setFirmwareVersion(undefined);

    if (!newKey) return;

    let attempts = 0;
    const tryOnce = async () => {
      if (!mountedRef.current) return;
      attempts += 1;
      const result = await checkOnce(newKey);
      if (result.connected) return;
      if (attempts >= SAVE_MAX_ATTEMPTS || !mountedRef.current) {
        if (!result.connected && mountedRef.current) onFailure?.(result.failureReason ?? "device_offline");
        return;
      }
      setTimeout(() => { void tryOnce(); }, SAVE_RETRY_SPACING_MS);
    };
    void tryOnce();
  }, [checkOnce]);

  return (
    <HandyContext.Provider value={{
      key, updateKey,
      connected, checking, battery, charging,
      deviceModel, firmwareVersion,
      mode, recordAppModeChange, modeChangedEvent,
    }}>
      {children}
    </HandyContext.Provider>
  );
}

export function useHandyContext() {
  return useContext(HandyContext);
}
