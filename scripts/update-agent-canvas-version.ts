import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { addChangelogStub } from "./changelog-stub";

const app = "apps/agent-canvas";
const semver = /^\d+\.\d+\.\d+$/;
const cargoVersion = /(^\[package\][\s\S]*?^version = ")([^"]+)(")/m;
const lockVersion =
  /(^\[\[package\]\]\nname = "agent-canvas"\nversion = ")([^"]+)(")/m;
const bunVersion =
  /("apps\/agent-canvas":\s*\{\s*"name":\s*"agent-canvas",\s*"version":\s*")([^"]+)(")/;

/** Check every manifest before writing any of them. */
export function agentVersionFiles(root: string) {
  const configPath = `${app}/src-tauri/tauri.conf.json`;
  const packagePath = `${app}/package.json`;
  const text = (path: string) => readFileSync(resolve(root, path), "utf8");
  const config = JSON.parse(text(configPath));
  const manifest = JSON.parse(text(packagePath));
  const version: string = config.version;
  if (!semver.test(version))
    throw new Error("Agents version must be major.minor.patch");
  const sources = [
    { path: `${app}/src-tauri/Cargo.toml`, pattern: cargoVersion },
    { path: `${app}/src-tauri/Cargo.lock`, pattern: lockVersion },
    { path: "bun.lock", pattern: bunVersion },
  ].map((file) => {
    const content = text(file.path);
    if (file.pattern.exec(content)?.[2] !== version) {
      throw new Error(`Version mismatch in ${file.path}; expected ${version}`);
    }
    return { ...file, content };
  });
  if (manifest.version !== version)
    throw new Error(`Version mismatch in ${packagePath}`);
  return { version, configPath, packagePath, config, manifest, sources };
}

export function bumpAgentVersion(root: string, bump: string) {
  if (!["major", "minor", "patch"].includes(bump)) {
    throw new Error(
      "Usage: bun run bump:agents major|minor|patch (or --check)",
    );
  }
  const files = agentVersionFiles(root);
  const [major, minor, patch] = files.version.split(".").map(Number);
  const next =
    bump === "major"
      ? `${major + 1}.0.0`
      : bump === "minor"
        ? `${major}.${minor + 1}.0`
        : `${major}.${minor}.${patch + 1}`;
  // Read the changelog first so a missing file cannot leave a partial bump.
  const changelog = resolve(root, app, "CHANGELOG.md");
  readFileSync(changelog, "utf8");
  const writes = [
    {
      path: files.configPath,
      content: `${JSON.stringify({ ...files.config, version: next }, null, 2)}\n`,
    },
    {
      path: files.packagePath,
      content: `${JSON.stringify({ ...files.manifest, version: next }, null, 2)}\n`,
    },
    ...files.sources.map((file) => ({
      path: file.path,
      content: file.content.replace(file.pattern, `$1${next}$3`),
    })),
  ];
  for (const file of writes)
    writeFileSync(resolve(root, file.path), file.content);
  addChangelogStub(changelog, next);
  return next;
}

if (import.meta.main) {
  const root = resolve(import.meta.dir, "..");
  if (process.argv[2] === "--check")
    console.log(
      `Agents ${agentVersionFiles(root).version}: all manifests agree`,
    );
  else
    console.log(
      `Agents ${bumpAgentVersion(root, process.argv[2])}: describe the release in ${app}/CHANGELOG.md`,
    );
}
