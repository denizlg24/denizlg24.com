import mongoose, { Schema } from "mongoose";
import type { TriageCategory } from "./EmailTriage";

export interface ICategoryRouting {
  /**
   * The master gate for acting on this category without a human. Off means
   * triage proposes and nothing else — no kanban cards, no course
   * assignments, no course deadlines, no calendar events. It used to gate the
   * card branch alone while assignments and events wrote themselves on
   * confidence, which made the settings switch read as "off" over a category
   * that was still filling the semester up.
   */
  autoAccept: boolean;
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
  /**
   * Sender domains whose mail is allowed to match a course. Anything else is
   * triaged normally but can never carry a `matchedCourseId`, so an unrelated
   * newsletter cannot land coursework in the semester overview. A subdomain of
   * a listed domain matches, so `dtu.dk` covers `student.dtu.dk` and
   * `learn.inside.dtu.dk`.
   */
  courseSenderDomains: string[];
  lastRunAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * `edu-mail.dk` is the bulk mailer CampusNet sends through — the school's own
 * name only appears in the local part (`campusnet.dtu.dk@edu-mail.dk`), so
 * nothing about the address matches `dtu.dk` on its own.
 */
export const DEFAULT_COURSE_SENDER_DOMAINS = ["dtu.dk", "edu-mail.dk"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function getDefaultCategoryRouting(): Record<
  TriageCategory,
  ICategoryRouting
> {
  return {
    spam: { autoAccept: false, autoAcceptThreshold: 1 },
    newsletter: { autoAccept: false, autoAcceptThreshold: 1 },
    promo: { autoAccept: false, autoAcceptThreshold: 1 },
    purchases: { autoAccept: false, autoAcceptThreshold: 1 },
    fyi: { autoAccept: false, autoAcceptThreshold: 1 },
    "action-needed": { autoAccept: false, autoAcceptThreshold: 0.85 },
    scheduled: { autoAccept: false, autoAcceptThreshold: 0.8 },
  };
}

/**
 * Reads one stored routing entry, accepting the pre-rename `autoCreateCard`
 * key so settings documents written before the gate became the master switch
 * keep their value instead of silently reverting to the default.
 */
function parseCategoryRouting(value: unknown): ICategoryRouting | undefined {
  if (!isRecord(value)) return undefined;

  const gate =
    typeof value.autoAccept === "boolean"
      ? value.autoAccept
      : typeof value.autoCreateCard === "boolean"
        ? value.autoCreateCard
        : undefined;
  if (gate === undefined) return undefined;
  if (
    typeof value.autoAcceptThreshold !== "number" ||
    !Number.isFinite(value.autoAcceptThreshold)
  ) {
    return undefined;
  }

  return { autoAccept: gate, autoAcceptThreshold: value.autoAcceptThreshold };
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
    const entry = parseCategoryRouting(value[category]);
    if (entry) normalized[category] = entry;
  }

  return normalized;
}

/** Lowercased, stripped of a leading `@` or `.`, and deduplicated. */
export function normalizeCourseSenderDomains(value: unknown): string[] {
  if (!Array.isArray(value)) return [...DEFAULT_COURSE_SENDER_DOMAINS];

  const domains = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const domain = entry
      .trim()
      .toLowerCase()
      .replace(/^[@.]+/, "");
    if (domain.length >= 3 && domain.includes(".")) domains.add(domain);
  }
  return [...domains];
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
    courseSenderDomains: {
      type: [String],
      default: () => [...DEFAULT_COURSE_SENDER_DOMAINS],
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
