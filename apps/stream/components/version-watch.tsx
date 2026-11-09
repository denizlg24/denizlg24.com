"use client";

import { webVersionSchema } from "@repo/schemas/stream";
import { RefreshCw } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const BUILD = process.env.NEXT_PUBLIC_STREAM_BUILD ?? "dev";
const POLL_MS = 5 * 60 * 1000;

function playing(pathname: string): boolean {
  return pathname.startsWith("/watch/");
}

/**
 * Notices a new deploy in tabs, TVs and the desktop shell that stay open
 * for days. The next navigation reloads quietly; an idle tab gets a toast.
 * Nothing happens while a film is playing.
 */
export function VersionWatch() {
  const pathname = usePathname();
  const [stale, setStale] = useState(false);
  const firstPath = useRef(pathname);

  useEffect(() => {
    if (BUILD === "dev") return;
    let cancelled = false;
    const check = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const response = await fetch("/api/public/version", {
          cache: "no-store",
        });
        if (!response.ok) return;
        const parsed = webVersionSchema.safeParse(await response.json());
        if (!cancelled && parsed.success && parsed.data.version !== BUILD) {
          setStale(true);
        }
      } catch {
        // Offline or mid-deploy: the next check tries again.
      }
    };
    const timer = window.setInterval(check, POLL_MS);
    document.addEventListener("visibilitychange", check);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", check);
    };
  }, []);

  useEffect(() => {
    if (pathname === firstPath.current) return;
    firstPath.current = pathname;
    if (stale && !playing(pathname)) window.location.reload();
  }, [pathname, stale]);

  if (!stale || playing(pathname)) return null;
  return (
    <div
      role="status"
      className="fixed right-[var(--gutter)] bottom-[calc(1rem+env(safe-area-inset-bottom))] z-[60] flex max-w-[calc(100vw-2*var(--gutter))] items-center gap-4 rounded-md bg-paper py-2.5 pr-2.5 pl-4 text-sm text-ink shadow-2xl animate-rise"
    >
      <span className="min-w-0">Stream has been updated.</span>
      <button
        type="button"
        data-nav
        onClick={() => window.location.reload()}
        className="flex shrink-0 items-center gap-2 rounded bg-ink px-3 py-1.5 font-bold text-paper"
      >
        <RefreshCw className="size-4" aria-hidden />
        Reload
      </button>
    </div>
  );
}
