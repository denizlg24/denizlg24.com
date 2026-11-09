import {
  type Billboard as BillboardData,
  tmdbImage,
} from "@repo/schemas/stream";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { Check, Play, Plus } from "lucide-react-native";
import { memo } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { openTitle, playTitle } from "@/features/title/open";
import { resumePosition } from "@/lib/time";
import { Button, colors, Grain, radius, Skeleton, spacing, Text } from "@/ui";
import { EDGE } from "./metrics";
import { TitleLogo } from "./rows";

/** Poster card height for a given width: tall, but never more than most of the screen. */
export function billboardHeight(width: number, screenHeight: number): number {
  return Math.round(Math.min((width - EDGE * 2) * 1.3, screenHeight * 0.6));
}

/**
 * Netflix's big poster card: the poster with a gradient, the logo (or the
 * name), a line of genres, then Play and My List side by side.
 */
export const Billboard = memo(function Billboard({
  billboard,
  inList,
  onToggleList,
  width,
  height,
}: {
  billboard: BillboardData;
  inList: boolean;
  onToggleList: () => void;
  width: number;
  height: number;
}) {
  const { title, progress } = billboard;
  const cardWidth = width - EDGE * 2;
  // Backdrops are usually textless key art; a poster would print the title twice.
  const uri =
    tmdbImage(title.backdropPath, "w1280") ??
    tmdbImage(title.posterPath, "w780");
  const resuming = resumePosition(progress) !== null;
  return (
    <View style={[styles.card, { width: cardWidth, height }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${title.title}. More about it`}
        onPress={() => openTitle(title.id)}
        style={StyleSheet.absoluteFill}
      >
        {uri ? (
          <Image
            source={{ uri }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            transition={240}
            recyclingKey={uri}
          />
        ) : null}
        <Grain />
        <LinearGradient
          colors={[
            "rgba(12,11,10,0)",
            "rgba(12,11,10,0.55)",
            "rgba(12,11,10,0.95)",
          ]}
          locations={[0.4, 0.68, 1]}
          style={StyleSheet.absoluteFill}
        />
      </Pressable>
      <View style={styles.foot} pointerEvents="box-none">
        <TitleLogo
          title={title}
          maxWidth={cardWidth * 0.7}
          height={Math.round(height * 0.16)}
          variant="hero"
          align="center"
        />
        {title.genres.length > 0 ? (
          <View style={styles.genres}>
            {title.genres.slice(0, 3).map((genre) => (
              <Text
                key={genre}
                variant="footnote"
                numberOfLines={1}
                style={styles.genre}
              >
                {genre}
              </Text>
            ))}
          </View>
        ) : null}
        {billboard.reason ? (
          <Text
            variant="caption"
            color="muted"
            numberOfLines={1}
            style={styles.genre}
          >
            {billboard.reason}
          </Text>
        ) : null}
        <View style={styles.actions}>
          <View style={styles.action}>
            <Button
              label={resuming ? "Resume" : "Play"}
              icon={Play}
              filledIcon
              rounded
              block
              disabled={!title.available}
              onPress={() => playTitle(title.id, progress?.episodeId)}
            />
          </View>
          <View style={styles.action}>
            <Button
              label="My List"
              icon={inList ? Check : Plus}
              variant="secondary"
              rounded
              block
              onPress={onToggleList}
            />
          </View>
        </View>
      </View>
      <View pointerEvents="none" style={styles.edge} />
    </View>
  );
});

export function BillboardSkeleton({
  width,
  height,
}: {
  width: number;
  height: number;
}) {
  return (
    <Skeleton
      style={{
        width: width - EDGE * 2,
        height,
        borderRadius: radius.md,
        alignSelf: "center",
      }}
    />
  );
}

const styles = StyleSheet.create({
  card: {
    alignSelf: "center",
    borderRadius: radius.md,
    overflow: "hidden",
    backgroundColor: colors.raised,
  },
  edge: {
    ...StyleSheet.absoluteFill,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  foot: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    padding: spacing.lg,
    gap: spacing.md,
    alignItems: "center",
  },
  genres: {
    flexDirection: "row",
    justifyContent: "center",
    columnGap: spacing.md,
    maxWidth: "100%",
  },
  genre: { flexShrink: 1, textAlign: "center" },
  actions: { flexDirection: "row", gap: spacing.sm, alignSelf: "stretch" },
  action: { flex: 1, minWidth: 0 },
});
