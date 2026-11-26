"use client";

import { useCallback, useSyncExternalStore } from "react";

const flagEvent = "stockwatcher:flag";
const flags = new Map<string, boolean>();

function readFlag(key: string, fallback: boolean) {
  const known = flags.get(key);
  if (known !== undefined) return known;
  try {
    const stored = window.localStorage.getItem(key);
    return stored === null ? fallback : stored === "1";
  } catch {
    return fallback;
  }
}

export function useStoredFlag(key: string, fallback: boolean) {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const external = (event: StorageEvent) => {
        if (event.key !== key) return;
        flags.delete(key);
        onChange();
      };
      window.addEventListener("storage", external);
      window.addEventListener(flagEvent, onChange);
      return () => {
        window.removeEventListener("storage", external);
        window.removeEventListener(flagEvent, onChange);
      };
    },
    [key],
  );
  const value = useSyncExternalStore(
    subscribe,
    () => readFlag(key, fallback),
    () => fallback,
  );
  const set = useCallback(
    (next: boolean) => {
      flags.set(key, next);
      try {
        window.localStorage.setItem(key, next ? "1" : "0");
      } catch {}
      window.dispatchEvent(new Event(flagEvent));
    },
    [key],
  );
  return [value, set] as const;
}

export function useMediaQuery(query: string) {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}

function watchHash(onChange: () => void) {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}
const readHash = () => window.location.hash.slice(1);
const noHash = () => "";

export const useHash = () => useSyncExternalStore(watchHash, readHash, noHash);
