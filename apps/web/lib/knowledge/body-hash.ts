import { createHash } from "node:crypto";

/**
 * Hash of a chunk's quoted passage, the identity study items are checked
 * against. Chunks stored before `bodyHash` existed compute it from the body,
 * which yields the value the next reindex writes.
 */
export function bodyHashOf(chunk: { body: string; bodyHash?: string }): string {
  return (
    chunk.bodyHash ?? createHash("sha256").update(chunk.body).digest("hex")
  );
}
