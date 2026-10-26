import {
  allowEmbedNavigation,
  EMBED_BROWSER_SCRIPT,
  type EmbedProgress,
  type EmbedSubtitle,
  type Episode,
  embedPlayerUrl,
  type Playback,
  type PlaybackSource,
  type Progress,
  parseEmbedProgress,
  pickSubtitle,
  type SubtitlePreference,
  tmdbImage,
} from "@repo/schemas/stream";
import { useQueryClient } from "@tanstack/react-query";
import { useEvent } from "expo";
import { Image } from "expo-image";
import { router } from "expo-router";
import { useVideoPlayer, VideoView } from "expo-video";
import {
  memo,
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { findNodeHandle, StyleSheet, View } from "react-native";
import { WebView } from "react-native-webview";
import {
  invalidateAfterWatching,
  usePlayback,
  useRecordProgress,
  useRecordViewing,
  useSubtitles,
  useTitle,
} from "@/api/stream";
import {
  type PlayerController,
  UNAVAILABLE,
} from "@/features/player/controller";
import { pickSource } from "@/features/player/player-screen";
import { useProgressReporter } from "@/features/player/use-progress-reporter";
import { useVideoController } from "@/features/player/use-video-controller";
import { useAudience } from "@/lib/audience-store";
import { API_URL } from "@/lib/config";
import { episodeLabel } from "@/lib/format";
import {
  setSubtitlePreference,
  useSubtitlePreference,
} from "@/lib/subtitle-preference";
import { resumePosition } from "@/lib/time";
import { tapCenter } from "../../../../modules/stream-tv";
import { type SubtitleOption, TvSubtitleMenu } from "./subtitle-menu";
import { type TvAction, TvPlayerChrome, type TvTransport } from "./tv-chrome";

const RESUME_NOTICE_MS = 6000;
/** An embed that has not started this long after loading gets a nudge. */
const EMBED_NUDGE_MS = 3000;
/** …and after this, the screen says to press OK. */
const EMBED_HINT_MS = 7000;
const EMBED_REPORT_MS = 10_000;
// The provider's title strip and control bar, pushed off screen while ours
// stand in for them; the web player clips the same amounts.
const PROVIDER_TOP = 64;
const PROVIDER_BOTTOM = 96;

interface ChromeShared {
  title: string;
  subtitle?: string;
  next: Episode | null;
  onNext: () => void;
  onClose: () => void;
}

export function TvPlayerScreen({
  id,
  episode,
}: {
  id: string;
  episode: string | null;
}) {
  const { lead: profile, audience } = useAudience();
  const client = useQueryClient();
  const title = useTitle(id, profile.id);
  const playback = usePlayback(id, profile.id, episode);
  const detail = title.data?.title;
  const source = playback.data ? pickSource(playback.data.sources) : null;

  const cachedEpisode = episode
    ? client
        .getQueriesData<{ episodes: Episode[] }>({ queryKey: ["episodes", id] })
        .flatMap(([, data]) => data?.episodes ?? [])
        .find((item) => item.id === episode)
    : undefined;
  const currentEpisode = playback.data?.episode ?? cachedEpisode;
  const subtitle = currentEpisode
    ? [
        episodeLabel(currentEpisode.season, currentEpisode.episode),
        currentEpisode.title,
      ]
        .filter(Boolean)
        .join(": ")
    : undefined;

  const nextEpisode = playback.data?.next ?? null;
  const onNext = useCallback(() => {
    if (nextEpisode)
      router.replace({
        pathname: "/tv/watch/[id]",
        params: { id, episode: nextEpisode.id },
      });
  }, [id, nextEpisode]);
  const onClose = useCallback(() => router.back(), []);
  const shared: ChromeShared = {
    title: detail?.title ?? "",
    subtitle,
    next: nextEpisode,
    onNext,
    onClose,
  };
  const backdrop = detail ? tmdbImage(detail.backdropPath, "w1280") : null;

  return (
    <View style={styles.screen}>
      {playback.data?.embed && !source ? (
        <TvEmbedPlayer
          key={playback.data.embed.url}
          playback={playback.data}
          titleId={id}
          profileIds={audience.map((item) => item.id)}
          {...shared}
        />
      ) : source ? (
        <TvFilePlayer
          key={`${id}:${episode ?? ""}`}
          source={source}
          artwork={backdrop}
          resume={playback.data?.resume ?? null}
          profileId={profile.id}
          titleId={id}
          episodeId={playback.data?.episode?.id ?? episode}
          {...shared}
        />
      ) : (
        <>
          {backdrop ? (
            <Image
              source={{ uri: backdrop }}
              style={[StyleSheet.absoluteFill, styles.dim]}
              contentFit="cover"
            />
          ) : null}
          <TvPlayerChrome
            transport={fromController(UNAVAILABLE)}
            ended={false}
            resumedAt={null}
            onStartOver={() => undefined}
            notice={
              playback.isPending
                ? null
                : playback.isError
                  ? {
                      title: "We couldn't reach Stream",
                      message:
                        "Check that the TV is connected to the internet, then try again in a moment.",
                    }
                  : {
                      title: "Not available to play yet",
                      message:
                        "This title is in the catalogue, but there's nothing to play for it yet. It's still on your list if you added it.",
                    }
            }
            {...shared}
          />
        </>
      )}
    </View>
  );
}

function fromController(controller: PlayerController): TvTransport {
  return {
    ready: controller.available && controller.duration > 0,
    playing: controller.playing,
    buffering: controller.buffering,
    position: controller.position,
    duration: controller.duration,
    toggle: controller.toggle,
    play: () => {
      if (!controller.playing) controller.toggle();
    },
    pause: () => {
      if (controller.playing) controller.toggle();
    },
    seekTo: controller.seekTo,
  };
}

/** A direct file through expo-video, as on the phone. */
function TvFilePlayer({
  source,
  artwork,
  resume,
  profileId,
  titleId,
  episodeId,
  ...chrome
}: ChromeShared & {
  source: PlaybackSource;
  artwork: string | null;
  resume: Progress | null;
  profileId: string;
  titleId: string;
  episodeId: string | null;
}) {
  const view = useRef<VideoView>(null);
  const player = useVideoPlayer(
    {
      uri: source.url,
      metadata: { title: chrome.title, artwork: artwork ?? undefined },
    },
    (created) => {
      created.timeUpdateEventInterval = 0.5;
      created.play();
    },
  );
  const controller = useVideoController(player, view);
  useProgressReporter({ controller, profileId, titleId, episodeId });
  const { status } = useEvent(player, "statusChange", {
    status: player.status,
  });

  const [resumedAt, setResumedAt] = useState<number | null>(null);
  const resumed = useRef(false);
  useEffect(() => {
    if (resumed.current || !(controller.duration > 0)) return;
    resumed.current = true;
    const at = resumePosition(resume);
    if (at === null) return;
    controller.seekTo(at);
    setResumedAt(at);
  }, [controller, resume]);

  useEffect(() => {
    if (resumedAt === null) return;
    const timer = setTimeout(() => setResumedAt(null), RESUME_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [resumedAt]);

  const ended =
    controller.duration > 0 &&
    !controller.playing &&
    controller.position >= controller.duration - 1;

  return (
    <>
      <VideoView
        ref={view}
        player={player}
        style={StyleSheet.absoluteFill}
        nativeControls={false}
        contentFit="contain"
        focusable={false}
      />
      <TvPlayerChrome
        transport={fromController(controller)}
        ended={ended}
        notice={
          status === "error"
            ? {
                title: "This didn't play",
                message:
                  "The film couldn't be loaded. Go back and try again in a moment. If it keeps happening, the TV may have lost its internet connection.",
              }
            : null
        }
        resumedAt={resumedAt}
        onStartOver={() => {
          controller.seekTo(0);
          setResumedAt(null);
        }}
        {...chrome}
      />
    </>
  );
}

type Clock = {
  position: number;
  duration: number;
  at: number;
  running: boolean;
};

/** A language preference waits this long for the list before playing without it. */
const SUBTITLE_WAIT_MS = 3000;

function sameSubtitle(a: EmbedSubtitle | null, b: EmbedSubtitle | null) {
  return (a?.url ?? null) === (b?.url ?? null);
}

/**
 * A VidSrc embed in a WebView that never takes focus: the remote drives it
 * through the provider's message API (`play`, `pause`, `seek<seconds>`), the
 * way the web player does, and its `PLAYER_EVENT`s keep a clock that runs
 * between them. Progress and viewing are recorded for everyone on the sofa.
 * Subtitles are ours: the chosen file goes to the provider as `sub_url`, so
 * changing them reloads the player at the same moment.
 */
function TvEmbedPlayer({
  playback,
  titleId,
  profileIds,
  ...chrome
}: ChromeShared & {
  playback: Playback;
  titleId: string;
  profileIds: string[];
}) {
  const client = useQueryClient();
  const viewing = useRecordViewing(profileIds);
  const report = useRecordProgress(profileIds);
  const webview = useRef<WebView>(null);
  // The WebView's ref is an imperative handle, not a native view; the tap
  // goes to this host view around it and reaches the page through it.
  const surface = useRef<View>(null);
  const started = useRef(false);
  const restored = useRef(false);
  /** Where a reload for new subtitles should pick up. */
  const resumeAt = useRef<number | null>(null);
  const lastSent = useRef(0);
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [slow, setSlow] = useState(false);
  const [clock, setClock] = useState<Clock | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [progress, setProgress] = useState<EmbedProgress | null>(null);
  const [completed, setCompleted] = useState(false);
  const [menu, setMenu] = useState(false);
  const episodeId = playback.episode?.id ?? null;
  const latest = useRef({ progress, completed, report, profileIds });
  latest.current = { progress, completed, report, profileIds };

  const preference = useSubtitlePreference();
  const subtitles = useSubtitles(titleId, episodeId);
  const [waited, setWaited] = useState(false);
  // Fixed once the player opens: a refetched list must never reload it.
  const [subtitle, setSubtitle] = useState<EmbedSubtitle | null | undefined>(
    undefined,
  );
  const available = subtitles.data ?? {
    off: `${API_URL}/api/public/subtitles/off`,
    tracks: [],
  };
  useEffect(() => {
    const timer = setTimeout(() => setWaited(true), SUBTITLE_WAIT_MS);
    return () => clearTimeout(timer);
  }, []);
  useEffect(() => {
    if (subtitle !== undefined || preference === undefined) return;
    const needsList = preference !== "auto" && preference !== "off";
    if (needsList && subtitles.isPending && !waited) return;
    setSubtitle(pickSubtitle(available, preference));
  }, [subtitle, preference, subtitles.isPending, waited, available]);

  const url =
    subtitle === undefined
      ? null
      : embedPlayerUrl(playback.embed!.url, true, subtitle);
  const origin = new URL(embedPlayerUrl(playback.embed!.url)).origin;
  const armed = clock !== null;

  const command = useCallback((action: string) => {
    webview.current?.injectJavaScript(
      `(function () { var f = document.getElementById('player_iframe'); if (f && f.contentWindow) f.contentWindow.postMessage({ player: true, action: ${JSON.stringify(action)} }, new URL(f.src).origin); })(); true;`,
    );
  }, []);

  useEffect(
    () => () => {
      const value = latest.current;
      if (value.progress && !value.completed)
        value.report.mutate({
          titleId,
          episodeId,
          positionS: value.progress.position,
          durationS: value.progress.duration,
        });
      for (const id of value.profileIds) invalidateAfterWatching(client, id);
    },
    [client, titleId, episodeId],
  );

  // What a phone gets from a tap on the provider's poster: its landing page
  // only builds a player on a real tap, so the native module gives it one,
  // and the message API is asked too for a page that is already listening.
  const start = useCallback(() => {
    void tapCenter(findNodeHandle(surface.current));
    command("play");
  }, [command]);

  // Autoplay sometimes starts the provider; when it doesn't, start it, then
  // tell whoever is holding the remote.
  useEffect(() => {
    if (!loaded || armed) return;
    const nudge = setTimeout(start, EMBED_NUDGE_MS);
    const hint = setTimeout(() => setSlow(true), EMBED_HINT_MS);
    return () => {
      clearTimeout(nudge);
      clearTimeout(hint);
    };
  }, [loaded, armed, start]);

  useEffect(() => {
    if (!clock?.running) return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [clock?.running]);

  const position = clock
    ? Math.min(
        clock.duration,
        clock.position + (clock.running ? (now - clock.at) / 1000 : 0),
      )
    : 0;

  const transport = useMemo<TvTransport>(() => {
    const move = (patch: Partial<Clock>) => {
      const at = Date.now();
      setNow(at);
      setClock((previous) =>
        previous ? { ...previous, position, at, ...patch } : previous,
      );
    };
    return {
      ready: armed,
      playing: clock?.running ?? false,
      buffering: false,
      position,
      duration: clock?.duration ?? 0,
      toggle: () => {
        command(clock?.running ? "pause" : "play");
        move({ running: !clock?.running });
      },
      play: () => {
        command("play");
        move({ running: true });
      },
      pause: () => {
        command("pause");
        move({ running: false });
      },
      seekTo: (seconds) => {
        const target = Math.max(0, Math.min(clock?.duration ?? 0, seconds));
        command(`seek${Math.floor(target)}`);
        move({ position: target });
      },
    };
  }, [armed, clock, position, command]);

  const reload = (at: number | null) => {
    resumeAt.current = at;
    setFailed(false);
    setLoaded(false);
    setSlow(false);
    setClock(null);
    restored.current = false;
    setAttempt((value) => value + 1);
  };

  const choose = (next: EmbedSubtitle | null, remember: SubtitlePreference) => {
    setSubtitlePreference(remember);
    setMenu(false);
    if (sameSubtitle(next, subtitle ?? null)) return;
    setSubtitle(next);
    reload(armed && position >= 5 ? position : null);
  };

  // Stable for the memoised surface: the clock ticks twice a second, and the
  // WebView should not re-render with it.
  const handlers = useRef<{
    onLoad: () => void;
    onMessage: (data: string, from: string) => void;
  } | null>(null);
  handlers.current = {
    onLoad: () => {
      setLoaded(true);
      if (!started.current) {
        started.current = true;
        viewing.mutate({ titleId, episodeId, completed: false });
      }
    },
    onMessage: (data, from) => {
      try {
        if (new URL(from).origin !== origin) return;
      } catch {
        return;
      }
      const update = parseEmbedProgress(data, playback.embed!.url);
      if (!update) return;
      if (!restored.current) {
        restored.current = true;
        const resume = playback.resume;
        // A reload for subtitles goes back to where it was; a fresh start
        // resumes only past the first 30 s, like the file player.
        const target =
          resumeAt.current ??
          (resume && !resume.completed && resume.positionS >= 30
            ? resume.positionS
            : null);
        resumeAt.current = null;
        if (
          target !== null &&
          target < update.duration - 10 &&
          Math.abs(target - update.position) > 5
        ) {
          command(`seek${Math.floor(target)}`);
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
      )
        setCompleted(false);
      if (
        update.status !== "playing" ||
        at - lastSent.current >= EMBED_REPORT_MS
      ) {
        lastSent.current = at;
        report.mutate({
          titleId,
          episodeId,
          positionS: update.position,
          durationS: update.duration,
        });
      }
    },
  };
  const onLoad = useCallback(() => handlers.current?.onLoad(), []);
  const onMessage = useCallback(
    (data: string, from: string) => handlers.current?.onMessage(data, from),
    [],
  );
  const onError = useCallback(() => setFailed(true), []);
  const closeMenu = useCallback(() => setMenu(false), []);

  const options: SubtitleOption[] = [
    {
      key: "off",
      label: "Off",
      selected: subtitle?.url === available.off,
      onPress: () =>
        choose({ url: available.off, label: "Off", language: "" }, "off"),
    },
    {
      key: "auto",
      label: "Automatic",
      detail: "Whatever the player picks, usually English",
      selected: subtitle === null,
      onPress: () => choose(null, "auto"),
    },
    ...available.tracks.map((track) => ({
      key: track.id,
      label: track.label,
      detail: track.release,
      selected: subtitle?.url === track.url,
      onPress: () =>
        choose(
          { url: track.url, label: track.label, language: track.language },
          track.language,
        ),
    })),
  ];

  const actions: TvAction[] = [
    { label: "Subtitles", onPress: () => setMenu(true) },
    { label: "Reload player", onPress: () => reload(armed ? position : null) },
    {
      label: completed ? "Watched" : "Mark watched",
      disabled: viewing.isPending || completed,
      onPress: () =>
        viewing.mutate(
          { titleId, episodeId, completed: true },
          { onSuccess: () => setCompleted(true) },
        ),
    },
  ];

  return (
    <>
      {failed || url === null ? null : (
        <EmbedSurface
          key={`${attempt}:${url}`}
          url={url}
          surface={surface}
          webview={webview}
          onLoad={onLoad}
          onMessage={onMessage}
          onError={onError}
        />
      )}
      <TvPlayerChrome
        transport={transport}
        ended={completed}
        resumedAt={null}
        onStartOver={() => transport.seekTo(0)}
        hint={slow ? "Press OK to start playing" : null}
        onSelectWhileNotReady={start}
        notice={
          failed
            ? {
                title: "The player didn't load",
                message:
                  "Go back and open it again. If it keeps happening, the TV may have lost its internet connection.",
              }
            : null
        }
        actions={actions}
        inactive={menu}
        {...chrome}
      />
      {menu ? (
        <TvSubtitleMenu
          options={options}
          note={
            subtitles.data?.configured === false
              ? "Only the player's own subtitles are available on this TV for now."
              : subtitles.isError
                ? "The list of subtitles didn't load. Off and Automatic still work."
                : available.tracks.length === 0 && !subtitles.isPending
                  ? "We didn't find any subtitles for this one."
                  : null
          }
          onClose={closeMenu}
        />
      ) : null}
    </>
  );
}

/**
 * The provider's page, behind everything and unreachable by focus. Memoised:
 * its props are stable, so the player's clock never re-renders it.
 */
const EmbedSurface = memo(function EmbedSurface({
  url,
  surface,
  webview,
  onLoad,
  onMessage,
  onError,
}: {
  url: string;
  surface: RefObject<View | null>;
  webview: RefObject<WebView | null>;
  onLoad: () => void;
  onMessage: (data: string, from: string) => void;
  onError: () => void;
}) {
  return (
    <View
      style={styles.stage}
      pointerEvents="none"
      importantForAccessibility="no-hide-descendants"
    >
      <View ref={surface} style={styles.video} collapsable={false}>
        <WebView
          ref={webview}
          source={{ uri: url }}
          style={styles.video}
          focusable={false}
          originWhitelist={["*"]}
          allowsFullscreenVideo
          allowsInlineMediaPlayback
          mediaPlaybackRequiresUserAction={false}
          javaScriptCanOpenWindowsAutomatically={false}
          setSupportMultipleWindows
          onOpenWindow={() => undefined}
          injectedJavaScriptBeforeContentLoaded={EMBED_BROWSER_SCRIPT}
          injectedJavaScriptBeforeContentLoadedForMainFrameOnly={false}
          injectedJavaScript={EMBED_BROWSER_SCRIPT}
          injectedJavaScriptForMainFrameOnly={false}
          onShouldStartLoadWithRequest={(request) =>
            allowEmbedNavigation(request, url)
          }
          onError={onError}
          onLoad={onLoad}
          onMessage={(event) =>
            onMessage(event.nativeEvent.data, event.nativeEvent.url)
          }
        />
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#000000" },
  dim: { opacity: 0.35 },
  video: { flex: 1, backgroundColor: "#000000" },
  stage: {
    position: "absolute",
    left: 0,
    right: 0,
    top: -PROVIDER_TOP,
    bottom: -PROVIDER_BOTTOM,
  },
});
