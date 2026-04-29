import { useState, useEffect } from "react";
import { getStatus } from "@/lib/handyApi";

export function useHandy() {
  const [key, setKey] = useState(() => localStorage.getItem("handy_connection_key") || "");
  const [connected, setConnected] = useState(false);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (!key) {
      setConnected(false);
      return;
    }

    let mounted = true;
    const check = async () => {
      if (!mounted) return;
      setChecking(true);
      try {
        const res = await getStatus(key);
        if (mounted) {
          setConnected(res.connected);
        }
      } catch (e) {
        if (mounted) setConnected(false);
      } finally {
        if (mounted) setChecking(false);
      }
    };

    check();
    const interval = setInterval(check, 5000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [key]);

  const updateKey = (newKey: string) => {
    localStorage.setItem("handy_connection_key", newKey);
    setKey(newKey);
  };

  return { key, updateKey, connected, checking };
}
