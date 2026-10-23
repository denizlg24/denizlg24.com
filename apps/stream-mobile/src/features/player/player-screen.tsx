import {
  type Episode,
  type PlaybackSource,
  type Progress,
  tmdbImage,
} from "@repo/schemas/stream";
import { useQueryClient } from "@tanstack/react-query";
import { Image } from "expo-image";
import { router } from "expo-router";
import { useVideoPlayer, VideoView } from "expo-video";
import { useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { usePlayback, useTitle } from "@/api/stream";
import { useAudience } from "@/lib/audience-store";
import { episodeLabel } from "@/lib/format";
import { resumePosition } from "@/lib/time";
import { type PlayerController, UNAVAILABLE } from "./controller";
import { PlayerChrome } from "./player-chrome";
import { useProgressReporter } from "./use-progress-reporter";
import { useVideoController } from "./use-video-controller";

const RESUME_NOTICE_MS = 6000;

/** The best source the catalogue offered: the tallest picture. */
export function pickSource(sources: PlaybackSource[]): PlaybackSource | null {
  return (
    [...sources].sort((a, b) => (b.height ?? 0) - (a.height ?? 0))[0] ?? null
  );
}

export function PlayerScreen({
  id,
  episode,
}: {
  id: string;
  episode: string | null;
}) {
  const { lead: profile } = useAudience();
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
  const subtitle = cachedEpisode
    ? [
        episodeLabel(cachedEpisode.season, cachedEpisode.episode),
        cachedEpisode.title,
      ]
        .filter(Boolean)
        .join(": ")
    : undefined;

  const shared = {
    title: detail?.title ?? "",
    subtitle,
    next: playback.data?.next ?? null,
    onNext: () => {
      const next = playback.data?.next;
      if (next)
        router.replace({
          pathname: "/watch/[id]",
          params: { id, episode: next.id },
        });
    },
    onClose: () => router.back(),
  };
  const backdrop = detail ? tmdbImage(detail.backdropPath, "w1280") : null;

  return (
    <View style={styles.screen}>
      {source ? (
        <ActivePlayer
          key={`${id}:${episode ?? ""}`}
          source={source}
          artwork={backdrop}
          resume={playback.data?.resume ?? null}
          profileId={profile.id}
          titleId={id}
          episodeId={episode}
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
          <PlayerChrome
            controller={UNAVAILABLE}
            resumedAt={null}
            onStartOver={() => undefined}
            notice={
              playback.isPending
                ? undefined
                : playback.isError
                  ? {
                      title: "We couldn't reach Stream",
                      message:
                        "Check your connection and try again in a moment.",
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

function ActivePlayer({
  source,
  artwork,
  resume,
  profileId,
  titleId,
  episodeId,
  ...chrome
}: {
  source: PlaybackSource;
  artwork: string | null;
  resume: Progress | null;
  profileId: string;
  titleId: string;
  episodeId: string | null;
  title: string;
  subtitle?: string;
  next: Episode | null;
  onNext: () => void;
  onClose: () => void;
}) {
  const view = useRef<VideoView>(null);
  const player = useVideoPlayer(
    {
      uri: source.url,
      metadata: { title: chrome.title, artwork: artwork ?? undefined },
    },
    (created) => {
      created.timeUpdateEventInterval = 0.5;
      created.allowsExternalPlayback = true;
      created.staysActiveInBackground = true;
      created.showNowPlayingNotification = true;
      created.play();
    },
  );
  const controller: PlayerController = useVideoController(player, view);
  useProgressReporter({ controller, profileId, titleId, episodeId });

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

  return (
    <>
      <VideoView
        ref={view}
        player={player}
        style={StyleSheet.absoluteFill}
        nativeControls={false}
        contentFit="contain"
        allowsPictureInPicture
        startsPictureInPictureAutomatically
      />
      <PlayerChrome
        controller={controller}
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

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#000000" },
  dim: { opacity: 0.35 },
});
