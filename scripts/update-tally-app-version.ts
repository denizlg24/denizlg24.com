import fs from "node:fs";
import path from "node:path";
import { addChangelogStub } from "./changelog-stub";

const appDirectory = path.join(__dirname, "..", "apps", "tally-macos");
const projectFile = path.join(appDirectory, "project.yml");
const changelogFile = path.join(appDirectory, "CHANGELOG.md");

const versionPattern = /^(\s*MARKETING_VERSION:\s*)"(\d+\.\d+\.\d+)"$/m;

const bumpVersion = (prevVersion: string, versionBump: string): string => {
  const [major, minor, patch] = prevVersion.split(".").map(Number);
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
  const project = fs.readFileSync(projectFile, "utf-8");
  const match = versionPattern.exec(project);
  if (!match) {
    console.error(`No MARKETING_VERSION in ${projectFile}`);
    process.exit(1);
  }
  const prevVersion = match[2];

  const versionBump = process.argv[2];
  if (!versionBump) {
    console.error("Please provide a version bump as an argument.");
    process.exit(1);
  }

  const newVersion = bumpVersion(prevVersion, versionBump);
  fs.writeFileSync(
    projectFile,
    project.replace(versionPattern, `$1"${newVersion}"`),
  );
  const stubbed = addChangelogStub(changelogFile, newVersion);

  console.log(
    `Updated Tally from ${prevVersion} to ${newVersion} in project.yml${
      stubbed
        ? "; describe it in CHANGELOG.md"
        : "; CHANGELOG.md already has its entry"
    }`,
  );
}

main();
