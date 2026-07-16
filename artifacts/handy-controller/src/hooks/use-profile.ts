import { useState, useEffect } from "react";
import { useAuth } from "@clerk/react";

const API = import.meta.env.VITE_API_URL ?? "";

interface Profile {
  username: string;
  plan: string;
}

/**
 * Fetches the signed-in user's profile (username + plan) from the DB.
 * The username is the permanent, unique name chosen at registration —
 * it never changes and is the same on every device/login.
 */
export function useProfile(): { username: string | null; isLoaded: boolean } {
  const { getToken, isSignedIn, isLoaded: isAuthLoaded } = useAuth();
  const [username, setUsername] = useState<string | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    if (!isAuthLoaded) return;
    if (!isSignedIn) {
      setUsername(null);
      setIsLoaded(true);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        const headers: Record<string, string> = {};
        if (token) headers["Authorization"] = `Bearer ${token}`;
        const res = await fetch(`${API}/api/users/me`, { headers });
        if (!res.ok) { setIsLoaded(true); return; }
        const data = (await res.json()) as Profile;
        if (!cancelled) {
          setUsername(data.username);
          setIsLoaded(true);
        }
      } catch {
        if (!cancelled) setIsLoaded(true);
      }
    })();

    return () => { cancelled = true; };
  }, [isAuthLoaded, isSignedIn, getToken]);

  return { username, isLoaded };
}
