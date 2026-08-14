import mongoose, { Schema } from "mongoose";
import type { TriageCategory } from "./EmailTriage";

export interface ICategoryRouting {
  autoCreateCard: boolean;
  autoAcceptThreshold: number;
}

export interface ITriageSettings {
  _id: string;
  enabled: boolean;
  runIntervalMinutes: number;
  prefilterModel: string;
  fullModel: string;
  classificationConfidenceThreshold: number;
  categoryRouting: Record<TriageCategory, ICategoryRouting>;
  lastRunAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isCategoryRouting(value: unknown): value is ICategoryRouting {
  return (
    isRecord(value) &&
    typeof value.autoCreateCard === "boolean" &&
    typeof value.autoAcceptThreshold === "number" &&
    Number.isFinite(value.autoAcceptThreshold)
  );
}

export function getDefaultCategoryRouting(): Record<
  TriageCategory,
  ICategoryRouting
> {
  return {
    spam: { autoCreateCard: false, autoAcceptThreshold: 1 },
    newsletter: { autoCreateCard: false, autoAcceptThreshold: 1 },
    promo: { autoCreateCard: false, autoAcceptThreshold: 1 },
    purchases: { autoCreateCard: false, autoAcceptThreshold: 1 },
    fyi: { autoCreateCard: false, autoAcceptThreshold: 1 },
    "action-needed": { autoCreateCard: false, autoAcceptThreshold: 0.85 },
    scheduled: { autoCreateCard: false, autoAcceptThreshold: 0.8 },
  };
}

export function normalizeCategoryRouting(
  value: unknown,
): Record<TriageCategory, ICategoryRouting> {
  const defaults = getDefaultCategoryRouting();

  if (!isRecord(value)) {
    return defaults;
  }

  const normalized = { ...defaults };
  for (const category of Object.keys(defaults) as TriageCategory[]) {
    const entry = value[category];
    if (!isCategoryRouting(entry)) {
      continue;
    }

    normalized[category] = {
      autoCreateCard: entry.autoCreateCard,
      autoAcceptThreshold: entry.autoAcceptThreshold,
    };
  }

  return normalized;
}

const TriageSettingsSchema = new Schema<ITriageSettings>(
  {
    _id: { type: String, default: "singleton" },
    enabled: { type: Boolean, default: true },
    runIntervalMinutes: { type: Number, default: 120 },
    // Retained only so existing settings documents and clients remain valid.
    // Classification no longer reads this model.
    prefilterModel: { type: String, default: "anthropic/claude-haiku-4.5" },
    // Used only for structured task/event extraction after Python classification.
    fullModel: { type: String, default: "anthropic/claude-sonnet-4.6" },
    classificationConfidenceThreshold: {
      type: Number,
      default: 0.8,
      min: 0,
      max: 1,
    },
    categoryRouting: {
      type: Schema.Types.Mixed,
      default: getDefaultCategoryRouting,
    },
    lastRunAt: { type: Date },
  },
  { timestamps: true, _id: false },
);

TriageSettingsSchema.path("categoryRouting").validate((value: unknown) => {
  if (!value || typeof value !== "object") return false;
  return true;
}, "categoryRouting must be an object");

export const TriageSettingsModel: mongoose.Model<ITriageSettings> =
  mongoose.models.TriageSettings ||
  mongoose.model<ITriageSettings>("TriageSettings", TriageSettingsSchema);

export async function getOrCreateTriageSettings(): Promise<
  mongoose.HydratedDocument<ITriageSettings>
> {
  const existing = await TriageSettingsModel.findById("singleton");
  if (existing) return existing;
  return TriageSettingsModel.create({ _id: "singleton" });
}
