/**
 * The body of an app's GitHub release: its CHANGELOG.md entry, then the pull
 * requests merged since the app's previous release that touched the app's
 * paths. GitHub's `--generate-notes` lists every PR merged into the monorepo,
 * so a desktop release read like a changelog for Macros and the cloud.
 *
 *   bun scripts/ci/release-notes.ts --version 2.3.3 --tag-prefix v \
 *     --changelog apps/desktop/CHANGELOG.md \
 *     --paths apps/desktop,apps/web,packages/admin [--head <sha>] [--repo owner/name]
 *
 * Standalone on purpose: it runs before `bun install`.
 */

import { readFileSync } from "node:fs";

const readOption = (name: string) => {
  const index = Bun.argv.indexOf(name);
  return index === -1 ? undefined : Bun.argv[index + 1];
};

const required = (name: string) => {
  const value = readOption(name);
  if (!value) {
    console.error(`${name} is required`);
    process.exit(1);
  }
  return value;
};

function git(args: string[]): string {
  const result = Bun.spawnSync(["git", ...args], { stderr: "pipe" });
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")}: ${result.stderr.toString()}`);
  }
  return result.stdout.toString();
}

function isAncestor(ancestor: string, of: string) {
  return (
    Bun.spawnSync(["git", "merge-base", "--is-ancestor", ancestor, of])
      .exitCode === 0
  );
}

export function changelogEntry(markdown: string, wanted: string) {
  const lines = markdown.split(/\r?\n/);
  const escaped = wanted.replaceAll(".", "\\.");
  const heading = new RegExp(`^##\\s+\\[?v?${escaped}\\]?(\\s|$)`);
  const start = lines.findIndex((line) => heading.test(line));
  if (start === -1) return null;
  const end = lines.findIndex(
    (line, index) => index > start && /^##\s/.test(line) && !/^###/.test(line),
  );
  return lines
    .slice(start + 1, end === -1 ? undefined : end)
    .join("\n")
    .trim();
}

function previousTag(tagPrefix: string, currentTag: string, head: string) {
  const tags = git(["tag", "--list", `${tagPrefix}[0-9]*`, "--sort=-v:refname"])
    .split("\n")
    .map((tag) => tag.trim())
    .filter((tag) => tag && tag !== currentTag);
  return tags.find((tag) => isAncestor(tag, head)) ?? null;
}

export function describeCommit(sha: string, subject: string, body: string) {
  const merge = /^Merge pull request #(\d+) from /.exec(subject);
  if (merge) {
    const title = body
      .split("\n")
      .find((line) => line.trim())
      ?.trim();
    return `- ${title || subject} (#${merge[1]})`;
  }
  // A squash merge already ends in its PR number.
  return /\(#\d+\)$/.test(subject)
    ? `- ${subject}`
    : `- ${subject} (${sha.slice(0, 7)})`;
}

function changesSince(tag: string | null, head: string, paths: string[]) {
  const range = tag ? `${tag}..${head}` : head;
  // First parent only: a merged PR is one entry, judged by the diff it brought
  // to main, rather than every commit on its branch.
  const log = git([
    "log",
    "--first-parent",
    "--format=%H%x1f%s%x1f%b%x1e",
    range,
    "--",
    ...paths,
  ]);
  return log
    .split("\x1e")
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [sha = "", subject = "", body = ""] = record.split("\x1f");
      return describeCommit(sha, subject, body);
    });
}

function main() {
  const version = required("--version");
  const tagPrefix = required("--tag-prefix");
  const changelogPath = required("--changelog");
  const paths = required("--paths").split(",").filter(Boolean);
  const head = readOption("--head") ?? "HEAD";
  const repository = readOption("--repo");

  const entry = changelogEntry(readFileSync(changelogPath, "utf-8"), version);
  const since = previousTag(tagPrefix, `${tagPrefix}${version}`, head);
  const changes = changesSince(since, head, paths);

  const sections: string[] = [];
  sections.push(entry ?? `_No entry for ${version} in \`${changelogPath}\`._`);
  if (changes.length > 0) {
    sections.push(`### Pull requests\n\n${changes.join("\n")}`);
  }
  if (since && repository) {
    sections.push(
      `Changes to ${paths.map((path) => `\`${path}\``).join(", ")} since [${since}](https://github.com/${repository}/releases/tag/${since}).`,
    );
  }
  console.log(sections.join("\n\n"));
}

if (import.meta.main) main();
