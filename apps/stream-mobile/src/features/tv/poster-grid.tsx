import type { TitleSummary } from "@repo/schemas/stream";
import { memo } from "react";
import { StyleSheet, View } from "react-native";
import { Poster } from "@/ui";
import { FOCUS_ROOM, Focusable } from "./focusable";
import { RAIL_GAP, RAIL_POSTER, TV_SAFE } from "./layout";
import { openTvTitle } from "./open";

/**
 * Posters in rows across the screen; each opens its title. Memoised with a
 * stable `onFocusTitle`, so moving focus re-renders none of it.
 */
export const TvPosterGrid = memo(function TvPosterGrid({
  titles,
  onFocusTitle,
  onOpen = openTvTitle,
  preferFirst = false,
}: {
  titles: TitleSummary[];
  onFocusTitle?: (title: TitleSummary) => void;
  onOpen?: (id: string) => void;
  /** The first poster takes focus: for a screen that is nothing but the grid. */
  preferFirst?: boolean;
}) {
  return (
    <View style={styles.grid}>
      {titles.map((title, index) => (
        <Focusable
          key={title.id}
          preferred={preferFirst && index === 0}
          accessibilityRole="button"
          accessibilityLabel={title.title}
          onPress={() => onOpen(title.id)}
          onFocus={onFocusTitle ? () => onFocusTitle(title) : undefined}
          radius={4}
        >
          <Poster title={title} width={RAIL_POSTER} />
        </Focusable>
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: RAIL_GAP,
    paddingHorizontal: TV_SAFE.x,
    paddingVertical: FOCUS_ROOM,
  },
});
