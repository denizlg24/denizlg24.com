import type { McpServer } from "@modelcontextprotocol/server";
import {
  agentCandidateSortSchema,
  agentCandidateStatusSchema,
  agentInsightActionSchema,
  agentMemoryDecisionSchema,
  agentMemoryExploreRequestSchema,
  agentMemorySortSchema,
  agentMemoryStatusSchema,
  agentMemoryTypeSchema,
  agentResourceSuggestionDecisionSchema,
  bulkAgentCandidateDecisionSchema,
  createAgentGoalSchema,
  createAgentMemoryFeedbackSchema,
  createAgentProcedureSchema,
  generateAgentResourceSuggestionsSchema,
  rollbackAgentUserModelSchema,
  setAgentReleaseGateSchema,
  updateAgentGoalSchema,
  updateAgentMemorySettingsSchema,
  updateAgentProcedureSchema,
} from "@repo/schemas";
import { z } from "zod";
import { type Api, action, defineActions, limit, p, page } from "../define";

const base = "/api/admin/agent-memory";
const id = z.string().min(1).describe("Mongo _id");
const byId = z.object({ id });
const reason = z.string().min(1).max(2_000);

export function registerWebAgentMemory(server: McpServer, api: Api) {
  defineActions(server, {
    name: "web_agent_memory",
    title: "Web: agent memory",
    description: "Memory store overview, audit, graph and maintenance runs.",
    actions: {
      overview: action({
        description: "Memories and candidates with filters and cursors",
        input: z.object({
          limit,
          status: agentMemoryStatusSchema.optional(),
          candidateStatus: agentCandidateStatusSchema.optional(),
          memorySort: agentMemorySortSchema.optional(),
          candidateSort: agentCandidateSortSchema.optional(),
          memoryType: agentMemoryTypeSchema.optional(),
          memoryCursor: z.string().optional(),
          candidateCursor: z.string().optional(),
        }),
        readOnly: true,
        run: (query) => api.web.get(base, query),
      }),
      audit: action({
        description: "Recent audit entries",
        input: z.object({ limit }),
        readOnly: true,
        run: ({ limit }) => api.web.get(`${base}/audit`, { limit }),
      }),
      graph: action({
        description: "Memory graph nodes and edges",
        readOnly: true,
        run: () => api.web.get(`${base}/graph`),
      }),
      contradictions: action({
        description: "Open contradiction pairs, paged",
        input: z.object({ page }),
        readOnly: true,
        run: ({ page }) => api.web.get(`${base}/contradictions`, { page }),
      }),
      explore: action({
        description: "Semantic search across memories",
        input: z.object(agentMemoryExploreRequestSchema.shape),
        readOnly: true,
        run: (body) => api.web.post(`${base}/explore`, body),
      }),
      backfill: action({
        description: "Schedules the evidence backfill (needs Gate A)",
        run: () => api.web.post(`${base}/backfill`),
      }),
      user_model_rollback: action({
        description: "Rolls the user model back to targetRevision",
        input: z.object(rollbackAgentUserModelSchema.shape),
        destructive: true,
        run: (body) => api.web.post(`${base}/user-model/rollback`, body),
      }),
    },
  });

  defineActions(server, {
    name: "web_agent_memory_candidates",
    title: "Web: memory candidates",
    description: "Accept or dismiss formed memory candidates.",
    actions: {
      decide: action({
        description: "Applies a decision to one candidate",
        input: z.object({ id, decision: agentMemoryDecisionSchema }),
        run: ({ id, decision }) =>
          api.web.post(p`/api/admin/agent-memory/candidates/${id}`, decision),
      }),
      bulk: action({
        description: "accept or dismiss up to 100 candidates",
        input: z.object({
          verdict: bulkAgentCandidateDecisionSchema.shape.action,
          candidateIds: bulkAgentCandidateDecisionSchema.shape.candidateIds,
          reason: bulkAgentCandidateDecisionSchema.shape.reason,
        }),
        run: ({ verdict, ...body }) =>
          api.web.post(`${base}/candidates/bulk`, { action: verdict, ...body }),
      }),
    },
  });

  defineActions(server, {
    name: "web_agent_memory_memories",
    title: "Web: memories",
    description: "Individual memories and their revisions.",
    actions: {
      get: action({
        description: "One memory with revisions and evidence",
        input: byId,
        readOnly: true,
        run: ({ id }) => api.web.get(p`/api/admin/agent-memory/memories/${id}`),
      }),
      act: action({
        description:
          "archive, delete, supersede, rollback (targetRevision) or resolve-contradiction (targetMemoryId)",
        input: z.object({ id, decision: agentMemoryDecisionSchema }),
        destructive: true,
        run: ({ id, decision }) =>
          api.web.post(p`/api/admin/agent-memory/memories/${id}`, decision),
      }),
    },
  });

  defineActions(server, {
    name: "web_agent_memory_evidence",
    title: "Web: memory evidence",
    description: "Evidence ledger events.",
    actions: {
      get: action({
        description: "One evidence event",
        input: z.object({ eventId: z.string().min(1) }),
        readOnly: true,
        run: ({ eventId }) =>
          api.web.get(p`/api/admin/agent-memory/evidence/${eventId}`),
      }),
    },
  });

  defineActions(server, {
    name: "web_agent_memory_goals",
    title: "Web: agent goals",
    description: "Goals the agent tracks (Gate E).",
    actions: {
      list: action({
        description: "Every goal",
        readOnly: true,
        run: () => api.web.get(`${base}/goals`),
      }),
      create: action({
        description: "Creates a goal",
        input: z.object(createAgentGoalSchema.shape),
        run: (body) => api.web.post(`${base}/goals`, body),
      }),
      update: action({
        description: "Changes a goal; reason required",
        input: z.object({ id, ...updateAgentGoalSchema.shape }),
        idempotent: true,
        run: ({ id, ...body }) =>
          api.web.patch(p`/api/admin/agent-memory/goals/${id}`, body),
      }),
    },
  });

  defineActions(server, {
    name: "web_agent_memory_insights",
    title: "Web: agent insights",
    description: "Proactive insights and their delivery state.",
    actions: {
      list: action({
        description: "Insights with counts per status",
        readOnly: true,
        run: () => api.web.get(`${base}/insights`),
      }),
      create: action({
        description: "Forces an insight sweep now",
        run: () => api.web.post(`${base}/insights`),
      }),
      update: action({
        description: "dismiss, snooze (snoozedUntil), useful or delivered",
        input: z.object({ id, decision: agentInsightActionSchema }),
        idempotent: true,
        run: ({ id, decision }) =>
          api.web.patch(p`/api/admin/agent-memory/insights/${id}`, decision),
      }),
    },
  });

  defineActions(server, {
    name: "web_agent_memory_procedures",
    title: "Web: agent procedures",
    description: "Learned procedures (Gate E).",
    actions: {
      list: action({
        description: "Every procedure",
        readOnly: true,
        run: () => api.web.get(`${base}/procedures`),
      }),
      create: action({
        description: "Creates a procedure",
        input: z.object(createAgentProcedureSchema.shape),
        run: (body) => api.web.post(`${base}/procedures`, body),
      }),
      update: action({
        description: "Changes a procedure or its lifecycle",
        input: z.object({ id, ...updateAgentProcedureSchema.shape }),
        idempotent: true,
        run: ({ id, ...body }) =>
          api.web.patch(p`/api/admin/agent-memory/procedures/${id}`, body),
      }),
      delete: action({
        description: "Deletes a procedure",
        input: byId,
        destructive: true,
        run: ({ id }) =>
          api.web.delete(p`/api/admin/agent-memory/procedures/${id}`),
      }),
    },
  });

  defineActions(server, {
    name: "web_agent_memory_reflection",
    title: "Web: agent reflection",
    description: "Reflection schedule and manual runs.",
    actions: {
      get: action({
        description: "Reflection overview",
        readOnly: true,
        run: () => api.web.get(`${base}/reflection`),
      }),
      run: action({
        description: "Runs a reflection pass now",
        run: () => api.web.post(`${base}/reflection`),
      }),
    },
  });

  defineActions(server, {
    name: "web_agent_memory_resource_suggestions",
    title: "Web: resource suggestions",
    description: "Resources the memory system proposes to track.",
    actions: {
      list: action({
        description: "Suggestions, optionally one status",
        input: z.object({ status: z.string().optional() }),
        readOnly: true,
        run: ({ status }) =>
          api.web.get(`${base}/resource-suggestions`, { status }),
      }),
      generate: action({
        description: "Sweeps for suggestions; entityKey narrows to one entity",
        input: z.object(generateAgentResourceSuggestionsSchema.shape),
        run: (body) => api.web.post(`${base}/resource-suggestions`, body),
      }),
      get: action({
        description: "One suggestion",
        input: byId,
        readOnly: true,
        run: ({ id }) =>
          api.web.get(p`/api/admin/agent-memory/resource-suggestions/${id}`),
      }),
      decide: action({
        description: "Applies a decision to one suggestion",
        input: z.object({
          id,
          decision: agentResourceSuggestionDecisionSchema,
        }),
        run: ({ id, decision }) =>
          api.web.post(
            p`/api/admin/agent-memory/resource-suggestions/${id}`,
            decision,
          ),
      }),
    },
  });

  defineActions(server, {
    name: "web_agent_memory_retrieval_traces",
    title: "Web: retrieval traces",
    description: "What the agent retrieved per conversation turn.",
    actions: {
      list: action({
        description: "Recent traces, optionally one conversation",
        input: z.object({ conversationId: z.string().optional(), limit }),
        readOnly: true,
        run: (query) => api.web.get(`${base}/retrieval-traces`, query),
      }),
      get: action({
        description: "One trace",
        input: z.object({ traceId: z.string().min(1) }),
        readOnly: true,
        run: ({ traceId }) =>
          api.web.get(p`/api/admin/agent-memory/retrieval-traces/${traceId}`),
      }),
      feedback: action({
        description:
          "useful, not-relevant, forget (memoryId) or correction (memoryId + correction)",
        input: z.object({
          traceId: z.string().min(1),
          feedback: createAgentMemoryFeedbackSchema,
        }),
        run: ({ traceId, feedback }) =>
          api.web.post(
            p`/api/admin/agent-memory/retrieval-traces/${traceId}/feedback`,
            feedback,
          ),
      }),
    },
  });

  defineActions(server, {
    name: "web_agent_memory_settings",
    title: "Web: agent memory settings",
    description: "Memory settings and release gates.",
    actions: {
      get: action({
        description: "Current settings",
        readOnly: true,
        run: () => api.web.get(`${base}/settings`),
      }),
      update: action({
        description: "Changes settings; reason is recorded in the audit",
        input: z.object({
          settings: updateAgentMemorySettingsSchema,
          reason,
        }),
        idempotent: true,
        run: (body) => api.web.patch(`${base}/settings`, body),
      }),
      set_release_gate: action({
        description: "Enables or disables one gate",
        input: z.object(setAgentReleaseGateSchema.shape),
        idempotent: true,
        run: (body) => api.web.post(`${base}/settings`, body),
      }),
    },
  });
}
