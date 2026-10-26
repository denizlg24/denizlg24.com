import { genreSchema, type TitleSummary } from "@repo/schemas/stream";
import { SlidersHorizontal } from "lucide-react-native";
import { useDeferredValue, useMemo } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, View } from "react-native";
import { useTitles } from "@/api/stream";
import {
  ACCLAIM_STOPS,
  acclaimAt,
  acclaimIndex,
  ERA_DECADES,
  eraAt,
  eraIndices,
  KIND_LABELS,
  kindAt,
  kindIndex,
  matchCount,
  moodAt,
  moodIndex,
  TIME_LABELS,
  timeAt,
  timeIndex,
} from "@/features/tune/dials";
import { tuning } from "@/features/tune/tune-screen";
import { useStore } from "@/lib/store";
import { EMPTY_FILTERS, type TitleFilters } from "@/lib/title-query";
import { Button, colors, EmptyState, radius, spacing, Text } from "@/ui";
import { FocusedSpotlight, FocusedTitle, TvNavBar } from "./chrome";
import { FOCUS_ROOM, Focusable } from "./focusable";
import { TV_SAFE } from "./layout";
import { TvPosterGrid } from "./poster-grid";
import { useSpotlight } from "./spotlight";

const set = (patch: Partial<TitleFilters>) =>
  tuning.update((current) => ({ ...current, ...patch }));

/** A D-pad has no needle to drag, so the mood dial becomes five stops. */
const MOODS: { label: string; index: number | null }[] = [
  { label: "Any mood", index: null },
  { label: "Light and easy", index: 2 },
  { label: "On the lighter side", index: 7 },
  { label: "Something with weight", index: 13 },
  { label: "Heavy going", index: 18 },
];

const ERAS: { label: string; from: number; to: number }[] = [
  { label: "Any era", from: 0, to: ERA_DECADES.length - 1 },
  ...ERA_DECADES.slice(4).map((decade, offset) => ({
    label: `${decade}s`,
    from: offset + 4,
    to: offset + 4,
  })),
];

const ACCLAIM = [0, 3, 5, 7].map((index) => ({
  index,
  label: index === 0 ? "Any rating" : `${ACCLAIM_STOPS[index]} and up`,
}));

/**
 * Tune for the remote: each dial is a row of stops, OK picks one, and the
 * posters below follow. Genres switch on and off; a title must have every
 * genre picked.
 */
export function TvTuneScreen() {
  const filters = useStore(tuning);
  const deferred = useDeferredValue(filters);
  const titles = useTitles(deferred);
  const spotlight = useSpotlight<TitleSummary>();
  const items = useMemo(
    () => titles.data?.pages.flatMap((page) => page.titles) ?? [],
    [titles.data],
  );
  const total = titles.data?.pages[0]?.total ?? null;
  const [eraFrom, eraTo] = eraIndices(filters.yearFrom, filters.yearTo);
  const mood = moodIndex(filters.moodMin, filters.moodMax);
  const acclaim = acclaimIndex(filters.ratingMin);
  const changed = JSON.stringify(filters) !== JSON.stringify(EMPTY_FILTERS);

  return (
    <View style={styles.screen}>
      <FocusedTitle spotlight={spotlight} />
      <TvNavBar current="tune" />
      <ScrollView
        style={styles.fill}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <Stops
          label="What"
          options={KIND_LABELS.map((label, index) => ({
            label,
            selected: kindIndex(filters.type) === index,
            onPress: () => set(kindAt(index)),
          }))}
          preferred
        />
        <Stops
          label="Time"
          options={TIME_LABELS.map((label, index) => ({
            label: label === "Any" ? "Any length" : `Up to ${label}`,
            selected: timeIndex(filters.runtimeMax) === index,
            onPress: () => set(timeAt(index)),
          }))}
        />
        <Stops
          label="Mood"
          options={MOODS.map((option) => ({
            label: option.label,
            selected:
              option.index === null
                ? mood === null
                : mood !== null && Math.abs(mood - option.index) <= 2,
            onPress: () => set(moodAt(option.index)),
          }))}
        />
        <Stops
          label="Era"
          options={ERAS.map((era) => ({
            label: era.label,
            selected: eraFrom === era.from && eraTo === era.to,
            onPress: () => set(eraAt(era.from, era.to)),
          }))}
        />
        <Stops
          label="Rating"
          options={ACCLAIM.map((option) => ({
            label: option.label,
            selected:
              option.index === 0 ? acclaim === 0 : acclaim === option.index,
            onPress: () => set(acclaimAt(option.index)),
          }))}
        />
        <Stops
          label="Genres"
          options={genreSchema.options.map((genre) => ({
            label: genre,
            selected: filters.genres.includes(genre),
            onPress: () =>
              set({
                genres: filters.genres.includes(genre)
                  ? filters.genres.filter((value) => value !== genre)
                  : [...filters.genres, genre],
              }),
          }))}
        />

        <View style={styles.summary}>
          <Text variant="title">{matchCount(total)}</Text>
          {changed ? (
            <Button
              label="Start again"
              variant="secondary"
              onPress={() => tuning.set(EMPTY_FILTERS)}
            />
          ) : null}
        </View>
        <FocusedSpotlight spotlight={spotlight} />
        {titles.isPending ? (
          <ActivityIndicator color={colors.muted} size="large" />
        ) : total === 0 ? (
          <EmptyState
            icon={SlidersHorizontal}
            title="Nothing fits all of that"
            message="Try turning one of the rows back to Any, or pick fewer genres."
          />
        ) : (
          <>
            <TvPosterGrid titles={items} onFocusTitle={spotlight.set} />
            {titles.hasNextPage ? (
              <View style={styles.more}>
                <Button
                  label="Show more"
                  variant="secondary"
                  size="large"
                  loading={titles.isFetchingNextPage}
                  onPress={() => void titles.fetchNextPage()}
                />
              </View>
            ) : null}
          </>
        )}
      </ScrollView>
    </View>
  );
}

function Stops({
  label,
  options,
  preferred = false,
}: {
  label: string;
  options: { label: string; selected: boolean; onPress: () => void }[];
  preferred?: boolean;
}) {
  return (
    <View style={styles.dial}>
      <Text variant="callout" color="muted" style={styles.dialLabel}>
        {label}
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.stops}
      >
        {options.map((option, index) => (
          <Focusable
            key={option.label}
            accessibilityRole="radio"
            accessibilityLabel={`${label}: ${option.label}`}
            accessibilityState={{ selected: option.selected }}
            onPress={option.onPress}
            preferred={preferred && index === 0}
            style={[styles.stop, option.selected ? styles.stopOn : null]}
            radius={radius.pill}
            grow={1.04}
          >
            <Text
              variant="callout"
              color={option.selected ? "onAmber" : "paper"}
            >
              {option.label}
            </Text>
          </Focusable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ink },
  fill: { flex: 1 },
  content: { paddingBottom: TV_SAFE.y + spacing.xl, gap: spacing.xs },
  dial: { flexDirection: "row", alignItems: "center" },
  dialLabel: { width: 72 + TV_SAFE.x, paddingLeft: TV_SAFE.x },
  stops: {
    paddingRight: TV_SAFE.x,
    paddingVertical: FOCUS_ROOM / 2,
    paddingLeft: FOCUS_ROOM / 2,
    gap: spacing.sm,
  },
  stop: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    backgroundColor: colors.fill,
  },
  stopOn: { backgroundColor: colors.amber },
  summary: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.lg,
    paddingHorizontal: TV_SAFE.x,
    paddingTop: spacing.lg,
  },
  more: { paddingHorizontal: TV_SAFE.x, flexDirection: "row" },
});
