import {
  type Episode,
  formatRuntime,
  type Progress,
  type TitleDetail,
  tmdbImage,
} from "@repo/schemas/stream";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import { Check, ChevronDown, Play, X } from "lucide-react-native";
import { memo, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useEpisodes } from "@/api/stream";
import { progressFraction } from "@/lib/time";
import {
  Button,
  colors,
  ProgressLine,
  radius,
  Skeleton,
  spacing,
  Text,
} from "@/ui";
import { playTitle } from "./open";

const STILL = 128;

/** A season button that opens Netflix's centred season list, then that season's episodes. */
export function Episodes({
  detail,
  progress,
  initialSeason,
}: {
  detail: TitleDetail;
  progress: Progress | null;
  initialSeason: number | null;
}) {
  const [season, setSeason] = useState<number | null>(null);
  const [picking, setPicking] = useState(false);
  const active = season ?? initialSeason ?? detail.seasons[0] ?? null;
  const episodes = useEpisodes(detail.id, active);

  return (
    <View style={styles.wrap}>
      {detail.seasons.length > 1 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Season ${active ?? ""}. Choose another season`}
          onPress={() => setPicking(true)}
          style={({ pressed }) => [
            styles.season,
            { opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <Text variant="callout" numberOfLines={1}>
            Season {active}
          </Text>
          <ChevronDown color={colors.paper} size={16} />
        </Pressable>
      ) : null}

      {episodes.isPending && active !== null ? (
        <EpisodeSkeleton />
      ) : episodes.isError ? (
        <View style={styles.note}>
          <Text variant="footnote" color="muted">
            The episode list didn't load.
          </Text>
          <Button
            label="Try again"
            variant="secondary"
            onPress={() => void episodes.refetch()}
          />
        </View>
      ) : episodes.data?.length === 0 ? (
        <Text variant="footnote" color="muted" style={styles.note}>
          There aren't any episodes listed for this season yet. Try another
          season.
        </Text>
      ) : (
        episodes.data?.map((episode) => (
          <EpisodeRow
            key={episode.id}
            episode={episode}
            seriesId={detail.id}
            progress={progress?.episodeId === episode.id ? progress : null}
          />
        ))
      )}

      <SeasonPicker
        visible={picking}
        seasons={detail.seasons}
        active={active}
        onPick={(value) => {
          setSeason(value);
          setPicking(false);
        }}
        onClose={() => setPicking(false)}
      />
    </View>
  );
}

const EpisodeRow = memo(function EpisodeRow({
  episode,
  seriesId,
  progress,
}: {
  episode: Episode;
  seriesId: string;
  progress: Progress | null;
}) {
  const still = tmdbImage(episode.stillPath ?? null, "w342");
  const name = episode.title ?? `Episode ${episode.episode ?? ""}`;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Play episode ${episode.episode ?? ""}, ${name}`}
      onPress={() => playTitle(seriesId, episode.id)}
      style={({ pressed }) => [styles.episode, { opacity: pressed ? 0.75 : 1 }]}
    >
      <View style={styles.episodeTop}>
        <View style={styles.still}>
          {still ? (
            <Image
              source={{ uri: still }}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              recyclingKey={still}
              transition={160}
            />
          ) : null}
          <View style={styles.stillPlay} pointerEvents="none">
            <View style={styles.disc}>
              <Play color={colors.paper} fill={colors.paper} size={14} />
            </View>
          </View>
          {progress ? (
            <ProgressLine
              value={
                progress.completed
                  ? 1
                  : progressFraction(progress.positionS, progress.durationS)
              }
              style={styles.stillProgress}
            />
          ) : null}
        </View>
        <View style={styles.episodeCopy}>
          <Text variant="callout" numberOfLines={2}>
            {episode.episode !== null ? `${episode.episode}. ${name}` : name}
          </Text>
          <View style={styles.episodeMeta}>
            {episode.runtimeMinutes ? (
              <Text variant="caption" color="muted">
                {formatRuntime(episode.runtimeMinutes)}
              </Text>
            ) : null}
            {progress?.completed ? (
              <Check color={colors.amber} size={14} />
            ) : null}
          </View>
        </View>
      </View>
      {episode.overview ? (
        <Text variant="footnote" color="muted" numberOfLines={3}>
          {episode.overview}
        </Text>
      ) : null}
    </Pressable>
  );
});

function SeasonPicker({
  visible,
  seasons,
  active,
  onPick,
  onClose,
}: {
  visible: boolean;
  seasons: number[];
  active: number | null;
  onPick: (season: number) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.picker}>
        <ScrollView
          contentContainerStyle={[
            styles.pickerList,
            {
              paddingTop: insets.top + spacing.xxxl,
              paddingBottom: insets.bottom + 140,
            },
          ]}
        >
          {seasons.map((season) => {
            const on = season === active;
            return (
              <Pressable
                key={season}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                accessibilityLabel={`Season ${season}`}
                onPress={() => {
                  void Haptics.selectionAsync().catch(() => undefined);
                  onPick(season);
                }}
                style={({ pressed }) => [
                  styles.pickerItem,
                  { opacity: pressed ? 0.5 : 1 },
                ]}
              >
                <Text
                  variant={on ? "title" : "heading"}
                  color={on ? "paper" : "muted"}
                >
                  Season {season}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
        <View
          style={[styles.closeWrap, { bottom: insets.bottom + spacing.xl }]}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close"
            onPress={onClose}
            style={({ pressed }) => [
              styles.close,
              { opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <X color={colors.ink} size={28} />
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function EpisodeSkeleton() {
  return (
    <View style={styles.wrap}>
      {[0, 1, 2].map((index) => (
        <View key={index} style={styles.episodeTop}>
          <Skeleton style={{ width: STILL, height: (STILL * 9) / 16 }} />
          <View style={styles.episodeCopy}>
            <Skeleton style={{ width: "80%", height: 16 }} />
            <Skeleton style={{ width: 48, height: 12 }} />
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.lg },
  season: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    minHeight: 36,
    paddingHorizontal: spacing.md,
    borderRadius: radius.sm,
    backgroundColor: colors.lifted,
  },
  note: { gap: spacing.sm },
  episode: { gap: spacing.sm },
  episodeTop: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  still: {
    width: STILL,
    aspectRatio: 16 / 9,
    borderRadius: radius.poster,
    overflow: "hidden",
    backgroundColor: colors.raised,
  },
  stillPlay: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    justifyContent: "center",
  },
  disc: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: colors.paper,
    backgroundColor: "rgba(12,11,10,0.45)",
    alignItems: "center",
    justifyContent: "center",
    paddingLeft: 2,
  },
  stillProgress: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 0,
  },
  episodeCopy: { flex: 1, minWidth: 0, gap: spacing.xxs },
  episodeMeta: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  picker: { flex: 1, backgroundColor: "rgba(12,11,10,0.94)" },
  pickerList: { alignItems: "center", gap: spacing.xs },
  pickerItem: { paddingVertical: spacing.md, paddingHorizontal: spacing.xl },
  closeWrap: { position: "absolute", left: 0, right: 0, alignItems: "center" },
  close: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.paper,
    alignItems: "center",
    justifyContent: "center",
  },
});
