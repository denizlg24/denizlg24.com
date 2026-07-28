import { classifyNoteWithSemanticLlm } from "@/lib/semantic-llm";
import type { ToolDefinition } from "./types";

export const clientTools: ToolDefinition[] = [
  {
    schema: {
      name: "get_current_page_context",
      description:
        "Read the desktop page currently visible to Deniz, including its route, title, selection, and concise visible text.",
      input_schema: { type: "object", properties: {} },
    },
    isWrite: false,
    category: "desktop",
    runtime: "client",
  },
  {
    schema: {
      name: "navigate_desktop",
      description:
        "Navigate the desktop app to another dashboard route. Use an absolute /dashboard/... path.",
      input_schema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Absolute dashboard path.",
          },
        },
        required: ["path"],
      },
    },
    isWrite: true,
    category: "desktop",
    runtime: "client",
  },
  {
    schema: {
      name: "refresh_current_page",
      description: "Refresh the data on the currently visible desktop page.",
      input_schema: { type: "object", properties: {} },
    },
    isWrite: true,
    category: "desktop",
    runtime: "client",
  },
  {
    schema: {
      name: "semantic_classify_note",
      description:
        "Run semantic keyword extraction and classification for an existing note. Use this after creating or materially updating a note so its semantic keywords, groups, tags, and semantic status are persisted.",
      input_schema: {
        type: "object",
        properties: {
          noteId: {
            type: "string",
            description: "The ID of the note to classify.",
          },
        },
        required: ["noteId"],
      },
    },
    isWrite: false,
    category: "notes",
    runtime: "server",
    execute: async (input) => {
      const noteId = typeof input.noteId === "string" ? input.noteId : "";
      if (!noteId) throw new Error("noteId is required");
      return classifyNoteWithSemanticLlm(noteId);
    },
  },
];
