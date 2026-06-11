import type { ToolDefinition } from "./types";

export const clientTools: ToolDefinition[] = [
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
    runtime: "client",
  },
];
