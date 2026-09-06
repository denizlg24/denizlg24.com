"use client";
import { useRouter } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";

export function Live({
  at,
  generatedAt,
  children,
}: {
  at: string | null;
  generatedAt: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const [now, setNow] = useState(Date.parse(generatedAt));
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const refresh = () => {
      tick();
      if (document.visibilityState === "visible" && navigator.onLine)
        router.refresh();
    };
    const connectivity = () => {
      setOnline(navigator.onLine);
      refresh();
    };
    const clock = setInterval(tick, 15_000);
    const poll = setInterval(refresh, 60_000);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("online", connectivity);
    window.addEventListener("offline", connectivity);
    connectivity();
    return () => {
      clearInterval(clock);
      clearInterval(poll);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("online", connectivity);
      window.removeEventListener("offline", connectivity);
    };
  }, [router]);
  const stale = !online || !at || now - Date.parse(at) > 180_000;
  return (
    <div data-stale={stale ? "true" : "false"}>
      {children}
      <div className="freshness">
        <span className="freshness-text" role="status">
          {!online
            ? "Offline"
            : !at
              ? "No data"
              : stale
                ? "Updates delayed"
                : `Updated ${Math.max(0, Math.floor((now - Date.parse(at)) / 1000))}s ago`}
        </span>
        <button
          type="button"
          className="text-button"
          onClick={() => router.refresh()}
        >
          Refresh <span aria-hidden="true">↻</span>
        </button>
      </div>
    </div>
  );
}
export function ThemeToggle() {
  const [dark, setDark] = useState(false);
  useEffect(
    () => setDark(document.documentElement.classList.contains("dark")),
    [],
  );
  return (
    <button
      className="theme-button"
      type="button"
      aria-label={dark ? "Use light theme" : "Use dark theme"}
      onClick={() => {
        const next = !dark;
        setDark(next);
        document.documentElement.classList.toggle("dark", next);
        try {
          localStorage.setItem("deniz-status-theme", next ? "dark" : "light");
        } catch {}
      }}
    >
      <span aria-hidden="true">{dark ? "☀" : "◐"}</span>
    </button>
  );
}
