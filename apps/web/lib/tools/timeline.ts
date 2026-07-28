import { revalidateTimelineContent } from "@/lib/public-content-revalidation";
import {
  createTimelineItem,
  deleteTimelineItem,
  getAllTimelineItems,
  toggleTimelineItemActive,
  updateTimelineItem,
} from "@/lib/timeline";
import type { ToolDefinition } from "./types";

const CATEGORIES = ["work", "education", "personal"] as const;

const TIMELINE_FIELDS = {
  title: {
    type: "string",
    description: "Role, degree, or event title.",
  },
  subtitle: {
    type: "string",
    description: "Organization, institution, or short description.",
  },
  dateFrom: {
    type: "string",
    description: "Start date, for example '2024-09' or 'September 2024'.",
  },
  dateTo: {
    type: "string",
    description: "End date. Omit for an ongoing entry.",
  },
  category: {
    type: "string",
    description: "Timeline category.",
    enum: [...CATEGORIES],
  },
  topics: {
    type: "array",
    description: "Skills, technologies, or subjects.",
    items: { type: "string" },
  },
  logoUrl: {
    type: "string",
    description: "Logo image URL already uploaded to storage.",
  },
  isActive: {
    type: "boolean",
    description: "Whether the item shows on the public timeline.",
  },
} as const;

function timelineWriteInput(input: Record<string, unknown>) {
  return {
    ...(typeof input.title === "string" ? { title: input.title } : {}),
    ...(typeof input.subtitle === "string" ? { subtitle: input.subtitle } : {}),
    ...(typeof input.dateFrom === "string" ? { dateFrom: input.dateFrom } : {}),
    ...(typeof input.dateTo === "string" ? { dateTo: input.dateTo } : {}),
    ...(typeof input.logoUrl === "string" ? { logoUrl: input.logoUrl } : {}),
    ...(typeof input.category === "string"
      ? { category: input.category as (typeof CATEGORIES)[number] }
      : {}),
    ...(Array.isArray(input.topics)
      ? { topics: input.topics as string[] }
      : {}),
    ...(typeof input.isActive === "boolean"
      ? { isActive: input.isActive }
      : {}),
  };
}

export const timelineTools: ToolDefinition[] = [
  {
    schema: {
      name: "list_timeline_items",
      description:
        "List career/education timeline items. Can filter by category: work, education, or personal.",
      input_schema: {
        type: "object",
        properties: {
          category: {
            type: "string",
            description: "Filter by category (optional)",
            enum: [...CATEGORIES],
          },
        },
      },
    },
    isWrite: false,
    category: "timeline",
    execute: async (input) => {
      const items = await getAllTimelineItems(
        input.category as "work" | "education" | "personal" | undefined,
      );
      return items;
    },
  },
  {
    schema: {
      name: "create_timeline_item",
      description:
        "Add an entry to the career/education timeline. New entries are appended at the end of their category.",
      input_schema: {
        type: "object",
        properties: TIMELINE_FIELDS,
        required: ["title", "subtitle", "dateFrom", "category"],
      },
    },
    isWrite: true,
    category: "timeline",
    execute: async (input) => {
      const items = await getAllTimelineItems();
      const maxOrder = items.reduce(
        (highest, item) => Math.max(highest, item.order ?? 0),
        0,
      );
      const written = timelineWriteInput(input);
      const item = await createTimelineItem({
        title: written.title ?? "",
        subtitle: written.subtitle ?? "",
        dateFrom: written.dateFrom ?? "",
        dateTo: written.dateTo,
        logoUrl: written.logoUrl,
        category: written.category ?? "work",
        topics: written.topics ?? [],
        isActive: written.isActive ?? true,
        order: maxOrder + 1,
      });
      revalidateTimelineContent();
      return item;
    },
  },
  {
    schema: {
      name: "update_timeline_item",
      description:
        "Update a timeline item. Only the fields you pass are changed.",
      input_schema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Timeline item ID" },
          ...TIMELINE_FIELDS,
          order: {
            type: "number",
            description: "Display order within the timeline.",
          },
        },
        required: ["id"],
      },
    },
    isWrite: true,
    category: "timeline",
    execute: async (input) => {
      const item = await updateTimelineItem(input.id as string, {
        ...timelineWriteInput(input),
        ...(typeof input.order === "number" ? { order: input.order } : {}),
      });
      if (!item) throw new Error("Timeline item not found");
      revalidateTimelineContent();
      return item;
    },
  },
  {
    schema: {
      name: "toggle_timeline_item_active",
      description: "Flip whether a timeline item shows on the public timeline.",
      input_schema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Timeline item ID" },
        },
        required: ["id"],
      },
    },
    isWrite: true,
    category: "timeline",
    execute: async (input) => {
      const item = await toggleTimelineItemActive(input.id as string);
      if (!item) throw new Error("Timeline item not found");
      revalidateTimelineContent();
      return item;
    },
  },
  {
    schema: {
      name: "delete_timeline_item",
      description: "Permanently delete a timeline item.",
      input_schema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Timeline item ID" },
        },
        required: ["id"],
      },
    },
    isWrite: true,
    category: "timeline",
    execute: async (input) => {
      await deleteTimelineItem(input.id as string);
      revalidateTimelineContent();
      return { deleted: true };
    },
  },
];
