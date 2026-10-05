import fs from "node:fs";
import path from "node:path";
import { addChangelogStub } from "./changelog-stub";

const appDir = path.join(__dirname, "..", "apps", "macros-mobile");
const packageJsonFile = path.join(appDir, "package.json");
const changelogFile = path.join(appDir, "CHANGELOG.md");

const bumpVersion = (prevVersion: string, versionBump: string): string => {
  const [major = 0, minor = 0, patch = 0] = prevVersion.split(".").map(Number);
  switch (versionBump) {
    case "major":
      return `${major + 1}.0.0`;
    case "minor":
      return `${major}.${minor + 1}.0`;
    case "patch":
      return `${major}.${minor}.${patch + 1}`;
    default:
      throw new Error(`Invalid version bump: ${versionBump}`);
  }
};

function main() {
  const versionBump = process.argv[2];
  if (!versionBump) {
    console.error("Usage: bun run bump:macros <major|minor|patch>");
    process.exit(1);
  }

  // Rewritten in place rather than re-serialised, so the file keeps its
  // formatting and the diff is one line.
  const packageJson = fs.readFileSync(packageJsonFile, "utf-8");
  const current = /"version":\s*"([^"]+)"/.exec(packageJson)?.[1];
  if (!current) throw new Error(`No version in ${packageJsonFile}`);
  const next = bumpVersion(current, versionBump);
  fs.writeFileSync(
    packageJsonFile,
    packageJson.replace(/"version":\s*"[^"]+"/, `"version": "${next}"`),
  );

  const stubbed = addChangelogStub(changelogFile, next);
  console.log(
    `Updated Macros from ${current} to ${next} in package.json${
      stubbed
        ? "; describe it in CHANGELOG.md"
        : "; CHANGELOG.md already has its entry"
    }`,
  );
}

main();
