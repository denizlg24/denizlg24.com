import { dateToIso, isoToDate } from "@repo/macros-core/food-log/date-utils";
import { formatLoggedAmount } from "@repo/macros-core/foods/display";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, View } from "react-native";
import { useCopyEntries, useFoodLogDay } from "@/api/food-log";
import { useProfile } from "@/api/profile";
import { FoodIcon } from "@/components/food-icon";
import { errorMessage } from "@/lib/api";
import { deviceTimeZone, shiftIsoDate, useToday } from "@/lib/day";
import { energyLabel, formatDayLabel, formatEnergy } from "@/lib/format";
import { haptics } from "@/lib/haptics";
import { formatTimeOfDay } from "@/lib/log-time";
import {
  colors,
  Icon,
  InlineNotice,
  Row,
  Section,
  sheetGutter,
  spacing,
  Text,
} from "@/ui";
import { DateTimePicker } from "@/ui/date-time-picker";
import { isIsoDate } from "./selected-date";
import { SheetHeader } from "./sheet-header";
import { sumEntries } from "./timeline";

/**
 * Copies another day into the day being viewed: all of it, or the entries
 * left ticked. Every copy keeps its time of day.
 */
export function CopySheet() {
  const router = useRouter();
  const params = useLocalSearchParams<{ date?: string; from?: string }>();
  const profile = useProfile();
  const energyUnit = profile.data?.energyUnit ?? "kcal";
  const timeZone = profile.data?.timezone ?? deviceTimeZone();
  const today = useToday(timeZone);
  const target = isIsoDate(params.date) ? params.date : today;

  const [source, setSource] = useState(() =>
    isIsoDate(params.from) ? params.from : shiftIsoDate(target, -1),
  );
  // Tracked as what was left out, so everything on the day starts ticked.
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [notice, setNotice] = useState<string | null>(null);

  const sourceDay = useFoodLogDay(source);
  const copy = useCopyEntries();
  const entries = sourceDay.data?.entries ?? [];
  const chosen = entries.filter((entry) => !excluded.has(entry.id));
  const everything = chosen.length === entries.length;

  function toggle(id: string) {
    haptics.selection();
    setExcluded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    haptics.selection();
    setExcluded(
      everything ? new Set(entries.map((entry) => entry.id)) : new Set(),
    );
  }

  function submit() {
    setNotice(null);
    copy.mutate(
      {
        sourceDate: source,
        targetDate: target,
        entryIds: everything ? undefined : chosen.map((entry) => entry.id),
      },
      {
        onSuccess: () => {
          haptics.success();
          router.back();
        },
        onError: (error) => {
          haptics.error();
          setNotice(errorMessage(error));
        },
      },
    );
  }

  const unit = energyLabel(energyUnit);
  const timeZoneOfDay = sourceDay.data?.timezone ?? timeZone;

  return (
    <View style={styles.sheet}>
      <SheetHeader
        title={`Copy to ${formatDayLabel(target, today)}`}
        onCancel={() => router.back()}
        confirm={{
          label:
            chosen.length > 0 && !everything ? `Copy ${chosen.length}` : "Copy",
          onPress: submit,
          disabled: chosen.length === 0,
          busy: copy.isPending,
        }}
      />
      {notice ? (
        <InlineNotice
          message={notice}
          onDismiss={() => setNotice(null)}
          style={styles.notice}
        />
      ) : null}

      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.dateRow}>
          <Text variant="body">From</Text>
          <DateTimePicker
            value={isoToDate(source)}
            mode="date"
            display="compact"
            maximumDate={isoToDate(today)}
            onValueChange={(_event, next) => {
              haptics.selection();
              setSource(dateToIso(next));
              setExcluded(new Set());
            }}
            style={styles.picker}
          />
        </View>

        <Section
          title={formatDayLabel(source, today)}
          action={
            entries.length > 1
              ? {
                  label: everything ? "Deselect All" : "Select All",
                  onPress: toggleAll,
                }
              : undefined
          }
          footer={
            chosen.length > 0
              ? `${formatEnergy(sumEntries(chosen).calories, energyUnit)} ${unit}. Each copy keeps its time of day.`
              : undefined
          }
        >
          {sourceDay.isPending ? (
            <ActivityIndicator style={styles.loading} />
          ) : sourceDay.isError ? (
            <InlineNotice
              message={errorMessage(sourceDay.error)}
              action={{
                label: "Try again",
                onPress: () => void sourceDay.refetch(),
              }}
            />
          ) : entries.length === 0 ? (
            <Text variant="subheadline" tone="secondary" style={styles.empty}>
              Nothing logged on this day.
            </Text>
          ) : (
            <View>
              {entries.map((entry, index) => {
                const checked = !excluded.has(entry.id);
                const time = entry.eatenAt
                  ? formatTimeOfDay(entry.eatenAt, timeZoneOfDay)
                  : null;
                return (
                  <Row
                    key={entry.id}
                    title={entry.foodName}
                    subtitle={[time, formatLoggedAmount(entry)]
                      .filter(Boolean)
                      .join(" · ")}
                    value={formatEnergy(entry.calories, energyUnit)}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked }}
                    onPress={() => toggle(entry.id)}
                    separator={index < entries.length - 1}
                    leading={
                      <>
                        <Icon
                          name={checked ? "circle-check" : "circle"}
                          size={22}
                          color={checked ? colors.label : colors.tertiaryLabel}
                        />
                        <FoodIcon
                          name={entry.foodName}
                          iconKey={entry.iconKey}
                          entryType={entry.entryType}
                          size={30}
                        />
                      </>
                    }
                  />
                );
              })}
            </View>
          )}
        </Section>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    flex: 1,
    backgroundColor: colors.background,
  },
  notice: {
    paddingHorizontal: sheetGutter,
  },
  content: {
    paddingHorizontal: sheetGutter,
    paddingBottom: spacing.xxxl,
    gap: spacing.xxl,
  },
  dateRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  picker: {
    flex: 1,
  },
  loading: {
    paddingVertical: spacing.xl,
  },
  empty: {
    paddingVertical: spacing.md,
  },
});
