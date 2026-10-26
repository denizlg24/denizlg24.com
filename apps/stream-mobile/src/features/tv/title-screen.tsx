import { tmdbImage } from "@repo/schemas/stream";
import { Image } from "expo-image";
import { router } from "expo-router";
import {
  Bookmark,
  BookmarkCheck,
  Clapperboard,
  Film,
  Play,
} from "lucide-react-native";
import { useState } from "react";
import {
  ActivityIndicator,
  Linking,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import {
  useCurrentEpisode,
  useEpisodes,
  useTitle,
  useToggleWatchlist,
} from "@/api/stream";
import { useAudience } from "@/lib/audience-store";
import { episodeLabel, titleFacts } from "@/lib/format";
import { formatRemaining, resumePosition } from "@/lib/time";
import {
  Button,
  colors,
  EmptyState,
  MetaRow,
  radius,
  spacing,
  Text,
} from "@/ui";
import { TvBackdrop } from "./chrome";
import { FOCUS_ROOM, Focusable } from "./focusable";
import { TV_SAFE } from "./layout";
import { playOnTv } from "./open";

const STILL = 224;

export function TvTitleScreen({ id }: { id: string }) {
  const { lead } = useAudience();
  const query = useTitle(id, lead.id);
  const toggle = useToggleWatchlist(lead.id);
  const detail = query.data?.title;
  const currentEpisode = useCurrentEpisode(
    id,
    query.data?.progress?.episodeId ?? null,
  );
  const [season, setSeason] = useState<number | null>(null);
  const activeSeason =
    season ?? currentEpisode.data?.season ?? detail?.seasons[0] ?? null;
  const episodes = useEpisodes(
    id,
    detail && detail.type !== "movie" ? activeSeason : null,
  );

  if (!detail || !query.data) {
    return (
      <View style={styles.center}>
        {query.isError ? (
          <EmptyState
            icon={Film}
            title="This page didn't load"
            message="We couldn't reach Stream. Check that the TV is connected to the internet, then try again."
            action={
              <Button
                label="Try again"
                size="large"
                preferred
                onPress={() => void query.refetch()}
              />
            }
          />
        ) : (
          <ActivityIndicator color={colors.muted} size="large" />
        )}
      </View>
    );
  }

  const { inWatchlist, progress } = query.data;
  const resume = resumePosition(progress);
  const playLabel =
    resume !== null && progress
      ? `Resume, ${formatRemaining(progress.positionS, progress.durationS)}`
      : progress && detail.type !== "movie"
        ? "Continue series"
        : "Play";

  return (
    <View style={styles.screen}>
      <TvBackdrop title={detail} />
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.head}>
          <Text variant="marquee" numberOfLines={2}>
            {detail.title}
          </Text>
          <MetaRow facts={titleFacts(detail)} />
          {detail.overview ? (
            <Text variant="body" color="muted" numberOfLines={4}>
              {detail.overview}
            </Text>
          ) : null}
          <View style={styles.actions}>
            <Button
              label={playLabel}
              icon={Play}
              filledIcon
              size="large"
              preferred
              disabled={!detail.available}
              onPress={() => playOnTv(id)}
            />
            <Button
              label={inWatchlist ? "On my list" : "Add to my list"}
              icon={inWatchlist ? BookmarkCheck : Bookmark}
              variant="secondary"
              size="large"
              onPress={() =>
                toggle.mutate({ title: detail, add: !inWatchlist })
              }
            />
            {detail.trailerKey ? (
              <Button
                label="Trailer"
                icon={Clapperboard}
                variant="secondary"
                size="large"
                // Google TV hands YouTube links to its YouTube app.
                onPress={() =>
                  void Linking.openURL(
                    `https://www.youtube.com/watch?v=${detail.trailerKey}`,
                  ).catch(() => undefined)
                }
              />
            ) : null}
          </View>
          {!detail.available ? (
            <Text variant="body" color="muted">
              This one isn't available to play yet. You can still add it to your
              list for later.
            </Text>
          ) : null}
        </View>

        {detail.type !== "movie" && detail.seasons.length > 0 ? (
          <View style={styles.episodes}>
            {detail.seasons.length > 1 ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.seasons}
              >
                {detail.seasons.map((number) => (
                  <Focusable
                    key={number}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: number === activeSeason }}
                    onPress={() => setSeason(number)}
                    style={[
                      styles.season,
                      number === activeSeason ? styles.seasonOn : null,
                    ]}
                    radius={6}
                    grow={1.04}
                  >
                    <Text
                      variant="callout"
                      color={number === activeSeason ? "onAmber" : "paper"}
                    >
                      Season {number}
                    </Text>
                  </Focusable>
                ))}
              </ScrollView>
            ) : (
              <Text variant="title" style={styles.pad}>
                Season {activeSeason}
              </Text>
            )}
            {episodes.isPending ? (
              <ActivityIndicator color={colors.muted} style={styles.pad} />
            ) : (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.rail}
              >
                {(episodes.data ?? []).map((episode) => {
                  const still = tmdbImage(episode.stillPath ?? null, "w780");
                  const current = episode.id === progress?.episodeId;
                  return (
                    <Focusable
                      key={episode.id}
                      accessibilityRole="button"
                      accessibilityLabel={`${episodeLabel(episode.season, episode.episode)} ${episode.title ?? ""}`}
                      onPress={() => playOnTv(id, episode.id)}
                      style={styles.episode}
                      radius={4}
                    >
                      <View style={styles.still}>
                        {still ? (
                          <Image
                            source={{ uri: still }}
                            style={StyleSheet.absoluteFill}
                            contentFit="cover"
                          />
                        ) : (
                          <Film color={colors.muted} size={22} />
                        )}
                      </View>
                      <Text
                        variant="caption"
                        color={current ? "amber" : "muted"}
                      >
                        {episodeLabel(episode.season, episode.episode)}
                      </Text>
                      <Text variant="callout" numberOfLines={2}>
                        {episode.title ?? `Episode ${episode.episode}`}
                      </Text>
                    </Focusable>
                  );
                })}
              </ScrollView>
            )}
          </View>
        ) : null}

        {detail.cast.length > 0 ? (
          <View style={styles.episodes}>
            <Text variant="title" style={styles.pad}>
              Cast
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.rail}
            >
              {detail.cast.map((person) => (
                <Focusable
                  key={`${person.name}:${person.character}`}
                  accessibilityRole="button"
                  accessibilityLabel={`Films and series with ${person.name}`}
                  onPress={() =>
                    router.push({
                      pathname: "/tv/actor/[name]",
                      params: { name: person.name },
                    })
                  }
                  style={styles.person}
                  radius={radius.md}
                  grow={1.04}
                >
                  <Text variant="headline" numberOfLines={1}>
                    {person.name}
                  </Text>
                  {person.character ? (
                    <Text variant="caption" color="muted" numberOfLines={1}>
                      {person.character}
                    </Text>
                  ) : null}
                </Focusable>
              ))}
            </ScrollView>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ink },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.ink,
  },
  content: {
    paddingTop: TV_SAFE.y + spacing.xxxl,
    paddingBottom: TV_SAFE.y + spacing.xl,
    gap: spacing.xxxl,
  },
  head: { paddingHorizontal: TV_SAFE.x, gap: spacing.md, maxWidth: 640 },
  actions: { flexDirection: "row", gap: spacing.md, marginTop: spacing.sm },
  episodes: { gap: spacing.md },
  pad: { paddingHorizontal: TV_SAFE.x },
  seasons: {
    paddingHorizontal: TV_SAFE.x,
    paddingVertical: FOCUS_ROOM,
    gap: spacing.sm,
  },
  season: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: 6,
    backgroundColor: colors.fill,
  },
  seasonOn: { backgroundColor: colors.amber },
  rail: {
    paddingHorizontal: TV_SAFE.x,
    paddingVertical: FOCUS_ROOM,
    gap: spacing.lg,
  },
  person: {
    width: 176,
    padding: spacing.md,
    gap: spacing.xxs,
    borderRadius: radius.md,
    backgroundColor: colors.raised,
  },
  episode: { width: STILL, gap: spacing.xs },
  still: {
    width: STILL,
    height: (STILL * 9) / 16,
    borderRadius: 4,
    overflow: "hidden",
    backgroundColor: colors.raised,
    alignItems: "center",
    justifyContent: "center",
  },
});
