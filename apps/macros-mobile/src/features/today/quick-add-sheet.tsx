import { useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { reachesDayTarget } from "@/api/day-targets";
import { useQuickAdd } from "@/api/food-log";
import { useProfile } from "@/api/profile";
import { EatenAtPicker } from "@/components/eaten-at-picker";
import { deviceTimeZone, useToday } from "@/lib/day";
import {
  energyLabel,
  energyValue,
  formatDayLabel,
  formatEnergy,
} from "@/lib/format";
import { haptics } from "@/lib/haptics";
import { type LogTime, logPlacement, readLogTime } from "@/lib/log-time";
import {
  Button,
  colors,
  parseDecimal,
  SheetHeader,
  sheetGutter,
  spacing,
  TextField,
  typeScale,
} from "@/ui";
import { kcalFromMacros } from "./logic";

const MAX_KCAL = 30_000;
const MAX_MACRO_GRAMS = 5_000;

const MACRO_FIELDS = [
  { key: "protein", label: "Protein" },
  { key: "carbs", label: "Carbs" },
  { key: "fat", label: "Fat" },
] as const;

type MacroKey = (typeof MACRO_FIELDS)[number]["key"];

/** `null` for a blank field; `NaN` for anything that is not a usable amount. */
function readAmount(text: string): number | null {
  if (text.trim() === "") return null;
  const value = parseDecimal(text);
  return value !== null && value >= 0 ? value : Number.NaN;
}

export function QuickAddSheet() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ date?: string; time?: string }>();
  const profile = useProfile();
  const timeZone = profile.data?.timezone ?? deviceTimeZone();
  const today = useToday(timeZone);
  const energyUnit = profile.data?.energyUnit ?? "kcal";
  const unit = energyLabel(energyUnit);
  const queryClient = useQueryClient();
  const quickAdd = useQuickAdd();

  const [energy, setEnergy] = useState("");
  const [macros, setMacros] = useState<Record<MacroKey, string>>({
    protein: "",
    carbs: "",
    fat: "",
  });
  const [name, setName] = useState("");
  const [when, setWhen] = useState<LogTime>(() => readLogTime(params, today));

  const amounts = {
    protein: readAmount(macros.protein),
    carbs: readAmount(macros.carbs),
    fat: readAmount(macros.fat),
  };
  const macroError = (key: MacroKey) => {
    const value = amounts[key];
    if (value === null) return undefined;
    if (Number.isNaN(value)) return "Not a number";
    return value > MAX_MACRO_GRAMS ? "Too high" : undefined;
  };
  const macrosValid = MACRO_FIELDS.every(({ key }) => !macroError(key));

  const typedEnergy = readAmount(energy);
  const derivedKcal = macrosValid ? kcalFromMacros(amounts) : 0;
  const kcal =
    typedEnergy === null
      ? derivedKcal > 0
        ? derivedKcal
        : null
      : typedEnergy / energyValue(1, energyUnit);
  const energyError =
    typedEnergy !== null && Number.isNaN(typedEnergy)
      ? "Not a number"
      : kcal !== null && kcal > MAX_KCAL
        ? `More than ${formatEnergy(MAX_KCAL, energyUnit)} ${unit}`
        : undefined;

  const canSubmit = kcal !== null && kcal > 0 && !energyError && macrosValid;

  function submit() {
    if (!canSubmit || kcal === null) return;
    const grams = (value: number | null) =>
      value === null ? undefined : Math.round(value * 10) / 10;
    const input = {
      calories: Math.round(kcal * 10) / 10,
      protein: grams(amounts.protein),
      carbs: grams(amounts.carbs),
      fat: grams(amounts.fat),
      name: name.trim() || undefined,
      ...logPlacement(when, timeZone),
    };
    const reached = reachesDayTarget(queryClient, [
      {
        logDate: input.logDate,
        macros: { calories: input.calories, protein: input.protein ?? 0 },
      },
    ]);
    quickAdd.mutate(input);
    if (reached) haptics.goalReached();
    else haptics.success();
    router.back();
  }

  return (
    <View
      style={[
        styles.container,
        { paddingBottom: Math.max(insets.bottom, spacing.lg) },
      ]}
    >
      <SheetHeader
        title="Quick add"
        subtitle={formatDayLabel(when.date, today)}
        onClose={() => router.back()}
      />

      <TextField
        label="Energy"
        value={energy}
        onChangeText={setEnergy}
        keyboardType="decimal-pad"
        placeholder={
          derivedKcal > 0 ? formatEnergy(derivedKcal, energyUnit) : "0"
        }
        suffix={unit}
        autoFocus
        error={energyError}
        hint={
          typedEnergy === null && derivedKcal > 0
            ? "Calculated from the macros below."
            : undefined
        }
        accessibilityLabel={`Energy in ${unit}`}
        style={styles.energyInput}
      />

      <View style={styles.macroRow}>
        {MACRO_FIELDS.map(({ key, label }) => (
          <TextField
            key={key}
            label={label}
            value={macros[key]}
            onChangeText={(text) =>
              setMacros((current) => ({ ...current, [key]: text }))
            }
            keyboardType="decimal-pad"
            placeholder="0"
            suffix="g"
            error={macroError(key)}
            accessibilityLabel={`${label} in grams`}
            containerStyle={styles.macroField}
          />
        ))}
      </View>

      <TextField
        label="Name"
        value={name}
        onChangeText={setName}
        placeholder="Quick add"
        autoCapitalize="sentences"
        maxLength={240}
        returnKeyType="done"
        onSubmitEditing={submit}
      />

      <EatenAtPicker
        value={when}
        timeZone={timeZone}
        today={today}
        onChange={setWhen}
      />

      <Button label="Add" disabled={!canSubmit} onPress={submit} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.xl,
    paddingHorizontal: sheetGutter,
    paddingTop: spacing.xl,
    backgroundColor: colors.background,
  },
  energyInput: {
    ...typeScale.largeTitle,
  },
  macroRow: {
    flexDirection: "row",
    gap: spacing.lg,
  },
  macroField: {
    flex: 1,
  },
});
