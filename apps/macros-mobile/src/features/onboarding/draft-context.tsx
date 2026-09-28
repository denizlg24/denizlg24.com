import type { EnergyUnit, WeightUnit } from "@repo/macros-core/wizard/calc";
import { getLocales } from "expo-localization";
import {
  createContext,
  type ReactNode,
  use,
  useCallback,
  useMemo,
  useState,
} from "react";
import { initialDraft, type OnboardingDraft } from "./model";

type DraftChange =
  | Partial<OnboardingDraft>
  | ((draft: OnboardingDraft) => OnboardingDraft);

interface DraftContextValue {
  draft: OnboardingDraft;
  update: (change: DraftChange) => void;
}

const DraftContext = createContext<DraftContextValue | null>(null);

/** Pounds for US-measurement locales, kilojoules where labels print them. */
function localeUnits(): { weightUnit: WeightUnit; energyUnit: EnergyUnit } {
  const locale = getLocales()[0];
  const region = locale?.regionCode ?? "";
  return {
    weightUnit: locale?.measurementSystem === "us" ? "lb" : "kg",
    energyUnit: region === "AU" || region === "NZ" ? "kj" : "kcal",
  };
}

/**
 * One draft for the whole wizard, above the stack so pushing and popping
 * steps never loses an answer. Nothing is persisted: leaving the wizard
 * means signing out.
 */
export function OnboardingDraftProvider({ children }: { children: ReactNode }) {
  const [draft, setDraft] = useState(() => initialDraft(localeUnits()));
  const update = useCallback((change: DraftChange) => {
    setDraft((current) =>
      typeof change === "function"
        ? change(current)
        : { ...current, ...change },
    );
  }, []);
  const value = useMemo(() => ({ draft, update }), [draft, update]);
  return <DraftContext value={value}>{children}</DraftContext>;
}

export function useOnboardingDraft(): DraftContextValue {
  const value = use(DraftContext);
  if (!value) {
    throw new Error(
      "useOnboardingDraft must be used inside the onboarding stack",
    );
  }
  return value;
}
