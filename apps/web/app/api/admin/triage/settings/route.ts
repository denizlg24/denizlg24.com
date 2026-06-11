import { type NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/require-admin";
import type { TriageCategory } from "@/models/EmailTriage";
import {
  getOrCreateTriageSettings,
  type ICategoryRouting,
  normalizeCategoryRouting,
  TriageSettingsModel,
} from "@/models/TriageSettings";

const TRIAGE_CATEGORIES: TriageCategory[] = [
  "spam",
  "newsletter",
  "promo",
  "purchases",
  "fyi",
  "action-needed",
  "scheduled",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isCategoryRouting(value: unknown): value is ICategoryRouting {
  if (!isRecord(value)) return false;

  return (
    typeof value.autoCreateCard === "boolean" &&
    typeof value.autoAcceptThreshold === "number" &&
    Number.isFinite(value.autoAcceptThreshold)
  );
}

function parseCategoryRouting(
  value: unknown,
): Partial<Record<TriageCategory, ICategoryRouting>> | undefined {
  if (!isRecord(value)) return undefined;

  const next: Partial<Record<TriageCategory, ICategoryRouting>> = {};
  let hasEntries = false;

  for (const category of TRIAGE_CATEGORIES) {
    const entry = value[category];
    if (!isCategoryRouting(entry)) {
      continue;
    }

    next[category] = {
      autoCreateCard: entry.autoCreateCard,
      autoAcceptThreshold: entry.autoAcceptThreshold,
    };
    hasEntries = true;
  }

  return hasEntries ? next : undefined;
}

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  await connectDB();
  const settings = await getOrCreateTriageSettings();
  const settingsObject = settings.toObject();

  return NextResponse.json({
    settings: {
      ...settingsObject,
      categoryRouting: normalizeCategoryRouting(settingsObject.categoryRouting),
    },
  });
}

export async function PATCH(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  await connectDB();
  const body = await request.json().catch(() => null);
  const payload = isRecord(body) ? body : {};
  const settings = await getOrCreateTriageSettings();

  const update: Record<string, unknown> = {};
  if (typeof payload.enabled === "boolean") update.enabled = payload.enabled;
  if (
    typeof payload.runIntervalMinutes === "number" &&
    Number.isFinite(payload.runIntervalMinutes)
  ) {
    update.runIntervalMinutes = payload.runIntervalMinutes;
  }
  if (typeof payload.prefilterModel === "string")
    update.prefilterModel = payload.prefilterModel;
  if (typeof payload.fullModel === "string")
    update.fullModel = payload.fullModel;

  const categoryRouting = parseCategoryRouting(payload.categoryRouting);
  if (categoryRouting) {
    update.categoryRouting = {
      ...normalizeCategoryRouting(settings.categoryRouting),
      ...categoryRouting,
    };
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const updated = await TriageSettingsModel.findByIdAndUpdate(
    settings._id,
    update,
    { new: true },
  );

  const updatedObject = updated?.toObject();

  return NextResponse.json({
    settings: updatedObject
      ? {
          ...updatedObject,
          categoryRouting: normalizeCategoryRouting(
            updatedObject.categoryRouting,
          ),
        }
      : null,
  });
}
