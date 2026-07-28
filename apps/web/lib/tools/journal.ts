import {
  createJournal,
  deleteJournal,
  getJournalById,
  getJournalLogs,
  updateJournalContent,
} from "@/lib/journal";
import type { ToolDefinition } from "./types";

function parseDate(value: unknown, label: string): Date {
  if (typeof value !== "string") throw new Error(`${label} is required`);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`${label} is not a valid date`);
  }
  return parsed;
}

export const journalTools: ToolDefinition[] = [
  {
    schema: {
      name: "list_journal_entries",
      description:
        "List journal entries, optionally within a date range. The nightly job archives the Today board into these entries.",
      input_schema: {
        type: "object",
        properties: {
          startDate: {
            type: "string",
            description: "Inclusive ISO start date.",
          },
          endDate: { type: "string", description: "Inclusive ISO end date." },
        },
      },
    },
    isWrite: false,
    category: "journal",
    execute: async (input) => {
      const start =
        typeof input.startDate === "string"
          ? new Date(input.startDate)
          : undefined;
      const end =
        typeof input.endDate === "string" ? new Date(input.endDate) : undefined;
      return getJournalLogs(start, end);
    },
  },
  {
    schema: {
      name: "get_journal_entry",
      description:
        "Read one journal entry in full, including its archived day data.",
      input_schema: {
        type: "object",
        properties: { id: { type: "string", description: "Journal entry ID" } },
        required: ["id"],
      },
    },
    isWrite: false,
    category: "journal",
    execute: async (input) => {
      const journal = await getJournalById(input.id as string);
      if (!journal) throw new Error("Journal entry not found");
      return journal;
    },
  },
  {
    schema: {
      name: "create_journal_entry",
      description:
        "Create a journal entry for a date. One entry exists per day, so this returns the existing entry when the day already has one.",
      input_schema: {
        type: "object",
        properties: {
          date: { type: "string", description: "ISO date for the entry." },
          content: { type: "string", description: "Entry body in markdown." },
        },
        required: ["date"],
      },
    },
    isWrite: true,
    category: "journal",
    execute: async (input) => {
      const journal = await createJournal({
        date: parseDate(input.date, "date"),
        content: typeof input.content === "string" ? input.content : undefined,
      });
      if (!journal) throw new Error("Journal entry could not be created");
      return journal;
    },
  },
  {
    schema: {
      name: "update_journal_entry",
      description:
        "Replace a journal entry's content. Read the entry first when appending rather than rewriting.",
      input_schema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Journal entry ID" },
          content: { type: "string", description: "Full replacement content." },
        },
        required: ["id", "content"],
      },
    },
    isWrite: true,
    category: "journal",
    execute: async (input) => {
      const journal = await updateJournalContent(
        input.id as string,
        input.content as string,
      );
      if (!journal) throw new Error("Journal entry not found");
      return journal;
    },
  },
  {
    schema: {
      name: "delete_journal_entry",
      description:
        "Permanently delete a journal entry and redact it from agent memory.",
      input_schema: {
        type: "object",
        properties: { id: { type: "string", description: "Journal entry ID" } },
        required: ["id"],
      },
    },
    isWrite: true,
    category: "journal",
    execute: async (input) => {
      const deleted = await deleteJournal(input.id as string);
      if (!deleted) throw new Error("Journal entry not found");
      return { deleted };
    },
  },
];
