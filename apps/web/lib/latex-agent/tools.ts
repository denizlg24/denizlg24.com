import {
  type ILatexFileEntry,
  type ILatexProjectRecord,
  LATEX_PROPOSE_TOOL,
  type LatexAgentProposalOutput,
  latexAgentChangeInputSchema,
} from "@repo/schemas";
import { type ToolSet, tool } from "ai";
import { z } from "zod";
import { searchLatexDataPoints } from "@/lib/latex-data-points";
import {
  isAlreadyCited,
  projectCitationIndex,
} from "@/lib/latex-reference-citations";
import { searchLatexReferences } from "@/lib/latex-references";
import { numberedFileWindow, proposalForChange } from "./proposals";

const MAX_READ_CHARS = 60_000;
const MAX_SEARCH_MATCHES = 60;

export interface LatexAgentToolContext {
  record: ILatexProjectRecord;
  activeFile: ILatexFileEntry;
  selectionFrom: number;
  selectionTo: number;
}

/**
 * The project agent's own tools: read-only inspection of the in-memory
 * project plus `propose_change`, which validates one edit against the current
 * source and hands back a proposal for review. Nothing here writes a file.
 */
export function buildLatexAgentTools(context: LatexAgentToolContext): ToolSet {
  const { record } = context;
  const project = record.project;
  const utf8Files = () =>
    project.entries.filter(
      (entry): entry is ILatexFileEntry =>
        entry.kind === "file" && entry.encoding === "utf8",
    );

  return {
    list_project_files: tool({
      description:
        "List every project entry with kind, encoding, size, and line count. The main file is marked. Use it to orient yourself before reading or editing files.",
      inputSchema: z.object({}),
      execute: async () =>
        project.entries
          .map((entry) => {
            if (entry.kind === "folder") return `${entry.path}/ (folder)`;
            const main = entry.path === project.mainFile ? " [main]" : "";
            if (entry.encoding !== "utf8") {
              return `${entry.path} (binary, ${entry.content.length} b64 chars)${main}`;
            }
            const lines = entry.content.split("\n").length;
            return `${entry.path} (${lines} lines, ${entry.content.length} chars)${main}`;
          })
          .join("\n") || "The project has no entries.",
    }),

    read_project_file: tool({
      description:
        "Read a UTF-8 project file with 1-based line numbers before editing it. Pass startLine and endLine to read only that inclusive range in large files. These line numbers are authoritative for replace_lines.",
      inputSchema: z.object({
        path: z.string().describe("Project-relative path from the file list."),
        startLine: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe("Optional first inclusive 1-based line."),
        endLine: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe("Optional last inclusive 1-based line."),
      }),
      execute: async ({ path, startLine, endLine }) => {
        const file = utf8Files().find((entry) => entry.path === path.trim());
        if (!file) {
          const available = utf8Files()
            .map((entry) => entry.path)
            .join(", ");
          return `No readable UTF-8 file at "${path}". Available files: ${available || "(none)"}.`;
        }
        const numbered = numberedFileWindow(file.content, startLine, endLine);
        return numbered.length > MAX_READ_CHARS
          ? `${numbered.slice(0, MAX_READ_CHARS)}\n… output truncated; request a smaller line range …`
          : numbered;
      },
    }),

    search_project: tool({
      description:
        "Case-insensitive substring search across all UTF-8 project files. Returns matching lines as 'path:line: text'. Use it to locate declarations such as \\usepackage before reading a specific file.",
      inputSchema: z.object({
        query: z.string().describe("Literal text to search for."),
      }),
      execute: async ({ query }) => {
        const needle = query.trim().toLowerCase();
        if (!needle) return "Provide a non-empty query.";
        const matches: string[] = [];
        for (const file of utf8Files()) {
          const lines = file.content.split("\n");
          for (let index = 0; index < lines.length; index += 1) {
            const line = lines[index] ?? "";
            if (line.toLowerCase().includes(needle)) {
              matches.push(
                `${file.path}:${index + 1}: ${line.trim().slice(0, 200)}`,
              );
              if (matches.length >= MAX_SEARCH_MATCHES) break;
            }
          }
          if (matches.length >= MAX_SEARCH_MATCHES) break;
        }
        return matches.length
          ? matches.join("\n")
          : `No matches for "${query}".`;
      },
    }),

    search_references: tool({
      description:
        "Search the personal paper library and OpenAlex for citable references. Returns compact JSON per match including title, authors, year, venue, doi, an existing citationKey when the paper is already in the library, and alreadyCited when the project already cites it. Use it before adding \\cite commands or bibliography entries, and never invent citations.",
      inputSchema: z.object({
        query: z.string().describe("Topic, title, or author search text."),
      }),
      execute: async ({ query }) => {
        const trimmed = query.trim();
        if (trimmed.length < 3)
          return "Provide a query of at least 3 characters.";
        const suggestions = await searchLatexReferences(trimmed, 8, project);
        if (suggestions.length === 0)
          return `No references match "${trimmed}".`;
        const citations = projectCitationIndex(project);
        return suggestions
          .map((suggestion) =>
            JSON.stringify({
              title: suggestion.title,
              authors: suggestion.authors
                .slice(0, 4)
                .map(
                  (author) =>
                    author.literal ??
                    [author.given, author.family].filter(Boolean).join(" "),
                ),
              year: suggestion.year,
              venue: suggestion.venue,
              doi: suggestion.doi,
              citationCount: suggestion.citationCount,
              citationKey: suggestion.citationKey,
              inLibrary: suggestion.alreadyInPapers,
              alreadyCited: isAlreadyCited(suggestion, citations),
            }),
          )
          .join("\n");
      },
    }),

    search_data_points: tool({
      description:
        "Mine verified numeric data points (value, unit, population, period, source passage, and reference) from the paper library and OpenAlex for a research question. Only use returned values verbatim with their reference; never extrapolate beyond the supporting passage.",
      inputSchema: z.object({
        query: z
          .string()
          .describe("The research question or metric to look for."),
      }),
      execute: async ({ query }) => {
        const trimmed = query.trim();
        if (trimmed.length < 3)
          return "Provide a query of at least 3 characters.";
        const result = await searchLatexDataPoints(record, trimmed, 6);
        if (result.candidates.length === 0) {
          return `No verified data points for "${trimmed}" (${result.inspectedPassages} passages inspected).`;
        }
        return result.candidates
          .map((candidate) =>
            JSON.stringify({
              value: candidate.value,
              unit: candidate.unit,
              population: candidate.population,
              geography: candidate.geography,
              period: candidate.period,
              qualifier: candidate.methodologyQualifier,
              passage: candidate.supportingPassage.slice(0, 600),
              reference: {
                title: candidate.reference.title,
                year: candidate.reference.year,
                doi: candidate.reference.doi,
                citationKey: candidate.reference.citationKey,
              },
            }),
          )
          .join("\n");
      },
    }),

    [LATEX_PROPOSE_TOOL]: tool({
      description:
        "Propose one project change for review. Operations: replace_selection (the user's current selection in the active file), replace_lines (inclusive 1-based lines of a file you have read this turn), replace_document (a whole file; empty replacement clears it), create_file (a new editable file — .tex, .bib, .sty, .cls, .bst, .def, …), rename_file, delete_file. Call it once per change and make every safe change the request needs. The user reviews each proposal as an inline diff and applies or rejects it; a call never edits the file itself. Never include line-number prefixes in replacement text.",
      inputSchema: latexAgentChangeInputSchema,
      execute: async (
        change,
        { toolCallId },
      ): Promise<LatexAgentProposalOutput> => ({
        proposal: proposalForChange({
          id: toolCallId,
          change,
          project,
          activeFile: context.activeFile,
          selectionFrom: context.selectionFrom,
          selectionTo: context.selectionTo,
        }),
        status: "proposed",
      }),
    }),
  };
}
