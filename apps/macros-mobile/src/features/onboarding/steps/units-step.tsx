import { useProfile } from "@/api/profile";
import { haptics } from "@/lib/haptics";
import { Section } from "@/ui";
import { SegmentedControl } from "@/ui/segmented-control";
import { withEnergyUnit, withWeightUnit } from "../model";
import { StepScaffold } from "../step-scaffold";
import { useStep } from "../use-step";

export function UnitsStep() {
  const { draft, update, advance } = useStep("units");
  const profile = useProfile();
  const firstName = profile.data?.name.trim().split(/\s+/)[0];
  const greeting = firstName ? `Hi ${firstName}. ` : "";

  return (
    <StepScaffold
      step="units"
      intro={`${greeting}A few questions set your starting targets. It takes about a minute.`}
      onContinue={() => advance()}
    >
      <Section
        title="Body weight"
        footer="Your weigh-ins, goal and trend use this unit."
      >
        <SegmentedControl
          values={["Kilograms (kg)", "Pounds (lb)"]}
          selectedIndex={draft.weightUnit === "kg" ? 0 : 1}
          onChange={(event) => {
            haptics.selection();
            const unit =
              event.nativeEvent.selectedSegmentIndex === 0 ? "kg" : "lb";
            update((current) => withWeightUnit(current, unit));
          }}
        />
      </Section>
      <Section
        title="Energy"
        footer="Food, targets and expenditure are shown in this unit."
      >
        <SegmentedControl
          values={["Calories (kcal)", "Kilojoules (kJ)"]}
          selectedIndex={draft.energyUnit === "kcal" ? 0 : 1}
          onChange={(event) => {
            haptics.selection();
            const unit =
              event.nativeEvent.selectedSegmentIndex === 0 ? "kcal" : "kj";
            update((current) => withEnergyUnit(current, unit));
          }}
        />
      </Section>
    </StepScaffold>
  );
}
