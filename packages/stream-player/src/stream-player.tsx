"use client";

import type { Episode, Playback } from "@repo/schemas/stream";
import {
  type PointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { BottomBar, type MenuId, TopBar } from "./controls";
import { EmbedPlayer } from "./embed-player";
import { DOUBLE_TAP_MS, resolveTap, type Tap } from "./gestures";
import type { PlayerAction } from "./keyboard";
import { SEEK_STEP_S } from "./keyboard";
import {
  Backdrop,
  CaptionText,
  Notice,
  PausedMark,
  SeekFlash,
  Spinner,
} from "./overlays";
import { cx } from "./styles";
import { UpNext } from "./up-next";
import { useAutoHide } from "./use-auto-hide";
import { moveFocus, useKeyboard } from "./use-keyboard";
import { type Player, usePlayer } from "./use-player";
import { useYoutubePlayer } from "./use-youtube-player";

export interface StreamPlayerProps {
  playback: Playback;
  title: string;
  /** Second line of the top bar, e.g. the episode label. */
  subtitle?: string | null;
  /** Poster while loading and the background of the unavailable state. */
  backdropUrl?: string | null;
  autoPlay?: boolean;
  crossOrigin?: "anonymous" | "use-credentials" | null;
  /** Seconds the end-of-video card counts down before calling `onNext`. */
  nextCountdownS?: number;
  unavailableMessage?: string;
  className?: string;
  onBack?: () => void;
  onPlayTitle?: () => void;
  onNext?: (episode: Episode) => void;
  /** About every 10 s while playing, and on pause, end and unmount. */
  onProgress?: (positionS: number, durationS: number) => void;
  onViewing?: (completed: boolean) => Promise<boolean>;
  /** Remote control: 30 s skips that keep moving while held. */
  tv?: boolean;
}

export function StreamPlayer(props: StreamPlayerProps) {
  if (
    props.playback.embed &&
    !props.playback.trailer &&
    props.playback.sources.length === 0
  ) {
    return <EmbedPlayer key={props.playback.embed.url} {...props} />;
  }
  return props.playback.trailer ? (
    <TrailerPlayer
      key={props.playback.trailer.youtubeKey}
      {...props}
      youtubeKey={props.playback.trailer.youtubeKey}
    />
  ) : (
    <FilePlayer {...props} />
  );
}

function FilePlayer(props: StreamPlayerProps) {
  const player = usePlayer({
    sources: props.playback.sources,
    textTracks: props.playback.textTracks,
    resume: props.playback.resume,
    autoPlay: props.autoPlay ?? true,
    onProgress: props.onProgress,
  });
  return <PlayerShell {...props} player={player} />;
}

function TrailerPlayer({
  youtubeKey,
  ...props
}: StreamPlayerProps & { youtubeKey: string }) {
  const { player, mountRef } = useYoutubePlayer(
    youtubeKey,
    props.autoPlay ?? true,
  );
  return (
    <PlayerShell
      {...props}
      player={player}
      surface={
        <div
          ref={mountRef}
          className="absolute inset-0 size-full [&_iframe]:size-full"
        />
      }
    />
  );
}

function PlayerShell({
  playback,
  title,
  subtitle = null,
  backdropUrl = null,
  crossOrigin = "anonymous",
  nextCountdownS = 10,
  unavailableMessage = "Not available to play yet",
  className,
  onBack,
  onNext,
  onPlayTitle,
  player,
  surface,
}: StreamPlayerProps & { player: Player; surface?: ReactNode }) {
  const { media, hasMedia, actions, availability } = player;

  const [openMenu, setOpenMenu] = useState<MenuId | null>(null);
  const [scrubbing, setScrubbing] = useState(false);
  const [hovering, setHovering] = useState(false);
  const [upNextDismissed, setUpNextDismissed] = useState(false);
  const [flash, setFlash] = useState<{
    side: "back" | "forward";
    at: number;
  } | null>(null);

  const playTitleRef = useRef<HTMLButtonElement>(null);
  const playRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (playback.trailer && media.ended)
      playTitleRef.current?.focus({ preventScroll: true });
  }, [playback.trailer, media.ended]);
  const backRef = useRef<HTMLButtonElement>(null);
  const lastTapRef = useRef<Tap | null>(null);
  const tapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pointerTypeRef = useRef("mouse");

  const next = playback.trailer ? null : playback.next;
  const showUpNext = Boolean(
    next && onNext && hasMedia && media.ended && !upNextDismissed,
  );
  const hold =
    !hasMedia ||
    media.paused ||
    openMenu !== null ||
    scrubbing ||
    hovering ||
    showUpNext;
  const chrome = useAutoHide(hold);
  const visibleRef = useRef(chrome.visible);
  visibleRef.current = chrome.visible;

  useEffect(() => {
    if (!media.ended) setUpNextDismissed(false);
  }, [media.ended]);

  useEffect(() => {
    if (!flash) return;
    const timer = setTimeout(() => setFlash(null), 600);
    return () => clearTimeout(timer);
  }, [flash]);

  useEffect(() => {
    const target =
      !playback.trailer && playback.sources.length === 0 && backRef.current
        ? backRef.current
        : playRef.current;
    target?.focus({ preventScroll: true });
    return () => {
      if (tapTimerRef.current !== null) clearTimeout(tapTimerRef.current);
    };
  }, []);

  const playNext = useCallback(() => {
    if (next && onNext) onNext(next);
  }, [next, onNext]);

  const run = (action: PlayerAction) => {
    switch (action.type) {
      case "toggle-play":
        return actions.togglePlay();
      case "play":
        return actions.play();
      case "pause":
        return actions.pause();
      case "seek-by":
        return actions.seekBy(action.seconds);
      case "seek-fraction":
        return actions.seekTo(action.fraction * media.duration);
      case "seek-edge":
        return actions.seekTo(action.edge === "start" ? 0 : media.duration);
      case "volume-by":
        return actions.volumeBy(action.delta);
      case "toggle-mute":
        return actions.toggleMute();
      case "toggle-fullscreen":
        return actions.toggleFullscreen();
      case "toggle-captions":
        return actions.toggleCaptions();
      case "close-menu":
        return setOpenMenu(null);
      case "back":
        return onBack?.();
      case "focus": {
        const container = player.containerRef.current;
        if (container && !moveFocus(container, action.direction)) {
          playRef.current?.focus({ preventScroll: true });
        }
        return;
      }
      case "reveal":
        return;
    }
  };

  useKeyboard({
    containerRef: player.containerRef,
    chromeVisible: chrome.visible,
    menuOpen: openMenu !== null,
    reveal: chrome.reveal,
    run,
  });

  const onSurfacePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    pointerTypeRef.current = event.pointerType;
    if (event.pointerType === "mouse") {
      if (event.button !== 0) return;
      actions.togglePlay();
      chrome.reveal();
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const tap: Tap = { x: event.clientX - rect.left, at: event.timeStamp };
    const result = resolveTap(lastTapRef.current, tap, rect.width);
    lastTapRef.current = tap;
    if (tapTimerRef.current !== null) clearTimeout(tapTimerRef.current);
    tapTimerRef.current = null;

    if (result !== "single" && hasMedia) {
      const back = result === "seek-back";
      actions.seekBy(back ? -SEEK_STEP_S : SEEK_STEP_S);
      setFlash({ side: back ? "back" : "forward", at: tap.at });
      return;
    }
    tapTimerRef.current = setTimeout(() => {
      tapTimerRef.current = null;
      if (visibleRef.current) chrome.hide();
      else chrome.reveal();
    }, DOUBLE_TAP_MS);
  };

  const showSpinner =
    availability === "probing" || (hasMedia && player.waiting);
  const showPaused =
    hasMedia &&
    media.ready &&
    media.paused &&
    !media.ended &&
    !player.waiting &&
    openMenu === null;

  return (
    <div
      ref={player.containerRef}
      role="region"
      aria-roledescription="video player"
      aria-label={title}
      tabIndex={-1}
      className={cx(
        "relative isolate h-full w-full select-none overflow-hidden bg-black text-white antialiased outline-none",
        !chrome.visible && "cursor-none",
        className,
      )}
      onPointerMove={(event) => {
        if (event.pointerType === "mouse") chrome.reveal();
      }}
      onPointerLeave={(event) => {
        if (event.pointerType === "mouse") chrome.hide();
      }}
      onPointerDown={(event) => {
        if (
          openMenu !== null &&
          event.target instanceof Element &&
          !event.target.closest("[data-player-menu]")
        ) {
          setOpenMenu(null);
        }
      }}
    >
      {surface ??
        (availability === "none" ? (
          <Backdrop url={backdropUrl} />
        ) : (
          // biome-ignore lint/a11y/useMediaCaption: tracks come from playback.textTracks
          <video
            ref={player.videoRef}
            src={player.source?.url}
            poster={backdropUrl ?? undefined}
            crossOrigin={crossOrigin ?? undefined}
            preload="metadata"
            playsInline
            x-webkit-airplay="allow"
            className="absolute inset-0 size-full object-contain"
          >
            {playback.textTracks.map((track) => (
              <track
                key={track.url}
                kind="subtitles"
                src={track.url}
                srcLang={track.language}
                label={track.label}
              />
            ))}
          </video>
        ))}

      <div
        aria-hidden="true"
        className="absolute inset-0"
        onPointerUp={onSurfacePointerUp}
        onDoubleClick={() => {
          if (pointerTypeRef.current === "mouse") actions.toggleFullscreen();
        }}
      />

      <CaptionText text={player.captionText} raised={chrome.visible} />
      {flash && <SeekFlash key={flash.at} side={flash.side} />}
      {showSpinner && <Spinner />}
      {showPaused && <PausedMark />}

      {availability === "none" && <Notice title={unavailableMessage} />}
      {availability === "unsupported" && (
        <Notice title="This video can't play on this device" />
      )}
      {player.failed && (
        <Notice
          title={
            playback.trailer
              ? "This trailer can’t be played here."
              : "Something went wrong while playing"
          }
          action={{ label: "Try again", onClick: actions.retry }}
        />
      )}

      {player.failed && playback.trailer && (
        <a
          className="absolute inset-x-0 top-[68%] z-30 mx-auto w-fit rounded-full border border-white/30 px-6 py-3 text-white hover:bg-white/10"
          href={`https://www.youtube.com/watch?v=${encodeURIComponent(playback.trailer.youtubeKey)}`}
          target="_blank"
          rel="noreferrer"
        >
          Open on YouTube
        </a>
      )}
      {playback.trailer && media.ended && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-5 bg-black/85 p-6 text-center">
          <h2 className="font-display text-4xl">What’s next?</h2>
          <button
            type="button"
            className="rounded-full bg-amber px-7 py-3 font-bold text-ink"
            ref={playTitleRef}
            data-player-nav=""
            data-player-role="control"
            onClick={onPlayTitle}
          >
            Play {title}
          </button>
          <button
            type="button"
            data-player-nav=""
            data-player-role="control"
            className="rounded-full border border-white/30 px-7 py-3"
            onClick={onBack}
          >
            Back to details
          </button>
        </div>
      )}

      <TopBar
        visible={chrome.visible}
        title={title}
        subtitle={subtitle}
        onBack={onBack}
        backRef={backRef}
        onHover={setHovering}
      />
      <BottomBar
        player={player}
        visible={chrome.visible}
        textTracks={playback.textTracks}
        next={next}
        onNext={onNext}
        openMenu={openMenu}
        onMenu={setOpenMenu}
        onScrubChange={setScrubbing}
        onHover={setHovering}
        playRef={playRef}
      />

      {showUpNext && next && (
        <UpNext
          episode={next}
          seconds={nextCountdownS}
          onPlay={playNext}
          onCancel={() => {
            setUpNextDismissed(true);
            playRef.current?.focus({ preventScroll: true });
          }}
        />
      )}
    </div>
  );
}
