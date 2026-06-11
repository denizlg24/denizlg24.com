import { connectDB } from "@/lib/mongodb";
import NowPage from "@/models/NowPage";
import { triggerPublicContentRevalidation } from "../public-content-revalidation";
import type { ToolDefinition } from "./types";

export const nowTools: ToolDefinition[] = [
  {
    schema: {
      name: "get_now_page",
      description:
        "Get the content of the 'Now' page, which includes current projects, mood, and what I'm learning.",
      input_schema: {
        type: "object",
        properties: {},
      },
    },
    isWrite: false,
    category: "now",
    execute: async () => {
      await connectDB();
      const now = await NowPage.findOne();
      if (!now) return { success: false, error: "Now page not found" };
      return {
        success: true,
        content: now.content,
        lastUpdated: now.updatedAt,
      };
    },
  },
  {
    schema: {
      name: "update_now_page",
      description:
        "Update the content of the 'Now' page, which includes current projects, mood, and what I'm learning.",
      input_schema: {
        type: "object",
        properties: {
          content: {
            type: "string",
            description: "The new content for the Now page in markdown format",
          },
        },
        required: ["content"],
      },
    },
    isWrite: true,
    category: "now",
    execute: async (input) => {
      await connectDB();
      const now = await NowPage.findOneAndUpdate(
        {},
        { content: input.content },
        { new: true, upsert: true },
      );
      if (!now) return { success: false, error: "Now page not found" };

      await triggerPublicContentRevalidation(["now"]);

      return {
        success: true,
        content: now.content,
        lastUpdated: now.updatedAt,
      };
    },
  },
];
