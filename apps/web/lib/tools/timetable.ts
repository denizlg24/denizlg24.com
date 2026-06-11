import {
  createTimetableEntry,
  deleteTimetableEntry,
  getAllTimetableEntries,
  updateTimetableEntry,
} from "@/lib/timetable";
import type { TimetableColor } from "@/lib/timetable-constants";
import type { ToolDefinition } from "./types";

const DAY_NAMES = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

export const timetableTools: ToolDefinition[] = [
  {
    schema: {
      name: "get_timetable",
      description:
        "Get all timetable/schedule entries. Returns recurring weekly entries with day of week, times, and details.",
      input_schema: {
        type: "object",
        properties: {},
      },
    },
    isWrite: false,
    category: "timetable",
    execute: async () => {
      const entries = await getAllTimetableEntries();
      return entries.map((e) => ({
        ...e,
        dayName: DAY_NAMES[e.dayOfWeek],
      }));
    },
  },
  {
    schema: {
      name: "create_timetable_entry",
      description: "Create a new recurring timetable entry.",
      input_schema: {
        type: "object",
        properties: {
          title: {
            type: "string",
            description: "Entry title (e.g. 'Math Lecture')",
          },
          dayOfWeek: {
            type: "number",
            description:
              "Day of week (0=Monday, 1=Tuesday, ..., 5=Saturday, 6=Sunday)",
          },
          startTime: {
            type: "string",
            description: "Start time in HH:mm format (e.g. '09:00')",
          },
          endTime: {
            type: "string",
            description: "End time in HH:mm format (e.g. '10:30')",
          },
          place: { type: "string", description: "Location (optional)" },
          color: {
            type: "string",
            description: "Color theme (optional)",
            enum: [
              "background",
              "surface",
              "muted",
              "accent",
              "accent-strong",
              "foreground",
              "destructive",
            ],
          },
          links: {
            type: "array",
            description: "Related links for the entry (optional)",
            items: {
              type: "object",
              properties: {
                label: { type: "string", description: "Link label" },
                url: { type: "string", description: "Link URL" },
                icon: { type: "string", description: "Icon name (optional)" },
              },
              required: ["label", "url"],
            },
          },
        },
        required: ["title", "dayOfWeek", "startTime", "endTime"],
      },
    },
    isWrite: true,
    category: "timetable",
    execute: async (input) => {
      const result = await createTimetableEntry({
        title: input.title as string,
        dayOfWeek: input.dayOfWeek as number,
        startTime: input.startTime as string,
        endTime: input.endTime as string,
        place: input.place as string | undefined,
        color: (input.color as TimetableColor) ?? "accent",
        isActive: true,
        links:
          (input.links as { label: string; url: string; icon?: string }[]) ??
          [],
      } as Parameters<typeof createTimetableEntry>[0]);
      if (!result) throw new Error("Failed to create timetable entry");
      return result;
    },
  },
  {
    schema: {
      name: "update_timetable_entry",
      description: "Update an existing timetable entry.",
      input_schema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Entry ID" },
          title: { type: "string", description: "New title (optional)" },
          dayOfWeek: {
            type: "number",
            description: "New day of week (optional)",
          },
          startTime: {
            type: "string",
            description: "New start time (optional)",
          },
          endTime: { type: "string", description: "New end time (optional)" },
          place: { type: "string", description: "New location (optional)" },
          color: { type: "string", description: "New color (optional)" },
          isActive: {
            type: "boolean",
            description: "Enable or disable entry (optional)",
          },
          links: {
            type: "array",
            description: "Replace entry links (optional)",
            items: {
              type: "object",
              properties: {
                label: { type: "string", description: "Link label" },
                url: { type: "string", description: "Link URL" },
                icon: { type: "string", description: "Icon name (optional)" },
              },
              required: ["label", "url"],
            },
          },
        },
        required: ["id"],
      },
    },
    isWrite: true,
    category: "timetable",
    execute: async (input) => {
      const data: Record<string, unknown> = {};
      for (const key of [
        "title",
        "dayOfWeek",
        "startTime",
        "endTime",
        "place",
        "color",
        "isActive",
        "links",
      ]) {
        if (input[key] !== undefined) data[key] = input[key];
      }
      const result = await updateTimetableEntry(input.id as string, data);
      if (!result) throw new Error("Timetable entry not found");
      return result;
    },
  },
  {
    schema: {
      name: "delete_timetable_entry",
      description: "Delete a timetable entry by its ID.",
      input_schema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Entry ID to delete" },
        },
        required: ["id"],
      },
    },
    isWrite: true,
    category: "timetable",
    execute: async (input) => {
      const success = await deleteTimetableEntry(input.id as string);
      if (!success) throw new Error("Failed to delete timetable entry");
      return { success: true };
    },
  },
];
