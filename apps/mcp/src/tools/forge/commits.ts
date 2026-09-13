import { isRecord, mapResult, type ToolResult } from "../define";

function subjects(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(subjects);
  if (!isRecord(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    out[key] =
      key === "gitMessage" && typeof entry === "string"
        ? (entry.split("\n", 1)[0] ?? "").trimEnd()
        : subjects(entry);
  }
  return out;
}

/**
 * Cuts every deployment's commit message to its subject line. Bodies in this
 * repo run to paragraphs: 18 targets listed at 117 KB, 65 KB of it message
 * bodies, which is past what a tool result can carry. The single-deployment
 * reads keep the full message.
 */
export function withCommitSubjects(result: ToolResult): ToolResult {
  return mapResult(result, subjects);
}
