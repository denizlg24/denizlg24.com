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
// file node-latex-compiler's resolver returns, which is also the path
// next.config.ts traces into the function via outputFileTracingIncludes.
//
// Runs from the root postinstall. No-ops off linux/x64 and when the target
// already holds the patched binary, so repeated installs and local dev on other
// platforms are unaffected.

import { createHash } from "node:crypto";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { gunzipSync } from "node:zlib";

const TECTONIC_VERSION = "0.16.9";
const TARBALL_URL = `https://github.com/tectonic-typesetting/tectonic/releases/download/tectonic%40${TECTONIC_VERSION}/tectonic-${TECTONIC_VERSION}-x86_64-unknown-linux-musl.tar.gz`;
const TARBALL_SHA256 =
  "60b13a0826ae7ad9ce34b4a2df06bff2cfcfa6dda8a915477c0cbb84e1a4a902";
const BINARY_SHA256 =
  "397efac4cabf7dfa02f238fe23681215b535ea665e99ba27d123b8bc655b88cb";
const BINARY_NAME = "tectonic";

const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");

function log(message) {
  process.stdout.write(`[fetch-tectonic] ${message}\n`);
}

function fail(message) {
  process.stderr.write(`[fetch-tectonic] ${message}\n`);
  process.exit(1);
}

function resolveTarget() {
  const require = createRequire(import.meta.url);
  try {
    const resolver = require("node-latex-compiler/lib/platform-resolver");
    const resolved = resolver.resolveBundledTectonic();
    if (resolved) return resolved;
  } catch {
    // fall through to direct package resolution
  }
  try {
    const pkgJson = require.resolve(
      "@node-latex-compiler/bin-linux-x64/package.json",
    );
    return join(dirname(pkgJson), "bin", BINARY_NAME);
  } catch {
    return null;
  }
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

  const target = resolveTarget();
  if (!target) {
    fail(
      "@node-latex-compiler/bin-linux-x64 not found; cannot patch tectonic binary.",
    );
  }

  if (existsSync(target) && sha256(readFileSync(target)) === BINARY_SHA256) {
    log("static tectonic already installed, skipping.");
    return;
  }

  log(`downloading ${TARBALL_URL}`);
  const response = await fetch(TARBALL_URL);
  if (!response.ok) {
    fail(`download failed: HTTP ${response.status}`);
  }
  const tarball = Buffer.from(await response.arrayBuffer());
  const tarballDigest = sha256(tarball);
  if (tarballDigest !== TARBALL_SHA256) {
    fail(
      `tarball sha256 mismatch: expected ${TARBALL_SHA256}, got ${tarballDigest}`,
    );
  }

  const binary = extractBinary(tarball);
  if (!binary) {
    fail(`could not find '${BINARY_NAME}' entry in tarball.`);
  }
  const binaryDigest = sha256(binary);
  if (binaryDigest !== BINARY_SHA256) {
    fail(
      `binary sha256 mismatch: expected ${BINARY_SHA256}, got ${binaryDigest}`,
    );
  }

  writeFileSync(target, binary);
  chmodSync(target, 0o755);
  log(`patched ${target}`);
}

main().catch((error) => fail(error?.stack ?? String(error)));
