import { describe, expect, it } from "bun:test";
import {
  appendLatexAgentMessagesSchema,
  latexAgentMessageSchema,
  updateLatexAgentChangeSchema,
} from "./latex-agent";

const proposal = {
  id: "b30fe946-9ff0-4168-a85a-769ce56ddbae",
  kind: "replace" as const,
  filePath: "main.tex",
  from: 10,
  to: 20,
  beforePreview: "old text",
  expectedFingerprint: "8:deadbeef:cafebabe",
  replacement: "new text",
  explanation: "Clarify the abstract",
};

describe("LaTeX agent change contracts", () => {
  it("accepts multiple edit proposals from a local agent turn", () => {
    const parsed = appendLatexAgentMessagesSchema.parse({
      baseRevision: 3,
      message: "Fix all reviewer comments",
      response: "Prepared the requested revisions.",
      model: "qwen3",
      memoryMode: "retrieval-off",
      editProposals: [
        proposal,
        {
          ...proposal,
          id: "1cb2de52-5e9b-4bea-ab49-23be08708f4c",
          from: 30,
          to: 40,
          explanation: "Define the notation",
        },
      ],
    });

    expect(parsed.editProposals).toHaveLength(2);
  });

  it("stores compact project-change activity on assistant messages", () => {
    const message = latexAgentMessageSchema.parse({
      role: "assistant",
      content: "Prepared the requested revisions.",
      createdAt: "2026-07-22T13:00:00.000Z",
      changes: [
        {
          id: proposal.id,
          kind: proposal.kind,
          filePath: proposal.filePath,
          explanation: proposal.explanation,
          status: "applied",
        },
      ],
    });

    expect(message.changes?.[0]?.status).toBe("applied");
  });

  it("only accepts terminal user decisions for a change log update", () => {
    expect(
      updateLatexAgentChangeSchema.safeParse({
        proposalId: proposal.id,
        status: "rejected",
      }).success,
    ).toBe(true);
    expect(
      updateLatexAgentChangeSchema.safeParse({
        proposalId: proposal.id,
        status: "proposed",
      }).success,
    ).toBe(false);
  });
});
