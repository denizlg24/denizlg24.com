import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ChangelogRelease } from "@repo/schemas";
import { parseChangelog } from "@repo/utils/changelog";

/**
 * The app's own changelog, read at build: the page and the route that serve it
 * are static, and the standalone server never ships the file.
 */
export async function loadChangelog(): Promise<ChangelogRelease[]> {
  const markdown = await readFile(
    join(process.cwd(), "..", "macros-mobile", "CHANGELOG.md"),
    "utf8",
  );
  return parseChangelog(markdown);
}
