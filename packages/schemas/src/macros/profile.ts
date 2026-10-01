import { z } from "zod";
import { macrosCaloriePreferenceSchema } from "./common";
import { macrosGoalTypeSchema } from "./goals";
import { macrosPlanDayInputSchema } from "./plans";

export const macrosWeightUnitSchema = z.enum(["kg", "lb"]);
export const macrosEnergyUnitSchema = z.enum(["kcal", "kj"]);
export const macrosSexSchema = z.enum([
  "female",
  "male",
  "other",
  "prefer_not_to_say",
]);
export const macrosActivityLevelSchema = z.enum([
  "sedentary",
  "light",
  "moderate",
  "active",
  "very_active",
]);

export const macrosProfileSchema = z.object({
  userId: z.string(),
  name: z.string(),
  email: z.string(),
  emailVerified: z.boolean(),
  onboardingCompleted: z.boolean(),
  timezone: z.string(),
  weightUnit: macrosWeightUnitSchema,
  energyUnit: macrosEnergyUnitSchema,
  caloriePreference: macrosCaloriePreferenceSchema,
  sex: macrosSexSchema.nullable().optional(),
  birthDate: z.iso.date().nullable().optional(),
});

export const macrosProfileResponseSchema = z.object({
  profile: macrosProfileSchema,
});

export const macrosCaloriePreferenceBodySchema = z.object({
  caloriePreference: macrosCaloriePreferenceSchema,
});

export const macrosCaloriePreferenceResponseSchema =
  macrosCaloriePreferenceBodySchema;

export const macrosTimezoneBodySchema = z.object({
  timezone: z.string().min(1),
});

export const macrosTimezoneResponseSchema = z.object({
  timezone: z.string(),
});

export const macrosCompleteRegistrationBodySchema = z.object({
  profile: z.object({
    timezone: z.string().min(1).default("UTC"),
    birthDate: z.iso.date().optional(),
    ageYears: z.number().int().min(13).max(120).optional(),
    heightCm: z.number().min(50).max(260).optional(),
    sex: macrosSexSchema.optional(),
    activityLevel: macrosActivityLevelSchema.optional(),
    weightUnit: macrosWeightUnitSchema.default("kg"),
    energyUnit: macrosEnergyUnitSchema.default("kcal"),
  }),
  metrics: z.object({
    measuredAt: z.iso.datetime({ offset: true }).optional(),
    logDate: z.iso.date().optional(),
    weightKg: z.number().min(20).max(500),
  }),
  weightGoal: z.object({
    goalType: macrosGoalTypeSchema,
    targetWeightKg: z.number().min(20).max(500).optional(),
    targetDate: z.iso.date().optional(),
    weeklyRateKg: z.number().min(0).max(2).optional(),
  }),
  nutritionPlan: z.object({
    name: z.string().min(1).max(120).default("Coached Program"),
    days: z.array(macrosPlanDayInputSchema).length(7),
  }),
});

export const macrosCompleteRegistrationResponseSchema = z.object({
  status: z.literal("completed"),
});

export type MacrosWeightUnit = z.infer<typeof macrosWeightUnitSchema>;
export type MacrosEnergyUnit = z.infer<typeof macrosEnergyUnitSchema>;
export type MacrosSex = z.infer<typeof macrosSexSchema>;
export type MacrosActivityLevel = z.infer<typeof macrosActivityLevelSchema>;
export type MacrosProfile = z.infer<typeof macrosProfileSchema>;
export type MacrosProfileResponse = z.infer<typeof macrosProfileResponseSchema>;
export type MacrosCaloriePreferenceBody = z.infer<
  typeof macrosCaloriePreferenceBodySchema
>;
export type MacrosCaloriePreferenceResponse = z.infer<
  typeof macrosCaloriePreferenceResponseSchema
>;
export type MacrosTimezoneBody = z.infer<typeof macrosTimezoneBodySchema>;
export type MacrosTimezoneResponse = z.infer<
  typeof macrosTimezoneResponseSchema
>;
export type MacrosCompleteRegistrationBody = z.infer<
  typeof macrosCompleteRegistrationBodySchema
>;
export type MacrosCompleteRegistrationResponse = z.infer<
  typeof macrosCompleteRegistrationResponseSchema
>;
