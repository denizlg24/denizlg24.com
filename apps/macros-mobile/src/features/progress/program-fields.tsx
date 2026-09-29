import { PROTEIN_PROFILES } from "@repo/macros-core/wizard/calc";
import type { Dispatch, SetStateAction } from "react";
import { StyleSheet, View } from "react-native";
import {
  type EnergyUnit,
  energyLabel,
  formatInteger,
  type WeightUnit,
} from "@/lib/format";
import { parseDecimal, Section, spacing, Text, TextField } from "@/ui";
import { MenuRow, Segmented, WeekdayToggles } from "./controls";
import {
  dietPhaseOptions,
  goalTypeOptions,
  planWeekdayNames,
  programModeOptions,
} from "./labels";
import {
  CHECK_IN_OPTIONS,
  type Draft,
  type DraftErrors,
  FAT_BASIS_OPTIONS,
  phaseFor,
  rateDescription,
  trimNumber,
} from "./program-draft";

/** Every program setting; shared by the program editor and the weekly check-in. */
export function ProgramFields({
  draft,
  setDraft,
  errors,
  rateKg,
  currentKg,
  weightUnit,
  energyUnit,
}: {
  draft: Draft;
  setDraft: Dispatch<SetStateAction<Draft>>;
  errors: DraftErrors;
  rateKg: number | null;
  currentKg: number | null;
  weightUnit: WeightUnit;
  energyUnit: EnergyUnit;
}) {
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const mode = programModeOptions.find((option) => option.value === draft.mode);
  const profileOptions = [
    ...PROTEIN_PROFILES.map((profile) => ({
      value: profile.value,
      label: profile.label,
    })),
    ...(PROTEIN_PROFILES.some(
      (profile) => profile.value === draft.distributionProfile,
    )
      ? []
      : [{ value: draft.distributionProfile, label: "Custom" }]),
  ];
  const rateHint = rateDescription(draft, rateKg, currentKg, energyUnit);
  const highDayCount = draft.highDays.length;
  const adjustment = parseDecimal(draft.highDayAdjustment) ?? 0;

  return (
    <>
      <Section title="Mode">
        <View style={styles.fields}>
          <Segmented
            options={programModeOptions}
            value={draft.mode}
            onChange={(value) => set("mode", value)}
          />
          <Text variant="footnote" tone="secondary">
            {mode?.description}
          </Text>
          {draft.mode === "manual" ? (
            <TextField
              label="Daily calories"
              keyboardType="decimal-pad"
              suffix={energyLabel(energyUnit)}
              value={draft.manualCalories}
              onChangeText={(value) => set("manualCalories", value)}
              error={errors.manualCalories}
            />
          ) : null}
        </View>
      </Section>

      <Section title="Goal">
        <View style={styles.fields}>
          <Segmented
            options={goalTypeOptions}
            value={draft.goalType}
            onChange={(value) =>
              setDraft((current) => ({
                ...current,
                goalType: value,
                dietPhase:
                  current.dietPhase === "diet_break"
                    ? current.dietPhase
                    : phaseFor(value),
              }))
            }
          />
          {draft.goalType !== "maintain" ? (
            <TextField
              label={
                draft.goalType === "lose" ? "Lose per week" : "Gain per week"
              }
              keyboardType="decimal-pad"
              suffix={weightUnit}
              placeholder={weightUnit === "lb" ? "1" : "0.5"}
              value={draft.rate}
              onChangeText={(value) => set("rate", value)}
              error={errors.rate}
              hint={rateHint}
            />
          ) : null}
        </View>
        <MenuRow
          title="Phase"
          value={draft.dietPhase}
          options={dietPhaseOptions}
          onChange={(value) => set("dietPhase", value)}
          separator={false}
        />
      </Section>

      <Section title="Macros">
        <MenuRow
          title="Split"
          subtitle="Sets protein and fat to a starting point"
          value={draft.distributionProfile}
          options={profileOptions}
          onChange={(value) => {
            const profile = PROTEIN_PROFILES.find(
              (option) => option.value === value,
            );
            setDraft((current) => ({
              ...current,
              distributionProfile: value,
              ...(profile
                ? {
                    protein: trimNumber(profile.proteinPerKg, 2),
                    fatBasis: "percent" as const,
                    fat: trimNumber(profile.fatPct * 100, 1),
                  }
                : {}),
            }));
          }}
        />
        <View style={styles.fields}>
          <TextField
            label="Protein"
            keyboardType="decimal-pad"
            suffix="g per kg"
            value={draft.protein}
            onChangeText={(value) => set("protein", value)}
            error={errors.protein}
            hint="Per kg of body weight. 1.6–2.2 suits most people."
          />
          <Segmented
            options={FAT_BASIS_OPTIONS}
            value={draft.fatBasis}
            onChange={(value) => set("fatBasis", value)}
          />
          <TextField
            label="Fat"
            keyboardType="decimal-pad"
            suffix={draft.fatBasis === "percent" ? "%" : "g per kg"}
            value={draft.fat}
            onChangeText={(value) => set("fat", value)}
            error={errors.fat}
            hint="Carbs fill whatever calories are left."
          />
        </View>
      </Section>

      <Section
        title="High days"
        footer="More calories on the days you train. The other days give the same amount back, so the week adds up to your target."
      >
        <View style={styles.fields}>
          <WeekdayToggles
            labels={planWeekdayNames}
            selected={draft.highDays}
            onToggle={(weekday) =>
              setDraft((current) => ({
                ...current,
                highDays: current.highDays.includes(weekday)
                  ? current.highDays.filter((day) => day !== weekday)
                  : [...current.highDays, weekday],
              }))
            }
          />
          {highDayCount > 0 ? (
            <TextField
              label="Extra on high days"
              keyboardType="decimal-pad"
              suffix={energyLabel(energyUnit)}
              placeholder="0"
              value={draft.highDayAdjustment}
              onChangeText={(value) => set("highDayAdjustment", value)}
              error={errors.highDayAdjustment}
              hint={
                highDayCount < 7 && adjustment > 0
                  ? `Other days: −${formatInteger((adjustment * highDayCount) / (7 - highDayCount))} ${energyLabel(energyUnit)}`
                  : undefined
              }
            />
          ) : null}
        </View>
      </Section>

      <Section
        title="Check-in"
        footer="From this day each week, a check-in re-estimates what you burn and proposes the coming week’s targets. Nothing changes until you check in."
      >
        <MenuRow
          title="Check-in day"
          value={draft.checkInWeekday}
          options={CHECK_IN_OPTIONS}
          onChange={(value) => set("checkInWeekday", value)}
          separator={false}
        />
      </Section>
    </>
  );
}

const styles = StyleSheet.create({
  fields: {
    gap: spacing.lg,
    paddingVertical: spacing.sm,
  },
});
