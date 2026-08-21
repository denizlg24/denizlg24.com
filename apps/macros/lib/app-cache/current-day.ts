"use client";

import { useSyncExternalStore } from "react";

const dayFormatter = new Intl.DateTimeFormat("en-CA");
const listeners = new Set<() => void>();

let currentDay = "";
let midnightTimer: ReturnType<typeof setTimeout> | null = null;
let watching = false;

function computeDay(): string {
  return dayFormatter.format(new Date());
}

function scheduleMidnightCheck() {
  if (midnightTimer) clearTimeout(midnightTimer);

  const now = new Date();
  const nextMidnight = new Date(now);
  nextMidnight.setHours(24, 0, 0, 0);
  const delay = Math.min(
    Math.max(nextMidnight.getTime() - now.getTime() + 1_000, 1_000),
    6 * 60 * 60 * 1_000,
  );

  midnightTimer = setTimeout(refresh, delay);
}

function refresh() {
  const next = computeDay();

  if (next !== currentDay) {
    currentDay = next;
    for (const listener of listeners) listener();
  }

  scheduleMidnightCheck();
}

function onVisible() {
  if (document.visibilityState === "visible") refresh();
}

function startWatching() {
  if (watching) return;
  watching = true;

  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("focus", refresh);
  window.addEventListener("pageshow", refresh);
  window.addEventListener("online", refresh);
  scheduleMidnightCheck();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  startWatching();
  refresh();

  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): string {
  const next = computeDay();
  if (next !== currentDay) currentDay = next;
  return currentDay;
}

/**
 * The device-local calendar day, re-read whenever the app is resumed, refocused
 * or crosses midnight. Day-scoped queries key on it so a cache persisted before
 * a rollover can never be served as today.
 */
export function useCurrentDay(): string {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
