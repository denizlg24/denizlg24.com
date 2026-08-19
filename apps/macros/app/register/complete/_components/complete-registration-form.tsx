"use client"

import { useRouter } from "next/navigation"
import {
  OnboardingWizard,
  type WizardPayload,
} from "@/components/onboarding/wizard"

export function CompleteRegistrationForm() {
  const router = useRouter()

  async function handleSubmit(payload: WizardPayload) {
    if (!payload.profile || !payload.weightGoal || !payload.nutritionPlan) {
      throw new Error("Incomplete registration payload")
    }
    if (payload.currentWeightKg === undefined) {
      throw new Error("Current weight is required")
    }

    const body = {
      profile: {
        timezone: payload.profile.timezone,
        sex: payload.profile.sex,
        birthDate: payload.profile.birthDate,
        heightCm: payload.profile.heightCm,
        activityLevel: payload.profile.activityLevel,
        weightUnit: payload.profile.weightUnit,
        energyUnit: payload.profile.energyUnit,
      },
      metrics: { weightKg: payload.currentWeightKg },
      weightGoal: payload.weightGoal,
      nutritionPlan: {
        name: payload.nutritionPlan.name ?? "Coached Program",
        days: payload.nutritionPlan.days,
      },
    }

    const res = await fetch("/api/register/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      const message =
        typeof data === "object" &&
        data !== null &&
        "error" in data &&
        typeof (data as Record<string, unknown>).error === "string"
          ? (data as Record<string, string>).error
          : "Something went wrong."
      throw new Error(message)
    }
    router.push("/")
  }

  return (
    <OnboardingWizard
      mode="full"
      onSubmit={handleSubmit}
      submitLabel="Start tracking"
    />
  )
}
