"use client";

import { Volume2, VolumeX } from "lucide-react";
import {
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

const ORIGIN = "https://www.youtube-nocookie.com";

function trailerUrl(key: string): string {
  const params = new URLSearchParams({
    autoplay: "1",
    mute: "1",
    controls: "0",
    loop: "1",
    playlist: key,
    playsinline: "1",
    rel: "0",
    iv_load_policy: "3",
    disablekb: "1",
    modestbranding: "1",
    enablejsapi: "1",
    fs: "0",
  });
  return `${ORIGIN}/embed/${key}?${params.toString()}`;
}

function quietScreen(): boolean {
  return (
    document.documentElement.hasAttribute("data-tv") ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * A muted YouTube trailer that fades in over a still after `delayMs`, the
 * way a billboard comes alive. Skipped on TVs, under reduced motion and on
 * narrow screens; paused while scrolled away, while the tab is hidden and,
 * with `pauseWhenInert`, while a details modal covers the page.
 */
export function useTrailer(
  trailerKey: string | null,
  {
    delayMs = 2500,
    minWidth = 768,
    pauseWhenInert = false,
  }: { delayMs?: number; minWidth?: number; pauseWhenInert?: boolean } = {},
) {
  const box = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);
  const [muted, setMuted] = useState(true);

  const command = useCallback((func: string) => {
    frame.current?.contentWindow?.postMessage(
      JSON.stringify({ event: "command", func, args: [] }),
      ORIGIN,
    );
  }, []);

  useEffect(() => {
    setMounted(false);
    setVisible(false);
    setMuted(true);
    if (!trailerKey || quietScreen() || window.innerWidth < minWidth) return;
    const timer = window.setTimeout(() => setMounted(true), delayMs);
    return () => window.clearTimeout(timer);
  }, [trailerKey, delayMs, minWidth]);

  useEffect(() => {
    if (!mounted || !box.current) return;
    let onScreen = true;
    const page = document.getElementById("page");
    const sync = () => {
      const covered = pauseWhenInert && page?.hasAttribute("inert");
      command(
        onScreen && !covered && document.visibilityState === "visible"
          ? "playVideo"
          : "pauseVideo",
      );
    };
    const observer = new IntersectionObserver(
      ([entry]) => {
        onScreen = entry.isIntersecting;
        sync();
      },
      { threshold: 0.35 },
    );
    observer.observe(box.current);
    const inert = new MutationObserver(sync);
    if (pauseWhenInert && page) {
      inert.observe(page, { attributes: true, attributeFilter: ["inert"] });
    }
    document.addEventListener("visibilitychange", sync);
    return () => {
      observer.disconnect();
      inert.disconnect();
      document.removeEventListener("visibilitychange", sync);
    };
  }, [mounted, pauseWhenInert, command]);

  // Only a trailer that actually plays is shown: a region-blocked or removed
  // video answers with an error page, which must never cover the still.
  useEffect(() => {
    if (!mounted) return;
    let reveal: number | undefined;
    const onMessage = (event: MessageEvent) => {
      if (
        event.origin !== ORIGIN ||
        event.source !== frame.current?.contentWindow
      )
        return;
      if (typeof event.data !== "string") return;
      let message: { event?: string; info?: { playerState?: number } | number };
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      const state =
        message.event === "onStateChange" && typeof message.info === "number"
          ? message.info
          : message.event === "infoDelivery" && typeof message.info === "object"
            ? message.info.playerState
            : undefined;
      if (message.event === "onError") {
        window.clearTimeout(reveal);
        setVisible(false);
        setMounted(false);
      } else if (state === 1 && reveal === undefined) {
        // YouTube shows its title bar for the first moment; wait it out.
        reveal = window.setTimeout(() => setVisible(true), 900);
      }
    };
    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
      window.clearTimeout(reveal);
    };
  }, [mounted]);

  const onLoad = useCallback(() => {
    frame.current?.contentWindow?.postMessage(
      JSON.stringify({ event: "listening", id: "stream-trailer" }),
      ORIGIN,
    );
  }, []);

  const toggleMute = useCallback(() => {
    command(muted ? "unMute" : "mute");
    setMuted(!muted);
  }, [command, muted]);

  return { box, frame, mounted, visible, muted, toggleMute, onLoad };
}

export function TrailerFrame({
  trailerKey,
  frame,
  visible,
  onLoad,
}: {
  trailerKey: string;
  frame: RefObject<HTMLIFrameElement | null>;
  visible: boolean;
  onLoad: () => void;
}) {
  return (
    <div
      aria-hidden
      className={`cover-frame absolute inset-0 overflow-hidden transition-opacity duration-1000 ${visible ? "opacity-100" : "opacity-0"}`}
    >
      <iframe
        ref={frame}
        src={trailerUrl(trailerKey)}
        title="Trailer"
        tabIndex={-1}
        allow="autoplay; encrypted-media"
        referrerPolicy="strict-origin-when-cross-origin"
        onLoad={onLoad}
      />
    </div>
  );
}

export function MuteButton({
  muted,
  onToggle,
  className = "",
}: {
  muted: boolean;
  onToggle: () => void;
  className?: string;
}) {
  const Icon = muted ? VolumeX : Volume2;
  return (
    <button
      type="button"
      data-nav
      onClick={onToggle}
      aria-label={muted ? "Turn sound on" : "Turn sound off"}
      className={`grid size-10 shrink-0 place-items-center rounded-full border-2 border-paper/60 bg-ink/30 text-paper transition-colors hover:border-paper hover:bg-paper/10 md:size-11 ${className}`}
    >
      <Icon className="size-5" strokeWidth={2} />
    </button>
  );
}
