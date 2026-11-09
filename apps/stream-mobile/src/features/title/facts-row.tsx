import {
  formatRuntime,
  type TitleDetail,
  titleYears,
} from "@repo/schemas/stream";
import { StyleSheet, View } from "react-native";
import { colors, Rating, radius, spacing, Text } from "@/ui";

function length(detail: TitleDetail): string | null {
  if (detail.type === "movie")
    return formatRuntime(detail.runtimeMinutes) || null;
  const seasons = detail.seasons.length;
  if (seasons > 1) return `${seasons} seasons`;
  if (detail.episodeCount > 0) {
    return detail.episodeCount === 1
      ? "1 episode"
      : `${detail.episodeCount} episodes`;
  }
  return seasons === 1 ? "1 season" : null;
}

/** Year, certification, runtime or seasons, and the rating, spaced apart. */
export function FactsRow({ detail }: { detail: TitleDetail }) {
  const years = titleYears(detail);
  const span = length(detail);
  return (
    <View style={styles.row}>
      {years ? (
        <Text variant="subheadline" color="muted">
          {years}
        </Text>
      ) : null}
      {detail.certification ? (
        <View style={styles.badge}>
          <Text variant="caption" color="muted">
            {detail.certification}
          </Text>
        </View>
      ) : null}
      {span ? (
        <Text variant="subheadline" color="muted">
          {span}
        </Text>
      ) : null}
      {detail.rating !== null ? (
        <Rating value={detail.rating.toFixed(1)} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    columnGap: spacing.md,
    rowGap: spacing.xs,
  },
  badge: {
    borderWidth: 1,
    borderColor: colors.muted,
    borderRadius: radius.poster,
    paddingHorizontal: spacing.xs + 1,
  },
});
