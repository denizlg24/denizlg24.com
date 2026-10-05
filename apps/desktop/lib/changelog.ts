import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ChangelogRelease } from "@repo/schemas";
import { parseChangelog } from "@repo/utils/changelog";

/**
 * Read at build: the app is a static export, so each build carries the notes
 * up to its own version and the updater announces anything newer.
 */
export async function loadDesktopChangelog(): Promise<ChangelogRelease[]> {
  const markdown = await readFile(join(process.cwd(), "CHANGELOG.md"), "utf8");
  return parseChangelog(markdown);
}
