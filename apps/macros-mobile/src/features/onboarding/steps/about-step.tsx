import { startOfDay, subYears } from "date-fns";
import { useMemo } from "react";
import { StyleSheet, View } from "react-native";
import { Section, spacing, Text, TextField } from "@/ui";
import { ChoiceList } from "../choice-list";
import { DateRow } from "../date-row";
import { ageOf, SEX_CHOICES } from "../model";
import { StepScaffold } from "../step-scaffold";
import { useStep } from "../use-step";

export function AboutStep() {
  const { draft, update, errors, advance, clearError } = useStep("about");
  const age = ageOf(draft);
  const bounds = useMemo(() => {
    const today = startOfDay(new Date());
    return {
      typical: subYears(today, 30),
      oldest: subYears(today, 120),
      youngest: subYears(today, 13),
    };
  }, []);

  return (
    <StepScaffold
      step="about"
      intro="All optional. Each answer makes your starting estimate more accurate."
      onContinue={() => advance()}
    >
      <Section title="Sex">
        <ChoiceList
          choices={SEX_CHOICES}
          value={draft.sex}
          optional
          onChange={(sex) => update({ sex })}
        />
      </Section>

      <Section title="Age">
        <DateRow
          title="Date of birth"
          value={draft.birthDate}
          detail={age !== undefined ? `${age} years old` : undefined}
          defaultDate={bounds.typical}
          minimumDate={bounds.oldest}
          maximumDate={bounds.youngest}
          error={errors.birthDate}
          onChange={(birthDate) => {
            update({ birthDate });
            clearError("birthDate");
          }}
        />
      </Section>

      <Section title="Height">
        {draft.weightUnit === "kg" ? (
          <TextField
            value={draft.heightCm}
            onChangeText={(heightCm) => {
              update({ heightCm });
              clearError("height");
            }}
            error={errors.height}
            placeholder="175"
            suffix="cm"
            keyboardType="decimal-pad"
            accessibilityLabel="Height in centimetres"
          />
        ) : (
          <View style={styles.imperial}>
            <View style={styles.pair}>
              <TextField
                containerStyle={styles.half}
                value={draft.heightFt}
                onChangeText={(heightFt) => {
                  update({ heightFt });
                  clearError("height");
                }}
                placeholder="5"
                suffix="ft"
                keyboardType="number-pad"
                accessibilityLabel="Height, feet"
              />
              <TextField
                containerStyle={styles.half}
                value={draft.heightIn}
                onChangeText={(heightIn) => {
                  update({ heightIn });
                  clearError("height");
                }}
                placeholder="9"
                suffix="in"
                keyboardType="number-pad"
                accessibilityLabel="Height, inches"
              />
            </View>
            {errors.height ? (
              <Text variant="footnote" tone="destructive">
                {errors.height}
              </Text>
            ) : null}
          </View>
        )}
      </Section>
    </StepScaffold>
  );
}

const styles = StyleSheet.create({
  imperial: {
    gap: spacing.xs,
  },
  pair: {
    flexDirection: "row",
    gap: spacing.lg,
  },
  half: {
    flex: 1,
  },
});
