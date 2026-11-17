"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorMessage, type TournamentState } from "./api";

export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export const SCORES_REFRESH_MS = 10 * 60 * 1000;
const HIDDEN_REFRESH_MS = 60 * 1000;
const AT_TRANSITION_DELAY_MS = 1500;

/**
 * Calls `load` every 10 minutes while the tab is visible, and when the tab becomes
 * visible again after being hidden for more than a minute. Does not call it on mount.
 */
export function useScoresRefresh(load: () => void, enabled = true): void {
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });
  useEffect(() => {
    if (!enabled) return;
    let hiddenAt: number | null = document.visibilityState === "hidden" ? Date.now() : null;
    const id = setInterval(() => {
      if (document.visibilityState === "visible") loadRef.current();
    }, SCORES_REFRESH_MS);
    const onVis = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
      } else {
        if (hiddenAt !== null && Date.now() - hiddenAt > HIDDEN_REFRESH_MS) loadRef.current();
        hiddenAt = null;
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [enabled]);
}

/**
 * Calls `load` shortly after the soonest of the given times (a matchup opening or closing,
 * or a countdown on the page reaching zero). Times already in the past are ignored.
 */
export function useRefreshAt(times: (string | null | undefined)[], load: () => void): void {
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });
  const key = times.filter(Boolean).join("|");
  useEffect(() => {
    const now = Date.now();
    let soonest = Infinity;
    for (const t of key ? key.split("|") : []) {
      const ms = Date.parse(t);
      if (!Number.isNaN(ms) && ms > now && ms < soonest) soonest = ms;
    }
    if (!Number.isFinite(soonest)) return;
    const delay = Math.min(soonest - now + AT_TRANSITION_DELAY_MS, 2 ** 31 - 1);
    const id = setTimeout(() => loadRef.current(), delay);
    return () => clearTimeout(id);
  }, [key]);
}

export function useTournament(
  slug: string,
  opts: { refresh?: boolean; enabled?: boolean } = {},
): { data: TournamentState | null; error: string | null; refetch: () => void } {
  const [state, setState] = useState<{ data: TournamentState | null; error: string | null }>({
    data: null,
    error: null,
  });
  const [tick, setTick] = useState(0);
  const refetch = useCallback(() => setTick((t) => t + 1), []);
  const enabled = opts.enabled !== false;
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    api
      .getTournament(slug)
      .then((data) => {
        if (!cancelled) setState({ data, error: null });
      })
      .catch((e) => {
        // Keep showing the last good data when a background refresh fails.
        if (!cancelled) setState((prev) => ({ data: prev.data, error: prev.data ? null : errorMessage(e) }));
      });
    return () => {
      cancelled = true;
    };
  }, [slug, tick, enabled]);
  useScoresRefresh(refetch, enabled && opts.refresh === true);
  return { ...state, refetch };
}

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function instagramUrl(handle: string): string {
  return `https://www.instagram.com/${encodeURIComponent(handle)}/`;
}
