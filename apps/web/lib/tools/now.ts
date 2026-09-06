import { z } from "zod";

import { connectDB } from "@/lib/mongodb";
import NowPage from "@/models/NowPage";
import { triggerPublicContentRevalidation } from "../public-content-revalidation";
import { defineTool } from "./define";
import type { ToolDefinition } from "./types";

export const nowTools: ToolDefinition[] = [
  defineTool({
    name: "get_now_page",
    description:
      "Get the content of the 'Now' page, which includes current projects, mood, and what I'm learning.",
    isWrite: false,
    category: "now",
    input: z.object({}),
    execute: async () => {
      await connectDB();
      const now = await NowPage.findOne();
      if (!now) {
        return {
          success: false,
          error:
            "The Now page has never been written. Call update_now_page to create it.",
        };
      }
      return {
        success: true,
        content: now.content,
        lastUpdated: now.updatedAt,
      };
    },
  }),
  defineTool({
    name: "update_now_page",
    description:
      "Update the content of the 'Now' page, which includes current projects, mood, and what I'm learning. Replaces the whole page — read it with get_now_page first if the intent is to amend it.",
    isWrite: true,
    category: "now",
    input: z.object({
      content: z
        .string()
        .min(1)
        .describe(
          "The full new content for the Now page, in markdown. Replaces what is there.",
        ),
    }),
    execute: async (input) => {
      await connectDB();
      const now = await NowPage.findOneAndUpdate(
        {},
        { content: input.content },
        { returnDocument: "after", upsert: true },
      );
      // An upsert that returns nothing means the write itself did not land;
      // "not found" described a state this call is incapable of leaving behind.
      if (!now) {
        return {
          success: false,
          error: "The Now page upsert returned no document; nothing was saved.",
        };
      }

      await triggerPublicContentRevalidation(["now"]);

      return {
        success: true,
        content: now.content,
        lastUpdated: now.updatedAt,
      };
    },
  }),
];
