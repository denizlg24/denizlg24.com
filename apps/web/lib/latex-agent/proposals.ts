import { dirname } from "@repo/latex-editor/project";
import {
  type AgentUIMessage,
  fingerprintLatexSource,
  type ILatexFileEntry,
  type ILatexProjectRecord,
  LATEX_PROPOSE_TOOL,
  type LatexAgentChangeInput,
  type LatexAgentEditProposal,
  latexAgentEditProposalSchema,
  latexAgentProposalOutputSchema,
} from "@repo/schemas";
import { isAgentToolPart, toolPartName } from "@/lib/agent/messages";

export function sourcePreview(value: string): string {
  if (value.length <= 19_000) return value;
  return `${value.slice(0, 9_000)}\n\n… ${value.length - 18_000} characters omitted …\n\n${value.slice(-9_000)}`;
}

export function lineRange(
  source: string,
  startLine: number,
  endLine: number,
): { from: number; to: number } | null {
  const starts = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "\n") starts.push(index + 1);
  }
  if (
    startLine > starts.length ||
    endLine > starts.length ||
    endLine < startLine
  ) {
    return null;
  }
  const from = starts[startLine - 1] ?? 0;
  const nextLineStart = starts[Math.min(endLine, starts.length)];
  const to = nextLineStart === undefined ? source.length : nextLineStart - 1;
  return { from, to };
}

export function numberedLineWindow(source: string, cursor: number): string {
  const lines = source.split("\n");
  const cursorLine = source.slice(0, cursor).split("\n").length;
  const first = Math.max(1, cursorLine - 50);
  const last = Math.min(lines.length, cursorLine + 50);
  return lines
    .slice(first - 1, last)
    .map((line, index) => `${first + index}: ${line}`)
    .join("\n");
}

function numberedDocument(source: string, maxChars = 120_000): string {
  const lines = source.split("\n");
  if (source.length <= maxChars) {
    return lines.map((line, index) => `${index + 1}: ${line}`).join("\n");
  }
  const half = Math.floor(maxChars / 2);
  const first: string[] = [];
  const last: string[] = [];
  let firstChars = 0;
  let lastChars = 0;
  for (let index = 0; index < lines.length && firstChars < half; index += 1) {
    const numbered = `${index + 1}: ${lines[index] ?? ""}`;
    first.push(numbered);
    firstChars += numbered.length + 1;
  }
  for (
    let index = lines.length - 1;
    index >= first.length && lastChars < half;
    index -= 1
  ) {
    const numbered = `${index + 1}: ${lines[index] ?? ""}`;
    last.unshift(numbered);
    lastChars += numbered.length + 1;
  }
  return `${first.join("\n")}\n… middle of large document omitted …\n${last.join("\n")}`;
}

export function numberedFileWindow(
  content: string,
  startLine?: number,
  endLine?: number,
): string {
  if (startLine === undefined && endLine === undefined) {
    return numberedDocument(content);
  }
  const lines = content.split("\n");
  const first = Math.max(1, Math.floor(startLine ?? 1));
  const last = Math.min(lines.length, Math.floor(endLine ?? lines.length));
  if (last < first) return `No lines in range ${first}-${last}.`;
  return lines
    .slice(first - 1, last)
    .map((line, index) => `${first + index}: ${line}`)
    .join("\n");
}

export class InvalidChangeError extends Error {}

/**
 * Turns one requested change into a reviewable proposal against the current
 * source. An impossible change is an error the model reads and corrects —
 * a range past the end of the file, a file that does not exist.
 */
export function proposalForChange(options: {
  id: string;
  change: LatexAgentChangeInput;
  project: ILatexProjectRecord["project"];
  activeFile: ILatexFileEntry;
  selectionFrom: number;
  selectionTo: number;
}): LatexAgentEditProposal {
  const { id, change, project, activeFile, selectionFrom, selectionTo } =
    options;
  const utf8 = (path: string): ILatexFileEntry | null => {
    const entry = project.entries.find(
      (candidate) =>
        candidate.kind === "file" &&
        candidate.encoding === "utf8" &&
        candidate.path === path,
    );
    return entry?.kind === "file" ? entry : null;
  };
  const requestedFile =
    change.filePath.trim().length === 0 ? activeFile : utf8(change.filePath);
  const explanation = change.explanation || "Proposed project change";

  switch (change.operation) {
    case "replace_selection": {
      const before = activeFile.content.slice(selectionFrom, selectionTo);
      return latexAgentEditProposalSchema.parse({
        id,
        kind: "replace",
        filePath: activeFile.path,
        from: selectionFrom,
        to: selectionTo,
        beforePreview: sourcePreview(before),
        expectedFingerprint: fingerprintLatexSource(before),
        replacement: change.replacement,
        explanation,
      });
    }
    case "replace_lines": {
      if (!requestedFile) {
        throw new InvalidChangeError(
          `No readable UTF-8 file at "${change.filePath}".`,
        );
      }
      if (change.startLine === undefined || change.endLine === undefined) {
        throw new InvalidChangeError(
          "replace_lines needs startLine and endLine.",
        );
      }
      const range = lineRange(
        requestedFile.content,
        change.startLine,
        change.endLine,
      );
      if (!range) {
        throw new InvalidChangeError(
          `Lines ${change.startLine}-${change.endLine} are outside ${requestedFile.path} (${requestedFile.content.split("\n").length} lines).`,
        );
      }
      const before = requestedFile.content.slice(range.from, range.to);
      return latexAgentEditProposalSchema.parse({
        id,
        kind: "replace",
        filePath: requestedFile.path,
        ...range,
        beforePreview: sourcePreview(before),
        expectedFingerprint: fingerprintLatexSource(before),
        replacement: change.replacement,
        explanation,
      });
    }
    case "replace_document": {
      if (!requestedFile) {
        throw new InvalidChangeError(
          `No readable UTF-8 file at "${change.filePath}".`,
        );
      }
      return latexAgentEditProposalSchema.parse({
        id,
        kind: "replace",
        filePath: requestedFile.path,
        from: 0,
        to: requestedFile.content.length,
        beforePreview: sourcePreview(requestedFile.content),
        expectedFingerprint: fingerprintLatexSource(requestedFile.content),
        replacement: change.replacement,
        explanation,
      });
    }
    case "create_file": {
      const path = change.filePath.trim();
      if (!path) throw new InvalidChangeError("create_file needs a filePath.");
      if (project.entries.some((entry) => entry.path === path)) {
        throw new InvalidChangeError(`"${path}" already exists.`);
      }
      return latexAgentEditProposalSchema.parse({
        id,
        kind: "create",
        filePath: path,
        content: change.replacement,
        explanation,
      });
    }
    case "rename_file": {
      const targetPath = change.targetPath.trim();
      if (!change.filePath || !targetPath) {
        throw new InvalidChangeError(
          "rename_file needs filePath and targetPath.",
        );
      }
      if (
        !project.entries.some(
          (entry) => entry.kind === "file" && entry.path === change.filePath,
        )
      ) {
        throw new InvalidChangeError(`"${change.filePath}" does not exist.`);
      }
      if (dirname(change.filePath) !== dirname(targetPath)) {
        throw new InvalidChangeError("A rename must stay in the same folder.");
      }
      if (project.entries.some((entry) => entry.path === targetPath)) {
        throw new InvalidChangeError(`"${targetPath}" already exists.`);
      }
      return latexAgentEditProposalSchema.parse({
        id,
        kind: "rename",
        filePath: change.filePath,
        targetPath,
        explanation,
      });
    }
    case "delete_file": {
      const target = project.entries.find(
        (entry) => entry.kind === "file" && entry.path === change.filePath,
      );
      if (target?.kind !== "file") {
        throw new InvalidChangeError(`"${change.filePath}" does not exist.`);
      }
      return latexAgentEditProposalSchema.parse({
        id,
        kind: "delete",
        filePath: target.path,
        beforePreview: sourcePreview(target.content),
        expectedFingerprint: fingerprintLatexSource(target.content),
        explanation,
      });
    }
  }
}

/** Proposals the user has not decided on yet, oldest first, capped like before. */
export function pendingProposals(
  messages: readonly AgentUIMessage[],
): LatexAgentEditProposal[] {
  const pending: LatexAgentEditProposal[] = [];
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    for (const part of message.parts) {
      if (
        !isAgentToolPart(part) ||
        toolPartName(part) !== LATEX_PROPOSE_TOOL ||
        part.state !== "output-available"
      ) {
        continue;
      }
      const output = latexAgentProposalOutputSchema.safeParse(part.output);
      if (output.success && output.data.status === "proposed") {
        pending.push(output.data.proposal);
      }
    }
  }
  return pending.slice(-12);
}

/** Records the user's decision on a proposal; false when no such proposal exists. */
export function markProposal(
  messages: readonly AgentUIMessage[],
  proposalId: string,
  status: "applied" | "rejected" | "failed",
): AgentUIMessage[] | null {
  let found = false;
  const next = messages.map((message) => {
    if (message.role !== "assistant") return message;
    return {
      ...message,
      parts: message.parts.map((part) => {
        if (
          !isAgentToolPart(part) ||
          toolPartName(part) !== LATEX_PROPOSE_TOOL ||
          part.toolCallId !== proposalId ||
          part.state !== "output-available"
        ) {
          return part;
        }
        const output = latexAgentProposalOutputSchema.safeParse(part.output);
        if (!output.success) return part;
        found = true;
        return { ...part, output: { ...output.data, status } };
      }),
    };
  });
  return found ? next : null;
}
