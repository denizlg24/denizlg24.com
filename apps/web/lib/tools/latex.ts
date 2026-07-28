import { randomUUID } from "node:crypto";
import {
  type ILatexFileEntry,
  type ILatexProjectRecord,
  latexProjectPathSchema,
} from "@repo/schemas";
import {
  LatexCompileBusyError,
  LatexCompileFailedError,
  runLatexProjectCompilation,
} from "@/lib/latex-compile-run";
import {
  createLatexProject,
  deleteLatexProject,
  getLatexProject,
  listLatexProjects,
  updateLatexProject,
} from "@/lib/latex-projects";
import type { ToolDefinition } from "./types";

const MAX_FILE_CHARS = 60_000;

function utf8Entries(record: ILatexProjectRecord): ILatexFileEntry[] {
  return record.project.entries.filter(
    (entry): entry is ILatexFileEntry =>
      entry.kind === "file" && entry.encoding === "utf8",
  );
}

function numbered(content: string): string {
  const body = content
    .split("\n")
    .map((line, index) => `${index + 1}: ${line}`)
    .join("\n");
  return body.length > MAX_FILE_CHARS
    ? `${body.slice(0, MAX_FILE_CHARS)}\n… file truncated …`
    : body;
}

async function requireProject(id: unknown): Promise<ILatexProjectRecord> {
  if (typeof id !== "string" || !id) throw new Error("projectId is required");
  return getLatexProject(id);
}

// The write path here bypasses the route schemas, so paths the model invents
// have to clear the same check before they reach workspace materialization.
function requirePath(value: unknown, field: string): string {
  const parsed = latexProjectPathSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      `${field} must be a project-relative path without "..", "." or a leading slash`,
    );
  }
  return parsed.data;
}

export const latexTools: ToolDefinition[] = [
  {
    schema: {
      name: "list_latex_projects",
      description:
        "List LaTeX projects with their revision, compile state, and last update. The CV is one of these projects.",
      input_schema: {
        type: "object",
        properties: {
          includeArchived: {
            type: "boolean",
            description: "Include archived projects. Defaults to false.",
          },
        },
      },
    },
    isWrite: false,
    category: "latex",
    execute: async (input) => {
      return listLatexProjects({
        includeArchived: input.includeArchived === true,
      });
    },
  },
  {
    schema: {
      name: "get_latex_project",
      description:
        "Get a LaTeX project's metadata and file listing, including its current revision. Pass that revision to any tool that edits or compiles the project.",
      input_schema: {
        type: "object",
        properties: {
          projectId: { type: "string", description: "LaTeX project ID" },
        },
        required: ["projectId"],
      },
    },
    isWrite: false,
    category: "latex",
    execute: async (input) => {
      const record = await requireProject(input.projectId);
      return {
        _id: record._id,
        name: record.name,
        revision: record.revision,
        mainFile: record.project.mainFile,
        compiledPdf: record.compiledPdf,
        compileStatus: record.compileStatus,
        compileError: record.compileError,
        entries: record.project.entries.map((entry) => {
          if (entry.kind === "folder")
            return { path: entry.path, kind: "folder" };
          return {
            path: entry.path,
            kind: "file",
            encoding: entry.encoding,
            chars: entry.content.length,
            isMain: entry.path === record.project.mainFile,
          };
        }),
      };
    },
  },
  {
    schema: {
      name: "read_latex_file",
      description:
        "Read a UTF-8 file from a LaTeX project with 1-based line numbers. Read before editing; never edit a file you have not read.",
      input_schema: {
        type: "object",
        properties: {
          projectId: { type: "string", description: "LaTeX project ID" },
          path: { type: "string", description: "Project-relative file path." },
        },
        required: ["projectId", "path"],
      },
    },
    isWrite: false,
    category: "latex",
    execute: async (input) => {
      const record = await requireProject(input.projectId);
      const file = utf8Entries(record).find(
        (entry) => entry.path === input.path,
      );
      if (!file) {
        const available = utf8Entries(record)
          .map((entry) => entry.path)
          .join(", ");
        throw new Error(
          `No readable file at "${String(input.path)}". Available: ${available || "(none)"}`,
        );
      }
      return { path: file.path, content: numbered(file.content) };
    },
  },
  {
    schema: {
      name: "write_latex_file",
      description:
        "Create or replace a UTF-8 file in a LaTeX project with full content. Read the file first when rewriting it, and never include the line-number prefixes that read_latex_file adds.",
      input_schema: {
        type: "object",
        properties: {
          projectId: { type: "string", description: "LaTeX project ID" },
          path: { type: "string", description: "Project-relative file path." },
          content: { type: "string", description: "Full file contents." },
        },
        required: ["projectId", "path", "content"],
      },
    },
    isWrite: true,
    category: "latex",
    execute: async (input) => {
      const record = await requireProject(input.projectId);
      const path = requirePath(input.path, "path");
      const content = String(input.content);
      const existing = record.project.entries.find(
        (entry) => entry.path === path,
      );
      if (existing && existing.kind !== "file") {
        throw new Error(`"${path}" is a folder`);
      }
      const entries = existing
        ? record.project.entries.map((entry) =>
            entry.path === path && entry.kind === "file"
              ? { ...entry, encoding: "utf8" as const, content }
              : entry,
          )
        : [
            ...record.project.entries,
            {
              id: randomUUID(),
              kind: "file" as const,
              path,
              encoding: "utf8" as const,
              content,
            },
          ];
      const updated = await updateLatexProject(record._id, {
        baseRevision: record.revision,
        project: { ...record.project, entries },
      });
      return {
        path,
        action: existing ? "replaced" : "created",
        revision: updated.revision,
      };
    },
  },
  {
    schema: {
      name: "delete_latex_file",
      description: "Delete a file from a LaTeX project.",
      input_schema: {
        type: "object",
        properties: {
          projectId: { type: "string", description: "LaTeX project ID" },
          path: { type: "string", description: "Project-relative file path." },
        },
        required: ["projectId", "path"],
      },
    },
    isWrite: true,
    category: "latex",
    execute: async (input) => {
      const record = await requireProject(input.projectId);
      const path = String(input.path);
      if (path === record.project.mainFile) {
        throw new Error("The main file cannot be deleted");
      }
      const entries = record.project.entries.filter(
        (entry) => entry.path !== path,
      );
      if (entries.length === record.project.entries.length) {
        throw new Error(`No entry at "${path}"`);
      }
      const updated = await updateLatexProject(record._id, {
        baseRevision: record.revision,
        project: { ...record.project, entries },
      });
      return { path, deleted: true, revision: updated.revision };
    },
  },
  {
    schema: {
      name: "create_latex_project",
      description:
        "Create a LaTeX project from a single main .tex file. Add further files with write_latex_file.",
      input_schema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Project name." },
          mainFile: {
            type: "string",
            description: "Main file path. Defaults to 'main.tex'.",
          },
          content: {
            type: "string",
            description: "Full LaTeX source for the main file.",
          },
        },
        required: ["name", "content"],
      },
    },
    isWrite: true,
    category: "latex",
    execute: async (input) => {
      const mainFile =
        typeof input.mainFile === "string" && input.mainFile
          ? requirePath(input.mainFile, "mainFile")
          : "main.tex";
      const name = String(input.name);
      const record = await createLatexProject({
        name,
        project: {
          version: 1,
          name,
          mainFile,
          entries: [
            {
              id: randomUUID(),
              kind: "file",
              path: mainFile,
              encoding: "utf8",
              content: String(input.content),
            },
          ],
        },
      });
      return {
        _id: record._id,
        name: record.name,
        revision: record.revision,
        mainFile,
      };
    },
  },
  {
    schema: {
      name: "compile_latex_project",
      description:
        "Compile a LaTeX project with Tectonic and store the resulting PDF. Returns the compile log; on failure the log holds the Tectonic errors to fix.",
      input_schema: {
        type: "object",
        properties: {
          projectId: { type: "string", description: "LaTeX project ID" },
        },
        required: ["projectId"],
      },
    },
    isWrite: true,
    category: "latex",
    execute: async (input) => {
      const record = await requireProject(input.projectId);
      try {
        const { project, log } = await runLatexProjectCompilation({
          projectId: record._id,
          baseRevision: record.revision,
          project: record.project,
        });
        return {
          compiled: true,
          revision: project.revision,
          compiledPdf: project.compiledPdf,
          log: log.slice(-8_000),
        };
      } catch (error) {
        if (error instanceof LatexCompileFailedError) {
          return {
            compiled: false,
            error: error.message,
            log: error.log.slice(-8_000),
          };
        }
        // Retryable, not a tool failure — let the model wait and call again.
        if (error instanceof LatexCompileBusyError) {
          return { compiled: false, busy: true, error: error.message };
        }
        throw error;
      }
    },
  },
  {
    schema: {
      name: "delete_latex_project",
      description: "Permanently delete a LaTeX project and its stored PDF.",
      input_schema: {
        type: "object",
        properties: {
          projectId: { type: "string", description: "LaTeX project ID" },
        },
        required: ["projectId"],
      },
    },
    isWrite: true,
    category: "latex",
    execute: async (input) => {
      const record = await requireProject(input.projectId);
      await deleteLatexProject(record._id);
      return { deleted: true, name: record.name };
    },
  },
];
