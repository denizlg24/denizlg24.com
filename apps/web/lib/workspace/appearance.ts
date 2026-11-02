import {
  type Appearance,
  type AppearancePatch,
  appearanceSchema,
  BUILTIN_THEME_IDS,
  BUILTIN_THEMES,
  DEFAULT_APPEARANCE,
  DEFAULT_THEME_ID,
  type Theme,
  type ThemeInput,
  type ThemePatch,
  type ThemeScheduleInput,
  themeInputSchema,
  themeScheduleInputSchema,
  themeSchema,
} from "@repo/schemas";
import { Types } from "mongoose";
import {
  type IWorkspaceTheme,
  WorkspaceAppearanceModel,
  WorkspaceThemeModel,
} from "@/models/WorkspaceAppearance";
import { WorkspaceError } from "./service";

const APPEARANCE_ID = "appearance";

/** A stored theme, re-validated; null when it no longer reads as one. */
function themeOf(doc: IWorkspaceTheme): Theme | null {
  const parsed = themeSchema.safeParse({
    id: doc._id.toString(),
    name: doc.name,
    description: doc.description,
    scheme: doc.scheme,
    colors: doc.colors,
    radius: doc.radius,
    fonts: doc.fonts,
    effect: doc.effect,
    ornament: doc.ornament ?? {},
    background: doc.background,
    fontImport: doc.fontImport ?? null,
    css: doc.css,
    builtin: false,
    createdBy: doc.createdBy,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  });
  return parsed.success ? parsed.data : null;
}

export async function listThemes(): Promise<Theme[]> {
  const docs = await WorkspaceThemeModel.find()
    .sort({ createdAt: 1 })
    .lean<IWorkspaceTheme[]>()
    .exec();
  const custom = docs.map(themeOf).filter((t): t is Theme => t !== null);
  return [...BUILTIN_THEMES, ...custom];
}

export async function getTheme(id: string): Promise<Theme> {
  const builtin = BUILTIN_THEMES.find((t) => t.id === id);
  if (builtin) return builtin;
  if (!Types.ObjectId.isValid(id)) {
    throw new WorkspaceError(404, "NOT_FOUND", `Theme ${id} not found`);
  }
  const doc = await WorkspaceThemeModel.findById(id)
    .lean<IWorkspaceTheme>()
    .exec();
  const theme = doc ? themeOf(doc) : null;
  if (!theme) {
    throw new WorkspaceError(404, "NOT_FOUND", `Theme ${id} not found`);
  }
  return theme;
}

async function assertThemeExists(id: string): Promise<void> {
  await getTheme(id);
}

export async function createTheme(
  input: ThemeInput,
  createdBy: string,
): Promise<Theme> {
  const parsed = themeInputSchema.parse(input);
  const doc = await WorkspaceThemeModel.create({ ...parsed, createdBy });
  const theme = themeOf(doc.toObject());
  if (!theme) throw new Error("Stored theme failed validation");
  return theme;
}

export async function updateTheme(
  id: string,
  patch: ThemePatch,
): Promise<Theme> {
  if (BUILTIN_THEME_IDS.has(id)) {
    throw new WorkspaceError(
      409,
      "BUILTIN_THEME",
      "Built-in themes are read-only; create a copy instead",
    );
  }
  const current = await getTheme(id);
  const merged = themeInputSchema.safeParse({
    ...current,
    ...patch,
    colors: { ...current.colors, ...patch.colors },
    fonts: { ...current.fonts, ...patch.fonts },
    effect: { ...current.effect, ...patch.effect },
  });
  if (!merged.success) {
    throw new WorkspaceError(400, "INVALID_INPUT", "Invalid theme", {
      issues: merged.error.issues.slice(0, 5),
    });
  }
  await WorkspaceThemeModel.updateOne(
    { _id: id },
    { $set: merged.data },
  ).exec();
  return getTheme(id);
}

/** Deletes a theme and every schedule entry naming it; the default takes over if it was on. */
export async function deleteTheme(id: string): Promise<void> {
  if (BUILTIN_THEME_IDS.has(id)) {
    throw new WorkspaceError(
      409,
      "BUILTIN_THEME",
      "Built-in themes cannot be deleted",
    );
  }
  await assertThemeExists(id);
  await WorkspaceThemeModel.deleteOne({ _id: id }).exec();
  const appearance = await getAppearance();
  await writeAppearance({
    themeId: appearance.themeId === id ? DEFAULT_THEME_ID : appearance.themeId,
    schedule: appearance.schedule.filter((entry) => entry.themeId !== id),
    moduleThemes: Object.fromEntries(
      Object.entries(appearance.moduleThemes).filter(
        ([, themeId]) => themeId !== id,
      ),
    ),
  });
}

export async function getAppearance(): Promise<Appearance> {
  const doc = await WorkspaceAppearanceModel.findById(APPEARANCE_ID)
    .lean()
    .exec();
  if (!doc) return DEFAULT_APPEARANCE;
  const parsed = appearanceSchema.safeParse({
    themeId: doc.themeId,
    schedule: doc.schedule,
    textScale: doc.textScale,
    density: doc.density,
    modules: doc.modules,
    sectionOrder: doc.sectionOrder,
    moduleOrder: doc.moduleOrder,
    moduleThemes: doc.moduleThemes ?? {},
    updatedAt: doc.updatedAt.toISOString(),
  });
  return parsed.success ? parsed.data : DEFAULT_APPEARANCE;
}

/** Writes `patch`; the first write fills every other field with its default. */
async function writeAppearance(patch: AppearancePatch): Promise<Appearance> {
  const { updatedAt: _updatedAt, ...defaults } = DEFAULT_APPEARANCE;
  const onInsert = Object.fromEntries(
    Object.entries(defaults).filter(([key]) => !(key in patch)),
  );
  await WorkspaceAppearanceModel.updateOne(
    { _id: APPEARANCE_ID },
    { $set: patch, $setOnInsert: onInsert },
    { upsert: true },
  ).exec();
  return getAppearance();
}

export async function patchAppearance(
  patch: AppearancePatch,
): Promise<Appearance> {
  const named = new Set<string>();
  if (patch.themeId) named.add(patch.themeId);
  for (const entry of patch.schedule ?? []) named.add(entry.themeId);
  for (const themeId of Object.values(patch.moduleThemes ?? {})) {
    named.add(themeId);
  }
  for (const id of named) await assertThemeExists(id);
  const current = await getAppearance();
  return writeAppearance({ ...stripUpdatedAt(current), ...patch });
}

function stripUpdatedAt(appearance: Appearance): AppearancePatch {
  const { updatedAt: _updatedAt, ...rest } = appearance;
  return rest;
}

export async function addScheduleEntry(
  input: ThemeScheduleInput,
): Promise<Appearance> {
  const entry = themeScheduleInputSchema.parse(input);
  await assertThemeExists(entry.themeId);
  const current = await getAppearance();
  return writeAppearance({
    schedule: [
      ...current.schedule,
      { ...entry, id: new Types.ObjectId().toString() },
    ],
  });
}

export async function removeScheduleEntry(id: string): Promise<Appearance> {
  const current = await getAppearance();
  if (!current.schedule.some((entry) => entry.id === id)) {
    throw new WorkspaceError(
      404,
      "NOT_FOUND",
      `Schedule entry ${id} not found`,
    );
  }
  return writeAppearance({
    schedule: current.schedule.filter((entry) => entry.id !== id),
  });
}
