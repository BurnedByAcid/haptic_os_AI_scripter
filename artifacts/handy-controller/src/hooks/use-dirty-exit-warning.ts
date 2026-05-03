import { useEffect, useRef } from "react";

interface Options {
  /** True when the page has unsaved work that would be lost on exit. */
  dirty: boolean;
  /**
   * Called when the user attempts in-app navigation (Wouter <Link/>, raw <a>,
   * or browser back/forward) while the page is dirty. Receives the would-be
   * destination href so the caller can replay the navigation after a confirm
   * dialog. For popstate (back/forward) the href is `null` because the
   * browser doesn't expose the original target — the caller can simply offer
   * "stay" / "leave (history.back)" UX. Return `true` to allow navigation
   * through, `false` to cancel it.
   */
  onAttemptNavigate: (href: string | null) => boolean;
}

/**
 * Warn the user when they try to leave a page with unsaved work.
 *
 * - `beforeunload` covers tab close / refresh (browsers strip custom text but
 *   still show a generic confirm if `returnValue` is set).
 * - A capture-phase document click handler intercepts <a> clicks (which is how
 *   Wouter's <Link/> navigates internally) so we can show an in-app dialog
 *   before the URL changes. Anchors with `target="_blank"`, modifier-key
 *   clicks, and external URLs are left alone.
 */
export function useDirtyExitWarning({ dirty, onAttemptNavigate }: Options): void {
  // Refs so handlers stay stable but always read the current values.
  const dirtyRef = useRef(dirty);
  const navRef = useRef(onAttemptNavigate);
  useEffect(() => { dirtyRef.current = dirty; }, [dirty]);
  useEffect(() => { navRef.current = onAttemptNavigate; }, [onAttemptNavigate]);

  useEffect(() => {
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);

    const onClick = (e: MouseEvent) => {
      if (!dirtyRef.current) return;
      // Honour modifier keys (open in new tab/window) and middle-click
      if (e.defaultPrevented) return;
      if (e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

      const target = e.target as Element | null;
      const anchor = target?.closest?.("a") as HTMLAnchorElement | null;
      if (!anchor) return;
      if (anchor.target && anchor.target !== "_self") return;
      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("#")) return;

      // Same-page anchors (no path change) — let them pass.
      try {
        const dest = new URL(anchor.href, window.location.href);
        if (
          dest.origin === window.location.origin &&
          dest.pathname === window.location.pathname &&
          dest.search === window.location.search
        ) return;
      } catch {
        return;
      }

      const allow = navRef.current(anchor.href);
      if (!allow) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    document.addEventListener("click", onClick, true);

    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, []);

  // Guard browser back/forward only while the page is dirty. We do NOT
  // pre-push a sentinel state on mount (that would pollute history and
  // force users to press Back twice on a clean page). Instead, when the
  // user actually presses Back/Forward while dirty:
  //   1. The browser has already moved to the prior history entry.
  //   2. We re-push the page's URL so the user visually stays put.
  //   3. We ask the caller to confirm; on "leave anyway" the caller
  //      issues a single `history.back()` which lands on the original
  //      back-target — one deterministic replay path, no double-back.
  useEffect(() => {
    if (!dirty) return;
    const sentinelUrl = window.location.href;
    const onPopState = () => {
      if (!dirtyRef.current) return;
      try { window.history.pushState(null, "", sentinelUrl); } catch { /* ignore */ }
      navRef.current(null);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [dirty]);
}
