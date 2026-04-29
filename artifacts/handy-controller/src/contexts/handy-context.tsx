import { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import { getStatus } from "@/lib/handyApi";

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

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const checkStatus = useCallback(async (k: string) => {
    if (!k || !mountedRef.current) return;
    setChecking(true);
    try {
      const res = await getStatus(k);
      if (!mountedRef.current) return;
      setConnected(res.connected);
      if (res.battery !== undefined) setBattery(res.battery);
    } catch {
      if (mountedRef.current) setConnected(false);
    } finally {
      if (mountedRef.current) setChecking(false);
    }
  }, []);

  useEffect(() => {
    if (!key) { setConnected(false); return; }
    checkStatus(key);
    const id = setInterval(() => checkStatus(key), 5000);
    return () => clearInterval(id);
  }, [key, checkStatus]);

  const updateKey = useCallback((newKey: string) => {
    localStorage.setItem("handy_connection_key", newKey);
    setKey(newKey);
    setConnected(false);
  }, []);

  return (
    <HandyContext.Provider value={{ key, updateKey, connected, checking, battery }}>
      {children}
    </HandyContext.Provider>
  );
}

export function useHandyContext() {
  return useContext(HandyContext);
}
