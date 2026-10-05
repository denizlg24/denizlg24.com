import fs from "node:fs";

/**
 * Opens a `## <version> — <today>` entry at the top of a changelog, above the
 * newest release, for the bump to be described in. A version that already has
 * an entry is left alone, so writing the notes first and bumping after works.
 */
export function addChangelogStub(file: string, version: string) {
  const markdown = fs.readFileSync(file, "utf-8");
  const escaped = version.replaceAll(".", "\\.");
  if (new RegExp(`^##\\s+\\[?v?${escaped}\\b`, "m").test(markdown)) {
    return false;
  }
  const today = new Date().toISOString().slice(0, 10);
  const stub = `## ${version} — ${today}\n\n### Changed\n- \n\n`;
  const firstRelease = markdown.search(/^##\s/m);
  const next =
    firstRelease === -1
      ? `${markdown.trimEnd()}\n\n${stub}`
      : `${markdown.slice(0, firstRelease)}${stub}${markdown.slice(firstRelease)}`;
  fs.writeFileSync(file, next);
  return true;
}
