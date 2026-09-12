"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const FLASH_MS = 900;

type FlashToken = "a" | "b";
type FlashTone = "accent" | "danger";

export interface FlashProps {
  "data-flash"?: FlashToken;
  "data-flash-tone"?: FlashTone;
}

/**
 * Marks the surface something just happened on so it can tint and fade instead
 * of a toast announcing it from the bottom of the screen. Keys are whatever the
 * caller wants to address - an entry id, a section name.
 */
export function useFlash() {
  const [tokens, setTokens] = useState<Record<string, FlashToken>>({});
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(
    () => () => {
      for (const timer of timers.current.values()) clearTimeout(timer);
      timers.current.clear();
    },
    [],
  );

  const flash = useCallback((key: string) => {
    setTokens((current) => ({
      ...current,
      [key]: current[key] === "a" ? "b" : "a",
    }));

    const running = timers.current.get(key);
    if (running) clearTimeout(running);
    timers.current.set(
      key,
      setTimeout(() => {
        timers.current.delete(key);
        setTokens((current) => {
          if (!(key in current)) return current;
          const next = { ...current };
          delete next[key];
          return next;
        });
      }, FLASH_MS),
    );
  }, []);

  const flashProps = useCallback(
    (key: string, tone: FlashTone = "accent"): FlashProps => {
      const token = tokens[key];
      if (!token) return {};
      return { "data-flash": token, "data-flash-tone": tone };
    },
    [tokens],
  );

  return { flash, flashProps };
}
