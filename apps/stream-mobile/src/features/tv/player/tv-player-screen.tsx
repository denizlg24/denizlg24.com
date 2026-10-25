import {
  allowEmbedNavigation,
  EMBED_BROWSER_SCRIPT,
  type EmbedProgress,
  type Episode,
  embedPlayerUrl,
  type Playback,
  type PlaybackSource,
  type Progress,
  parseEmbedProgress,
  tmdbImage,
} from "@repo/schemas/stream";
import { useQueryClient } from "@tanstack/react-query";
import { useEvent } from "expo";
import { Image } from "expo-image";
import { router } from "expo-router";
import { useVideoPlayer, VideoView } from "expo-video";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { findNodeHandle, StyleSheet, View } from "react-native";
import { WebView } from "react-native-webview";
import {
  invalidateAfterWatching,
  usePlayback,
  useRecordProgress,
  useRecordViewing,
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
import { episodeLabel } from "@/lib/format";
import { resumePosition } from "@/lib/time";
import { tapCenter } from "../../../../modules/stream-tv";
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

/**
 * A VidSrc embed in a WebView that never takes focus: the remote drives it
 * through the provider's message API (`play`, `pause`, `seek<seconds>`), the
 * way the web player does, and its `PLAYER_EVENT`s keep a clock that runs
 * between them. Progress and viewing are recorded for everyone on the sofa.
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
  const lastSent = useRef(0);
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [slow, setSlow] = useState(false);
  const [clock, setClock] = useState<Clock | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [progress, setProgress] = useState<EmbedProgress | null>(null);
  const [completed, setCompleted] = useState(false);
  const episodeId = playback.episode?.id ?? null;
  const latest = useRef({ progress, completed, report, profileIds });
  latest.current = { progress, completed, report, profileIds };
  const url = embedPlayerUrl(playback.embed!.url);
  const origin = new URL(url).origin;
  const armed = clock !== null;

  const command = useCallback((action: string) => {
    webview.current?.injectJavaScript(
      `(function () { var f = document.getElementById('player_iframe'); if (f && f.contentWindow) f.contentWindow.postMessage({ player: true, action: ${JSON.stringify(action)} }, new URL(f.src).origin); })(); true;`,
    );
  }, []);

  const send = (update: EmbedProgress) =>
    report.mutate({
      titleId,
      episodeId,
      positionS: update.position,
      durationS: update.duration,
    });

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

  const reload = () => {
    setFailed(false);
    setLoaded(false);
    setSlow(false);
    setClock(null);
    restored.current = false;
    setAttempt((value) => value + 1);
  };

  const actions: TvAction[] = [
    { label: "Reload player", onPress: reload },
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
      {failed ? null : (
        <View
          style={styles.stage}
          pointerEvents="none"
          importantForAccessibility="no-hide-descendants"
        >
          <View ref={surface} style={styles.video} collapsable={false}>
            <WebView
              ref={webview}
              key={attempt}
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
              onError={() => setFailed(true)}
              onLoad={() => {
                setLoaded(true);
                if (!started.current) {
                  started.current = true;
                  viewing.mutate({ titleId, episodeId, completed: false });
                }
              }}
              onMessage={(event) => {
                try {
                  if (new URL(event.nativeEvent.url).origin !== origin) return;
                } catch {
                  return;
                }
                const update = parseEmbedProgress(
                  event.nativeEvent.data,
                  playback.embed!.url,
                );
                if (!update) return;
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
                    (update.status === "seeked" &&
                      (previous?.running ?? false)),
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
                  send(update);
                }
              }}
            />
          </View>
        </View>
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
        {...chrome}
      />
    </>
  );
}

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
