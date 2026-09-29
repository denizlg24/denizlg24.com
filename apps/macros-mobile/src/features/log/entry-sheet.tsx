import { formatFoodQuantity } from "@repo/macros-core/foods/display";
import type {
  MacrosEnteredUnit,
  MacrosFoodLogEntry,
} from "@repo/schemas/macros";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import {
  type UpdateEntryInput,
  useDeleteEntry,
  useFoodLogDay,
  useUpdateEntry,
} from "@/api/food-log";
import { useProfile } from "@/api/profile";
import { EatenAtPicker } from "@/components/eaten-at-picker";
import { FoodIcon } from "@/components/food-icon";
import { errorMessage } from "@/lib/api";
import { deviceTimeZone, useToday } from "@/lib/day";
import {
  type EnergyUnit,
  energyLabel,
  formatEnergy,
  formatInteger,
} from "@/lib/format";
import { haptics } from "@/lib/haptics";
import { eatenAtFor, entryLogTime, type LogTime } from "@/lib/log-time";
import {
  Button,
  colors,
  EmptyState,
  gutter,
  InlineNotice,
  macroColors,
  parseDecimal,
  Section,
  spacing,
  Text,
  TextField,
} from "@/ui";
import { SegmentedControl } from "@/ui/segmented-control";
import { amountModel, quantityFor, scaleFor, unitLabel } from "./entry-amount";
import { flashEntries } from "./flash";
import { isIsoDate } from "./selected-date";
import { SheetHeader } from "./sheet-header";

// Long enough for the sheet to be out of the way when the row tints.
const AFTER_DISMISS_MS = 420;

export function EntrySheet() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string; date?: string }>();
  const profile = useProfile();
  const timezone = profile.data?.timezone ?? deviceTimeZone();
  const today = useToday(timezone);
  const logDate = isIsoDate(params.date) ? params.date : today;
  const day = useFoodLogDay(logDate);
  const found = day.data?.entries.find((entry) => entry.id === params.id);

  // A deleted entry leaves the cached day before the sheet finishes sliding
  // away; keep drawing it rather than flashing "not found" on the way out.
  const lastEntry = useRef<MacrosFoodLogEntry | undefined>(found);
  if (found) lastEntry.current = found;
  const entry = found ?? lastEntry.current;

  if (!entry) {
    return (
      <View style={styles.sheet}>
        <SheetHeader title="Entry" onCancel={() => router.back()} />
        {day.isPending ? (
          <ActivityIndicator style={styles.loading} />
        ) : (
          <EmptyState
            icon="circle-question-mark"
            title="Entry not found"
            message={
              day.isError
                ? errorMessage(day.error)
                : "It may have been deleted or moved to another day."
            }
          />
        )}
      </View>
    );
  }

  return (
    <EntryEditor
      key={entry.id}
      entry={entry}
      timezone={day.data?.timezone ?? timezone}
      today={today}
      energyUnit={profile.data?.energyUnit ?? "kcal"}
    />
  );
}

function EntryEditor({
  entry,
  timezone,
  today,
  energyUnit,
}: {
  entry: MacrosFoodLogEntry;
  timezone: string;
  today: string;
  energyUnit: EnergyUnit;
}) {
  const router = useRouter();
  const update = useUpdateEntry();
  const remove = useDeleteEntry(entry.logDate);

  const [model] = useState(() => amountModel(entry));
  const [initialWhen] = useState(() =>
    entryLogTime(entry.logDate, entry.eatenAt, timezone),
  );
  const [quantity, setQuantity] = useState(model.initialQuantity);
  const [unit, setUnit] = useState<MacrosEnteredUnit>(model.initialUnit);
  const [when, setWhen] = useState<LogTime>(initialWhen);
  const [notes, setNotes] = useState(entry.notes ?? "");
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const parsed = parseDecimal(quantity);
  const scale = parsed === null ? 0 : scaleFor(parsed, unit, model);
  const amountChanged =
    unit !== model.initialUnit || quantity.trim() !== model.initialQuantity;
  const amountValid = scale > 0 && scale <= 9999;
  const whenChanged =
    when.date !== initialWhen.date || when.clock !== initialWhen.clock;
  const notesChanged = notes.trim() !== (entry.notes ?? "");
  const dirty = amountChanged || whenChanged || notesChanged;

  const perServing =
    entry.servingsConsumed > 0 ? 1 / entry.servingsConsumed : 0;
  const factor = amountChanged ? scale * perServing : 1;
  const preview = {
    calories: entry.calories * factor,
    protein: entry.protein * factor,
    carbs: entry.carbs * factor,
    fat: entry.fat * factor,
  };

  function changeUnit(next: MacrosEnteredUnit) {
    if (next === unit) return;
    haptics.selection();
    // Changing the unit restates the same amount; it must not change what
    // was eaten.
    if (scale > 0) setQuantity(quantityFor(scale, next, model));
    setUnit(next);
  }

  async function save() {
    if (!dirty) {
      router.back();
      return;
    }
    if (amountChanged && !amountValid) {
      setNotice("Enter an amount greater than zero.");
      haptics.error();
      return;
    }
    const body: UpdateEntryInput = {
      ...(amountChanged && parsed !== null
        ? {
            servingsConsumed: scale,
            enteredQuantity: parsed,
            enteredUnit: unit,
          }
        : {}),
      ...(notesChanged ? { notes: notes.trim() } : {}),
      ...(whenChanged
        ? {
            eatenAt: eatenAtFor(when, timezone).toISOString(),
            ...(when.date !== entry.logDate ? { logDate: when.date } : {}),
          }
        : {}),
    };
    setSaving(true);
    setNotice(null);
    try {
      if (Object.keys(body).length > 0) {
        await update.mutateAsync({ id: entry.id, ...body });
      }
      haptics.success();
      flashEntries([entry.id], AFTER_DISMISS_MS);
      router.back();
    } catch (error) {
      haptics.error();
      setNotice(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  function confirmDelete() {
    Alert.alert(`Delete ${entry.foodName}?`, undefined, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          remove.mutate(entry.id);
          haptics.success();
          router.back();
        },
      },
    ]);
  }

  const unitLabels = model.units.map((option) => unitLabel(option, model));

  return (
    <View style={styles.sheet}>
      <SheetHeader
        title="Edit entry"
        onCancel={() => router.back()}
        confirm={{
          label: "Save",
          onPress: () => void save(),
          disabled: amountChanged && !amountValid,
          busy: saving,
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
        keyboardDismissMode="interactive"
      >
        <View style={styles.identity}>
          <FoodIcon
            name={entry.foodName}
            iconKey={entry.iconKey}
            entryType={entry.entryType}
            size={44}
          />
          <View style={styles.identityText}>
            <Text variant="title3" numberOfLines={2}>
              {entry.foodName}
            </Text>
            {entry.brand ? (
              <Text variant="subheadline" tone="secondary" numberOfLines={1}>
                {entry.brand}
              </Text>
            ) : null}
          </View>
        </View>

        <View
          style={styles.preview}
          accessible
          accessibilityLabel={previewLabel(preview, energyUnit)}
        >
          <PreviewFigure
            label={energyLabel(energyUnit)}
            value={formatEnergy(preview.calories, energyUnit)}
            color={macroColors.calories}
          />
          <PreviewFigure
            label="Protein"
            value={`${formatInteger(preview.protein)} g`}
            color={macroColors.protein}
          />
          <PreviewFigure
            label="Carbs"
            value={`${formatInteger(preview.carbs)} g`}
            color={macroColors.carbs}
          />
          <PreviewFigure
            label="Fat"
            value={`${formatInteger(preview.fat)} g`}
            color={macroColors.fat}
          />
        </View>

        <Section title="Amount">
          <View style={styles.group}>
            <TextField
              value={quantity}
              onChangeText={setQuantity}
              keyboardType="decimal-pad"
              selectTextOnFocus
              suffix={unitLabel(unit, model)}
              accessibilityLabel="Amount"
              error={
                amountChanged && !amountValid
                  ? "Enter an amount greater than zero."
                  : undefined
              }
            />
            {model.units.length > 1 ? (
              <SegmentedControl
                values={unitLabels}
                selectedIndex={Math.max(0, model.units.indexOf(unit))}
                onChange={({ nativeEvent }) => {
                  const next = model.units[nativeEvent.selectedSegmentIndex];
                  if (next) changeUnit(next);
                }}
              />
            ) : null}
            {model.servingDetail &&
            model.servingDetail !== model.servingName ? (
              <Text variant="footnote" tone="secondary">
                {`1 serving = ${formatFoodQuantity(model.servingUnitQuantity)} ${model.servingDetail}`}
              </Text>
            ) : null}
          </View>
        </Section>

        <Section title="Time">
          <EatenAtPicker
            value={when}
            timeZone={timezone}
            today={today}
            onChange={setWhen}
          />
        </Section>

        <Section title="Note">
          <TextField
            value={notes}
            onChangeText={setNotes}
            placeholder="Optional"
            multiline
            maxLength={500}
            accessibilityLabel="Note"
            style={styles.notes}
          />
        </Section>

        <Button
          label="Delete entry"
          variant="destructive"
          icon="trash"
          size="regular"
          block
          onPress={confirmDelete}
        />
      </ScrollView>
    </View>
  );
}

function previewLabel(
  preview: { calories: number; protein: number; carbs: number; fat: number },
  energyUnit: EnergyUnit,
) {
  return `${formatEnergy(preview.calories, energyUnit)} ${energyLabel(energyUnit)}, ${formatInteger(preview.protein)} grams protein, ${formatInteger(preview.carbs)} grams carbs, ${formatInteger(preview.fat)} grams fat`;
}

function PreviewFigure({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  return (
    <View style={styles.figure}>
      <Text variant="title3" figure numberOfLines={1}>
        {value}
      </Text>
      <View style={styles.figureLabel}>
        <View style={[styles.dot, { backgroundColor: color }]} />
        <Text variant="caption1" tone="secondary" eyebrow>
          {label}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    flex: 1,
    backgroundColor: colors.background,
  },
  loading: {
    paddingVertical: spacing.xxxl,
  },
  notice: {
    paddingHorizontal: gutter,
  },
  content: {
    paddingHorizontal: gutter,
    paddingBottom: spacing.xxxl,
    gap: spacing.xxl,
  },
  identity: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  identityText: {
    flex: 1,
    gap: spacing.xxs,
  },
  preview: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  figure: {
    flex: 1,
    gap: spacing.xxs,
  },
  figureLabel: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  group: {
    gap: spacing.md,
  },
  notes: {
    minHeight: 64,
    textAlignVertical: "top",
  },
});
