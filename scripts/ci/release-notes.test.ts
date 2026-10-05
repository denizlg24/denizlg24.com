import { describe, expect, it } from "bun:test";
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
