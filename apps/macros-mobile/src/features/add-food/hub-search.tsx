import type {
  MacrosFoodHistoryItem,
  MacrosFoodSearchItem,
} from "@repo/schemas/macros";
import { useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import {
  useCustomFoods,
  useFavorites,
  useFoodHistory,
  useFoodSearch,
} from "@/api/foods";
import { queryKeys } from "@/api/keys";
import { errorMessage, NetworkError } from "@/lib/api";
import type { EnergyUnit } from "@/lib/format";
import { formatHour } from "@/lib/log-time";
import { Button, EmptyState, gutter, InlineNotice, spacing } from "@/ui";
import { type QuickHandlers, QuickSection } from "./components/quick-section";
import {
  favoriteQuick,
  historyQuick,
  type QuickItem,
  searchQuick,
} from "./search-rows";

const PICKS = 5;
const FAVORITES_CAP = 4;
const LATEST_CAP = 20;
const MATCHES_CAP = 4;

/** "7 PM Picks" where the clock has AM/PM, "19:00 Picks" where it doesn't. */
function picksTitle(hour: number): string {
  return `${formatHour(hour).replace(/:00(?=\s*[^\d\s])/, "")} Picks`;
}

function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

function matches(
  item: { name: string; brand?: string | null },
  needle: string,
): boolean {
  return (
    item.name.toLocaleLowerCase().includes(needle) ||
    (item.brand?.toLocaleLowerCase().includes(needle) ?? false)
  );
}

function byRecency(
  left: MacrosFoodHistoryItem,
  right: MacrosFoodHistoryItem,
): number {
  return (right.lastLoggedAt ?? right.lastLogDate).localeCompare(
    left.lastLoggedAt ?? left.lastLogDate,
  );
}

export function SearchBody({
  query,
  hour,
  energyUnit,
  handlers,
  createFoodParams,
}: {
  query: string;
  /** The hour the hub logs at, which ranks the picks. */
  hour: number;
  energyUnit: EnergyUnit;
  handlers: QuickHandlers;
  createFoodParams: Record<string, string>;
}) {
  const needle = query.trim().toLocaleLowerCase();
  const debounced = useDebouncedValue(query.trim(), 250);
  const typing = needle.length > 0;

  const history = useFoodHistory(hour);
  const search = useFoodSearch(debounced, 50);
  const favorites = useFavorites();
  const custom = useCustomFoods();

  // Search answers with each food's current icon. When that differs from the
  // cached history, the source changed it, and the log shows the same row.
  const queryClient = useQueryClient();
  useEffect(() => {
    const cached = new Map(
      (history.data ?? []).map((item) => [item.id, item.iconKey]),
    );
    const changed = (search.data?.items ?? []).some(
      (item) => cached.has(item.id) && cached.get(item.id) !== item.iconKey,
    );
    if (!changed) return;
    void queryClient.invalidateQueries({ queryKey: ["foods", "history"] });
    void queryClient.invalidateQueries({ queryKey: queryKeys.foodLog });
  }, [search.data, history.data, queryClient]);

  const iconKeys = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of history.data ?? []) map.set(item.id, item.iconKey);
    for (const item of custom.data ?? []) map.set(item.id, item.iconKey);
    return map;
  }, [history.data, custom.data]);

  if (!typing) {
    const favoriteRows = (favorites.data ?? []).map((favorite) =>
      favoriteQuick(favorite, iconKeys.get(favorite.sourceItemId) ?? null),
    );
    const ranked = history.data ?? [];
    const picks = ranked.slice(0, PICKS).map(historyQuick);
    const latest = [...ranked].sort(byRecency).map(historyQuick);
    const nothingYet =
      !history.isPending && ranked.length === 0 && favoriteRows.length === 0;

    return (
      <View>
        {history.isError ? (
          <View style={styles.inset}>
            <InlineNotice
              tone={history.error instanceof NetworkError ? "offline" : "error"}
              message={
                history.error instanceof NetworkError
                  ? "You’re offline. Your history will load when you’re back."
                  : `History failed to load. ${errorMessage(history.error)}`
              }
              action={{ label: "Retry", onPress: () => void history.refetch() }}
            />
          </View>
        ) : null}
        <QuickSection
          title="Favorites"
          items={favoriteRows}
          cap={FAVORITES_CAP}
          energyUnit={energyUnit}
          handlers={handlers}
        />
        <QuickSection
          title={picksTitle(hour)}
          items={picks}
          energyUnit={energyUnit}
          handlers={handlers}
        />
        <QuickSection
          title="Latest"
          items={latest}
          cap={LATEST_CAP}
          energyUnit={energyUnit}
          handlers={handlers}
        />
        {history.isPending ? (
          <ActivityIndicator style={styles.loading} />
        ) : null}
        {nothingYet ? (
          <EmptyState
            icon="utensils"
            title="Search for a food"
            message="Foods you log show up here, ranked for the time of day. Tap + to put one on your plate."
          />
        ) : null}
      </View>
    );
  }

  // The user's own history and foods answer from cache at once; the server
  // adds database results as they arrive, never above the user's own.
  const results = search.data?.items ?? [];
  const seen = new Set<string>();
  const fromHistory: QuickItem[] = [];
  for (const item of history.data ?? []) {
    if (matches(item, needle) && !seen.has(item.id)) {
      seen.add(item.id);
      fromHistory.push(historyQuick(item));
    }
  }
  const yourFoods: QuickItem[] = [];
  const own: MacrosFoodSearchItem[] = [
    ...(custom.data ?? []).filter((item) => matches(item, needle)),
    ...results.filter((item) => item.isUserFood),
  ];
  for (const item of own) {
    if (!seen.has(item.id)) {
      seen.add(item.id);
      yourFoods.push(searchQuick(item));
    }
  }
  const database = results.filter((item) => !seen.has(item.id));
  const common = database.filter((item) => !item.brand).map(searchQuick);
  const branded = database.filter((item) => item.brand).map(searchQuick);
  const settled = search.data !== undefined && !search.isPlaceholderData;
  const awaiting = debounced !== query.trim() || search.isFetching;
  const none =
    fromHistory.length === 0 &&
    yourFoods.length === 0 &&
    common.length === 0 &&
    branded.length === 0;

  return (
    <View>
      {search.data?.sourceUnavailable ? (
        <View style={styles.inset}>
          <InlineNotice
            tone="offline"
            message="The food database can’t be reached. Your own foods and history still work."
          />
        </View>
      ) : search.isError && !awaiting ? (
        <View style={styles.inset}>
          <InlineNotice
            tone={search.error instanceof NetworkError ? "offline" : "error"}
            message={
              search.error instanceof NetworkError
                ? "You’re offline. Showing your own foods and history."
                : `Search failed. ${errorMessage(search.error)}`
            }
            action={{ label: "Retry", onPress: () => void search.refetch() }}
          />
        </View>
      ) : null}

      <QuickSection
        title="From History"
        items={fromHistory}
        cap={MATCHES_CAP}
        energyUnit={energyUnit}
        handlers={handlers}
      />
      <QuickSection
        title="Your Foods"
        items={yourFoods}
        cap={MATCHES_CAP}
        energyUnit={energyUnit}
        handlers={handlers}
      />
      <QuickSection
        title="Common"
        items={common}
        cap={MATCHES_CAP}
        energyUnit={energyUnit}
        handlers={handlers}
      />
      <QuickSection
        title="Branded"
        items={branded}
        cap={MATCHES_CAP}
        energyUnit={energyUnit}
        handlers={handlers}
      />

      {awaiting ? (
        <ActivityIndicator style={styles.loading} />
      ) : settled && none ? (
        <EmptyState
          icon="search"
          title={`No matches for “${query.trim()}”`}
          message="Check the spelling, scan the barcode, or add it yourself."
        >
          <Button
            label="Create food"
            size="regular"
            variant="tinted"
            block={false}
            onPress={() =>
              router.push({
                pathname: "/create-food",
                params: { name: query.trim(), ...createFoodParams },
              })
            }
          />
        </EmptyState>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  inset: {
    paddingHorizontal: gutter,
    paddingTop: spacing.lg,
  },
  loading: {
    paddingVertical: spacing.xl,
  },
});
