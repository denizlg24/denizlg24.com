"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import type { AlertEvent } from "@/lib/models";

const key = "stockwatcher.browserAlerts";
const changed = "stockwatcher:browser-alerts";

type State = "on" | "off" | "denied" | "unsupported";

function read(): State {
  if (typeof window === "undefined" || !("Notification" in window))
    return "unsupported";
  if (Notification.permission === "denied") return "denied";
  let wanted = false;
  try {
    wanted = localStorage.getItem(key) === "1";
  } catch {}
  return wanted && Notification.permission === "granted" ? "on" : "off";
}

function subscribe(update: () => void) {
  window.addEventListener("storage", update);
  window.addEventListener(changed, update);
  return () => {
    window.removeEventListener("storage", update);
    window.removeEventListener(changed, update);
  };
}

function store(on: boolean) {
  try {
    localStorage.setItem(key, on ? "1" : "0");
  } catch {}
  window.dispatchEvent(new Event(changed));
}

export function useBrowserAlerts() {
  const state = useSyncExternalStore(subscribe, read, () => "off" as State);
  async function toggle() {
    if (state === "on") return store(false);
    const permission = await Notification.requestPermission();
    store(permission === "granted");
    if (permission === "granted")
      new Notification("Stockwatcher alerts are on", {
        body: "Alerts will pop up here while Stockwatcher is open.",
        tag: "stockwatcher-test",
      });
  }
  return { state, toggle };
}

/** Announces alert events that arrive after the page loaded. */
export function useAlertAnnouncer(
  log: AlertEvent[],
  announce: (text: string) => void,
) {
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!seen.current) {
      seen.current = new Set(log.map((event) => event.id));
      return;
    }
    const fresh = log.filter((event) => !seen.current!.has(event.id));
    for (const event of fresh) seen.current.add(event.id);
    if (!fresh.length) return;
    const first = fresh[0]!;
    announce(
      fresh.length === 1
        ? `Alert · ${first.symbol}: ${first.message.split("\n")[0]}`
        : `${fresh.length} alerts fired: ${fresh.map((event) => event.symbol).join(", ")}`,
    );
    if (read() !== "on") return;
    for (const event of fresh.slice(0, 4))
      new Notification(`${event.symbol} alert`, {
        body: event.message,
        tag: event.id,
      });
  }, [log, announce]);
}
