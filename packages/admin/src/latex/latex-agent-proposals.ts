import type { LatexAgentEditProposal } from "@repo/schemas";

/**
 * Keeps still-pending proposals aligned with a change that was just applied.
 * Agent ranges are based on one source snapshot, so an earlier replacement
 * shifts every later, non-overlapping range in the same file.
 */
export function rebaseLatexAgentProposals(
  proposals: LatexAgentEditProposal[],
  applied: LatexAgentEditProposal,
): LatexAgentEditProposal[] {
  const remaining = proposals.filter((proposal) => proposal.id !== applied.id);

  if (applied.kind === "rename") {
    return remaining.map((proposal) =>
      proposal.filePath === applied.filePath
        ? { ...proposal, filePath: applied.targetPath }
        : proposal,
    );
  }

  if (applied.kind !== "replace") return remaining;

  const shift = applied.replacement.length - (applied.to - applied.from);
  if (shift === 0) return remaining;

  return remaining.map((proposal) => {
    if (
      proposal.kind !== "replace" ||
      proposal.filePath !== applied.filePath ||
      proposal.from < applied.to
    ) {
      return proposal;
    }
    return {
      ...proposal,
      from: proposal.from + shift,
      to: proposal.to + shift,
    };
  });
}
