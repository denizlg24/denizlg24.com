import { connectDB } from "@/lib/mongodb";
import { acceptSuggestion, dismissSuggestion, runTriage } from "@/lib/triage";
import { EmailTriageModel } from "@/models/EmailTriage";
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
];
