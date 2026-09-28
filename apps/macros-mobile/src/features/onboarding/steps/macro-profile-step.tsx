import { PROTEIN_PROFILES } from "@repo/macros-core/wizard/calc";
import { Section } from "@/ui";
import { ChoiceList } from "../choice-list";
import { withSuggestedTargets } from "../model";
import { StepScaffold } from "../step-scaffold";
import { useStep } from "../use-step";

export function MacroProfileStep() {
  const { draft, update, advance } = useStep("macros");

  return (
    <StepScaffold
      step="macros"
      intro="A starting split between protein, carbs and fat. You can fine-tune it next."
      continueLabel="Calculate targets"
      onContinue={() => advance((current) => withSuggestedTargets(current))}
    >
      <Section title="Macro profile">
        <ChoiceList
          choices={PROTEIN_PROFILES}
          value={draft.proteinProfile}
          onChange={(profile) => {
            if (profile) update({ proteinProfile: profile });
          }}
        />
      </Section>
    </StepScaffold>
  );
}
