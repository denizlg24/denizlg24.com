"use client";

import {
  type EmbedProgress,
  embedPlayerUrl,
  parseEmbedProgress,
} from "@repo/schemas/stream";
import {
  ArrowLeft,
  Check,
  Maximize,
  Minimize,
  MousePointerClick,
  Pause,
  Play,
  RotateCw,
  SkipForward,
  Volume2,
  VolumeX,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { ControlButton } from "./control-button";
import { SkipIcon } from "./controls";
import {
  embedEnvironment,
  serverEmbedEnvironment,
  subscribeEmbedEnvironment,
} from "./embed-environment";
import { useHoldSeek } from "./hold-seek";
import { type Direction, SEEK_STEP_S } from "./keyboard";
import { SeekBar } from "./seek-bar";
import type { StreamPlayerProps } from "./stream-player";
import { cx, iconSize } from "./styles";
import { formatTime } from "./time";
import { UpNext } from "./up-next";
import { useAutoHide } from "./use-auto-hide";
import { moveFocus } from "./use-keyboard";

const UNLOCK_MS = 30_000;
const TV_SEEK_STEP_S = 30;
// The provider's title strip and control bar, clipped while our controls
// stand in for them. Measured on its player; it has no option to hide them.
const PROVIDER_TOP_PX = 64;
const PROVIDER_BOTTOM_PX = 96;

const ARROWS: Record<string, Direction> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
};
const SEEK_KEYS: Record<string, -1 | 1> = {
  ArrowLeft: -1,
  j: -1,
  ArrowRight: 1,
  l: 1,
};

type Clock = {
  position: number;
  duration: number;
  at: number;
  running: boolean;
};

export function EmbedPlayer({
  playback,
  title,
  subtitle,
  onBack,
  onNext,
  onViewing,
  onProgress,
  autoPlay = true,
  nextCountdownS = 10,
  tv = false,
}: StreamPlayerProps) {
  const environment = useSyncExternalStore(
    subscribeEmbedEnvironment,
    embedEnvironment,
    serverEmbedEnvironment,
  );
  // A browser cannot block another site's scripts, so on the web the provider
  // never receives a click once it is playing: the shield takes them and the
  // player is driven through its message API. The desktop host blocks natively.
  const shielded = environment !== "native";
  const iframe = useRef<HTMLIFrameElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const playButton = useRef<HTMLButtonElement>(null);
  const step = tv ? TV_SEEK_STEP_S : SEEK_STEP_S;
  const [attempt, setAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState<EmbedProgress | null>(null);
  const [clock, setClock] = useState<Clock | null>(null);
  const [now, setNow] = useState(0);
  const [armed, setArmed] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [muted, setMuted] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [scrubbing, setScrubbing] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const started = useRef(false);
  const restored = useRef(false);
  const lastSent = useRef(0);
  const latest = useRef({ onProgress, progress, completed });
  latest.current = { onProgress, progress, completed };
  const url = embedPlayerUrl(playback.embed!.url, autoPlay);
  const origin = new URL(url).origin;
  const shieldUp = shielded && armed && !unlocked;
  const chrome = useAutoHide(!clock?.running || scrubbing);

  const command = useCallback(
    (action: string) =>
      iframe.current?.contentWindow?.postMessage(
        { player: true, action },
        origin,
      ),
    [origin],
  );

  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (
        event.source !== iframe.current?.contentWindow ||
        event.origin !== origin
      )
        return;
      const update = parseEmbedProgress(event.data, playback.embed!.url);
      if (!update) return;
      setArmed(true);
      if (!restored.current) {
        restored.current = true;
        const resume = playback.resume;
        if (
          resume &&
          !resume.completed &&
          resume.positionS >= 30 &&
          resume.positionS < update.duration - 10
        ) {
          command(`seek${Math.floor(resume.positionS)}`);
          return;
        }
      }
      const at = Date.now();
      setNow(at);
      setClock((previous) => ({
        position: update.position,
        duration: update.duration,
        at,
        running:
          update.status === "playing" ||
          (update.status === "seeked" && (previous?.running ?? false)),
      }));
      setProgress(update);
      if (update.status === "completed") setCompleted(true);
      else if (
        (update.status === "playing" || update.status === "seeked") &&
        update.position < update.duration - 2
      ) {
        setCompleted(false);
        setDismissed(false);
      }
      if (update.status !== "playing" || at - lastSent.current >= 10_000) {
        lastSent.current = at;
        latest.current.onProgress?.(update.position, update.duration);
      }
    };
    window.addEventListener("message", receive);
    return () => {
      window.removeEventListener("message", receive);
      const value = latest.current.progress;
      if (value && !latest.current.completed)
        latest.current.onProgress?.(value.position, value.duration);
    };
  }, [origin, command, playback.embed, playback.resume]);

  useEffect(() => {
    if (!clock?.running) return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [clock?.running]);

  useEffect(() => {
    if (!unlocked) return;
    const timer = setTimeout(() => setUnlocked(false), UNLOCK_MS);
    return () => clearTimeout(timer);
  }, [unlocked]);

  useEffect(() => {
    const sync = () => setFullscreen(document.fullscreenElement !== null);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

  // Provider frames may still redirect the whole tab; make that ask first.
  useEffect(() => {
    if (!shielded) return;
    const guard = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [shielded]);

  const position = clock
    ? Math.min(
        clock.duration,
        clock.position + (clock.running ? (now - clock.at) / 1000 : 0),
      )
    : 0;

  const moveClock = (patch: Partial<Clock>) => {
    const at = Date.now();
    setNow(at);
    setClock((previous) =>
      previous ? { ...previous, position, at, ...patch } : previous,
    );
  };
  const togglePlay = () => {
    command(clock?.running ? "pause" : "play");
    moveClock({ running: !clock?.running });
    chrome.reveal();
  };
  const seekTo = (seconds: number) => {
    const target = Math.max(0, Math.min(clock?.duration ?? 0, seconds));
    command(`seek${Math.floor(target)}`);
    moveClock({ position: target });
    chrome.reveal();
  };
  const hold = useHoldSeek({
    step,
    position,
    duration: clock?.duration ?? 0,
    commit: seekTo,
  });
  const shown = hold.target ?? position;
  const { reveal } = chrome;
  useEffect(() => {
    if (hold.target !== null) reveal();
  }, [hold.target, reveal]);

  // Once the shield is up the remote and keyboard must reach this page, not
  // the provider's frame, which still holds focus from the landing click.
  useEffect(() => {
    if (!shieldUp) return;
    const active = document.activeElement;
    if (!active || active === document.body || active === iframe.current)
      playButton.current?.focus({ preventScroll: true });
  }, [shieldUp]);

  const toggleMute = () => {
    command(muted ? "unmute" : "mute");
    setMuted(!muted);
  };
  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void stage.current?.requestFullscreen();
  };

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target instanceof Element ? event.target : null;
      const control = target?.closest<HTMLElement>("[data-player-nav]");
      const inside = control && root.current?.contains(control);
      const direction = ARROWS[event.key];
      const seekKey = SEEK_KEYS[event.key];
      if (inside && control.dataset.playerRole === "seek" && seekKey) {
        event.preventDefault();
        hold.start(seekKey, true);
        return;
      }
      if (inside && direction && root.current) {
        if (moveFocus(root.current, direction)) event.preventDefault();
        return;
      }
      if (
        !shieldUp ||
        target?.closest("button, input, select, textarea, [contenteditable]")
      )
        return;
      if (seekKey) {
        event.preventDefault();
        hold.start(seekKey, true);
        return;
      }
      const actions: Record<string, () => void> = {
        " ": togglePlay,
        k: togglePlay,
        m: toggleMute,
        f: toggleFullscreen,
      };
      const action = actions[event.key];
      if (!action) return;
      event.preventDefault();
      action();
    };
    const up = (event: KeyboardEvent) => {
      if (SEEK_KEYS[event.key]) hold.stop();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  });

  const save = async () => {
    if (!onViewing) return;
    setSaving(true);
    try {
      if (await onViewing(true)) {
        setCompleted(true);
        setDismissed(false);
        setError("");
      } else setError("Couldn't mark this watched. Try again.");
    } catch {
      setError("Couldn't mark this watched. Try again.");
    } finally {
      setSaving(false);
    }
  };
  return (
    <div
      ref={root}
      className="relative flex h-full min-h-0 flex-col bg-black text-paper"
    >
      <header className="flex shrink-0 items-center gap-4 px-4 py-3">
        <button
          type="button"
          data-nav
          data-player-nav=""
          onClick={onBack}
          aria-label="Back to title"
          className="rounded-full p-3 hover:bg-paper/10"
        >
          <ArrowLeft className="size-5" />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-bold">{title}</h1>
          {subtitle ? (
            <p className="truncate text-sm text-paper/70">{subtitle}</p>
          ) : null}
        </div>
        {shielded && armed ? (
          <button
            type="button"
            data-nav
            data-player-nav=""
            aria-pressed={unlocked}
            onClick={() => setUnlocked((value) => !value)}
            className="flex items-center gap-2 rounded-full px-3 py-2 hover:bg-paper/10 aria-pressed:bg-paper/15"
          >
            <MousePointerClick className="size-4" />
            <span>Player menu</span>
          </button>
        ) : null}
        <button
          type="button"
          data-nav
          data-player-nav=""
          onClick={() => {
            restored.current = false;
            setArmed(false);
            setClock(null);
            setAttempt((value) => value + 1);
          }}
          className="flex items-center gap-2 rounded-full px-3 py-2 hover:bg-paper/10"
        >
          <RotateCw className="size-4" />
          <span>Reload player</span>
        </button>
      </header>
      <div
        ref={stage}
        className="relative min-h-0 flex-1 overflow-hidden bg-black"
      >
        <iframe
          ref={iframe}
          key={`${url}:${attempt}`}
          src={url}
          title={subtitle ? `${title}: ${subtitle}` : title}
          allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
          className={
            shieldUp
              ? "absolute inset-x-0 w-full border-0"
              : "size-full border-0"
          }
          style={
            shieldUp
              ? {
                  top: -PROVIDER_TOP_PX,
                  height: `calc(100% + ${PROVIDER_TOP_PX + PROVIDER_BOTTOM_PX}px)`,
                }
              : undefined
          }
          onLoad={() => {
            if (!started.current) {
              started.current = true;
              void onViewing?.(false)
                .then((ok) => {
                  if (!ok)
                    setError(
                      "Your progress couldn't be saved. Try reloading the player.",
                    );
                })
                .catch(() =>
                  setError(
                    "Your progress couldn't be saved. Try reloading the player.",
                  ),
                );
            }
          }}
        />
        {shieldUp ? (
          <>
            <div
              data-embed-shield=""
              aria-hidden
              onClick={togglePlay}
              onDoubleClick={toggleFullscreen}
              onPointerMove={chrome.reveal}
              className={cx(
                "absolute inset-0 z-10",
                !chrome.visible && "cursor-none",
              )}
            />
            <div
              onPointerMove={chrome.reveal}
              className={cx(
                "absolute inset-x-0 bottom-0 z-20 flex items-center gap-1 bg-black px-2 py-2 transition-opacity sm:gap-2 sm:px-4",
                chrome.visible
                  ? "opacity-100"
                  : "pointer-events-none opacity-0",
              )}
            >
              <ControlButton
                ref={playButton}
                label={clock?.running ? "Pause" : "Play"}
                onClick={togglePlay}
              >
                {clock?.running ? (
                  <Pause className={iconSize} />
                ) : (
                  <Play className={iconSize} />
                )}
              </ControlButton>
              <ControlButton label={`Back ${step} seconds`} {...hold.bind(-1)}>
                <SkipIcon direction="back" seconds={step} />
              </ControlButton>
              <ControlButton
                label={`Forward ${step} seconds`}
                {...hold.bind(1)}
              >
                <SkipIcon direction="forward" seconds={step} />
              </ControlButton>
              <span className="shrink-0 px-1 text-sm text-white/80 tabular-nums">
                {formatTime(shown)} / {formatTime(clock?.duration ?? 0)}
              </span>
              <div className="min-w-0 flex-1 px-2">
                <SeekBar
                  currentTime={shown}
                  duration={clock?.duration ?? 0}
                  buffered={[]}
                  disabled={!clock}
                  onSeek={seekTo}
                  onScrubChange={setScrubbing}
                />
              </div>
              <ControlButton
                label={muted ? "Unmute" : "Mute"}
                onClick={toggleMute}
              >
                {muted ? (
                  <VolumeX className={iconSize} />
                ) : (
                  <Volume2 className={iconSize} />
                )}
              </ControlButton>
              <ControlButton
                label={fullscreen ? "Exit full screen" : "Full screen"}
                onClick={toggleFullscreen}
              >
                {fullscreen ? (
                  <Minimize className={iconSize} />
                ) : (
                  <Maximize className={iconSize} />
                )}
              </ControlButton>
            </div>
          </>
        ) : null}
      </div>
      <footer className="flex shrink-0 flex-wrap items-center justify-end gap-3 px-4 py-2 text-sm">
        {progress && !shieldUp ? (
          <span className="mr-auto text-paper/70 tabular-nums">
            {formatTime(progress.position)} / {formatTime(progress.duration)}
          </span>
        ) : null}
        {error ? (
          <p role="alert" className="mr-auto">
            {error}
          </p>
        ) : null}
        <button
          type="button"
          data-nav
          data-player-nav=""
          disabled={saving || completed}
          onClick={() => void save()}
          className="flex items-center gap-2 rounded-full px-4 py-2 hover:bg-paper/10 disabled:opacity-50"
        >
          <Check className="size-4" />
          {completed ? "Watched" : "Mark watched"}
        </button>
        {playback.next && onNext ? (
          <button
            type="button"
            data-nav
            data-player-nav=""
            disabled={saving}
            onClick={() => onNext(playback.next!)}
            className="flex items-center gap-2 rounded-full px-4 py-2 hover:bg-paper/10 disabled:opacity-50"
          >
            <SkipForward className="size-4" />
            Next episode
          </button>
        ) : null}
      </footer>
      {completed && !dismissed && playback.next && onNext ? (
        <UpNext
          episode={playback.next}
          seconds={nextCountdownS}
          onPlay={() => onNext(playback.next!)}
          onCancel={() => setDismissed(true)}
          className="absolute right-4 bottom-20 z-30 flex max-w-[calc(100%-2rem)] flex-col items-end gap-3 rounded-xl bg-ink/95 p-5 text-right sm:right-8 sm:max-w-sm"
        />
      ) : null}
    </div>
  );
}
