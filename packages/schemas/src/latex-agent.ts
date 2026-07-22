import { z } from "zod";
import { chatMessageAttachmentSchema } from "./conversation";
import { latexProjectRecordSchema } from "./latex-project";

export const latexAgentMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
  attachments: z.array(chatMessageAttachmentSchema).max(5).optional(),
  changes: z
    .array(
      z.object({
        id: z.uuid(),
        kind: z.enum(["replace", "create", "rename", "delete"]),
        filePath: z.string().min(1).max(240),
        targetPath: z.string().min(1).max(240).optional(),
        explanation: z.string().max(2_000),
        status: z.enum(["proposed", "applied", "rejected", "failed"]),
      }),
    )
    .max(12)
    .optional(),
  createdAt: z.iso.datetime(),
});
export type LatexAgentMessage = z.infer<typeof latexAgentMessageSchema>;

const latexAgentProposalBaseSchema = z.object({
  id: z.uuid(),
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
  messages: z.array(latexAgentMessageSchema),
  editProposals: z.array(latexAgentEditProposalSchema).max(12).default([]),
  /** Compatibility with conversations returned by the first agent release. */
  editProposal: latexAgentEditProposalSchema.nullable().optional(),
});
export type LatexAgentConversationResponse = z.infer<
  typeof latexAgentConversationResponseSchema
>;

export const sendLatexAgentMessageSchema = z.object({
  baseRevision: z.number().int().nonnegative(),
  message: z.string().trim().min(1).max(20_000),
  model: z.string().min(1).max(200),
  memoryMode: z.enum(["enabled", "retrieval-off"]),
  activeFile: z.string().min(1).max(240).optional(),
  cursor: z.number().int().nonnegative().optional(),
  selectionFrom: z.number().int().nonnegative().optional(),
  selectionTo: z.number().int().nonnegative().optional(),
  attachments: z.array(chatMessageAttachmentSchema).max(5).optional(),
});
export type SendLatexAgentMessage = z.infer<typeof sendLatexAgentMessageSchema>;

export const appendLatexAgentMessagesSchema = z.object({
  baseRevision: z.number().int().nonnegative(),
  message: z.string().trim().min(1).max(20_000),
  response: z.string().trim().min(1).max(50_000),
  model: z.string().min(1).max(200),
  memoryMode: z.enum(["enabled", "retrieval-off"]),
  attachments: z.array(chatMessageAttachmentSchema).max(5).optional(),
  editProposals: z.array(latexAgentEditProposalSchema).max(12).optional(),
  editProposal: latexAgentEditProposalSchema.nullable().optional(),
});
export type AppendLatexAgentMessages = z.infer<
  typeof appendLatexAgentMessagesSchema
>;

export const updateLatexAgentChangeSchema = z.object({
  proposalId: z.uuid(),
  status: z.enum(["applied", "rejected", "failed"]),
});
export type UpdateLatexAgentChange = z.infer<
  typeof updateLatexAgentChangeSchema
>;
