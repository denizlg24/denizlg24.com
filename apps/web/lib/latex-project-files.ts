import { randomUUID } from "node:crypto";
import {
  type ILatexFileEntry,
  type ILatexProjectRecord,
  latexProjectSchema,
} from "@repo/schemas";
import { getLatexProject, updateLatexProject } from "@/lib/latex-projects";

const MAX_FILE_CHARS = 60_000;

export class LatexFileError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "LatexFileError";
  }
}

function utf8Entries(record: ILatexProjectRecord): ILatexFileEntry[] {
  return record.project.entries.filter(
    (entry): entry is ILatexFileEntry =>
      entry.kind === "file" && entry.encoding === "utf8",
  );
}

function numbered(content: string): { content: string; truncated: boolean } {
  const body = content
    .split("\n")
    .map((line, index) => `${index + 1}: ${line}`)
    .join("\n");
  return body.length > MAX_FILE_CHARS
    ? { content: body.slice(0, MAX_FILE_CHARS), truncated: true }
    : { content: body, truncated: false };
}

/** A UTF-8 file with 1-based `N: ` line prefixes, capped at 60k characters. */
export async function readLatexFile(projectId: string, path: string) {
  const record = await getLatexProject(projectId);
  const file = utf8Entries(record).find((entry) => entry.path === path);
  if (!file) {
    const available = utf8Entries(record).map((entry) => entry.path);
    throw new LatexFileError(
      `No readable file at "${path}". Available: ${available.join(", ") || "(none)"}`,
      404,
    );
  }
  return {
    path: file.path,
    revision: record.revision,
    ...numbered(file.content),
  };
}

async function saveEntries(
  record: ILatexProjectRecord,
  entries: ILatexProjectRecord["project"]["entries"],
) {
  const project = latexProjectSchema.safeParse({ ...record.project, entries });
  if (!project.success) {
    throw new LatexFileError("The resulting project is invalid", 400);
  }
  return updateLatexProject(record._id, {
    baseRevision: record.revision,
    project: project.data,
  });
}

/** Creates or replaces a UTF-8 file at the project's current revision. */
export async function writeLatexFile(
  projectId: string,
  path: string,
  content: string,
) {
  const record = await getLatexProject(projectId);
  const existing = record.project.entries.find((entry) => entry.path === path);
  if (existing && existing.kind !== "file") {
    throw new LatexFileError(`"${path}" is a folder`, 409);
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
  const updated = await saveEntries(record, entries);
  return {
    path,
    action: existing ? ("replaced" as const) : ("created" as const),
    revision: updated.revision,
  };
}

export async function deleteLatexFile(projectId: string, path: string) {
  const record = await getLatexProject(projectId);
  if (path === record.project.mainFile) {
    throw new LatexFileError("The main file cannot be deleted", 409);
  }
  const entries = record.project.entries.filter((entry) => entry.path !== path);
  if (entries.length === record.project.entries.length) {
    throw new LatexFileError(`No entry at "${path}"`, 404);
  }
  const updated = await saveEntries(record, entries);
  return { path, deleted: true, revision: updated.revision };
}
