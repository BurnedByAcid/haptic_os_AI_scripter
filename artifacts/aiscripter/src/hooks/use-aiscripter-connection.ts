import { useState, useEffect, useRef, useCallback } from "react";

export type AIScripterStatus = "connecting" | "connected" | "unreachable";

export interface AIScripterInfo {
  version?: string;
  session_token?: string;
  yt_dlp_available?: boolean;
}

export interface AIScripterConnection {
  status: AIScripterStatus;
  info: AIScripterInfo;
  sessionToken: string;
  ytDlpAvailable: boolean;
  retry: () => void;
}

const DAEMON_URL = "http://localhost:7860";
const POLL_INTERVAL_MS = 3000;
const TIMEOUT_MS = 2500;

export function useAIScripterConnection(): AIScripterConnection {
  const [status, setStatus] = useState<AIScripterStatus>("connecting");
  const [info, setInfo] = useState<AIScripterInfo>({});
  const [sessionToken, setSessionToken] = useState<string>("");
  const [ytDlpAvailable, setYtDlpAvailable] = useState<boolean>(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);

  const poll = useCallback(async () => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(`${DAEMON_URL}/status`, {
        signal: controller.signal,
        mode: "cors",
      });
      clearTimeout(timeoutId);
      if (!mountedRef.current) return;
      if (res.ok) {
        let data: AIScripterInfo = {};
        try { data = (await res.json()) as AIScripterInfo; } catch { }
        setInfo(data);
        if (data.session_token) setSessionToken(data.session_token);
        setYtDlpAvailable(data.yt_dlp_available ?? false);
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
    poll();
    intervalRef.current = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      mountedRef.current = false;
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [poll]);

  const retry = useCallback(() => {
    setStatus("connecting");
    poll();
  }, [poll]);

  return { status, info, sessionToken, ytDlpAvailable, retry };
}
