import { markEmailsSeen } from "@/lib/email";
import { connectDB } from "@/lib/mongodb";
import { acceptSuggestion, dismissSuggestion, runTriage } from "@/lib/triage";
import { EmailTriageModel } from "@/models/EmailTriage";
import {
  getOrCreateTriageSettings,
  normalizeCategoryRouting,
  normalizeCourseSenderDomains,
} from "@/models/TriageSettings";
import type { ToolDefinition } from "./types";

const TRIAGE_CATEGORIES = [
  "spam",
  "newsletter",
  "promo",
  "purchases",
  "fyi",
  "action-needed",
  "scheduled",
] as const;

const TRIAGE_USER_STATUSES = [
  "open",
  "pending",
  "reviewed",
  "archived",
] as const;

type TriageCategory = (typeof TRIAGE_CATEGORIES)[number];

function isTriageCategory(value: unknown): value is TriageCategory {
  return TRIAGE_CATEGORIES.some((category) => category === value);
}

export const triageTools: ToolDefinition[] = [
  {
    schema: {
      name: "list_triage",
      description:
        "List triaged emails with their category, summary, and suggested tasks and events. Use it to see what email triage has queued for review.",
      input_schema: {
        type: "object",
        properties: {
          category: {
            type: "string",
            description: "Filter by triage category.",
            enum: [...TRIAGE_CATEGORIES],
          },
          status: {
            type: "string",
            description: "Filter by review status.",
            enum: [...TRIAGE_USER_STATUSES],
          },
          limit: {
            type: "number",
            description: "Maximum rows to return. Defaults to 30, max 300.",
          },
        },
      },
    },
    isWrite: false,
    category: "triage",
    execute: async (input) => {
      await connectDB();
      const filter: Record<string, unknown> = {};
      if (typeof input.category === "string") filter.category = input.category;
      if (typeof input.status === "string") filter.userStatus = input.status;
      const limit = Math.min(
        Math.max(typeof input.limit === "number" ? input.limit : 30, 1),
        300,
      );
      const rows = await EmailTriageModel.find(filter)
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean()
        .exec();
      return rows.map((row) => ({
        _id: String(row._id),
        emailId: row.emailId ? String(row.emailId) : null,
        category: row.category,
        userStatus: row.userStatus,
        summary: row.summary,
        suggestedTasks: row.suggestedTasks,
        suggestedEvents: row.suggestedEvents,
        createdAt: row.createdAt,
      }));
    },
  },
  {
    schema: {
      name: "accept_triage_suggestion",
      description:
        "Accept a suggested task or event from a triaged email, creating the real kanban card or calendar event.",
      input_schema: {
        type: "object",
        properties: {
          triageId: { type: "string", description: "Triage record ID" },
          suggestionId: {
            type: "string",
            description: "ID of the suggestion inside that triage record.",
          },
          type: {
            type: "string",
            description: "Which suggestion list the id belongs to.",
            enum: ["task", "event"],
          },
          overrides: {
            type: "object",
            description:
              "Optional field overrides applied to the created record.",
          },
        },
        required: ["triageId", "suggestionId", "type"],
      },
    },
    isWrite: true,
    category: "triage",
    execute: async (input) => {
      const result = await acceptSuggestion(
        String(input.triageId),
        String(input.suggestionId),
        input.type === "event" ? "event" : "task",
        input.overrides as Record<string, unknown> | undefined,
      );
      if (!result.ok) throw new Error(result.error);
      return result;
    },
  },
  {
    schema: {
      name: "dismiss_triage_suggestion",
      description: "Dismiss a suggested task or event from a triaged email.",
      input_schema: {
        type: "object",
        properties: {
          triageId: { type: "string", description: "Triage record ID" },
          suggestionId: {
            type: "string",
            description: "ID of the suggestion inside that triage record.",
          },
          type: {
            type: "string",
            description: "Which suggestion list the id belongs to.",
            enum: ["task", "event"],
          },
        },
        required: ["triageId", "suggestionId", "type"],
      },
    },
    isWrite: true,
    category: "triage",
    execute: async (input) => {
      return dismissSuggestion(
        String(input.triageId),
        String(input.suggestionId),
        input.type === "event" ? "event" : "task",
      );
    },
  },
  {
    schema: {
      name: "set_triage_status",
      description:
        "Set the review status of a triaged email — open, pending, reviewed, or archived.",
      input_schema: {
        type: "object",
        properties: {
          triageId: { type: "string", description: "Triage record ID" },
          status: {
            type: "string",
            description: "New review status.",
            enum: [...TRIAGE_USER_STATUSES],
          },
        },
        required: ["triageId", "status"],
      },
    },
    isWrite: true,
    category: "triage",
    execute: async (input) => {
      await connectDB();
      const updated = await EmailTriageModel.findByIdAndUpdate(
        String(input.triageId),
        { userStatus: input.status },
        { returnDocument: "after" },
      )
        .lean()
        .exec();
      if (!updated) throw new Error("Triage record not found");
      return { _id: String(updated._id), userStatus: updated.userStatus };
    },
  },
  {
    schema: {
      name: "run_triage",
      description:
        "Run email triage now over unprocessed mail and return the run statistics. Triage is normally scheduled, so use this only when asked to re-run it.",
      input_schema: {
        type: "object",
        properties: {
          since: {
            type: "string",
            description: "Optional ISO timestamp to triage mail newer than.",
          },
        },
      },
    },
    isWrite: true,
    category: "triage",
    execute: async (input) => {
      const since =
        typeof input.since === "string" ? new Date(input.since) : undefined;
      if (since && Number.isNaN(since.getTime())) {
        throw new Error("since is not a valid date");
      }
      return runTriage(since ? { since } : undefined);
    },
  },
  {
    schema: {
      name: "get_triage_settings",
      description:
        "Triage configuration: whether it runs, how often, which models classify, and the per-category routing that decides when a suggestion is auto-accepted.",
      input_schema: { type: "object", properties: {} },
    },
    isWrite: false,
    category: "triage",
    execute: async () => {
      await connectDB();
      const settings = (await getOrCreateTriageSettings()).toObject();
      return {
        ...settings,
        classificationConfidenceThreshold:
          settings.classificationConfidenceThreshold ?? 0.8,
        categoryRouting: normalizeCategoryRouting(settings.categoryRouting),
        courseSenderDomains: normalizeCourseSenderDomains(
          settings.courseSenderDomains,
        ),
      };
    },
  },
  {
    schema: {
      name: "update_triage_settings",
      description:
        "Change triage configuration. categoryRouting is merged per category, not replaced, so naming one category leaves the rest alone. Lowering an autoAcceptThreshold makes triage act on its own more often.",
      input_schema: {
        type: "object",
        properties: {
          enabled: {
            type: "boolean",
            description: "Whether the triage run is active at all.",
          },
          runIntervalMinutes: {
            type: "number",
            description: "Minutes between runs.",
            minimum: 1,
          },
          prefilterModel: {
            type: "string",
            description: "Model id for the cheap first pass.",
          },
          fullModel: {
            type: "string",
            description: "Model id for full classification.",
          },
          classificationConfidenceThreshold: {
            type: "number",
            description:
              "Below this confidence a classification is held for review, 0-1.",
            minimum: 0,
            maximum: 1,
          },
          categoryRouting: {
            type: "object",
            description:
              'Per-category routing, e.g. {"action-needed":{"autoAccept":true,"autoAcceptThreshold":0.9}}. autoAccept gates every artifact triage writes on its own for that category — cards, course assignments, deadlines and events. Categories: spam, newsletter, promo, purchases, fyi, action-needed, scheduled.',
          },
          courseSenderDomains: {
            type: "array",
            items: { type: "string" },
            description:
              "Sender domains whose mail may match a course; subdomains count. An empty list makes every sender eligible.",
          },
        },
      },
    },
    isWrite: true,
    category: "triage",
    execute: async (input) => {
      await connectDB();
      const settings = await getOrCreateTriageSettings();
      const update: Record<string, unknown> = {};

      if (typeof input.enabled === "boolean") update.enabled = input.enabled;
      if (typeof input.runIntervalMinutes === "number") {
        if (!Number.isFinite(input.runIntervalMinutes)) {
          throw new Error("runIntervalMinutes must be a finite number");
        }
        update.runIntervalMinutes = input.runIntervalMinutes;
      }
      if (typeof input.prefilterModel === "string") {
        update.prefilterModel = input.prefilterModel;
      }
      if (typeof input.fullModel === "string") {
        update.fullModel = input.fullModel;
      }
      if (typeof input.classificationConfidenceThreshold === "number") {
        const value = input.classificationConfidenceThreshold;
        if (!Number.isFinite(value) || value < 0 || value > 1) {
          throw new Error(
            "classificationConfidenceThreshold must be between 0 and 1",
          );
        }
        update.classificationConfidenceThreshold = value;
      }
      if (input.courseSenderDomains !== undefined) {
        if (!Array.isArray(input.courseSenderDomains)) {
          throw new Error("courseSenderDomains must be an array of domains");
        }
        update.courseSenderDomains = normalizeCourseSenderDomains(
          input.courseSenderDomains,
        );
      }
      if (input.categoryRouting !== undefined) {
        const routing = normalizeCategoryRouting(input.categoryRouting);
        // Merged over the current routing rather than replacing it: naming one
        // category must not silently reset the other six to their defaults,
        // which is what normalizeCategoryRouting alone would do.
        const current = normalizeCategoryRouting(settings.categoryRouting);
        const incoming =
          typeof input.categoryRouting === "object" &&
          input.categoryRouting !== null
            ? (input.categoryRouting as Record<string, unknown>)
            : {};
        update.categoryRouting = {
          ...current,
          ...Object.fromEntries(
            TRIAGE_CATEGORIES.filter((category) => category in incoming).map(
              (category) => [category, routing[category]],
            ),
          ),
        };
      }

      if (Object.keys(update).length === 0) {
        throw new Error("Nothing to update");
      }
      settings.set(update);
      await settings.save();
      const saved = settings.toObject();
      return {
        ...saved,
        categoryRouting: normalizeCategoryRouting(saved.categoryRouting),
        courseSenderDomains: normalizeCourseSenderDomains(
          saved.courseSenderDomains,
        ),
      };
    },
  },
  {
    schema: {
      name: "archive_triage_category",
      description:
        "Archive every open row in one triage category at once. Items held for review are left alone — they sit in their own bucket and are not part of the category listing.",
      input_schema: {
        type: "object",
        properties: {
          category: {
            type: "string",
            description: "Category to clear.",
            enum: [...TRIAGE_CATEGORIES],
          },
        },
        required: ["category"],
      },
    },
    isWrite: true,
    category: "triage",
    execute: async (input) => {
      const category = input.category;
      if (!isTriageCategory(category)) throw new Error("Invalid category");
      await connectDB();
      const targets = await EmailTriageModel.find({
        category,
        reviewRequired: { $ne: true },
        userStatus: { $ne: "archived" },
      })
        .select("emailId")
        .lean();
      const result = await EmailTriageModel.updateMany(
        { _id: { $in: targets.map((target) => target._id) } },
        { $set: { userStatus: "archived" } },
      );
      try {
        await markEmailsSeen(targets.map((target) => target.emailId));
      } catch (error) {
        // The rows are archived either way; failing the whole call over the
        // IMAP flag would report no progress when most of the work landed.
        console.error("mark seen failed:", error);
      }
      return { archived: result.modifiedCount };
    },
  },
];
