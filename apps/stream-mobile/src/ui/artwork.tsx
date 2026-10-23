import { type TitleSummary, tmdbImage } from "@repo/schemas/stream";
import { Image } from "expo-image";
import { Film } from "lucide-react-native";
import {
  type DimensionValue,
  StyleSheet,
  View,
  type ViewStyle,
} from "react-native";
import grain from "../../assets/grain.png";
import { Text } from "./text";
import { colors, POSTER_RATIO, radius, spacing } from "./theme";

type Artwork = Pick<TitleSummary, "title" | "posterPath" | "backdropPath">;

/** A landscape 16:9 still, framed like a poster, with optional progress and overlay. */
export function Still({
  title,
  width,
  progress,
  children,
}: {
  title: Artwork;
  width: number;
  progress?: number;
  /** Drawn over the image, e.g. the title on a bottom gradient. */
  children?: React.ReactNode;
}) {
  const uri =
    tmdbImage(title.backdropPath, "w780") ??
    tmdbImage(title.posterPath, "w500");
  return (
    <View style={[styles.poster, { width, height: (width * 9) / 16 }]}>
      {uri ? (
        <Image
          source={{ uri }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          transition={160}
          recyclingKey={uri}
        />
      ) : (
        <View style={styles.fallback}>
          <Film color={colors.muted} size={22} />
        </View>
      )}
      {children}
      <View pointerEvents="none" style={styles.edge} />
      {progress !== undefined ? (
        <View style={styles.track}>
          <View
            style={[
              styles.fill,
              { width: `${Math.round(progress * 100)}%` as DimensionValue },
            ]}
          />
        </View>
      ) : null}
    </View>
  );
}

/** Posters: 4 pt radius and a 1 pt inner hairline, so dark art keeps an edge. */
export function Poster({
  title,
  width,
  style,
  progress,
}: {
  title: Pick<TitleSummary, "title" | "posterPath">;
  width: number;
  style?: ViewStyle;
  /** 0–1: a hairline progress bar along the bottom. */
  progress?: number;
}) {
  const uri = tmdbImage(title.posterPath, width > 160 ? "w500" : "w342");
  return (
    <View
      style={[styles.poster, { width, height: width / POSTER_RATIO }, style]}
    >
      {uri ? (
        <Image
          source={{ uri }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          transition={160}
          recyclingKey={uri}
        />
      ) : (
        <View style={styles.fallback}>
          <Film color={colors.muted} size={Math.min(22, width / 4)} />
          {width >= 72 ? (
            <Text
              variant="caption"
              color="muted"
              numberOfLines={3}
              style={styles.center}
            >
              {title.title}
            </Text>
          ) : null}
        </View>
      )}
      <View pointerEvents="none" style={styles.edge} />
      {progress !== undefined ? (
        <View style={styles.track}>
          <View
            style={[
              styles.fill,
              { width: `${Math.round(progress * 100)}%` as DimensionValue },
            ]}
          />
        </View>
      ) : null}
    </View>
  );
}

/** A full-bleed 16:9 still with the faint grain the design puts on imagery. */
export function Backdrop({
  title,
  style,
  children,
}: {
  title: Artwork;
  style?: ViewStyle;
  children?: React.ReactNode;
}) {
  const uri =
    tmdbImage(title.backdropPath, "w1280") ??
    tmdbImage(title.posterPath, "w780");
  return (
    <View style={[styles.backdrop, style]}>
      {uri ? (
        <Image
          source={{ uri }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          transition={240}
        />
      ) : null}
      <Grain />
      {children}
    </View>
  );
}

export function Grain() {
  return (
    <Image
      pointerEvents="none"
      source={grain}
      style={[StyleSheet.absoluteFill, styles.grain]}
      contentFit="cover"
    />
  );
}

const styles = StyleSheet.create({
  poster: {
    borderRadius: radius.poster,
    overflow: "hidden",
    backgroundColor: colors.raised,
  },
  edge: {
    ...StyleSheet.absoluteFill,
    borderRadius: radius.poster,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  fallback: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    padding: spacing.sm,
  },
  center: { textAlign: "center" },
  track: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 3,
    backgroundColor: "rgba(12,11,10,0.6)",
  },
  fill: { height: 3, backgroundColor: colors.amber },
  backdrop: { overflow: "hidden", backgroundColor: colors.raised },
  grain: { opacity: 0.07 },
});
