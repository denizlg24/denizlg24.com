import { describe, expect, it } from "bun:test";
import type { LatexAgentEditProposal } from "@repo/schemas";
import { fingerprintLatexSource } from "@repo/schemas";
import { rebaseLatexAgentProposals } from "./latex-agent-proposals";

type ReplaceProposal = Extract<LatexAgentEditProposal, { kind: "replace" }>;

function replacement(
  id: string,
  source: string,
  from: number,
  to: number,
  content: string,
): ReplaceProposal {
  return {
    id,
    kind: "replace",
    filePath: "main.tex",
    from,
    to,
    beforePreview: source.slice(from, to),
    expectedFingerprint: fingerprintLatexSource(source.slice(from, to)),
    replacement: content,
    explanation: "test",
  };
}

describe("rebaseLatexAgentProposals", () => {
  it("shifts later ranges after applying an earlier replacement", () => {
    const source = "alpha beta gamma";
    const first = replacement(
      "00000000-0000-4000-8000-000000000001",
      source,
      0,
      5,
      "alphabet",
    );
    const second = replacement(
      "00000000-0000-4000-8000-000000000002",
      source,
      11,
      16,
      "delta",
    );

    expect(rebaseLatexAgentProposals([first, second], first)).toEqual([
      { ...second, from: 14, to: 19 },
    ]);
  });

  it("does not shift ranges before the applied replacement", () => {
    const source = "alpha beta gamma";
    const first = replacement(
      "00000000-0000-4000-8000-000000000001",
      source,
      0,
      5,
      "a",
    );
    const second = replacement(
      "00000000-0000-4000-8000-000000000002",
      source,
      11,
      16,
      "g",
    );

    expect(rebaseLatexAgentProposals([first, second], second)).toEqual([first]);
  });

  it("moves pending operations when their file is renamed", () => {
    const source = "alpha";
    const edit = replacement(
      "00000000-0000-4000-8000-000000000001",
      source,
      0,
      5,
      "beta",
    );
    const rename: LatexAgentEditProposal = {
      id: "00000000-0000-4000-8000-000000000002",
      kind: "rename",
      filePath: "main.tex",
      targetPath: "paper.tex",
      explanation: "test",
    };

    expect(rebaseLatexAgentProposals([rename, edit], rename)).toEqual([
      { ...edit, filePath: "paper.tex" },
    ]);
  });
});
