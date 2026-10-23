import { useEffect, useRef, useState } from "react";
import {
  fullscreenElement,
  fullscreenSupported,
  webkitExitFullscreen,
  webkitRequestFullscreen,
} from "./media-apis";
import { clamp } from "./time";
import type { MediaSnapshot, Player } from "./use-player";
import { loadYoutubeApi, type YoutubePlayer } from "./youtube-api";

const INITIAL: MediaSnapshot = {
  ready: false,
  paused: true,
  ended: false,
  currentTime: 0,
  duration: 0,
  buffered: [],
  volume: 1,
  muted: false,
  rate: 1,
};
const noop = () => {};

/** Adapts the official YouTube API to the same controls as stored files. */
export function useYoutubePlayer(key: string, autoPlay: boolean) {
  const mountRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const engine = useRef<YoutubePlayer | null>(null);
  const [media, setMedia] = useState(INITIAL);
  const [waiting, setWaiting] = useState(true);
  const [failed, setFailed] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [canFullscreen, setCanFullscreen] = useState(false);
  const [rates, setRates] = useState([1]);
  const [attempt, setAttempt] = useState(0);
  const syncRef = useRef(noop);

  useEffect(() => {
    let cancelled = false;
    let ready = false;
    let frame = 0;
    const readyTimeout = window.setTimeout(() => {
      if (!cancelled && !ready) {
        setFailed(true);
        setWaiting(false);
      }
    }, 25_000);
    let player: YoutubePlayer | null = null;
    setMedia(INITIAL);
    setWaiting(true);
    setFailed(false);
    setCanFullscreen(fullscreenSupported());
    const sync = () => {
      if (cancelled || !ready || !player) return;
      const state = player.getPlayerState();
      const duration = player.getDuration() || 0;
      setWaiting(state === 3);
      setMedia({
        ready: true,
        paused: state !== 1,
        ended: state === 0,
        currentTime: player.getCurrentTime() || 0,
        duration,
        buffered: [[0, duration * player.getVideoLoadedFraction()]],
        volume: player.getVolume() / 100,
        muted: player.isMuted(),
        rate: player.getPlaybackRate(),
      });
    };
    syncRef.current = sync;
    let lastPoll = 0;
    const tick = (now: number) => {
      if (now - lastPoll >= 250) {
        sync();
        lastPoll = now;
      }
      frame = requestAnimationFrame(tick);
    };
    const onFullscreen = () =>
      setFullscreen(fullscreenElement() === containerRef.current);
    document.addEventListener("fullscreenchange", onFullscreen);
    document.addEventListener("webkitfullscreenchange", onFullscreen);
    loadYoutubeApi()
      .then((api) => {
        if (cancelled || !mountRef.current) return;
        // YouTube replaces this child; React retains ownership of the parent.
        const target = document.createElement("div");
        mountRef.current.replaceChildren(target);
        player = new api.Player(target, {
          host: "https://www.youtube-nocookie.com",
          width: "100%",
          height: "100%",
          videoId: key,
          playerVars: {
            controls: 0,
            disablekb: 1,
            rel: 0,
            playsinline: 1,
            iv_load_policy: 3,
            fs: 0,
            origin: window.location.origin,
          },
          events: {
            onReady: ({ target: current }) => {
              if (cancelled) return;
              player = current;
              engine.current = current;
              window.clearTimeout(readyTimeout);
              ready = true;
              setRates(current.getAvailablePlaybackRates());
              sync();
              if (autoPlay) current.playVideo();
              frame = requestAnimationFrame(tick);
            },
            onStateChange: sync,
            onAutoplayBlocked: () => {
              setWaiting(false);
              sync();
            },
            onError: () => {
              if (!cancelled) {
                setFailed(true);
                setWaiting(false);
              }
            },
          },
        });
      })
      .catch(() => {
        if (!cancelled) {
          setFailed(true);
          setWaiting(false);
        }
      });
    return () => {
      cancelled = true;
      window.clearTimeout(readyTimeout);
      cancelAnimationFrame(frame);
      engine.current = null;
      syncRef.current = noop;
      player?.destroy();
      document.removeEventListener("fullscreenchange", onFullscreen);
      document.removeEventListener("webkitfullscreenchange", onFullscreen);
    };
  }, [key, autoPlay, attempt]);

  const withEngine = (run: (p: YoutubePlayer) => void) => {
    if (engine.current && !failed) {
      run(engine.current);
      syncRef.current();
    }
  };
  const seekTo = (time: number) =>
    withEngine((p) => p.seekTo(clamp(time, 0, p.getDuration()), true));
  const setVolume = (volume: number) =>
    withEngine((p) => {
      p.setVolume(clamp(volume, 0, 1) * 100);
      if (volume > 0) p.unMute();
    });
  const player: Player = {
    videoRef,
    containerRef,
    media,
    waiting: waiting && !failed,
    failed,
    availability: failed || media.ready ? "ready" : "probing",
    hasMedia: media.ready && !failed,
    source: null,
    sourceIndex: null,
    qualities: [],
    captionIndex: -1,
    captionText: "",
    audioTracks: [],
    audioIndex: -1,
    fullscreen,
    pip: false,
    canFullscreen,
    canPip: false,
    castKind: null,
    rates,
    actions: {
      play: () => withEngine((p) => p.playVideo()),
      pause: () => withEngine((p) => p.pauseVideo()),
      togglePlay: () =>
        withEngine((p) =>
          p.getPlayerState() === 1 ? p.pauseVideo() : p.playVideo(),
        ),
      seekTo,
      seekBy: (delta) => withEngine((p) => seekTo(p.getCurrentTime() + delta)),
      setVolume,
      volumeBy: (delta) =>
        withEngine((p) =>
          setVolume((p.isMuted() ? 0 : p.getVolume() / 100) + delta),
        ),
      toggleMute: () =>
        withEngine((p) => {
          if (p.isMuted() || p.getVolume() === 0) {
            p.unMute();
            if (!p.getVolume()) p.setVolume(50);
          } else p.mute();
        }),
      setRate: (rate) =>
        withEngine((p) => {
          if (rates.includes(rate)) p.setPlaybackRate(rate);
        }),
      setCaptions: noop,
      toggleCaptions: noop,
      setAudioTrack: noop,
      setSource: noop,
      togglePip: noop,
      cast: noop,
      retry: () => setAttempt((n) => n + 1),
      toggleFullscreen: () => {
        const container = containerRef.current;
        if (!container) return;
        if (fullscreenElement()) {
          if (document.exitFullscreen)
            void document.exitFullscreen().catch(noop);
          else webkitExitFullscreen()?.();
        } else if (container.requestFullscreen)
          void container.requestFullscreen().catch(noop);
        else webkitRequestFullscreen(container)?.();
      },
    },
  };
  return { player, mountRef };
}
