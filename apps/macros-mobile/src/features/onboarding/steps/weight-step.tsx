import { StyleSheet } from "react-native";
import { TextField, typeScale } from "@/ui";
import { StepScaffold } from "../step-scaffold";
import { useStep } from "../use-step";

export function WeightStep() {
  const { draft, update, errors, advance, clearError } = useStep("weight");

  return (
    <StepScaffold
      step="weight"
      intro="Logged as today’s weigh-in and used as the starting point of your trend."
      onContinue={() => advance()}
    >
      <TextField
        label="Current weight"
        value={draft.currentWeight}
        onChangeText={(currentWeight) => {
          update({ currentWeight });
          clearError("currentWeight");
        }}
        error={errors.currentWeight}
        placeholder={draft.weightUnit === "kg" ? "75" : "165"}
        suffix={draft.weightUnit}
        keyboardType="decimal-pad"
        autoFocus={draft.currentWeight === ""}
        style={styles.figure}
      />
    </StepScaffold>
  );
}

const styles = StyleSheet.create({
  figure: {
    ...typeScale.largeTitle,
    fontWeight: "600",
  },
});
