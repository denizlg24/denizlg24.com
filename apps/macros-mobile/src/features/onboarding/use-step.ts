import { useRouter } from "expo-router";
import { useState } from "react";
import { Keyboard } from "react-native";
import { haptics } from "@/lib/haptics";
import { useOnboardingDraft } from "./draft-context";
import {
  type DraftErrors,
  type DraftField,
  hasErrors,
  type OnboardingDraft,
  type StepKey,
  stepPosition,
  validateStep,
} from "./model";

/**
 * A step's draft, its field errors, and `advance`, which validates the step
 * and pushes the next one. Each step is its own native stack screen, so Back
 * and the edge swipe are the system's and every answer survives them.
 */
export function useStep(step: StepKey) {
  const router = useRouter();
  const { draft, update } = useOnboardingDraft();
  const [errors, setErrors] = useState<DraftErrors>({});

  function advance(prepare?: (draft: OnboardingDraft) => OnboardingDraft) {
    const found = validateStep(step, draft);
    setErrors(found);
    if (hasErrors(found)) {
      haptics.error();
      return;
    }
    if (prepare) update(prepare);
    Keyboard.dismiss();
    const next = stepPosition(step).next;
    if (next) router.push(next.href);
  }

  function clearError(field: DraftField) {
    setErrors((current) =>
      current[field] ? { ...current, [field]: undefined } : current,
    );
  }

  return { draft, update, errors, advance, clearError };
}
