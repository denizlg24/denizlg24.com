import { Stack } from "expo-router";
import { OnboardingDraftProvider } from "@/features/onboarding/draft-context";
import { ONBOARDING_STEPS } from "@/features/onboarding/model";
import { tabStackOptions } from "@/features/shell/routes";

export default function OnboardingLayout() {
  return (
    <OnboardingDraftProvider>
      <Stack screenOptions={tabStackOptions}>
        {ONBOARDING_STEPS.map((step) => (
          <Stack.Screen
            key={step.route}
            name={step.route}
            options={{ title: step.title }}
          />
        ))}
      </Stack>
    </OnboardingDraftProvider>
  );
}
