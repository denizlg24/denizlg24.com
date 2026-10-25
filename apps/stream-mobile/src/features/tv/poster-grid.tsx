import type { TitleSummary } from "@repo/schemas/stream";
import { StyleSheet, View } from "react-native";
import { Poster } from "@/ui";
import { Focusable } from "./focusable";
import { RAIL_GAP, RAIL_POSTER, TV_SAFE } from "./layout";
import { openTvTitle } from "./open";

/** Posters in rows across the screen; each opens its title. */
export function TvPosterGrid({
  titles,
  onFocusTitle,
}: {
  titles: TitleSummary[];
  onFocusTitle?: (title: TitleSummary) => void;
}) {
  return (
    <View style={styles.grid}>
      {titles.map((title) => (
        <Focusable
          key={title.id}
          accessibilityRole="button"
          accessibilityLabel={title.title}
          onPress={() => openTvTitle(title.id)}
          onFocus={() => onFocusTitle?.(title)}
          radius={4}
        >
          <Poster title={title} width={RAIL_POSTER} />
        </Focusable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: RAIL_GAP,
    paddingHorizontal: TV_SAFE.x,
    paddingVertical: RAIL_GAP / 2,
  },
});
