import {
  SURFACE_CODE_MAX,
  SURFACE_HEAD_MAX,
  type SurfaceSourceRequest,
  type WorkspaceSurface,
} from "@repo/schemas";
import { WorkspaceError } from "./service";

export const SOURCE_FIELDS = ["head", "html", "css", "js"] as const;
type Source = Pick<WorkspaceSurface, (typeof SOURCE_FIELDS)[number]>;

export function readSurfaceSource(
  source: Source,
  input: Extract<SurfaceSourceRequest, { action: "source_read" }>,
) {
  const full = source[input.field];
  const lines = full.split("\n");
  const selected = lines.slice(input.startLine - 1, input.endLine).join("\n");
  const text = selected.slice(input.offset, input.offset + input.maxChars);
  const next = input.offset + text.length;
  return {
    field: input.field,
    totalChars: full.length,
    totalLines: lines.length,
    startLine: input.startLine,
    endLine: Math.min(input.endLine ?? lines.length, lines.length),
    offset: input.offset,
    text,
    nextOffset: next < selected.length ? next : null,
  };
}

export function searchSurfaceSource(
  source: Source,
  input: Extract<SurfaceSourceRequest, { action: "source_search" }>,
) {
  const matches: {
    field: (typeof SOURCE_FIELDS)[number];
    offset: number;
    line: number;
    column: number;
    snippet: string;
  }[] = [];
  let seen = 0;
  for (const field of input.field ? [input.field] : SOURCE_FIELDS) {
    const text = source[field];
    let from = 0;
    let line = 1;
    let lineStart = 0;
    let scanned = 0;
    while (from <= text.length) {
      const at = text.indexOf(input.query, from);
      if (at < 0) break;
      if (seen++ >= input.offset) {
        if (matches.length === input.limit)
          return { matches, nextOffset: input.offset + matches.length };
        for (; scanned < at; scanned++) {
          if (text[scanned] === "\n") {
            line++;
            lineStart = scanned + 1;
          }
        }
        matches.push({
          field,
          offset: at,
          line,
          column: at - lineStart + 1,
          snippet: text.slice(Math.max(0, at - 80), at + 160),
        });
      }
      from = at + 1;
    }
  }
  return { matches, nextOffset: null };
}

/** Prepare every edit before writing anything; duplicate/overlapping matches are refused. */
export function editSurfaceSource(
  source: Source,
  input: Extract<SurfaceSourceRequest, { action: "source_edit" }>,
): Partial<Source> {
  const next = { ...source };
  const patch: Partial<Source> = {};
  for (const [index, edit] of input.edits.entries()) {
    const text = next[edit.field];
    const at = text.indexOf(edit.oldText);
    if (at < 0 || text.indexOf(edit.oldText, at + 1) >= 0) {
      throw new WorkspaceError(
        422,
        "SOURCE_MATCH",
        "oldText must match exactly once",
        {
          editIndex: index,
          field: edit.field,
          reason: at < 0 ? "not_found" : "ambiguous",
        },
      );
    }
    const value =
      text.slice(0, at) + edit.newText + text.slice(at + edit.oldText.length);
    const max = edit.field === "head" ? SURFACE_HEAD_MAX : SURFACE_CODE_MAX;
    if (value.length > max)
      throw new WorkspaceError(
        413,
        "SOURCE_TOO_LARGE",
        `${edit.field} is limited to ${max} characters`,
      );
    next[edit.field] = value;
    patch[edit.field] = value;
  }
  return patch;
}
