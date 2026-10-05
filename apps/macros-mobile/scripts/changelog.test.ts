import { describe, expect, it } from "bun:test";
import { parseChangelog } from "@repo/utils/changelog";
import packageJson from "../package.json";

describe("CHANGELOG.md", () => {
  it("has an entry for the version being released", async () => {
    const markdown = await Bun.file(
      new URL("../CHANGELOG.md", import.meta.url),
    ).text();
    const versions = parseChangelog(markdown).map((release) => release.version);
    expect(versions).toContain(packageJson.version);
  });
});
