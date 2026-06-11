import { getAllTimelineItems } from "@/lib/timeline";
import type { ToolDefinition } from "./types";

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
            enum: ["work", "education", "personal"],
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
];
