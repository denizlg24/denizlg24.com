// Replaces the dynamically-linked tectonic shipped by
// @node-latex-compiler/bin-linux-x64 with the statically-linked musl build.
//
// The bundled Linux binary links against libgraphite2.so.3 (and the rest of the
// HarfBuzz/ICU/FreeType stack), none of which exist on the Vercel Lambda runtime
// (Amazon Linux), so /api/admin/cv/compile fails with:
//   error while loading shared libraries: libgraphite2.so.3
//
// The upstream x86_64-unknown-linux-musl release is a fully static ET_EXEC with
// zero shared-object dependencies, so it runs anywhere. We overwrite the exact
// file node-latex-compiler's resolver returns (the real binary in the bun store,
// which is also what gets traced into the function bundle).
//
// Runs from the root postinstall. Best-effort by design: it no-ops off linux/x64
// and when the target is already patched, and every failure path warns and exits
// 0 so a resolution miss or a transient download error can never break the whole
// deploy — it only overwrites after both checksums verify.

import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const TECTONIC_VERSION = "0.16.9";
const TARBALL_URL = `https://github.com/tectonic-typesetting/tectonic/releases/download/tectonic%40${TECTONIC_VERSION}/tectonic-${TECTONIC_VERSION}-x86_64-unknown-linux-musl.tar.gz`;
const TARBALL_SHA256 =
  "60b13a0826ae7ad9ce34b4a2df06bff2cfcfa6dda8a915477c0cbb84e1a4a902";
const BINARY_SHA256 =
  "397efac4cabf7dfa02f238fe23681215b535ea665e99ba27d123b8bc655b88cb";
const BINARY_NAME = "tectonic";
const BIN_PACKAGE_PREFIX = "@node-latex-compiler+bin-linux-x64@";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");

function log(message) {
  process.stdout.write(`[fetch-tectonic] ${message}\n`);
}

function warn(message) {
  process.stderr.write(`[fetch-tectonic] ${message}\n`);
}

// node-latex-compiler is an apps/web dependency and is not hoisted to the repo
// root, so we anchor resolution there and let its own resolver return the store
// path of the bundled binary.
function resolveViaPackage() {
  try {
    const require = createRequire(join(REPO_ROOT, "apps/web/package.json"));
    const resolver = require("node-latex-compiler/lib/platform-resolver");
    return resolver.resolveBundledTectonic() || null;
  } catch {
    return null;
  }
}

// Fallback: scan the bun store directly for the linux bin package.
function resolveViaStore() {
  const storeDir = join(REPO_ROOT, "node_modules", ".bun");
  let entries;
  try {
    entries = readdirSync(storeDir);
  } catch {
    return null;
  }
  const match = entries.find((entry) => entry.startsWith(BIN_PACKAGE_PREFIX));
  if (!match) return null;
  const candidate = join(
    storeDir,
    match,
    "node_modules",
    "@node-latex-compiler",
    "bin-linux-x64",
    "bin",
    BINARY_NAME,
  );
  return existsSync(candidate) ? candidate : null;
}

function extractBinary(gzip) {
  const tar = gunzipSync(gzip);
  for (let offset = 0; offset + 512 <= tar.length; ) {
    const header = tar.subarray(offset, offset + 512);
    const name = header.subarray(0, 100).toString("utf8").replace(/\0.*$/, "");
    if (name === "") break;
    const size =
      Number.parseInt(
        header.subarray(124, 136).toString("utf8").replace(/\0.*$/, "").trim(),
        8,
      ) || 0;
    const dataStart = offset + 512;
    if (name.split("/").pop() === BINARY_NAME && size > 0) {
      return tar.subarray(dataStart, dataStart + size);
    }
    offset = dataStart + Math.ceil(size / 512) * 512;
  }
  return null;
}

async function main() {
  if (process.platform !== "linux" || process.arch !== "x64") return;

  const target = resolveViaPackage() ?? resolveViaStore();
  if (!target) {
    warn(
      "bundled linux tectonic not found; skipping patch (compile route may fail).",
    );
    return;
  }

  if (existsSync(target) && sha256(readFileSync(target)) === BINARY_SHA256) {
    log("static tectonic already installed, skipping.");
    return;
  }

  log(`downloading ${TARBALL_URL}`);
  let tarball;
  try {
    const response = await fetch(TARBALL_URL);
    if (!response.ok) {
      warn(`download failed: HTTP ${response.status}; skipping patch.`);
      return;
    }
    tarball = Buffer.from(await response.arrayBuffer());
  } catch (error) {
    warn(`download error: ${error?.message ?? error}; skipping patch.`);
    return;
  }

  const tarballDigest = sha256(tarball);
  if (tarballDigest !== TARBALL_SHA256) {
    warn(
      `tarball sha256 mismatch (expected ${TARBALL_SHA256}, got ${tarballDigest}); skipping patch.`,
    );
    return;
  }

  const binary = extractBinary(tarball);
  if (!binary) {
    warn(`could not find '${BINARY_NAME}' entry in tarball; skipping patch.`);
    return;
  }
  const binaryDigest = sha256(binary);
  if (binaryDigest !== BINARY_SHA256) {
    warn(
      `binary sha256 mismatch (expected ${BINARY_SHA256}, got ${binaryDigest}); skipping patch.`,
    );
    return;
  }

  writeFileSync(target, binary);
  chmodSync(target, 0o755);
  log(`patched ${target}`);
}

main().catch((error) => {
  warn(`unexpected error: ${error?.stack ?? error}; skipping patch.`);
});
