"use client";

import { useCallback, useSyncExternalStore } from "react";

declare module "react" {
  interface CSSProperties {
    "--dock"?: string;
  }
}

const storageKey = "stockwatcher.assistant.width";
const changeEvent = "stockwatcher:dock-width";
const rail = 76;
const mainMin = 480;

export const dockMin = 320;
const dockCeiling = 900;

let memory: number | null | undefined;

function readStored(): number | null {
  if (memory !== undefined) return memory;
  try {
    const raw = window.localStorage.getItem(storageKey);
    const value = raw === null ? Number.NaN : Number(raw);
    memory = Number.isFinite(value) ? value : null;
  } catch {
    memory = null;
  }
  return memory;
}

function subscribeStored(onChange: () => void) {
  const external = (event: StorageEvent) => {
    if (event.key !== storageKey) return;
    memory = undefined;
    onChange();
  };
  window.addEventListener("storage", external);
  window.addEventListener(changeEvent, onChange);
  return () => {
    window.removeEventListener("storage", external);
    window.removeEventListener(changeEvent, onChange);
  };
}

function subscribeViewport(onChange: () => void) {
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

export const dockMax = (viewport: number) =>
  Math.max(dockMin, Math.min(dockCeiling, viewport - rail - mainMin));

/** Mirrors the CSS default, `clamp(340px, 27vw, 440px)`. */
const dockDefault = (viewport: number) => clamp(viewport * 0.27, 340, 440);

export function useDockWidth() {
  const stored = useSyncExternalStore(subscribeStored, readStored, () => null);
  const viewport = useSyncExternalStore(
    subscribeViewport,
    () => window.innerWidth,
    () => 0,
  );
  const max = dockMax(viewport);
  const width = viewport
    ? Math.round(clamp(stored ?? dockDefault(viewport), dockMin, max))
    : null;

  const set = useCallback((next: number, persist: boolean) => {
    const value = Math.round(clamp(next, dockMin, dockMax(window.innerWidth)));
    memory = value;
    if (persist)
      try {
        window.localStorage.setItem(storageKey, String(value));
      } catch {}
    window.dispatchEvent(new Event(changeEvent));
  }, []);

  const reset = useCallback(() => {
    memory = null;
    try {
      window.localStorage.removeItem(storageKey);
    } catch {}
    window.dispatchEvent(new Event(changeEvent));
  }, []);

  return { width, custom: stored !== null, min: dockMin, max, set, reset };
}
