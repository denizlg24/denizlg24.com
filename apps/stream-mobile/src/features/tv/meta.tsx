import {
  formatRuntime,
  type TitleSummary,
  titleYears,
} from "@repo/schemas/stream";
import { Star } from "lucide-react-native";
import { StyleSheet, View } from "react-native";
import { colors, spacing } from "@/ui";
import { TvText } from "./tv-text";

type MetaTitle = Pick<
  TitleSummary,
  "type" | "startYear" | "endYear" | "runtimeMinutes" | "rating" | "genres"
> & { certification?: string | null; seasons?: number[] };

function length(title: MetaTitle): string | null {
  if (title.type === "movie")
    return formatRuntime(title.runtimeMinutes) || null;
  const seasons = title.seasons?.length ?? 0;
  if (seasons > 1) return `${seasons} seasons`;
  if (title.type === "miniseries") return "Limited series";
  return seasons === 1 ? "1 season" : null;
}

/** "A", "A and B", "A, B and C". */
export function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/**
 * Rating, year, certification, length and up to two genres on one line,
 * separated by space alone. Never wraps: whatever doesn't fit is cut.
 */
export function TvMeta({
  title,
  genres = 2,
}: {
  title: MetaTitle;
  genres?: number;
}) {
  const years = titleYears(title);
  const runtime = length(title);
  const shownGenres = title.genres.slice(0, genres).join("  ");
  return (
    <View style={styles.row}>
      {title.rating !== null ? (
        <View style={styles.rating}>
          <Star
            size={14}
            color={colors.amber}
            fill={colors.amber}
            strokeWidth={1.5}
          />
          <TvText
            variant="metaStrong"
            accessibilityLabel={`Rated ${title.rating.toFixed(1)} out of 10`}
          >
            {title.rating.toFixed(1)}
          </TvText>
        </View>
      ) : null}
      {years ? <TvText variant="meta">{years}</TvText> : null}
      {title.certification ? (
        <View style={styles.badge}>
          <TvText variant="caption" color="paper">
            {title.certification}
          </TvText>
        </View>
      ) : null}
      {runtime ? <TvText variant="meta">{runtime}</TvText> : null}
      {shownGenres ? (
        <TvText
          variant="meta"
          color="muted"
          numberOfLines={1}
          style={styles.shrink}
        >
          {shownGenres}
        </TvText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    overflow: "hidden",
  },
  rating: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  badge: {
    borderWidth: 1,
    borderColor: "rgba(239,233,223,0.55)",
    borderRadius: 3,
    paddingHorizontal: 5,
  },
  shrink: { flexShrink: 1 },
});
