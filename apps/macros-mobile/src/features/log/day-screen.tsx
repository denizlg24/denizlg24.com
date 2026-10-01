import { type MenuAction, MenuView } from "@expo/ui/community/menu";
import { weekDaysFor } from "@repo/macros-core/food-log/date-utils";
import type { MacrosFoodLogEntry } from "@repo/schemas/macros";
import { useQueryClient } from "@tanstack/react-query";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  type ImageSourcePropType,
  Platform,
  StyleSheet,
  View,
} from "react-native";
import { reachesDayTarget } from "@/api/day-targets";
import {
  queueEntryUpdate,
  useBulkDeleteEntries,
  useCopyEntries,
  useDuplicateEntry,
  useFoodLogDay,
  useWeekTotals,
} from "@/api/food-log";
import { useCreateMealTemplate } from "@/api/meal-templates";
import { useProfile } from "@/api/profile";
import { FailedWritesNotice } from "@/components/failed-writes-notice";
import { PendingPlateBar } from "@/features/add-food/components/plate-bar";
import { usePlate } from "@/features/add-food/plate-store";
import { promptText } from "@/features/more/shared/prompt";
import { errorMessage } from "@/lib/api";
import { deviceTimeZone, shiftIsoDate, useToday } from "@/lib/day";
import { useFailedWrites } from "@/lib/failed-writes";
import { formatDayLabel } from "@/lib/format";
import { haptics } from "@/lib/haptics";
import { clockAtHour, clockOf } from "@/lib/log-time";
import {
  Button,
  colors,
  EmptyState,
  HeaderIconButton,
  HeaderTextButton,
  InlineNotice,
  PageHeader,
  Screen,
  spacing,
  VStack,
} from "@/ui";
import { glyphs } from "@/ui/glyphs";
import { DayNoteRow } from "./day-note-row";
import { DaySummary } from "./day-summary";
import { useDeferredDelete } from "./deferred-delete";
import type { EntryActions } from "./entry-row";
import { flashEntries, useFlashArrivals } from "./flash";
import { HourSection } from "./hour-section";
import { isIsoDate, selectDate, useSelectedDate } from "./selected-date";
import {
  keepSelected,
  setSelected,
  startSelecting,
  stopSelecting,
  toggleSelected,
  useSelection,
} from "./selection";
import { groupByHour } from "./timeline";
import { WeekStrip } from "./week-strip";

/** SF Symbols on iOS; Android's Compose menu takes images instead. */
function menuIcon(
  sfSymbol: Extract<MenuAction["image"], string>,
  glyph: ImageSourcePropType,
): MenuAction["image"] {
  return Platform.OS === "ios" ? sfSymbol : glyph;
}

function dayMenu(hasEntries: boolean): MenuAction[] {
  return [
    {
      id: "select",
      title: "Select entries",
      image: menuIcon("checkmark.circle", glyphs["circle-check"]),
      attributes: { disabled: !hasEntries },
    },
    {
      id: "copy",
      title: "Copy from another day",
      image: menuIcon("doc.on.doc", glyphs.copy),
    },
    {
      id: "note",
      title: "Day note",
      image: menuIcon("square.and.pencil", glyphs["notebook-pen"]),
    },
    {
      id: "insights",
      title: "",
      displayInline: true,
      subactions: [
        {
          id: "nutrition",
          title: "Nutrition",
          image: menuIcon("chart.bar", glyphs["chart-column"]),
        },
        {
          id: "streak",
          title: "Logging streak",
          image: menuIcon("flame", glyphs.flame),
        },
      ],
    },
  ];
}

export function LogDayScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const profile = useProfile();
  const timezone = profile.data?.timezone ?? deviceTimeZone();
  const energyUnit = profile.data?.energyUnit ?? "kcal";
  const today = useToday(timezone);
  const params = useLocalSearchParams<{ date?: string }>();
  const date = useSelectedDate(today);
  const viewingToday = date === today;

  const day = useFoodLogDay(date);
  const week = weekDaysFor(date);
  const weekStart = week[0]?.iso ?? date;
  const weekEnd = week[week.length - 1]?.iso ?? date;
  const weekTotals = useWeekTotals(weekStart, weekEnd);

  const selection = useSelection();
  const [notice, setNotice] = useState<string | null>(null);
  const [retiming, setRetiming] = useState(false);
  const failedWrites = useFailedWrites();
  const staged = usePlate().length;
  const [refreshing, setRefreshing] = useState(false);
  const showError = useCallback((error: unknown) => {
    haptics.error();
    setNotice(errorMessage(error));
  }, []);

  const deferredDelete = useDeferredDelete(date);
  const { flush: flushDeletes } = deferredDelete;
  const duplicate = useDuplicateEntry();
  const copy = useCopyEntries();
  const bulkDelete = useBulkDeleteEntries();
  const createTemplate = useCreateMealTemplate();

  const entries = day.data?.entries;
  useFlashArrivals(date, entries);

  const entryIds = useMemo(
    () => new Set(entries?.map((entry) => entry.id) ?? []),
    [entries],
  );
  useEffect(() => {
    keepSelected(entryIds);
  }, [entryIds]);

  // Keyed on the link alone: `today` rolling over must not re-apply an old
  // `?date=` and drag the log back to it.
  useEffect(() => {
    if (isIsoDate(params.date)) selectDate(params.date, today);
  }, [params.date]);

  function changeDate(next: string) {
    if (next === date) return;
    flushDeletes();
    stopSelecting();
    setNotice(null);
    haptics.selection();
    selectDate(next > today ? today : next, today);
  }

  async function refresh() {
    setRefreshing(true);
    try {
      await Promise.all([day.refetch(), weekTotals.refetch()]);
    } finally {
      setRefreshing(false);
    }
  }

  // At the hour a group is headed with, except that adding to the current
  // hour of today is simply adding now. `time` is always sent so a time left
  // over from an earlier visit is cleared.
  function openAdd(hour?: number) {
    const nowHour = Number(clockOf(new Date(), timezone).slice(0, 2));
    const time =
      hour === undefined || (viewingToday && hour === nowHour)
        ? undefined
        : clockAtHour(hour);
    router.push({ pathname: "/add-food", params: { date, time } });
  }

  function openMove(ids: readonly string[]) {
    router.push({
      pathname: "/log-move",
      params: { date, ids: ids.join(",") },
    });
  }

  function openCopy(from?: string) {
    router.push({
      pathname: "/log-copy",
      params: from ? { date, from } : { date },
    });
  }

  function openNote() {
    router.push({ pathname: "/day-note", params: { date } });
  }

  function feelLoggedOn(logDate: string, entry: MacrosFoodLogEntry) {
    return reachesDayTarget(queryClient, [{ logDate, macros: entry }])
      ? haptics.goalReached
      : haptics.success;
  }

  function copyToToday(entry: MacrosFoodLogEntry) {
    const feelLogged = feelLoggedOn(today, entry);
    copy.mutate(
      {
        sourceDate: entry.logDate,
        targetDate: today,
        entryIds: [entry.id],
      },
      { onSuccess: () => feelLogged(), onError: showError },
    );
  }

  const actions: EntryActions = {
    onDelete: (entry) => deferredDelete.schedule(entry.id),
    onUndo: (entry) => deferredDelete.undo(entry.id),
    onDuplicate: (entry) => {
      const feelLogged = feelLoggedOn(entry.logDate, entry);
      duplicate.mutate(entry.id, {
        onSuccess: () => feelLogged(),
        onError: showError,
      });
    },
    onMove: (entry) => openMove([entry.id]),
    onCopyToToday: copyToToday,
    onToggle: (entry) => {
      haptics.selection();
      toggleSelected(entry.id);
    },
    onRetime: (entry, eatenAt) => {
      queueEntryUpdate(queryClient, entry, { eatenAt });
      haptics.success();
      flashEntries([entry.id]);
    },
    onRetimeActive: setRetiming,
  };

  function confirmBulkDelete() {
    const ids = [...selection.ids];
    if (ids.length === 0) return;
    const noun = ids.length === 1 ? "entry" : "entries";
    Alert.alert(`Delete ${ids.length} ${noun}?`, undefined, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () =>
          bulkDelete.mutate(
            { entryIds: ids },
            {
              onSuccess: () => {
                haptics.success();
                stopSelecting();
              },
              onError: showError,
            },
          ),
      },
    ]);
  }

  function saveAsMeal() {
    const ids = [...selection.ids];
    if (ids.length === 0) return;
    const names = (entries ?? [])
      .filter((entry) => selection.ids.has(entry.id))
      .map((entry) => entry.foodName);
    promptText({
      title: "Save as meal",
      message: "Log these together again from Recipes.",
      defaultValue: names.length <= 2 ? names.join(" and ") : "",
      onSubmit: (value) => {
        const name = value.trim();
        if (!name) return;
        createTemplate.mutate(
          { name: name.slice(0, 120), entryIds: ids },
          {
            onSuccess: () => {
              haptics.success();
              stopSelecting();
            },
            onError: showError,
          },
        );
      },
    });
  }

  const selectedCount = selection.ids.size;
  const allSelected =
    entries !== undefined &&
    entries.length > 0 &&
    selectedCount === entries.length;
  const title = selection.active
    ? selectedCount === 0
      ? "Select"
      : `${selectedCount} selected`
    : formatDayLabel(date, today);
  const dayTimezone = day.data?.timezone ?? timezone;
  const hours = entries ? groupByHour(entries, dayTimezone) : [];
  const hasEntries = hours.length > 0;

  return (
    <>
      <Stack.Screen options={{ title }} />
      <Screen
        statusBarScrim
        onRefresh={() => void refresh()}
        refreshing={refreshing}
        stickyHeaderIndices={[1]}
        scrollEnabled={!retiming}
      >
        <PageHeader title={title}>
          {selection.active ? (
            <>
              <HeaderIconButton
                icon={allSelected ? "list-x" : "list-checks"}
                label={allSelected ? "Deselect all" : "Select all"}
                onPress={() =>
                  setSelected(
                    allSelected
                      ? []
                      : (entries?.map((entry) => entry.id) ?? []),
                  )
                }
              />
              <HeaderIconButton
                icon="arrow-up-down"
                label="Move"
                disabled={selectedCount === 0}
                onPress={() => openMove([...selection.ids])}
              />
              <HeaderIconButton
                icon="bookmark-plus"
                label="Save as meal"
                disabled={selectedCount === 0 || createTemplate.isPending}
                onPress={saveAsMeal}
              />
              <HeaderIconButton
                icon="trash"
                label="Delete"
                destructive
                disabled={selectedCount === 0 || bulkDelete.isPending}
                onPress={confirmBulkDelete}
              />
              <HeaderTextButton
                label="Done"
                prominent
                onPress={stopSelecting}
              />
            </>
          ) : (
            <>
              {viewingToday ? null : (
                <HeaderTextButton
                  label="Today"
                  onPress={() => changeDate(today)}
                />
              )}
              <HeaderIconButton
                icon="calendar"
                label="Calendar"
                onPress={() => router.push("/log/calendar")}
              />
              <MenuView
                actions={dayMenu(hasEntries)}
                onPressAction={({ nativeEvent }) => {
                  switch (nativeEvent.event) {
                    case "select":
                      return startSelecting();
                    case "copy":
                      return openCopy();
                    case "note":
                      return openNote();
                    case "nutrition":
                      return router.push("/log/nutrition");
                    case "streak":
                      return router.push("/log/activity");
                  }
                }}
              >
                <HeaderIconButton icon="ellipsis" label="More" />
              </MenuView>
            </>
          )}
        </PageHeader>
        <View
          style={
            notice || day.isError || failedWrites.length > 0 || staged > 0
              ? styles.notice
              : undefined
          }
        >
          <PendingPlateBar />
          {notice ? (
            <InlineNotice message={notice} onDismiss={() => setNotice(null)} />
          ) : day.isError && !day.data ? (
            <InlineNotice
              message={errorMessage(day.error)}
              action={{ label: "Try again", onPress: () => void day.refetch() }}
            />
          ) : null}
          <FailedWritesNotice />
        </View>

        <VStack gap={spacing.xl}>
          <WeekStrip
            selectedDate={date}
            today={today}
            totals={weekTotals.data}
            energyUnit={energyUnit}
            onSelect={changeDate}
            onShiftWeek={(direction) =>
              changeDate(shiftIsoDate(date, direction * 7))
            }
          />

          {day.data ? (
            <DaySummary day={day.data} energyUnit={energyUnit} />
          ) : null}

          {hasEntries ? (
            <VStack gap={spacing.lg}>
              {hours.map((group) => (
                <HourSection
                  key={group.hour}
                  group={group}
                  timezone={dayTimezone}
                  energyUnit={energyUnit}
                  selecting={selection.active}
                  selectedIds={selection.ids}
                  pendingIds={deferredDelete.pending}
                  viewingToday={viewingToday}
                  actions={actions}
                  onAdd={openAdd}
                />
              ))}
              {selection.active ? null : (
                <Button
                  label="Add food"
                  icon="plus"
                  variant="plain"
                  size="regular"
                  block={false}
                  onPress={() => openAdd()}
                  style={styles.addMore}
                />
              )}
            </VStack>
          ) : day.data ? (
            <EmptyState
              icon="utensils"
              title={viewingToday ? "Nothing logged yet" : "Nothing logged"}
              message="Add what you ate, or copy from a day you’ve already logged."
            >
              <View style={styles.emptyActions}>
                <Button
                  label="Add food"
                  icon="plus"
                  size="regular"
                  block
                  onPress={() => openAdd()}
                />
                <Button
                  label="Copy from yesterday"
                  variant="tinted"
                  size="regular"
                  block
                  onPress={() => openCopy(shiftIsoDate(date, -1))}
                />
              </View>
            </EmptyState>
          ) : day.isPending ? (
            <ActivityIndicator style={styles.loading} />
          ) : null}

          {day.data ? (
            <DayNoteRow date={date} note={day.data.note} onPress={openNote} />
          ) : null}
        </VStack>
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  notice: {
    backgroundColor: colors.background,
  },
  emptyActions: {
    alignSelf: "stretch",
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  loading: {
    paddingVertical: spacing.xxxl,
  },
  addMore: {
    alignSelf: "flex-start",
  },
});
