import { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import { getStatus } from "@/lib/handyApi";
import { BASE } from "@/lib/handyApi";

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
  updateKey: (k: string, onFailure?: () => void) => void;
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
  const checkOnce = useCallback(async (k: string): Promise<boolean> => {
    if (!k || !mountedRef.current) return false;
    setChecking(true);
    try {
      const res = await getStatus(k);
      if (!mountedRef.current) return false;
      setConnected(res.connected);
      if (typeof res.mode === "number") setMode(res.mode);
      return res.connected;
    } catch {
      if (mountedRef.current) setConnected(false);
      return false;
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
      const url = `${BASE}/events?ck=${ck}&apikey=${ck}`;
      sse = new EventSource(url);

      sse.onopen = () => {
        if (!mountedRef.current || cancelled) return;
        // Reset back-off on successful connection
        retryDelay = SSE_RETRY_MIN_MS;
        setChecking(false);
      };

      sse.addEventListener("device_connected", (e: MessageEvent) => {
        if (!mountedRef.current || cancelled) return;
        setConnected(true);
        setDeviceModel(undefined);
        setFirmwareVersion(undefined);
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
      });

      sse.addEventListener("device_disconnected", () => {
        if (!mountedRef.current || cancelled) return;
        setConnected(false);
        setBattery(undefined);
        setCharging(false);
        setDeviceModel(undefined);
        setFirmwareVersion(undefined);
      });

      sse.addEventListener("battery_changed", (e: MessageEvent) => {
        if (!mountedRef.current || cancelled) return;
        try {
          const data = JSON.parse(e.data as string) as {
            battery_level?: number;
            charger_connected?: boolean;
            charging_complete?: boolean;
          };
          if (typeof data.battery_level === "number") {
            setBattery(data.battery_level);
          }
          // charging = plugged in (regardless of whether already full)
          setCharging(!!data.charger_connected);
        } catch {
          // Ignore malformed events
        }
      });

      sse.addEventListener("mode_changed", (e: MessageEvent) => {
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
      });

      sse.onerror = () => {
        if (cancelled) return;
        // SSE dropped — close, fall back to a single REST check, then retry
        sse?.close();
        sse = null;
        void checkOnce(key);
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
  // onFailure callback is invoked (used by layout.tsx to show an error toast).
  const updateKey = useCallback((newKey: string, onFailure?: () => void) => {
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
      const ok = await checkOnce(newKey);
      if (ok) return;
      if (attempts >= SAVE_MAX_ATTEMPTS || !mountedRef.current) {
        if (!ok && mountedRef.current) onFailure?.();
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
