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
  updateAvailable: boolean;
  latestVersion: string;
  retry: () => void;
}

const DAEMON_URL = "http://localhost:7860";
const POLL_INTERVAL_MS = 3000;
const TIMEOUT_MS = 2500;
const API = import.meta.env.VITE_API_URL ?? "";

function semverGt(a: string, b: string): boolean {
  const parse = (v: string) =>
    v
      .replace(/[^0-9.]/g, "")
      .split(".")
      .map((n) => parseInt(n, 10) || 0);
  const [aMaj = 0, aMin = 0, aPatch = 0] = parse(a);
  const [bMaj = 0, bMin = 0, bPatch = 0] = parse(b);
  if (aMaj !== bMaj) return aMaj > bMaj;
  if (aMin !== bMin) return aMin > bMin;
  return aPatch > bPatch;
}

export function useAIScripterConnection(): AIScripterConnection {
  const [status, setStatus] = useState<AIScripterStatus>("connecting");
  const [info, setInfo] = useState<AIScripterInfo>({});
  const [sessionToken, setSessionToken] = useState<string>("");
  const [ytDlpAvailable, setYtDlpAvailable] = useState<boolean>(false);
  const [latestVersion, setLatestVersion] = useState<string>("");
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

  useEffect(() => {
    let cancelled = false;
    fetch(`${API}/api/aiscripter/version`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { version?: string } | null) => {
        if (!cancelled && d?.version) setLatestVersion(d.version);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const retry = useCallback(() => {
    setStatus("connecting");
    poll();
  }, [poll]);

  const daemonVersion = info.version ?? "";
  const updateAvailable =
    status === "connected" &&
    !!latestVersion &&
    !!daemonVersion &&
    semverGt(latestVersion, daemonVersion);

  return { status, info, sessionToken, ytDlpAvailable, updateAvailable, latestVersion, retry };
}
