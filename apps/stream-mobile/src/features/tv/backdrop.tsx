import { type TitleSummary, tmdbImage } from "@repo/schemas/stream";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { memo } from "react";
import { StyleSheet, View } from "react-native";

/**
 * A title's backdrop across the top right of the screen, faded into ink to
 * the left (where the words sit) and towards the bottom (where the rows do).
 */
export const TvBackdrop = memo(function TvBackdrop({
  title,
  fade = 0.62,
}: {
  title: Pick<TitleSummary, "backdropPath" | "posterPath"> | null;
  /** Where the bottom fade reaches solid ink, as a share of the height. */
  fade?: number;
}) {
  const uri = title
    ? (tmdbImage(title.backdropPath, "w1280") ??
      tmdbImage(title.posterPath, "w780"))
    : null;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {uri ? (
        <Image
          source={{ uri }}
          style={styles.image}
          contentFit="cover"
          contentPosition="top"
          transition={350}
        />
      ) : null}
      <LinearGradient
        colors={[
          "rgba(12,11,10,0.97)",
          "rgba(12,11,10,0.78)",
          "rgba(12,11,10,0.15)",
          "rgba(12,11,10,0)",
        ]}
        locations={[0, 0.3, 0.62, 0.8]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={StyleSheet.absoluteFill}
      />
      <LinearGradient
        colors={["rgba(12,11,10,0)", "rgba(12,11,10,0.8)", "#0c0b0a"]}
        locations={[fade - 0.3, fade - 0.08, fade]}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  image: { position: "absolute", top: 0, left: "18%", right: 0, height: "86%" },
});
