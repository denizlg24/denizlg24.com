import { describe, expect, it } from "bun:test";
import {
  appendLatexAgentMessagesSchema,
  latexAgentProposalOutputSchema,
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

  it("stores a proposal with its review status on the tool part", () => {
    const output = latexAgentProposalOutputSchema.parse({
      proposal: { ...proposal, id: "call_01HZY" },
      status: "applied",
    });

    expect(output.status).toBe("applied");
    expect(output.proposal.id).toBe("call_01HZY");
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
