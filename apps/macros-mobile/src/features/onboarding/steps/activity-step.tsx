import { ACTIVITY_LEVELS } from "@repo/macros-core/wizard/calc";
import { Section } from "@/ui";
import { ChoiceList } from "../choice-list";
import { StepScaffold } from "../step-scaffold";
import { useStep } from "../use-step";

export function ActivityStep() {
  const { draft, update, advance } = useStep("activity");

  return (
    <StepScaffold
      step="activity"
      intro="Your typical week of training and movement. Optional — skip it if you’re unsure."
      onContinue={() => advance()}
    >
      <Section title="Activity level">
        <ChoiceList
          choices={ACTIVITY_LEVELS}
          value={draft.activityLevel}
          optional
          onChange={(activityLevel) => update({ activityLevel })}
        />
      </Section>
    </StepScaffold>
  );
}
