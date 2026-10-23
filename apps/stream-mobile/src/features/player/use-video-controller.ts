import { useEvent } from "expo";
import {
  isPictureInPictureSupported,
  type VideoPlayer,
  type VideoView,
} from "expo-video";
import { type RefObject, useMemo, useState } from "react";
import { clampSeek, type PlayerController } from "./controller";

/** A `PlayerController` over an expo-video player and its view. */
export function useVideoController(
  player: VideoPlayer,
  view: RefObject<VideoView | null>,
): PlayerController {
  const { isPlaying } = useEvent(player, "playingChange", {
    isPlaying: player.playing,
  });
  const { status } = useEvent(player, "statusChange", {
    status: player.status,
  });
  const { currentTime } = useEvent(player, "timeUpdate", {
    currentTime: player.currentTime,
    currentLiveTimestamp: null,
    currentOffsetFromLive: null,
    bufferedPosition: player.bufferedPosition,
  });
  const { playbackRate } = useEvent(player, "playbackRateChange", {
    playbackRate: player.playbackRate,
  });
  const { availableSubtitleTracks } = useEvent(
    player,
    "availableSubtitleTracksChange",
    {
      availableSubtitleTracks: player.availableSubtitleTracks,
    },
  );
  const { subtitleTrack } = useEvent(player, "subtitleTrackChange", {
    subtitleTrack: player.subtitleTrack,
  });
  const [pipSupported] = useState(() => isPictureInPictureSupported());

  return useMemo<PlayerController>(() => {
    const tracks = availableSubtitleTracks.map((track, index) => ({
      id: track.id ?? `${track.language}-${index}`,
      track,
    }));
    return {
      available: true,
      playing: isPlaying,
      buffering: status === "loading",
      position: currentTime,
      duration: player.duration,
      rate: playbackRate,
      subtitles: tracks.map(({ id, track }) => ({
        id,
        label: track.label || track.name || track.language,
      })),
      subtitle: subtitleTrack
        ? (tracks.find(
            ({ track }) =>
              track.language === subtitleTrack.language &&
              track.label === subtitleTrack.label,
          )?.id ?? null)
        : null,
      pictureInPicture: pipSupported,
      toggle: () => (player.playing ? player.pause() : player.play()),
      seekBy: (seconds) => {
        player.currentTime = clampSeek(
          player.currentTime + seconds,
          player.duration,
        );
      },
      seekTo: (seconds) => {
        player.currentTime = clampSeek(seconds, player.duration);
      },
      setRate: (rate) => {
        player.playbackRate = rate;
      },
      setSubtitle: (id) => {
        player.subtitleTrack =
          id === null ? null : (tracks.find((t) => t.id === id)?.track ?? null);
      },
      startPictureInPicture: () => {
        void view.current?.startPictureInPicture().catch(() => undefined);
      },
    };
  }, [
    player,
    view,
    isPlaying,
    status,
    currentTime,
    playbackRate,
    availableSubtitleTracks,
    subtitleTrack,
    pipSupported,
  ]);
}
