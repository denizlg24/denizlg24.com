import { z } from "zod";
import {
  agentExecutionModeSchema,
  agentToolTogglesSchema,
  agentUIMessageSchema,
} from "./agent-chat";
import { connectorSlugSchema } from "./connectors";
import { chatMessageAttachmentSchema } from "./conversation";
import { latexProjectRecordSchema } from "./latex-project";

/** The tool the agent proposes edits through; each call is one reviewable change. */
export const LATEX_PROPOSE_TOOL = "propose_change";

export const latexAgentChangeInputSchema = z.object({
  operation: z.enum([
    "replace_selection",
    "replace_lines",
    "replace_document",
    "create_file",
    "rename_file",
    "delete_file",
  ]),
  filePath: z.string().max(240).default(""),
  startLine: z.number().int().positive().optional(),
  endLine: z.number().int().positive().optional(),
  replacement: z.string().max(2_800_000).default(""),
  targetPath: z.string().max(240).default(""),
  explanation: z.string().max(2_000).default(""),
});
export type LatexAgentChangeInput = z.infer<typeof latexAgentChangeInputSchema>;

export const latexAgentChangeStatusSchema = z.enum([
  "proposed",
  "applied",
  "rejected",
  "failed",
]);
export type LatexAgentChangeStatus = z.infer<
  typeof latexAgentChangeStatusSchema
>;

const latexAgentProposalBaseSchema = z.object({
  /** The tool call id of the `propose_change` call that produced it. */
  id: z.string().min(1).max(120),
  filePath: z.string().min(1).max(240),
  explanation: z.string().max(2_000),
});

export const latexAgentEditProposalSchema = z.discriminatedUnion("kind", [
  latexAgentProposalBaseSchema.extend({
    kind: z.literal("replace"),
    from: z.number().int().nonnegative(),
    to: z.number().int().nonnegative(),
    beforePreview: z.string().max(20_000),
    expectedFingerprint: z.string().min(1).max(80),
    replacement: z.string().max(2_800_000),
  }),
  latexAgentProposalBaseSchema.extend({
    kind: z.literal("create"),
    content: z.string().max(2_800_000),
  }),
  latexAgentProposalBaseSchema.extend({
    kind: z.literal("rename"),
    targetPath: z.string().min(1).max(240),
  }),
  latexAgentProposalBaseSchema.extend({
    kind: z.literal("delete"),
    beforePreview: z.string().max(20_000),
    expectedFingerprint: z.string().min(1).max(80),
  }),
]);
export type LatexAgentEditProposal = z.infer<
  typeof latexAgentEditProposalSchema
>;

/** Output of one `propose_change` call, as stored on the tool part. */
export const latexAgentProposalOutputSchema = z.object({
  proposal: latexAgentEditProposalSchema,
  status: latexAgentChangeStatusSchema,
});
export type LatexAgentProposalOutput = z.infer<
  typeof latexAgentProposalOutputSchema
>;

/** Fast stale-edit guard used on both the server and the editor client. */
export function fingerprintLatexSource(value: string): string {
  let first = 2_166_136_261;
  let second = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 16_777_619) >>> 0;
    second = Math.imul(second ^ (code + index), 16_777_619) >>> 0;
  }
  return `${value.length}:${first.toString(16)}:${second.toString(16)}`;
}

export const latexAgentConversationResponseSchema = z.object({
  project: latexProjectRecordSchema,
  conversationId: z.string().nullable(),
  messages: z.array(agentUIMessageSchema),
  editProposals: z.array(latexAgentEditProposalSchema).max(12).default([]),
});
export type LatexAgentConversationResponse = z.infer<
  typeof latexAgentConversationResponseSchema
>;

export const latexAgentMemoryModeSchema = z.enum(["enabled", "retrieval-off"]);

/** One streamed turn of the project agent. */
export const latexAgentStreamRequestSchema = z.object({
  baseRevision: z.number().int().nonnegative(),
  trigger: z.enum(["submit-message", "regenerate-message"]),
  message: agentUIMessageSchema.optional(),
  messageId: z.string().optional(),
  model: z.string().min(1).max(200),
  memoryMode: latexAgentMemoryModeSchema,
  activeFile: z.string().min(1).max(240).optional(),
  cursor: z.number().int().nonnegative().optional(),
  selectionFrom: z.number().int().nonnegative().optional(),
  selectionTo: z.number().int().nonnegative().optional(),
  tools: agentToolTogglesSchema.default({
    webSearch: false,
    webFetch: false,
    thinkLonger: false,
  }),
  /** Connectors the turn may use; the project agent defaults to none. */
  connectors: z.array(connectorSlugSchema).max(32).default([]),
  executionMode: agentExecutionModeSchema.default("interactive"),
});
export type LatexAgentStreamRequest = z.infer<
  typeof latexAgentStreamRequestSchema
>;
export type LatexAgentStreamRequestInput = z.input<
  typeof latexAgentStreamRequestSchema
>;

/** One non-streamed turn from plain text, for callers that cannot read a UI stream. */
export const sendLatexAgentMessageSchema = z.object({
  baseRevision: z.number().int().nonnegative(),
  message: z.string().trim().min(1).max(20_000),
  model: z.string().min(1).max(200),
  memoryMode: latexAgentMemoryModeSchema,
  activeFile: z.string().min(1).max(240).optional(),
  cursor: z.number().int().nonnegative().optional(),
  selectionFrom: z.number().int().nonnegative().optional(),
  selectionTo: z.number().int().nonnegative().optional(),
  attachments: z.array(chatMessageAttachmentSchema).max(5).optional(),
});
export type SendLatexAgentMessage = z.infer<typeof sendLatexAgentMessageSchema>;

/** A turn produced by a local model in the editor, appended as-is. */
export const appendLatexAgentMessagesSchema = z.object({
  baseRevision: z.number().int().nonnegative(),
  message: z.string().trim().min(1).max(20_000),
  response: z.string().trim().min(1).max(50_000),
  model: z.string().min(1).max(200),
  memoryMode: latexAgentMemoryModeSchema,
  attachments: z.array(chatMessageAttachmentSchema).max(5).optional(),
  editProposals: z.array(latexAgentEditProposalSchema).max(12).default([]),
});
export type AppendLatexAgentMessages = z.infer<
  typeof appendLatexAgentMessagesSchema
>;

export const updateLatexAgentChangeSchema = z.object({
  proposalId: z.string().min(1).max(120),
  status: z.enum(["applied", "rejected", "failed"]),
});
export type UpdateLatexAgentChange = z.infer<
  typeof updateLatexAgentChangeSchema
>;
