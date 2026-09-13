import { saveMemoryToolInputSchema } from "@repo/schemas";
import { saveAgentMemory } from "@/lib/agent-memory/manual-save";
import type { ToolDefinition } from "./types";

export const agentMemoryTools: ToolDefinition[] = [
  {
    schema: {
      name: "save_memory",
      description:
        "Remember a durable fact about the owner. Deduplicates against what is already stored: restating a fact reinforces it, restating it with a changed value supersedes the old one. Write the statement in third person about the owner. Do not use this for one-off requests, questions, or anything a tool can look up on demand.",
      input_schema: {
        type: "object",
        properties: {
          statement: {
            type: "string",
            description:
              "The fact, in third person, as a complete sentence. Self-contained: it will be read without this conversation.",
          },
          memoryType: {
            type: "string",
            description:
              "core for stable identity, semantic for facts and preferences, episodic for a specific event",
            enum: ["core", "semantic", "episodic"],
          },
          explicitness: {
            type: "string",
            description:
              "explicit when the owner stated it, inferred when you concluded it from evidence",
            enum: ["explicit", "inferred"],
          },
          importance: {
            type: "number",
            description: "0 to 1; how much it should shape future answers",
            minimum: 0,
            maximum: 1,
          },
          confidence: {
            type: "number",
            description: "0 to 1; how sure you are the statement is true",
            minimum: 0,
            maximum: 1,
          },
          validFrom: {
            type: "string",
            description:
              "ISO 8601 date the fact starts holding. Set this whenever the statement carries a value that moves over time — a balance, count, weight, price, status or role. It is what separates an updated value from a contradiction.",
            format: "date-time",
          },
          validUntil: {
            type: "string",
            description: "ISO 8601 date the fact stops holding, if it is known",
            format: "date-time",
          },
          reason: {
            type: "string",
            description: "Why this is worth keeping",
          },
        },
        required: [
          "statement",
          "memoryType",
          "explicitness",
          "importance",
          "confidence",
          "reason",
        ],
      },
    },
    isWrite: true,
    category: "agent-memory",
    execute: async (input, context) => {
      const parsed = saveMemoryToolInputSchema.safeParse(input);
      if (!parsed.success) {
        // Field and code only. The values are the memory statement itself,
        // which is exactly what the surrounding logging redacts.
        throw new Error(
          `save_memory input is invalid — ${parsed.error.issues
            .slice(0, 5)
            .map(
              (issue) => `${issue.path.join(".") || "(root)"}: ${issue.code}`,
            )
            .join(", ")}`,
        );
      }
      // Passed through, never defaulted: `saveAgentMemory` refuses a turn that
      // did not declare a mode, so a missing context cannot buy a memory write.
      return saveAgentMemory({
        ...parsed.data,
        memoryMode: context?.memoryMode,
        conversationId: context?.conversationId,
      });
    },
  },
];
