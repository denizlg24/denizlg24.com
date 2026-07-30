import { AppSettings, type ILeanAppSettings } from "@/models/AppSettings";
import { connectDB } from "./mongodb";

/**
 * Unattended-job model defaults. Policy, not catalog: overridable from the
 * AppSettings singleton and always fully qualified Gateway ids.
 *
 * These were environment variables until they became settings, so the shape
 * mirrors lib/timezone.ts: a cached async read of the singleton with a
 * hardcoded fallback, and a setter that busts the cache.
 */
export const DEFAULT_SEMANTIC_MODEL = "deepseek/deepseek-v3.2";
export const DEFAULT_UNATTENDED_MODEL = "anthropic/claude-haiku-4.5";

export type ModelSettingKey = "semanticModel" | "unattendedModel";

const DEFAULTS: Record<ModelSettingKey, string> = {
  semanticModel: DEFAULT_SEMANTIC_MODEL,
  unattendedModel: DEFAULT_UNATTENDED_MODEL,
};

const CACHE_TTL_MS = 60_000;
let cached: {
  values: Record<ModelSettingKey, string>;
  fetchedAt: number;
} | null = null;

async function loadModelSettings(): Promise<Record<ModelSettingKey, string>> {
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.values;
  }
  try {
    await connectDB();
    const settings = await AppSettings.findById("singleton")
      .lean<ILeanAppSettings>()
      .exec();
    const values: Record<ModelSettingKey, string> = {
      semanticModel: settings?.semanticModel?.trim() || DEFAULT_SEMANTIC_MODEL,
      unattendedModel:
        settings?.unattendedModel?.trim() || DEFAULT_UNATTENDED_MODEL,
    };
    cached = { values, fetchedAt: Date.now() };
    return values;
  } catch {
    return cached?.values ?? DEFAULTS;
  }
}

/** Model for semantic/JSON classification work. */
export async function getSemanticModel(): Promise<string> {
  return (await loadModelSettings()).semanticModel;
}

/** Default model for unattended text jobs (note categorization, drafts). */
export async function getUnattendedModel(): Promise<string> {
  return (await loadModelSettings()).unattendedModel;
}

export async function getModelSettings(): Promise<{
  semanticModel: string | null;
  unattendedModel: string | null;
  effectiveSemanticModel: string;
  effectiveUnattendedModel: string;
}> {
  await connectDB();
  const settings = await AppSettings.findById("singleton")
    .lean<ILeanAppSettings>()
    .exec();
  const effective = await loadModelSettings();
  return {
    semanticModel: settings?.semanticModel ?? null,
    unattendedModel: settings?.unattendedModel ?? null,
    effectiveSemanticModel: effective.semanticModel,
    effectiveUnattendedModel: effective.unattendedModel,
  };
}

export async function setModelSetting(
  key: ModelSettingKey,
  model: string | null,
): Promise<string> {
  await connectDB();
  await AppSettings.findByIdAndUpdate(
    "singleton",
    { [key]: model },
    { upsert: true },
  ).exec();
  cached = null;
  return (await loadModelSettings())[key];
}
