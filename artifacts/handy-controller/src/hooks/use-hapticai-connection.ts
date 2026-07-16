import { useState, useEffect, useRef, useCallback } from "react";

export type HapticAIStatus = "connecting" | "connected" | "unreachable";

export interface HapticAICapabilities {
  version?: string;
  options?: HapticAIOption[];
  session_token?: string;
}

export interface HapticAIOption {
  key: string;
  label: string;
  type: "number" | "boolean" | "select";
  default: unknown;
  min?: number;
  max?: number;
  step?: number;
  choices?: string[];
}

export interface HapticAIConnection {
  status: HapticAIStatus;
  capabilities: HapticAICapabilities;
  serverUrl: string;
  sessionToken: string;
  setServerUrl: (url: string) => void;
  retry: () => void;
}

const DEFAULT_URL = "http://localhost:8000";
const POLL_INTERVAL_MS = 3000;
const TIMEOUT_MS = 2500;

export function useHapticAIConnection(): HapticAIConnection {
  const [serverUrl, setServerUrl] = useState<string>(() => {
    try {
      return localStorage.getItem("hapticai_server_url") ?? DEFAULT_URL;
    } catch {
      return DEFAULT_URL;
    }
  });

  const [status, setStatus] = useState<HapticAIStatus>("connecting");
  const [capabilities, setCapabilities] = useState<HapticAICapabilities>({});
  const [sessionToken, setSessionToken] = useState<string>("");
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);

  const poll = useCallback(async (url: string) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(`${url}/status`, {
        signal: controller.signal,
        mode: "cors",
      });
      clearTimeout(timeoutId);
      if (!mountedRef.current) return;
      if (res.ok) {
        let caps: HapticAICapabilities = {};
        try {
          caps = (await res.json()) as HapticAICapabilities;
        } catch { /* ignore */ }
        setCapabilities(caps);
        if (caps.session_token) {
          setSessionToken(caps.session_token);
        }
        setStatus("connected");
      } else {
        setStatus("unreachable");
      }
    } catch {
      clearTimeout(timeoutId);
      if (!mountedRef.current) return;
      setStatus("unreachable");
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    setStatus("connecting");
    poll(serverUrl);
    intervalRef.current = setInterval(() => poll(serverUrl), POLL_INTERVAL_MS);
    return () => {
      mountedRef.current = false;
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [serverUrl, poll]);

  const handleSetServerUrl = useCallback((url: string) => {
    try {
      localStorage.setItem("hapticai_server_url", url);
    } catch { /* ignore */ }
    setServerUrl(url);
  }, []);

  const retry = useCallback(() => {
    setStatus("connecting");
    poll(serverUrl);
  }, [serverUrl, poll]);

  return { status, capabilities, serverUrl, sessionToken, setServerUrl: handleSetServerUrl, retry };
}
