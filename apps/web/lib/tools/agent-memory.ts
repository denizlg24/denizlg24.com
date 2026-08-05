import {
  agentGoalStatusSchema,
  createAgentGoalSchema,
  createAgentProcedureSchema,
  saveMemoryToolInputSchema,
  updateAgentGoalSchema,
  updateAgentProcedureSchema,
} from "@repo/schemas";
import {
  createGoal,
  createProcedure,
  updateGoal,
  updateProcedure,
} from "@/lib/agent-memory/lifecycle";
import { saveAgentMemory } from "@/lib/agent-memory/manual-save";
import {
  serializeAgentGoal,
  serializeAgentProcedure,
  serializeAgentUserModel,
} from "@/lib/agent-memory/serialize";
import { getAgentMemorySettings } from "@/lib/agent-memory/settings";
import { connectDB } from "@/lib/mongodb";
import { AgentGoal } from "@/models/AgentGoal";
import { AgentProcedure } from "@/models/AgentProcedure";
import { AgentUserModel } from "@/models/AgentUserModel";
import type { ToolDefinition } from "./types";

async function assertGateE() {
  if (!(await getAgentMemorySettings()).releaseGates.reflection) {
    throw new Error("Gate E is disabled");
  }
}

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
  {
    schema: {
      name: "list_agent_goals",
      description: "List the user's tracked goals and commitments.",
      input_schema: {
        type: "object",
        properties: {
          status: {
            type: "string",
            description: "Optional goal status filter",
            enum: ["suggested", "active", "paused", "completed", "abandoned"],
          },
        },
      },
    },
    isWrite: false,
    category: "agent-memory",
    execute: async (input) => {
      await assertGateE();
      await connectDB();
      const status = agentGoalStatusSchema.safeParse(input.status);
      const goals = await AgentGoal.find(
        status.success ? { status: status.data } : {},
      )
        .sort({ status: 1, targetUntil: 1, updatedAt: -1 })
        .limit(100);
      return goals.map(serializeAgentGoal);
    },
  },
  {
    schema: {
      name: "create_agent_goal",
      description:
        "Create a tracked personal goal or commitment. This is a write action requiring approval.",
      input_schema: {
        type: "object",
        properties: {
          title: { type: "string", description: "Goal title" },
          description: { type: "string", description: "Optional details" },
          kind: {
            type: "string",
            description: "Goal kind",
            enum: ["goal", "user-commitment", "agent-follow-up"],
          },
          targetUntil: {
            type: "string",
            description: "Optional ISO 8601 target date",
          },
          motivation: { type: "string", description: "Optional motivation" },
        },
        required: ["title", "kind"],
      },
    },
    isWrite: true,
    category: "agent-memory",
    execute: async (input) => {
      await assertGateE();
      const parsed = createAgentGoalSchema.parse({
        ...input,
        constraints: [],
        dependencyIds: [],
        progressEvidenceIds: [],
        relatedEntities: [],
      });
      return serializeAgentGoal(await createGoal(parsed));
    },
  },
  {
    schema: {
      name: "update_agent_goal",
      description:
        "Update a tracked goal's status or details. This is a write action requiring approval.",
      input_schema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Goal ID from list_agent_goals" },
          status: {
            type: "string",
            description: "New status",
            enum: ["suggested", "active", "paused", "completed", "abandoned"],
          },
          description: { type: "string", description: "Updated details" },
          reason: { type: "string", description: "Reason for the update" },
        },
        required: ["id", "reason"],
      },
    },
    isWrite: true,
    category: "agent-memory",
    execute: async (input) => {
      await assertGateE();
      const parsed = updateAgentGoalSchema.parse({
        status: input.status,
        description: input.description,
        reason: input.reason,
      });
      return serializeAgentGoal(await updateGoal(input.id as string, parsed));
    },
  },
  {
    schema: {
      name: "list_agent_procedures",
      description:
        "List active and learned personal working procedures. Procedures never grant permissions.",
      input_schema: { type: "object", properties: {} },
    },
    isWrite: false,
    category: "agent-memory",
    execute: async () => {
      await assertGateE();
      await connectDB();
      const procedures = await AgentProcedure.find()
        .sort({ lifecycle: 1, confidence: -1 })
        .limit(100);
      return procedures.map(serializeAgentProcedure);
    },
  },
  {
    schema: {
      name: "create_agent_procedure",
      description:
        "Create an explicit personal working procedure. This cannot alter permissions and requires write approval.",
      input_schema: {
        type: "object",
        properties: {
          scope: { type: "string", description: "Where it applies" },
          trigger: { type: "string", description: "When it applies" },
          behavior: { type: "string", description: "Preferred behavior" },
          exceptions: {
            type: "array",
            description: "Cases where it should not apply",
            items: { type: "string" },
          },
        },
        required: ["scope", "trigger", "behavior"],
      },
    },
    isWrite: true,
    category: "agent-memory",
    execute: async (input) => {
      await assertGateE();
      const parsed = createAgentProcedureSchema.parse({
        ...input,
        exceptions: input.exceptions ?? [],
        supportingFeedbackIds: [],
        evidenceIds: [],
        confidence: 1,
        explicit: true,
        lifecycle: "active",
      });
      return serializeAgentProcedure(await createProcedure(parsed));
    },
  },
  {
    schema: {
      name: "retire_agent_procedure",
      description:
        "Retire an existing personal procedure. This is a write action requiring approval.",
      input_schema: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description: "Procedure ID from list_agent_procedures",
          },
          reason: { type: "string", description: "Reason for retirement" },
        },
        required: ["id", "reason"],
      },
    },
    isWrite: true,
    category: "agent-memory",
    execute: async (input) => {
      await assertGateE();
      const parsed = updateAgentProcedureSchema.parse({
        lifecycle: "retired",
        reason: input.reason,
      });
      return serializeAgentProcedure(
        await updateProcedure(input.id as string, parsed),
      );
    },
  },
  {
    schema: {
      name: "get_personal_user_model",
      description:
        "Get the current evidence-backed personal profile projection and its revision.",
      input_schema: { type: "object", properties: {} },
    },
    isWrite: false,
    category: "agent-memory",
    execute: async () => {
      await assertGateE();
      await connectDB();
      const model = await AgentUserModel.findById("singleton");
      return model ? serializeAgentUserModel(model) : null;
    },
  },
];
