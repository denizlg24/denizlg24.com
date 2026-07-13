import {
  agentGoalStatusSchema,
  createAgentGoalSchema,
  createAgentProcedureSchema,
  updateAgentGoalSchema,
  updateAgentProcedureSchema,
} from "@repo/schemas";
import {
  createGoal,
  createProcedure,
  updateGoal,
  updateProcedure,
} from "@/lib/agent-memory/lifecycle";
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
