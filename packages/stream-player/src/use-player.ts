import type { PlaybackSource, Progress, TextTrack } from "@repo/schemas/stream";
import { useEffect, useMemo, useRef, useState } from "react";
import { languageName, PLAYBACK_RATES } from "./labels";
import {
  airPlaySupported,
  audioTracksOf,
  fullscreenElement,
  fullscreenSupported,
  playbackTargetAvailable,
  showAirPlayPicker,
  webkitEnterFullscreen,
  webkitExitFullscreen,
  webkitRequestFullscreen,
} from "./media-apis";
import {
  pickSource,
  playableSourceIndices,
  type QualityOption,
  qualityOptions,
} from "./quality";
import { clamp, type Range, resumeAt, timeRanges } from "./time";

export const PROGRESS_INTERVAL_MS = 10_000;
const VOLUME_KEY = "stream-player:volume";

export type Availability = "none" | "probing" | "unsupported" | "ready";
export type CastKind = "airplay" | "remote";

export interface MediaSnapshot {
  ready: boolean;
  paused: boolean;
  ended: boolean;
  currentTime: number;
  duration: number;
  buffered: Range[];
  volume: number;
  muted: boolean;
  rate: number;
}

export interface AudioTrackOption {
  index: number;
  label: string;
}

export interface UsePlayerOptions {
  sources: readonly PlaybackSource[];
  textTracks: readonly TextTrack[];
  resume: Progress | null;
  autoPlay: boolean;
  onProgress?: (positionS: number, durationS: number) => void;
}

const INITIAL_MEDIA: MediaSnapshot = {
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

function noop() {}

function readMedia(video: HTMLVideoElement): MediaSnapshot {
  return {
    ready: video.readyState >= HTMLMediaElement.HAVE_METADATA,
    paused: video.paused,
    ended: video.ended,
    currentTime: video.currentTime,
    duration: Number.isFinite(video.duration) ? video.duration : 0,
    buffered: timeRanges(video.buffered),
    volume: video.volume,
    muted: video.muted,
    rate: video.playbackRate,
  };
}

function cueText(cues: TextTrackCueList | null): string {
  if (!cues) return "";
  const lines: string[] = [];
  for (let i = 0; i < cues.length; i++) {
    const text: unknown = Reflect.get(cues[i] ?? {}, "text");
    if (typeof text === "string") lines.push(text.replace(/<[^>]*>/g, ""));
  }
  return lines.join("\n");
}

function restoreVolume(video: HTMLVideoElement) {
  try {
    const raw = localStorage.getItem(VOLUME_KEY);
    if (!raw) return;
    const saved: unknown = JSON.parse(raw);
    if (typeof saved !== "object" || saved === null) return;
    if ("volume" in saved && typeof saved.volume === "number") {
      video.volume = clamp(saved.volume, 0, 1);
    }
    if ("muted" in saved && typeof saved.muted === "boolean") {
      video.muted = saved.muted;
    }
  } catch {}
}

function saveVolume(video: HTMLVideoElement) {
  try {
    localStorage.setItem(
      VOLUME_KEY,
      JSON.stringify({ volume: video.volume, muted: video.muted }),
    );
  } catch {}
}

export function usePlayer({
  sources,
  textTracks,
  resume,
  autoPlay,
  onProgress,
}: UsePlayerOptions) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [media, setMedia] = useState<MediaSnapshot>(INITIAL_MEDIA);
  const [waiting, setWaiting] = useState(false);
  const [failed, setFailed] = useState(false);
  const [playable, setPlayable] = useState<number[] | null>(null);
  const [sourceIndex, setSourceIndex] = useState<number | null>(null);
  const [captionIndex, setCaptionIndex] = useState(-1);
  const [captionText, setCaptionText] = useState("");
  const [audioTracks, setAudioTracks] = useState<AudioTrackOption[]>([]);
  const [audioIndex, setAudioIndex] = useState(-1);
  const [fullscreen, setFullscreen] = useState(false);
  const [pip, setPip] = useState(false);
  const [canFullscreen, setCanFullscreen] = useState(false);
  const [canPip, setCanPip] = useState(false);
  const [airPlay, setAirPlay] = useState(false);
  const [remote, setRemote] = useState(false);

  const hasSources = sources.length > 0;
  const sourceKey = sources.map((source) => source.url).join("\n");
  const trackKey = textTracks.map((track) => track.url).join("\n");

  const pendingRef = useRef<{ time: number; play: boolean } | null>(null);
  const startedRef = useRef(false);
  const lastCaptionRef = useRef(0);
  const latest = useRef({ resume, autoPlay, onProgress });
  useEffect(() => {
    latest.current = { resume, autoPlay, onProgress };
  });

  useEffect(() => {
    pendingRef.current = null;
    startedRef.current = false;
    setFailed(false);
    if (!hasSources) {
      setPlayable([]);
      setSourceIndex(null);
      return;
    }
    const probe = document.createElement("video");
    const indices = playableSourceIndices(
      sources,
      (mimeType) => probe.canPlayType(mimeType) !== "",
    );
    const target = Math.round(
      Math.min(window.screen.width, window.screen.height) *
        (window.devicePixelRatio || 1),
    );
    setPlayable(indices);
    setSourceIndex(pickSource(sources, indices, target || null));
  }, [sourceKey]);

  useEffect(() => {
    const video = videoRef.current;
    setCanFullscreen(
      fullscreenSupported() ||
        (video !== null && webkitEnterFullscreen(video) !== null),
    );
    setCanPip(
      video !== null &&
        document.pictureInPictureEnabled &&
        !video.disablePictureInPicture,
    );
    const onFullscreen = () =>
      setFullscreen(
        containerRef.current !== null &&
          fullscreenElement() === containerRef.current,
      );
    document.addEventListener("fullscreenchange", onFullscreen);
    document.addEventListener("webkitfullscreenchange", onFullscreen);
    return () => {
      document.removeEventListener("fullscreenchange", onFullscreen);
      document.removeEventListener("webkitfullscreenchange", onFullscreen);
    };
  }, [hasSources]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    restoreVolume(video);

    let lastReport = performance.now();
    const sync = () => setMedia(readMedia(video));
    const report = () => {
      const duration = video.duration;
      if (!Number.isFinite(duration) || duration <= 0) return;
      lastReport = performance.now();
      latest.current.onProgress?.(video.currentTime, duration);
    };
    const readAudio = () => {
      const list = audioTracksOf(video);
      if (!list || list.length < 2) {
        setAudioTracks([]);
        setAudioIndex(-1);
        return;
      }
      const options: AudioTrackOption[] = [];
      let enabled = -1;
      for (let i = 0; i < list.length; i++) {
        const track = list[i];
        if (!track) continue;
        options.push({
          index: i,
          label:
            track.label || languageName(track.language) || `Track ${i + 1}`,
        });
        if (track.enabled) enabled = i;
      }
      setAudioTracks(options);
      setAudioIndex(enabled);
    };

    const onMetadata = () => {
      const pending = pendingRef.current;
      pendingRef.current = null;
      if (pending) {
        video.currentTime = Math.min(pending.time, video.duration || 0);
        if (pending.play) video.play().catch(noop);
      } else if (!startedRef.current) {
        const saved = latest.current.resume;
        const start = saved ? resumeAt(saved.positionS, video.duration) : 0;
        if (start > 0) video.currentTime = start;
        if (latest.current.autoPlay) video.play().catch(noop);
      }
      startedRef.current = true;
      readAudio();
      sync();
    };
    const onTimeUpdate = () => {
      sync();
      if (
        !video.paused &&
        performance.now() - lastReport >= PROGRESS_INTERVAL_MS
      ) {
        report();
      }
    };
    const onStop = () => {
      sync();
      setWaiting(false);
      report();
    };
    const onError = () => {
      const code = video.error?.code;
      if (!code || code === MediaError.MEDIA_ERR_ABORTED) return;
      setWaiting(false);
      setFailed(true);
    };
    const onHidden = () => {
      if (document.visibilityState === "hidden") report();
    };

    const listeners: Array<[EventTarget, string, EventListener]> = [
      [video, "loadedmetadata", onMetadata],
      [video, "timeupdate", onTimeUpdate],
      [video, "pause", onStop],
      [video, "ended", onStop],
      [video, "error", onError],
      [video, "waiting", () => setWaiting(true)],
      [video, "seeking", () => setWaiting(true)],
      [video, "playing", () => setWaiting(false)],
      [video, "canplay", () => setWaiting(false)],
      [video, "seeked", () => setWaiting(false)],
      [
        video,
        "volumechange",
        () => {
          sync();
          saveVolume(video);
        },
      ],
      [video, "enterpictureinpicture", () => setPip(true)],
      [video, "leavepictureinpicture", () => setPip(false)],
      [video, "webkitbeginfullscreen", () => setFullscreen(true)],
      [video, "webkitendfullscreen", () => setFullscreen(false)],
      [document, "visibilitychange", onHidden],
      [window, "pagehide", report],
    ];
    for (const event of [
      "play",
      "durationchange",
      "progress",
      "ratechange",
      "emptied",
    ]) {
      listeners.push([video, event, sync]);
    }
    for (const [target, event, handler] of listeners) {
      target.addEventListener(event, handler);
    }
    const audioList = audioTracksOf(video);
    for (const event of ["change", "addtrack", "removetrack"]) {
      audioList?.addEventListener(event, readAudio);
    }
    sync();

    return () => {
      for (const [target, event, handler] of listeners) {
        target.removeEventListener(event, handler);
      }
      for (const event of ["change", "addtrack", "removetrack"]) {
        audioList?.removeEventListener(event, readAudio);
      }
      report();
    };
  }, [hasSources]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const elements = Array.from(video.querySelectorAll("track"));
    elements.forEach((element, index) => {
      element.track.mode = index === captionIndex ? "hidden" : "disabled";
    });
    const active = elements[captionIndex]?.track;
    if (!active) {
      setCaptionText("");
      return;
    }
    const update = () => setCaptionText(cueText(active.activeCues));
    update();
    active.addEventListener("cuechange", update);
    return () => active.removeEventListener("cuechange", update);
  }, [captionIndex, hasSources, trackKey]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || sourceIndex === null) return;
    if (airPlaySupported()) {
      const onAvailability = (event: Event) =>
        setAirPlay(playbackTargetAvailable(event));
      video.addEventListener(
        "webkitplaybacktargetavailabilitychanged",
        onAvailability,
      );
      return () =>
        video.removeEventListener(
          "webkitplaybacktargetavailabilitychanged",
          onAvailability,
        );
    }
    const remotePlayback = video.remote;
    if (!remotePlayback) return;
    let watchId: number | null = null;
    let cancelled = false;
    remotePlayback
      .watchAvailability((available) => setRemote(available))
      .then((id) => {
        if (cancelled) remotePlayback.cancelWatchAvailability(id).catch(noop);
        else watchId = id;
      })
      .catch(() => setRemote(false));
    return () => {
      cancelled = true;
      if (watchId !== null) {
        remotePlayback.cancelWatchAvailability(watchId).catch(noop);
      }
    };
  }, [sourceIndex]);

  const qualities: QualityOption[] = useMemo(
    () => qualityOptions(sources, playable ?? []),
    [sourceKey, playable],
  );

  const availability: Availability = !hasSources
    ? "none"
    : playable === null
      ? "probing"
      : playable.length === 0
        ? "unsupported"
        : "ready";
  const hasMedia = availability === "ready" && !failed;
  const castKind: CastKind | null = airPlay
    ? "airplay"
    : remote
      ? "remote"
      : null;

  const withMedia = (run: (video: HTMLVideoElement) => void) => {
    const video = videoRef.current;
    if (video && hasMedia) run(video);
  };

  const seekTo = (seconds: number) =>
    withMedia((video) => {
      const duration = Number.isFinite(video.duration) ? video.duration : 0;
      const time = clamp(seconds, 0, duration);
      video.currentTime = time;
      setMedia((current) => ({ ...current, currentTime: time, ended: false }));
    });

  const setVolume = (volume: number) =>
    withMedia((video) => {
      video.volume = clamp(volume, 0, 1);
      if (volume > 0) video.muted = false;
    });

  const setCaptions = (index: number) => {
    if (index >= 0) lastCaptionRef.current = index;
    setCaptionIndex(index);
  };

  const actions = {
    play: () => withMedia((video) => void video.play().catch(noop)),
    pause: () => withMedia((video) => video.pause()),
    togglePlay: () =>
      withMedia((video) => {
        if (video.paused || video.ended) video.play().catch(noop);
        else video.pause();
      }),
    seekTo,
    seekBy: (delta: number) =>
      withMedia((video) => seekTo(video.currentTime + delta)),
    setVolume,
    volumeBy: (delta: number) =>
      withMedia((video) => setVolume((video.muted ? 0 : video.volume) + delta)),
    toggleMute: () =>
      withMedia((video) => {
        if (video.muted || video.volume === 0) {
          video.muted = false;
          if (video.volume === 0) video.volume = 0.5;
        } else {
          video.muted = true;
        }
      }),
    setRate: (rate: number) =>
      withMedia((video) => {
        video.defaultPlaybackRate = rate;
        video.playbackRate = rate;
      }),
    setCaptions,
    toggleCaptions: () => {
      if (!hasMedia || textTracks.length === 0) return;
      setCaptions(
        captionIndex >= 0
          ? -1
          : Math.min(lastCaptionRef.current, textTracks.length - 1),
      );
    },
    setAudioTrack: (index: number) =>
      withMedia((video) => {
        const list = audioTracksOf(video);
        if (!list) return;
        for (let i = 0; i < list.length; i++) {
          const track = list[i];
          if (track) track.enabled = i === index;
        }
        setAudioIndex(index);
      }),
    setSource: (index: number) =>
      withMedia((video) => {
        if (index === sourceIndex || !playable?.includes(index)) return;
        pendingRef.current = { time: video.currentTime, play: !video.paused };
        setWaiting(true);
        setSourceIndex(index);
      }),
    retry: () => {
      const video = videoRef.current;
      if (!video || availability !== "ready") return;
      pendingRef.current = { time: video.currentTime, play: true };
      setFailed(false);
      video.load();
    },
    toggleFullscreen: () => {
      const container = containerRef.current;
      const video = videoRef.current;
      if (!container) return;
      if (fullscreenElement()) {
        if (document.exitFullscreen) document.exitFullscreen().catch(noop);
        else webkitExitFullscreen()?.();
        return;
      }
      if (fullscreenSupported()) {
        if (container.requestFullscreen) {
          container.requestFullscreen().catch(noop);
        } else {
          webkitRequestFullscreen(container)?.();
        }
        return;
      }
      if (video && hasMedia) webkitEnterFullscreen(video)?.();
    },
    togglePip: () =>
      withMedia((video) => {
        if (!canPip) return;
        if (document.pictureInPictureElement) {
          document.exitPictureInPicture().catch(noop);
        } else {
          video.requestPictureInPicture().catch(noop);
        }
      }),
    cast: () =>
      withMedia((video) => {
        if (castKind === "airplay") showAirPlayPicker(video)?.();
        else if (castKind === "remote") video.remote.prompt().catch(noop);
      }),
  };

  return {
    rates: [...PLAYBACK_RATES] as number[],
    videoRef,
    containerRef,
    media,
    waiting,
    failed,
    availability,
    hasMedia,
    source: sourceIndex !== null ? (sources[sourceIndex] ?? null) : null,
    sourceIndex,
    qualities,
    captionIndex,
    captionText,
    audioTracks,
    audioIndex,
    fullscreen,
    pip,
    canFullscreen,
    canPip,
    castKind,
    actions,
  };
}

export type Player = ReturnType<typeof usePlayer>;
export type PlayerActions = Player["actions"];
