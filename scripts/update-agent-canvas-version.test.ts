import { afterEach, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  agentVersionFiles,
  bumpAgentVersion,
} from "./update-agent-canvas-version";

const roots: string[] = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "agents-version-"));
  roots.push(root);
  const write = (name: string, text: string) => {
    mkdirSync(join(root, name, ".."), { recursive: true });
    writeFileSync(join(root, name), text);
  };
  write(
    "apps/agent-canvas/src-tauri/tauri.conf.json",
    '{"version":"1.2.3","productName":"Agents"}',
  );
  write(
    "apps/agent-canvas/package.json",
    '{"version":"1.2.3","name":"agent-canvas"}',
  );
  write(
    "apps/agent-canvas/src-tauri/Cargo.toml",
    '[package]\nname = "agent-canvas"\nversion = "1.2.3"\n[dependencies]\nserde = "1"\n',
  );
  write(
    "apps/agent-canvas/src-tauri/Cargo.lock",
    '[[package]]\nname = "agent-canvas"\nversion = "1.2.3"\n\n[[package]]\nname = "other"\nversion = "9.9.9"\n',
  );
  write(
    "bun.lock",
    '{"workspaces":{"apps/agent-canvas":{"name":"agent-canvas","version":"1.2.3",},},}',
  );
  write(
    "apps/agent-canvas/CHANGELOG.md",
    "# Agents\n\n## 1.2.3 — 2026-01-01\n\nFirst release.\n",
  );
  return root;
}
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
for (const [bump, expected] of [
  ["major", "2.0.0"],
  ["minor", "1.3.0"],
  ["patch", "1.2.4"],
])
  test(`${bump} synchronizes manifests and lockfiles`, () => {
    const root = fixture();
    expect(bumpAgentVersion(root, bump)).toBe(expected);
    expect(agentVersionFiles(root).version).toBe(expected);
    expect(
      readFileSync(
        join(root, "apps/agent-canvas/src-tauri/Cargo.lock"),
        "utf8",
      ),
    ).toContain('name = "other"\nversion = "9.9.9"');
    expect(
      readFileSync(join(root, "apps/agent-canvas/CHANGELOG.md"), "utf8"),
    ).toContain(`## ${expected}`);
  });
test("rejects drift and invalid bumps before writing", () => {
  const root = fixture();
  const path = join(root, "apps/agent-canvas/src-tauri/tauri.conf.json");
  const before = readFileSync(path, "utf8");
  expect(() => bumpAgentVersion(root, "prerelease")).toThrow("Usage:");
  writeFileSync(
    join(root, "apps/agent-canvas/src-tauri/Cargo.lock"),
    '[[package]]\nname = "agent-canvas"\nversion = "0.0.0"\n',
  );
  expect(() => bumpAgentVersion(root, "patch")).toThrow("Version mismatch");
  expect(readFileSync(path, "utf8")).toBe(before);
});
