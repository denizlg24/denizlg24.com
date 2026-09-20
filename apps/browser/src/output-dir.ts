import { readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";

/**
 * Playwright MCP writes every snapshot, screenshot and PDF it returns into
 * the output directory as well, and nothing else ever reads them back — the
 * agent got the bytes in the tool result. Anything older than `maxAgeMs` is
 * removed, files and session directories alike.
 */
export async function sweepOutputDir(
  dir: string,
  maxAgeMs: number,
  now = Date.now(),
): Promise<string[]> {
  const removed: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const path = join(dir, entry.name);
    const info = await stat(path).catch(() => null);
    if (!info || now - info.mtimeMs < maxAgeMs) continue;
    await rm(path, { recursive: true, force: true }).catch(() => undefined);
    removed.push(entry.name);
  }
  return removed;
}
