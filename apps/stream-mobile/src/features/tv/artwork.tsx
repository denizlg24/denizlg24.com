import { type TitleSummary, tmdbImage } from "@repo/schemas/stream";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { Film } from "lucide-react-native";
import { memo } from "react";
import { StyleSheet, View } from "react-native";
import { colors, spacing } from "@/ui";
import { TvText, type TvTextVariant } from "./tv-text";

type Art = Pick<TitleSummary, "title" | "posterPath" | "backdropPath"> & {
  logoPath?: string | null;
};

/**
 * TMDB's transparent title treatment, or the name set in Big Shoulders when
 * there is none. Sits in a fixed box, so a tall or a wide logo never moves
 * anything around it.
 */
export function TitleLogo({
  title,
  width,
  height,
  variant = "marquee",
  lines = 2,
  align = "left",
}: {
  title: Art;
  width: number;
  height: number;
  variant?: TvTextVariant;
  lines?: number;
  align?: "left" | "center";
}) {
  const logo = tmdbImage(title.logoPath ?? null, "w500");
  return (
    <View
      style={[
        styles.logoBox,
        // A name sets its own height: in a logo's box two lines would clip.
        logo ? { width, height } : { width, maxHeight: height * 1.6 },
        align === "center" ? styles.centered : null,
      ]}
    >
      {logo ? (
        <Image
          source={{ uri: logo }}
          style={StyleSheet.absoluteFill}
          contentFit="contain"
          contentPosition={align === "center" ? "center" : "left bottom"}
          transition={200}
          accessibilityLabel={title.title}
        />
      ) : (
        <TvText
          variant={variant}
          numberOfLines={lines}
          style={align === "center" ? styles.textCenter : null}
        >
          {title.title}
        </TvText>
      )}
    </View>
  );
}

/** A 2:3 poster; its name in small type when TMDB has no art. */
export const PosterArt = memo(function PosterArt({
  title,
  width,
  height,
}: {
  title: Art;
  width: number;
  height: number;
}) {
  const uri = tmdbImage(title.posterPath, width > 160 ? "w500" : "w342");
  return (
    <View style={[styles.frame, { width, height }]}>
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
          <TvText
            variant="caption"
            color="muted"
            numberOfLines={3}
            style={styles.textCenter}
          >
            {title.title}
          </TvText>
        </View>
      )}
      <View pointerEvents="none" style={styles.edge} />
    </View>
  );
});

/**
 * 16:9 box art: the backdrop with the title's logo (or name) set in the
 * bottom-left corner over a soft shade, and an optional progress bar.
 */
export const BoxArt = memo(function BoxArt({
  title,
  width,
  height,
  progress,
}: {
  title: Art;
  width: number;
  height: number;
  /** 0–1. */
  progress?: number;
}) {
  const uri =
    tmdbImage(title.backdropPath, "w780") ??
    tmdbImage(title.posterPath, "w500");
  return (
    <View style={[styles.frame, { width, height }]}>
      {uri ? (
        <Image
          source={{ uri }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          transition={160}
          recyclingKey={uri}
        />
      ) : null}
      <LinearGradient
        colors={["rgba(12,11,10,0)", "rgba(12,11,10,0.82)"]}
        locations={[0.35, 1]}
        style={StyleSheet.absoluteFill}
      />
      <View
        style={[styles.artTitle, progress !== undefined ? styles.above : null]}
      >
        <TitleLogo
          title={title}
          width={width * 0.62}
          height={height * 0.34}
          variant="art"
          lines={2}
        />
      </View>
      {progress !== undefined ? (
        <View style={styles.track}>
          <View
            style={[
              styles.fill,
              {
                width:
                  `${Math.round(Math.min(1, Math.max(0.03, progress)) * 100)}%` as const,
              },
            ]}
          />
        </View>
      ) : null}
      <View pointerEvents="none" style={styles.edge} />
    </View>
  );
});

const styles = StyleSheet.create({
  logoBox: { justifyContent: "flex-end" },
  centered: { alignItems: "center" },
  textCenter: { textAlign: "center" },
  frame: {
    borderRadius: 4,
    overflow: "hidden",
    backgroundColor: colors.raised,
  },
  edge: {
    ...StyleSheet.absoluteFill,
    borderRadius: 4,
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
  artTitle: {
    position: "absolute",
    left: spacing.md,
    right: spacing.md,
    bottom: spacing.md,
  },
  above: { bottom: spacing.xl },
  track: {
    position: "absolute",
    left: spacing.md,
    right: spacing.md,
    bottom: 6,
    height: 3,
    borderRadius: 2,
    backgroundColor: "rgba(239,233,223,0.28)",
    overflow: "hidden",
  },
  fill: { height: 3, backgroundColor: colors.amber },
});
