import { endOfDay, format, parseISO } from "date-fns";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { Alert, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useProfile } from "@/api/profile";
import {
  useDeleteWeighIn,
  useUpsertWeighIn,
  useWeightOverview,
} from "@/api/weight";
import { errorMessage } from "@/lib/api";
import { useToday } from "@/lib/day";
import {
  formatDayLabel,
  formatWeight,
  kgFromUnit,
  weightValue,
} from "@/lib/format";
import { haptics } from "@/lib/haptics";
import {
  Button,
  colors,
  gutter,
  Hairline,
  InlineNotice,
  parseDecimal,
  spacing,
  Text,
  TextField,
  typeScale,
  useResolvedColors,
} from "@/ui";
import { DateTimePicker } from "@/ui/date-time-picker";
import { isIsoDate } from "./logic";
import { SheetHeader } from "./sheet-header";

const MAX_WEIGHT_KG = 999;

// Grouping would turn 2,202.4 lb into something `parseDecimal` rejects.
const inputNumber = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 2,
  useGrouping: false,
});

interface Draft {
  weight: string | null;
  bodyFat: string | null;
  note: string | null;
}

const untouched: Draft = { weight: null, bodyFat: null, note: null };

export function WeighInSheet() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const resolved = useResolvedColors();
  const params = useLocalSearchParams<{ date?: string }>();
  const profile = useProfile();
  const today = useToday(profile.data?.timezone);
  const unit = profile.data?.weightUnit ?? "kg";
  const overview = useWeightOverview();
  const upsert = useUpsertWeighIn();
  const remove = useDeleteWeighIn();

  const [date, setDate] = useState(() =>
    isIsoDate(params.date) && params.date <= today ? params.date : today,
  );
  // `null` means "not edited": the field shows what that day already holds,
  // so switching the date re-prefills everything the user has not typed into.
  const [draft, setDraft] = useState<Draft>(untouched);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const entry =
    overview.data?.entries.find((item) => item.logDate === date) ?? null;

  const weightText =
    draft.weight ??
    (entry ? inputNumber.format(weightValue(entry.weightKg, unit)) : "");
  const bodyFatText =
    draft.bodyFat ??
    (entry?.bodyFatPct != null ? inputNumber.format(entry.bodyFatPct) : "");
  const noteText = draft.note ?? entry?.notes ?? "";

  const typedWeight = parseDecimal(weightText);
  const weightKg =
    draft.weight === null && entry
      ? entry.weightKg
      : typedWeight !== null
        ? Math.round(kgFromUnit(typedWeight, unit) * 1000) / 1000
        : null;
  const weightError =
    weightText.trim() !== "" && (weightKg === null || weightKg <= 0)
      ? "Not a weight"
      : weightKg !== null && weightKg > MAX_WEIGHT_KG
        ? "Too high"
        : undefined;

  const typedBodyFat = parseDecimal(bodyFatText);
  const bodyFatPct =
    draft.bodyFat === null && entry ? entry.bodyFatPct : typedBodyFat;
  const bodyFatError =
    bodyFatText.trim() !== "" &&
    (typedBodyFat === null || typedBodyFat < 0 || typedBodyFat > 100)
      ? "0–100"
      : undefined;

  const canSave =
    weightKg !== null && weightKg > 0 && !weightError && !bodyFatError;
  const replaces =
    entry &&
    draft.weight !== null &&
    weightKg !== null &&
    weightKg !== entry.weightKg
      ? `Replaces ${formatWeight(entry.weightKg, unit)} logged that day.`
      : undefined;

  function save() {
    if (!canSave || weightKg === null) return;
    const note = noteText.trim();
    upsert.mutate({
      logDate: date,
      weightKg,
      bodyFatPct: bodyFatPct ?? null,
      notes: note === "" ? null : note,
    });
    haptics.success();
    router.back();
  }

  function confirmDelete() {
    if (!entry) return;
    Alert.alert(
      "Delete this weigh-in?",
      `${formatWeight(entry.weightKg, unit)} · ${formatDayLabel(entry.logDate, today)}`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            setDeleteError(null);
            remove.mutate(entry.id, {
              onSuccess: () => {
                haptics.success();
                router.back();
              },
              onError: (error) => {
                haptics.error();
                setDeleteError(errorMessage(error));
              },
            });
          },
        },
      ],
    );
  }

  return (
    <View
      style={[
        styles.container,
        { paddingBottom: Math.max(insets.bottom, spacing.lg) },
      ]}
    >
      <SheetHeader
        title={entry ? "Edit weigh-in" : "Weigh-in"}
        subtitle={formatDayLabel(date, today)}
        onClose={() => router.back()}
      />

      <View>
        <View style={styles.dateRow}>
          <Text variant="body">Date</Text>
          <DateTimePicker
            value={parseISO(date)}
            mode="date"
            display="compact"
            maximumDate={endOfDay(parseISO(today))}
            accentColor={resolved.label}
            onValueChange={(_event, next) => {
              const picked = format(next, "yyyy-MM-dd");
              if (picked === date) return;
              haptics.selection();
              setDate(picked);
              setDeleteError(null);
            }}
            style={styles.datePicker}
          />
        </View>
        <Hairline />
      </View>

      <TextField
        label="Weight"
        value={weightText}
        onChangeText={(text) =>
          setDraft((current) => ({ ...current, weight: text }))
        }
        keyboardType="decimal-pad"
        placeholder="0"
        suffix={unit}
        autoFocus={!entry}
        selectTextOnFocus
        error={weightError}
        hint={replaces}
        accessibilityLabel={`Weight in ${unit}`}
        style={styles.weightInput}
      />

      <View style={styles.optionalRow}>
        <TextField
          label="Body fat"
          value={bodyFatText}
          onChangeText={(text) =>
            setDraft((current) => ({ ...current, bodyFat: text }))
          }
          keyboardType="decimal-pad"
          placeholder="Optional"
          suffix="%"
          error={bodyFatError}
          accessibilityLabel="Body fat percentage, optional"
          containerStyle={styles.bodyFat}
        />
        <TextField
          label="Note"
          value={noteText}
          onChangeText={(text) =>
            setDraft((current) => ({ ...current, note: text }))
          }
          placeholder="Optional"
          autoCapitalize="sentences"
          maxLength={1000}
          returnKeyType="done"
          onSubmitEditing={save}
          containerStyle={styles.note}
        />
      </View>

      {deleteError ? (
        <InlineNotice
          message={`Couldn’t delete. ${deleteError}`}
          onDismiss={() => setDeleteError(null)}
        />
      ) : null}

      <View style={styles.actions}>
        <Button label="Save" disabled={!canSave} onPress={save} />
        {entry ? (
          <Button
            label="Delete weigh-in"
            variant="destructive"
            loading={remove.isPending}
            onPress={confirmDelete}
          />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.xl,
    paddingHorizontal: gutter,
    paddingTop: spacing.xl,
    backgroundColor: colors.background,
  },
  dateRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    minHeight: 44,
    paddingVertical: spacing.xs,
  },
  datePicker: {
    flex: 1,
  },
  weightInput: {
    ...typeScale.largeTitle,
  },
  optionalRow: {
    flexDirection: "row",
    gap: spacing.lg,
  },
  bodyFat: {
    flex: 1,
  },
  note: {
    flex: 2,
  },
  actions: {
    gap: spacing.sm,
  },
});
