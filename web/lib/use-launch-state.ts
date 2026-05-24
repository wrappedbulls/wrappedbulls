"use client";

// useLaunchState — client-side hook for runtime launch state.
//
// Client components cannot read the server-side state file, so this
// hook fetches /api/launch-state. While the request is in flight,
// `loading` is true and `state` is null — callers should render a
// neutral loading state, NOT flash pre-launch then live (or vice
// versa).
//
// On fetch failure the hook resolves to "pre-launch" — the safe
// default. A network blip must not accidentally expose the live wrap
// UI before the operator intends.

import { useEffect, useState } from "react";
import type { LaunchState, LaunchStateData } from "./launch-state";

export interface UseLaunchStateResult {
  /** null while loading; otherwise the resolved phase. */
  state: LaunchState | null;
  /** $TOKEN mint, or null. */
  tokenMint: string | null;
  /** true until the first fetch resolves. */
  loading: boolean;
}

export function useLaunchState(): UseLaunchStateResult {
  const [data, setData] = useState<LaunchStateData | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/launch-state", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: LaunchStateData) => {
        if (cancelled) return;
        setData({
          state: d?.state === "live" ? "live" : "pre-launch",
          tokenMint: d?.tokenMint ?? null,
          updatedAt: d?.updatedAt ?? null,
        });
      })
      .catch(() => {
        if (cancelled) return;
        // Safe default — never expose the live UI on a fetch error.
        setData({ state: "pre-launch", tokenMint: null, updatedAt: null });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return {
    state: data?.state ?? null,
    tokenMint: data?.tokenMint ?? null,
    loading: data === null,
  };
}
