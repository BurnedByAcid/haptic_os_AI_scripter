import { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import { getStatus } from "@/lib/handyApi";

const POLL_INTERVAL_MS = 5000;
const MAX_CONSECUTIVE_FAILURES = 3;
// Spacing between the burst of attempts triggered by a Save click.
const SAVE_RETRY_SPACING_MS = 1500;

interface HandyStatus {
  connected: boolean;
  checking: boolean;
  battery?: number;
}

interface HandyContextType extends HandyStatus {
  key: string;
  updateKey: (k: string) => void;
}

const HandyContext = createContext<HandyContextType>({
  key: "",
  updateKey: () => {},
  connected: false,
  checking: false,
});

export function HandyProvider({ children }: { children: React.ReactNode }) {
  const [key, setKey] = useState(() => localStorage.getItem("handy_connection_key") || "");
  const [connected, setConnected] = useState(false);
  const [checking, setChecking] = useState(false);
  const [battery, setBattery] = useState<number | undefined>(undefined);

  const mountedRef = useRef(true);
  // Tracks consecutive failed status checks for the *current* key. Reset on
  // success or when the key changes. Once it hits MAX_CONSECUTIVE_FAILURES
  // the background poll silently stops to avoid hammering the API.
  const failureCountRef = useRef(0);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Single status check. Returns true on success, false on failure (so callers
  // can implement bounded retry loops). Updates `connected` / `battery` /
  // `checking` and the failure counter.
  const checkOnce = useCallback(async (k: string): Promise<boolean> => {
    if (!k || !mountedRef.current) return false;
    setChecking(true);
    try {
      const res = await getStatus(k);
      if (!mountedRef.current) return false;
      if (res.connected) {
        failureCountRef.current = 0;
        setConnected(true);
        if (res.battery !== undefined) setBattery(res.battery);
        return true;
      }
      failureCountRef.current += 1;
      setConnected(false);
      return false;
    } catch {
      if (mountedRef.current) {
        failureCountRef.current += 1;
        setConnected(false);
      }
      return false;
    } finally {
      if (mountedRef.current) setChecking(false);
    }
  }, []);

  const stopPolling = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  }, []);

  // Background poll: kicks off once per saved key. Stops itself silently
  // after MAX_CONSECUTIVE_FAILURES so a wrong/missing key doesn't keep
  // pinging Handy's API forever. Polling resumes only when the user updates
  // the key (which triggers this effect again).
  useEffect(() => {
    stopPolling();
    failureCountRef.current = 0;

    if (!key) {
      setConnected(false);
      setBattery(undefined);
      return;
    }

    let cancelled = false;
    void checkOnce(key);

    pollIntervalRef.current = setInterval(() => {
      if (cancelled) return;
      if (failureCountRef.current >= MAX_CONSECUTIVE_FAILURES) {
        stopPolling();
        return;
      }
      void checkOnce(key);
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      stopPolling();
    };
  }, [key, checkOnce, stopPolling]);

  // Called when the user clicks Save next to the connection key. Persists the
  // new key, then runs up to MAX_CONSECUTIVE_FAILURES attempts spaced by
  // SAVE_RETRY_SPACING_MS. If all attempts fail the burst stops silently —
  // no error toast, no further user-visible noise — and the regular poll
  // (started by the key-change effect above) takes over until it also hits
  // the failure cap.
  const updateKey = useCallback((newKey: string) => {
    localStorage.setItem("handy_connection_key", newKey);
    setKey(newKey);
    setConnected(false);
    failureCountRef.current = 0;

    if (!newKey) return;

    let attempts = 0;
    const tryOnce = async () => {
      if (!mountedRef.current) return;
      attempts += 1;
      const ok = await checkOnce(newKey);
      if (ok || attempts >= MAX_CONSECUTIVE_FAILURES || !mountedRef.current) return;
      setTimeout(() => { void tryOnce(); }, SAVE_RETRY_SPACING_MS);
    };
    void tryOnce();
  }, [checkOnce]);

  return (
    <HandyContext.Provider value={{ key, updateKey, connected, checking, battery }}>
      {children}
    </HandyContext.Provider>
  );
}

export function useHandyContext() {
  return useContext(HandyContext);
}
