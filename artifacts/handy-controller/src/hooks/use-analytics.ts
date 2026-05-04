import { useEffect, useRef } from "react";
import { useAuth } from "@clerk/react";

const API_BASE = import.meta.env.VITE_API_URL ?? "";

type Feature = "scripter" | "games" | "beat" | "player" | "community" | "library" | "control";

/**
 * Call this hook once at the top of a page component to record a feature
 * usage event. Fires at most once per mount. Silent on failure.
 */
export function useFeatureTracking(feature: Feature) {
  const { getToken, isSignedIn } = useAuth();
  const fired = useRef(false);

  useEffect(() => {
    if (!isSignedIn || fired.current) return;
    fired.current = true;

    getToken().then((token) => {
      if (!token) return;
      fetch(`${API_BASE}/api/analytics/event`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ feature }),
      }).catch(() => {
        // Silent — analytics should never break the UI
      });
    }).catch(() => {});
  }, [isSignedIn]); // eslint-disable-line react-hooks/exhaustive-deps
}
