import { describe, expect, it } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { changelogEntry, describeCommit } from "./release-notes";

describe("changelogEntry", () => {
  const markdown = `# Changelog

## 2.3.3 — 2026-10-05

### Added
- Release notes

## 2.3.2 — 2026-10-01
- older
`;

  it("returns the version's body without its heading", () => {
    expect(changelogEntry(markdown, "2.3.3")).toBe(
      "### Added\n- Release notes",
    );
    expect(changelogEntry(markdown, "2.3.2")).toBe("- older");
  });

  it("does not match a longer version by prefix", () => {
    expect(changelogEntry(markdown, "2.3")).toBeNull();
  });
});

describe("describeCommit", () => {
  it("names a merged PR by its title and number", () => {
    expect(
      describeCommit(
        "92ee51b6aaaa",
        "Merge pull request #233 from denizlg24/fix/hours-mobile-ui",
        "fix(hours): rework the hours PWA for phones\n",
      ),
    ).toBe("- fix(hours): rework the hours PWA for phones (#233)");
  });

  it("keeps a squash merge's number and labels a direct push by sha", () => {
    expect(describeCommit("abc1234def", "feat(web): x (#12)", "")).toBe(
      "- feat(web): x (#12)",
    );
    expect(describeCommit("abc1234def", "chore(web): y", "")).toBe(
      "- chore(web): y (abc1234)",
    );
  });
});

it("Agents release notes exclude unrelated shared UI history", () => {
  const root = mkdtempSync(join(tmpdir(), "agents-release-notes-"));
  const git = (...args: string[]) => {
    const result = Bun.spawnSync(["git", ...args], {
      cwd: root,
      stderr: "pipe",
    });
    if (result.exitCode !== 0) throw new Error(result.stderr.toString());
  };
  const commit = (message: string) => {
    git("add", ".");
    git(
      "-c",
      "user.name=Release test",
      "-c",
      "user.email=test@example.com",
      "commit",
      "-m",
      message,
    );
  };
  try {
    git("init", "-q");
    mkdirSync(join(root, "packages/ui"), { recursive: true });
    writeFileSync(join(root, "packages/ui/theme.css"), "old UI");
    commit("Unrelated old shared UI (#77)");
    mkdirSync(join(root, "apps/agent-canvas"), { recursive: true });
    writeFileSync(
      join(root, "apps/agent-canvas/CHANGELOG.md"),
      "# Agents\n\n## 0.1.0\n\nFirst canvas\n",
    );
    commit("Add Agents canvas (#361)");
    writeFileSync(join(root, "packages/ui/theme.css"), "new UI");
    commit("Unrelated new shared UI (#400)");
    // Exercise the exact path scope configured by the Agents workflow.
    const workflow = readFileSync(
      new URL("../../.github/workflows/agent-canvas.yml", import.meta.url),
      "utf8",
    );
    const scope = /--paths\s+(\S+)/.exec(workflow)?.[1];
    expect(scope).toBe("apps/agent-canvas");
    const result = Bun.spawnSync(
      [
        process.execPath,
        join(import.meta.dir, "release-notes.ts"),
        "--version",
        "0.1.0",
        "--tag-prefix",
        "agents-v",
        "--changelog",
        "apps/agent-canvas/CHANGELOG.md",
        "--paths",
        scope!,
        "--head",
        "HEAD",
      ],
      { cwd: root, stderr: "pipe" },
    );
    expect(result.exitCode).toBe(0);
    const notes = result.stdout.toString();
    expect(notes).toContain("Add Agents canvas (#361)");
    expect(notes).not.toContain("#77");
    expect(notes).not.toContain("#400");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
