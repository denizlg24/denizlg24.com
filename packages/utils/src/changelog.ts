import type {
  ChangelogInline,
  ChangelogRelease,
  ChangelogSection,
} from "@repo/schemas";

/**
 * The subset of Markdown a changelog needs, parsed once into a structure each
 * app renders with its own typography (Macros' site and app, the desktop app):
 *
 *   ## 0.0.10 — 2026-10-05      a release (date optional; `-`, `–` or `—`)
 *   ### Fixed                   a group inside it
 *   - **Search** works as you type, see [notes](https://…)
 *     continued on an indented line
 *   A plain paragraph.
 *
 * Anything above the first release (the `# Changelog` title, an intro) is
 * ignored. Unknown syntax is kept as literal text rather than dropped.
 */
export function parseChangelog(markdown: string): ChangelogRelease[] {
  const releases: ChangelogRelease[] = [];
  let release: ChangelogRelease | null = null;
  let section: ChangelogSection | null = null;
  let paragraph: string[] = [];
  let list: string[] | null = null;

  const flush = () => {
    if (!section) return;
    if (paragraph.length > 0) {
      section.blocks.push({
        type: "paragraph",
        content: parseInline(paragraph.join(" ")),
      });
      paragraph = [];
    }
    if (list) {
      section.blocks.push({ type: "list", items: list.map(parseInline) });
      list = null;
    }
  };

  const openSection = (title: string | null) => {
    if (!release) return null;
    const next: ChangelogSection = { title, blocks: [] };
    release.sections.push(next);
    return next;
  };

  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trimEnd();
    const releaseHeading = /^##\s+(.+)$/.exec(line);
    if (releaseHeading?.[1] && !line.startsWith("###")) {
      flush();
      release = parseReleaseHeading(releaseHeading[1]);
      releases.push(release);
      section = null;
      continue;
    }
    if (!release) continue;

    const groupHeading = /^###\s+(.+)$/.exec(line);
    if (groupHeading?.[1]) {
      flush();
      section = openSection(groupHeading[1].trim());
      continue;
    }
    if (line.trim() === "") {
      flush();
      continue;
    }

    section ??= openSection(null);
    const bullet = /^[-*]\s+(.*)$/.exec(line);
    if (bullet) {
      if (paragraph.length > 0) flush();
      list ??= [];
      list.push(bullet[1] ?? "");
      continue;
    }
    const last = list ? list.length - 1 : -1;
    if (list && last >= 0 && /^\s{2,}\S/.test(line)) {
      list[last] = `${list[last]} ${line.trim()}`;
      continue;
    }
    if (list) flush();
    paragraph.push(line.trim());
  }
  flush();

  for (const entry of releases) {
    entry.sections = entry.sections.filter(
      (candidate) => candidate.blocks.length > 0,
    );
  }
  return releases;
}

function parseReleaseHeading(text: string): ChangelogRelease {
  const match =
    /^\[?v?([^\]\s]+)\]?(?:\s*[—–-]\s*|\s+\()?(\d{4}-\d{2}-\d{2})?\)?\s*$/.exec(
      text.trim(),
    );
  return {
    version: match?.[1] ?? text.trim(),
    date: match?.[2] ?? null,
    sections: [],
  };
}

const INLINE = /\*\*(.+?)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)/g;

export function parseInline(text: string): ChangelogInline[] {
  const tokens: ChangelogInline[] = [];
  const pushText = (value: string) => {
    if (!value) return;
    const previous = tokens.at(-1);
    if (previous?.type === "text") previous.text += value;
    else tokens.push({ type: "text", text: value });
  };

  let cursor = 0;
  for (const match of text.matchAll(INLINE)) {
    pushText(text.slice(cursor, match.index));
    const [, strong, code, label, href] = match;
    if (strong !== undefined) tokens.push({ type: "strong", text: strong });
    else if (code !== undefined) tokens.push({ type: "code", text: code });
    else if (label !== undefined && href !== undefined)
      tokens.push({ type: "link", text: label, href });
    cursor = match.index + match[0].length;
  }
  pushText(text.slice(cursor));
  return tokens;
}

/**
 * Orders dotted versions numerically (`0.0.10` after `0.0.9`). A version that
 * is not dotted numbers (`Unreleased`) sorts after every numbered one.
 */
export function compareVersions(left: string, right: string): number {
  const parse = (version: string) =>
    /^\d+(\.\d+)*$/.test(version) ? version.split(".").map(Number) : null;
  const a = parse(left);
  const b = parse(right);
  if (!a || !b) return a ? -1 : b ? 1 : 0;
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return Math.sign(difference);
  }
  return 0;
}
