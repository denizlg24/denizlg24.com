import { formatRuntime, type TitleDetail } from "@repo/schemas/stream";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import {
  Bookmark,
  BookmarkCheck,
  ChevronLeft,
  Clapperboard,
  Film,
  Play,
} from "lucide-react-native";
import { useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useEpisodes, useTitle, useToggleWatchlist } from "@/api/stream";
import { playTitle } from "@/features/studio/open";
import { useAudience } from "@/lib/audience-store";
import { listNames, titleFacts } from "@/lib/format";
import { formatRemaining, resumePosition } from "@/lib/time";
import {
  BACKDROP_RATIO,
  Backdrop,
  Button,
  Chip,
  colors,
  EmptyState,
  gutter,
  IconButton,
  MetaRow,
  Rating,
  spacing,
  Text,
} from "@/ui";

/**
 * A title's page: backdrop, the name set large, a typeset billing block,
 * Play / Resume, Save, the trailer, and seasons with their episodes. The
 * classic layout gets the same page in bigger type with labelled buttons.
 */
export function TitleScreen({ id }: { id: string }) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { lead, layout } = useAudience();
  const classic = layout === "classic";
  const query = useTitle(id, lead.id);
  const toggle = useToggleWatchlist(lead.id);
  const detail = query.data?.title;
  const [season, setSeason] = useState<number | null>(null);
  const activeSeason = season ?? detail?.seasons[0] ?? null;
  const episodes = useEpisodes(
    id,
    detail && detail.type !== "movie" ? activeSeason : null,
  );

  const back = (
    <View style={[styles.back, { top: insets.top + spacing.xs }]}>
      <IconButton
        icon={ChevronLeft}
        label="Back"
        scrim
        onPress={() => router.back()}
      />
    </View>
  );

  if (!detail || !query.data) {
    return (
      <View style={styles.center}>
        {back}
        {query.isError ? (
          <EmptyState
            icon={Film}
            title="This page didn't load"
            message="We couldn't reach Stream. Check your connection and try again."
            large={classic}
            action={
              <Button label="Try again" onPress={() => void query.refetch()} />
            }
          />
        ) : (
          <ActivityIndicator color={colors.muted} />
        )}
      </View>
    );
  }

  const { inWatchlist, progress } = query.data;
  const resume = resumePosition(progress);
  const size = classic ? "classic" : "large";

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 80 }}>
        <Backdrop
          title={detail}
          style={{ width, height: width / BACKDROP_RATIO + insets.top }}
        >
          <LinearGradient
            colors={["rgba(12,11,10,0.55)", "rgba(12,11,10,0)", colors.ink]}
            locations={[0, 0.35, 1]}
            style={StyleSheet.absoluteFill}
          />
        </Backdrop>
        <Animated.View entering={FadeIn.duration(400)} style={styles.body}>
          <Text variant={classic ? "classicTitle" : "marquee"}>
            {detail.title}
          </Text>
          <MetaRow facts={titleFacts(detail)} large={classic} />
          {detail.tagline ? (
            <Text variant={classic ? "classicBody" : "lede"} color="muted">
              {detail.tagline}
            </Text>
          ) : null}

          <View style={styles.actions}>
            <Button
              label={
                resume !== null && progress
                  ? `Resume, ${formatRemaining(progress.positionS, progress.durationS)}`
                  : "Play"
              }
              icon={Play}
              filledIcon
              size={size}
              block
              onPress={() => playTitle(id, progress?.episodeId ?? null)}
            />
            <View style={styles.row}>
              <Button
                label={
                  inWatchlist
                    ? classic
                      ? "On my list"
                      : "Saved"
                    : classic
                      ? "Add to my list"
                      : "Save"
                }
                icon={inWatchlist ? BookmarkCheck : Bookmark}
                variant="secondary"
                size={size}
                onPress={() =>
                  toggle.mutate({ title: detail, add: !inWatchlist })
                }
              />
              {detail.trailerKey ? (
                <Button
                  label={classic ? "Watch the trailer" : "Trailer"}
                  icon={Clapperboard}
                  variant="secondary"
                  size={size}
                  onPress={() =>
                    void Linking.openURL(
                      `https://www.youtube.com/watch?v=${detail.trailerKey}`,
                    )
                  }
                />
              ) : null}
            </View>
            {!detail.available ? (
              <Text
                variant={classic ? "classicBody" : "footnote"}
                color="muted"
              >
                Not available to play yet. You can still save it for later.
              </Text>
            ) : null}
          </View>

          <Billing detail={detail} classic={classic} />

          {detail.overview ? (
            <Text
              variant={classic ? "classicBody" : "body"}
              style={styles.overview}
            >
              {detail.overview}
            </Text>
          ) : null}

          {detail.seasons.length > 0 ? (
            <View style={styles.seasons}>
              <Text variant={classic ? "classicHeading" : "display"}>
                Episodes
              </Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.tabs}
              >
                {detail.seasons.map((number) => (
                  <Chip
                    key={number}
                    label={`Season ${number}`}
                    large={classic}
                    selected={number === activeSeason}
                    onPress={() => setSeason(number)}
                  />
                ))}
              </ScrollView>
              {episodes.isPending && activeSeason !== null ? (
                <ActivityIndicator color={colors.muted} />
              ) : null}
              {episodes.data?.map((episode) => (
                <Pressable
                  key={episode.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Play episode ${episode.episode ?? ""}, ${episode.title ?? ""}`}
                  onPress={() => playTitle(id, episode.id)}
                  style={({ pressed }) => [
                    styles.episode,
                    { opacity: pressed ? 0.7 : 1 },
                  ]}
                >
                  <Text
                    variant={classic ? "classicTitle" : "title"}
                    color="amber"
                    style={styles.episodeNumber}
                  >
                    {episode.episode ?? ""}
                  </Text>
                  <View style={styles.grow}>
                    <Text
                      variant={classic ? "classicLabel" : "headline"}
                      numberOfLines={2}
                    >
                      {episode.title ?? `Episode ${episode.episode ?? ""}`}
                    </Text>
                    <View style={styles.episodeMeta}>
                      {episode.rating !== null ? (
                        <Rating
                          value={episode.rating.toFixed(1)}
                          large={classic}
                        />
                      ) : null}
                      {episode.runtimeMinutes ? (
                        <Text
                          variant={classic ? "classicBody" : "footnote"}
                          color="muted"
                        >
                          {formatRuntime(episode.runtimeMinutes)}
                        </Text>
                      ) : null}
                    </View>
                  </View>
                  <Play color={colors.muted} size={18} />
                </Pressable>
              ))}
            </View>
          ) : null}
        </Animated.View>
      </ScrollView>
      {back}
    </View>
  );
}

/** Credits set like a poster's billing block: genres, the cast, the IMDb standing. */
function Billing({
  detail,
  classic,
}: {
  detail: TitleDetail;
  classic: boolean;
}) {
  const cast = detail.cast.slice(0, 8).map((member) => member.name);
  const body = classic ? "classicBody" : "body";
  return (
    <View style={styles.billing}>
      <View style={styles.rule} />
      {detail.genres.length > 0 ? (
        <View style={styles.genres}>
          {detail.genres.map((genre) => (
            <Text key={genre} variant={classic ? "classicLabel" : "callout"}>
              {genre}
            </Text>
          ))}
        </View>
      ) : null}
      {cast.length > 0 ? (
        <Text
          variant={classic ? "classicHeading" : "title"}
          style={styles.centerText}
        >
          {listNames(cast)}
        </Text>
      ) : null}
      {detail.episodeCount > 0 ? (
        <Text variant={body} color="muted" style={styles.centerText}>
          {detail.episodeCount} episodes
        </Text>
      ) : null}
      {detail.rating !== null ? (
        <View style={styles.standing}>
          <Rating value={detail.rating.toFixed(1)} large={classic} />
          <Text variant={body} color="muted">
            on IMDb, from {detail.votes.toLocaleString("en-GB")} votes
          </Text>
        </View>
      ) : null}
      <View style={styles.rule} />
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
  back: { position: "absolute", left: spacing.sm },
  body: {
    paddingHorizontal: gutter,
    gap: spacing.xl,
    marginTop: -spacing.xxxl,
  },
  actions: { gap: spacing.sm },
  row: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  billing: { gap: spacing.sm, alignItems: "center" },
  rule: {
    alignSelf: "stretch",
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.hairline,
    marginVertical: spacing.sm,
  },
  centerText: { textAlign: "center" },
  genres: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    columnGap: spacing.lg,
    rowGap: spacing.xs,
  },
  standing: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    flexWrap: "wrap",
    justifyContent: "center",
  },
  episodeMeta: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  overview: { color: colors.paper },
  seasons: { gap: spacing.md },
  tabs: { gap: spacing.sm },
  episode: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
  },
  episodeNumber: { width: 44 },
  grow: { flex: 1, gap: spacing.xxs },
});
