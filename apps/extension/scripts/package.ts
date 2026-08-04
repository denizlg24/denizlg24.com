/**
 * Produces the three archives a release needs:
 *   - one zip per browser, ready to upload to the Chrome Web Store / AMO
 *   - a source archive, which AMO requires whenever the submitted code was
 *     produced by a bundler (see SOURCE.md for the build steps a reviewer runs)
 */

import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { zipSync } from "fflate";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = resolve(ROOT, "../..");
const RELEASE_DIR = resolve(ROOT, "release");

const TARGETS = ["chrome", "firefox"] as const;

/** 1980-01-01, the earliest timestamp the ZIP format can store. Pinning it keeps
 *  the same build reproducible byte for byte. */
const FIXED_MTIME = Date.UTC(1980, 0, 1);

function collect(dir: string, base = dir): Record<string, Uint8Array> {
  const files: Record<string, Uint8Array> = {};

  for (const name of readdirSync(dir)) {
    const absolute = join(dir, name);
    if (statSync(absolute).isDirectory()) {
      Object.assign(files, collect(absolute, base));
      continue;
    }
    // Zip entries always use forward slashes, on every platform.
    files[relative(base, absolute).split("\\").join("/")] = new Uint8Array(
      readFileSync(absolute),
    );
  }

  return files;
}

function run(command: string, args: string[], cwd: string) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed`);
  }
}

function humanSize(bytes: number) {
  return `${(bytes / 1024).toFixed(0)} kB`;
}

const version = (
  JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8")) as {
    version: string;
  }
).version;

rmSync(RELEASE_DIR, { recursive: true, force: true });
mkdirSync(RELEASE_DIR, { recursive: true });

for (const target of TARGETS) {
  run("bun", ["scripts/build.ts", `--target=${target}`], ROOT);

  const archive = zipSync(collect(resolve(ROOT, "dist", target)), {
    level: 9,
    mtime: FIXED_MTIME,
  });
  const name = `denizlg24-authenticator-${target}-v${version}.zip`;
  writeFileSync(resolve(RELEASE_DIR, name), archive);
  console.log(`${name} — ${humanSize(archive.length)}`);
}

// `git archive` gives exactly the tracked tree, so nothing gitignored (and no
// build output) can leak into the source review.
const sourceName = `denizlg24-authenticator-source-v${version}.zip`;
run(
  "git",
  ["archive", "--format=zip", "-o", join(RELEASE_DIR, sourceName), "HEAD"],
  REPO_ROOT,
);
console.log(
  `${sourceName} — ${humanSize(statSync(resolve(RELEASE_DIR, sourceName)).size)}`,
);
