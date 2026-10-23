import type { TitleSummary } from "@repo/schemas/stream";
import { Search, SearchX } from "lucide-react-native";
import { useDeferredValue } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import Animated, { FadeIn, LinearTransition } from "react-native-reanimated";
import { useTitles } from "@/api/stream";
import { openTitle } from "@/features/studio/open";
import { StudioHeader } from "@/features/studio/studio-header";
import { createStore, useStore } from "@/lib/store";
import { EMPTY_FILTERS, type TitleFilters } from "@/lib/title-query";
import {
  Button,
  colors,
  EmptyState,
  gutter,
  Poster,
  radius,
  spacing,
  Text,
} from "@/ui";
import {
  ACCLAIM_STOPS,
  acclaimAt,
  acclaimIndex,
  ERA_DECADES,
  eraAt,
  eraIndices,
  eraLabel,
  KIND_LABELS,
  KIND_STOPS,
  kindAt,
  kindIndex,
  MOOD_STOPS,
  MOOD_WINDOW,
  matchCount,
  moodAt,
  moodIndex,
  moodLabel,
  TIME_LABELS,
  TIME_STOPS,
  timeAt,
  timeIndex,
} from "./dials";
import { RangeBand, TunerBand } from "./tuner-band";

/** The dials survive leaving the tab. */
const tuning = createStore<TitleFilters>(EMPTY_FILTERS);
const set = (patch: Partial<TitleFilters>) =>
  tuning.update((current) => ({ ...current, ...patch }));

const COLUMNS = 3;

/** Discovery by dials: turn them and the wall of posters reflows. */
export function TuneScreen() {
  const { width } = useWindowDimensions();
  const filters = useStore(tuning);
  const deferred = useDeferredValue(filters);
  const titles = useTitles(deferred);
  const items = titles.data?.pages.flatMap((page) => page.titles) ?? [];
  const total = titles.data?.pages[0]?.total ?? null;
  const poster = (width - gutter * 2 - spacing.md * (COLUMNS - 1)) / COLUMNS;
  const [eraFrom, eraTo] = eraIndices(filters.yearFrom, filters.yearTo);
  const mood = moodIndex(filters.moodMin, filters.moodMax);
  const acclaim = acclaimIndex(filters.ratingMin);
  const time = timeIndex(filters.runtimeMax);

  const header = (
    <View style={styles.dials}>
      <Text variant="hero">Tune</Text>
      <View style={styles.search}>
        <Search color={colors.muted} size={18} />
        <TextInput
          value={filters.q}
          onChangeText={(q) => set({ q })}
          placeholder="or name something…"
          placeholderTextColor={colors.faint}
          returnKeyType="search"
          autoCorrect={false}
          clearButtonMode="while-editing"
          accessibilityLabel="Search by name"
          style={styles.input}
        />
      </View>
      <TunerBand
        title="Time"
        reading={
          time === TIME_STOPS.length - 1
            ? "Any length"
            : `Up to ${TIME_LABELS[time]}`
        }
        count={TIME_STOPS.length}
        labels={TIME_LABELS}
        value={time}
        onChange={(index) => set(timeAt(index))}
        onReset={
          filters.runtimeMax === null
            ? undefined
            : () => set({ runtimeMax: null })
        }
      />
      <TunerBand
        title="Mood"
        reading={moodLabel(mood)}
        count={MOOD_STOPS}
        labels={Array.from({ length: MOOD_STOPS }, (_, index) =>
          index === 0 ? "Light" : index === MOOD_STOPS - 1 ? "Heavy" : null,
        )}
        windowStops={MOOD_WINDOW * 10}
        value={mood}
        onChange={(index) => set(moodAt(index))}
        onReset={mood === null ? undefined : () => set(moodAt(null))}
      />
      <RangeBand
        title="Era"
        reading={eraLabel(eraFrom, eraTo)}
        count={ERA_DECADES.length}
        labels={ERA_DECADES.map((decade, index) =>
          index % 2 === 0 ? `’${String(decade).slice(2)}` : null,
        )}
        value={[eraFrom, eraTo]}
        onChange={([from, to]) => set(eraAt(from, to))}
        onReset={
          filters.yearFrom === null && filters.yearTo === null
            ? undefined
            : () => set({ yearFrom: null, yearTo: null })
        }
      />
      <TunerBand
        title="Acclaim"
        reading={
          acclaim === 0
            ? "Any rating"
            : `Rated ${ACCLAIM_STOPS[acclaim]} and up`
        }
        count={ACCLAIM_STOPS.length}
        labels={ACCLAIM_STOPS.map((stop) =>
          stop === null ? "Any" : Number.isInteger(stop) ? String(stop) : null,
        )}
        value={acclaim}
        onChange={(index) => set(acclaimAt(index))}
        onReset={
          filters.ratingMin === null
            ? undefined
            : () => set({ ratingMin: null })
        }
      />
      <TunerBand
        title="Kind"
        reading={KIND_LABELS[kindIndex(filters.type)] ?? "Either"}
        count={KIND_STOPS.length}
        labels={KIND_LABELS}
        value={kindIndex(filters.type)}
        onChange={(index) => set(kindAt(index))}
      />
      <View style={styles.countRow}>
        <Text variant="display" style={styles.count}>
          {matchCount(total)}
        </Text>
        {titles.isFetching ? <ActivityIndicator color={colors.muted} /> : null}
      </View>
    </View>
  );

  return (
    <View style={styles.screen}>
      <StudioHeader />
      <Animated.FlatList
        data={items}
        keyExtractor={(title) => title.id}
        numColumns={COLUMNS}
        columnWrapperStyle={styles.row}
        itemLayoutAnimation={LinearTransition.springify().damping(20)}
        renderItem={({ item }) => <Tile title={item} width={poster} />}
        ListHeaderComponent={header}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        onEndReachedThreshold={0.7}
        onEndReached={() => {
          if (titles.hasNextPage && !titles.isFetchingNextPage) {
            void titles.fetchNextPage();
          }
        }}
        ListEmptyComponent={
          titles.isPending ? null : titles.isError ? (
            <EmptyState
              icon={SearchX}
              title="The dials lost the signal"
              message="We couldn't reach Stream. Check your connection and try again."
              action={
                <Button
                  label="Try again"
                  onPress={() => void titles.refetch()}
                />
              }
            />
          ) : (
            <EmptyState
              icon={SearchX}
              title="Nothing on this frequency"
              message="No titles match all of those at once. Try widening the era or easing off the acclaim dial."
              action={
                <Button
                  label="Reset the dials"
                  variant="secondary"
                  onPress={() => tuning.set(EMPTY_FILTERS)}
                />
              }
            />
          )
        }
        contentContainerStyle={styles.content}
      />
    </View>
  );
}

function Tile({ title, width }: { title: TitleSummary; width: number }) {
  return (
    <Animated.View entering={FadeIn.duration(260)}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={title.title}
        onPress={() => openTitle(title.id)}
        style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
      >
        <Poster title={title} width={width} />
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ink },
  content: { paddingHorizontal: gutter, paddingBottom: 140, gap: spacing.md },
  dials: { gap: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.md },
  search: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    minHeight: 44,
    paddingHorizontal: spacing.md,
    borderRadius: radius.sm,
    backgroundColor: colors.raised,
  },
  input: {
    flex: 1,
    color: colors.paper,
    fontSize: 16,
    paddingVertical: spacing.sm,
  },
  countRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    marginTop: spacing.sm,
    paddingTop: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
  },
  count: { flex: 1 },
  row: { gap: spacing.md },
});
