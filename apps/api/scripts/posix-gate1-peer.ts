import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  link,
  lstat,
  open,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";

const ROOT_MARKER = ".posix-gate1-disposable";
const ROOT_MARKER_CONTENT = "deniz-cloud-posix-gate1\n";
const CONTROL_MARKER = ".posix-gate1-control";
const MAX_BYTES = 32 * 1024 * 1024;
const DEFAULT_BYTES = 1024 * 1024;
const MAX_HOLD_MS = 15_000;
const MAX_ITERATIONS = 200;
const MAX_TOTAL_LOOP_MS = 15_000;
const MAX_LOG_BYTES = 64 * 1024;
const CHUNK_BYTES = 256 * 1024;
const RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const GENERATION = /^[A-Z0-9_-]{1,16}$/;

const PROTECTED_ROOTS = [
  "/",
  "/data/hdd",
  "/data/ssd",
  "/mnt/hdd/storage",
  "/mnt/ssd/storage",
  "/opt/deniz-cloud",
  "/srv/deniz-cloud/storage",
] as const;

export const PEER_ACTIONS = [
  "seed",
  "atomic-replace",
  "rename",
  "unlink",
  "hold-read",
  "snapshot-loop",
  "inject-test-link",
] as const;

export type PeerAction = (typeof PEER_ACTIONS)[number];
export type PeerTarget = "payload" | "renamed";

export interface PeerArguments {
  action: PeerAction;
  bytes: number;
  controlDir?: string;
  delayMs: number;
  dryRun: boolean;
  expectedGenerations: string[];
  generation?: string;
  holdMs: number;
  iterations: number;
  logPath?: string;
  root: string;
  runId: string;
  target: PeerTarget;
}

export interface PeerResult {
  action: PeerAction;
  details: Record<
    string,
    boolean | number | string | Record<string, number> | Record<string, string>
  >;
  dryRun: boolean;
  errorCode?: string;
  ok: boolean;
  peer: "posix-gate1";
  runId: string;
}

export interface PeerHooks {
  onReady?: (event: PeerResult) => Promise<void> | void;
}

export class PeerSafetyError extends Error {}

function valueAfter(argv: readonly string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  if (index === -1) return undefined;
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new PeerSafetyError(`${flag} requires a value`);
  }
  return value;
}

function integerFlag(
  argv: readonly string[],
  flag: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const raw = valueAfter(argv, flag);
  if (raw === undefined) return fallback;
  if (!/^\d+$/.test(raw))
    throw new PeerSafetyError(`${flag} must be an integer`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new PeerSafetyError(
      `${flag} must be between ${minimum} and ${maximum}`,
    );
  }
  return value;
}

function parseAction(value: string | undefined): PeerAction {
  if (!value || !(PEER_ACTIONS as readonly string[]).includes(value)) {
    throw new PeerSafetyError(
      `--action must be one of ${PEER_ACTIONS.join(",")}`,
    );
  }
  return value as PeerAction;
}

export function parsePeerArguments(argv: readonly string[]): PeerArguments {
  const execute = argv.includes("--execute");
  const explicitDryRun = argv.includes("--dry-run");
  if (execute && explicitDryRun) {
    throw new PeerSafetyError("Choose either --dry-run or --execute, not both");
  }
  const action = parseAction(valueAfter(argv, "--action"));
  const root = valueAfter(argv, "--root");
  if (!root) throw new PeerSafetyError("--root is required");
  const rawRunId = valueAfter(argv, "--run-id");
  const runId = rawRunId?.toLowerCase();
  if (!runId || !RUN_ID.test(runId)) {
    throw new PeerSafetyError("--run-id must be a canonical UUID");
  }
  const generation = valueAfter(argv, "--generation")?.toUpperCase();
  if (generation && !GENERATION.test(generation)) {
    throw new PeerSafetyError("--generation is invalid");
  }
  const expectedGenerations = (valueAfter(argv, "--expected-generations") ?? "")
    .split(",")
    .filter(Boolean)
    .map((value) => value.toUpperCase());
  if (
    expectedGenerations.length > 4 ||
    expectedGenerations.some((value) => !GENERATION.test(value))
  ) {
    throw new PeerSafetyError("--expected-generations is invalid");
  }
  const target = valueAfter(argv, "--target") ?? "payload";
  if (target !== "payload" && target !== "renamed") {
    throw new PeerSafetyError("--target must be payload or renamed");
  }

  const known = new Set([
    "--action",
    "--bytes",
    "--control-dir",
    "--delay-ms",
    "--dry-run",
    "--execute",
    "--expected-generations",
    "--generation",
    "--hold-ms",
    "--iterations",
    "--log",
    "--root",
    "--run-id",
    "--target",
  ]);
  const valueFlags = new Set(
    [...known].filter((flag) => !["--dry-run", "--execute"].includes(flag)),
  );
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument?.startsWith("--")) {
      throw new PeerSafetyError(
        `Unexpected positional argument: ${argument ?? ""}`,
      );
    }
    if (!known.has(argument))
      throw new PeerSafetyError(`Unknown option: ${argument}`);
    if (valueFlags.has(argument)) index += 1;
  }

  if ((action === "seed" || action === "atomic-replace") && !generation) {
    throw new PeerSafetyError(`${action} requires --generation`);
  }
  if (action === "snapshot-loop" && expectedGenerations.length === 0) {
    throw new PeerSafetyError("snapshot-loop requires --expected-generations");
  }
  const controlDir = valueAfter(argv, "--control-dir");
  if (action === "hold-read" && !controlDir) {
    throw new PeerSafetyError("hold-read requires --control-dir");
  }

  const bytes = integerFlag(argv, "--bytes", DEFAULT_BYTES, 1024, MAX_BYTES);
  const delayMs = integerFlag(argv, "--delay-ms", 10, 0, 1000);
  const holdMs = integerFlag(argv, "--hold-ms", 5000, 1, MAX_HOLD_MS);
  const iterations = integerFlag(argv, "--iterations", 25, 1, MAX_ITERATIONS);
  if (delayMs * iterations > MAX_TOTAL_LOOP_MS) {
    throw new PeerSafetyError(
      "snapshot-loop duration exceeds the bounded limit",
    );
  }

  return {
    action,
    bytes,
    controlDir,
    delayMs,
    dryRun: !execute,
    expectedGenerations,
    generation,
    holdMs,
    iterations,
    logPath: valueAfter(argv, "--log"),
    root,
    runId,
    target,
  };
}

function atOrInside(parent: string, candidate: string): boolean {
  const remainder = relative(parent, candidate);
  return (
    remainder === "" ||
    (remainder !== ".." &&
      !remainder.startsWith(`..${sep}`) &&
      !isAbsolute(remainder))
  );
}

function assertNotProtected(path: string): void {
  for (const protectedRoot of PROTECTED_ROOTS) {
    if (
      (protectedRoot === "/" && path === "/") ||
      (protectedRoot !== "/" && atOrInside(protectedRoot, path))
    ) {
      throw new PeerSafetyError(
        "Path overlaps a protected production location",
      );
    }
  }
}

async function assertCanonicalDirectory(path: string): Promise<string> {
  if (!isAbsolute(path)) throw new PeerSafetyError("Path must be absolute");
  const requested = resolve(path);
  assertNotProtected(requested);
  const requestedInfo = await lstat(requested);
  if (!requestedInfo.isDirectory() || requestedInfo.isSymbolicLink()) {
    throw new PeerSafetyError("Path must be a real directory");
  }
  const canonical = await realpath(requested);
  assertNotProtected(canonical);
  const components = canonical.split(sep).filter(Boolean);
  let current: string = sep;
  for (const component of components) {
    current = join(current, component);
    if ((await lstat(current)).isSymbolicLink()) {
      throw new PeerSafetyError("Path has a symlink component");
    }
  }
  return canonical;
}

async function validatePeerRoot(options: PeerArguments): Promise<string> {
  const root = await assertCanonicalDirectory(options.root);
  if (basename(root) !== `posix-gate1-disposable-${options.runId}`) {
    throw new PeerSafetyError("Peer root name does not match its run ID");
  }
  const entries = await readdir(root);
  const allowed = new Set([ROOT_MARKER, "payload.bin", "renamed.bin"]);
  if (entries.some((entry) => !allowed.has(entry))) {
    throw new PeerSafetyError("Peer root contains an unexpected entry");
  }
  const marker = await lstat(join(root, ROOT_MARKER)).catch(() => null);
  if (!marker?.isFile() || marker.isSymbolicLink()) {
    throw new PeerSafetyError("Peer root marker is missing or unsafe");
  }
  if (
    (await readFile(join(root, ROOT_MARKER), "utf8")) !== ROOT_MARKER_CONTENT
  ) {
    throw new PeerSafetyError("Peer root marker has invalid content");
  }
  for (const entry of entries.filter((entry) => entry !== ROOT_MARKER)) {
    const info = await lstat(join(root, entry));
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) {
      throw new PeerSafetyError("Peer root contains an unsafe entry");
    }
  }
  return root;
}

async function validateControlDirectory(
  options: PeerArguments,
  root: string,
): Promise<string | undefined> {
  if (!options.controlDir) return undefined;
  const control = await assertCanonicalDirectory(options.controlDir);
  if (basename(control) !== `posix-gate1-control-${options.runId}`) {
    throw new PeerSafetyError(
      "Control directory name does not match its run ID",
    );
  }
  if (atOrInside(root, control)) {
    throw new PeerSafetyError(
      "Control directory must be outside the namespace",
    );
  }
  const entries = await readdir(control);
  if (entries.some((entry) => entry !== CONTROL_MARKER)) {
    throw new PeerSafetyError("Control directory must contain only its marker");
  }
  const marker = await lstat(join(control, CONTROL_MARKER)).catch(() => null);
  if (!marker?.isFile() || marker.isSymbolicLink()) {
    throw new PeerSafetyError("Control marker is missing or unsafe");
  }
  if (
    (await readFile(join(control, CONTROL_MARKER), "utf8")) !==
    `${options.runId}\n`
  ) {
    throw new PeerSafetyError("Control marker does not match the run ID");
  }
  return control;
}

async function canonicalizeProspectivePath(path: string): Promise<string> {
  const suffix: string[] = [];
  let existing = resolve(path);
  for (;;) {
    try {
      await lstat(existing);
      return join(await realpath(existing), ...suffix);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const parent = dirname(existing);
      if (parent === existing) throw error;
      suffix.unshift(basename(existing));
      existing = parent;
    }
  }
}

function targetPath(root: string, target: PeerTarget): string {
  return join(root, target === "payload" ? "payload.bin" : "renamed.bin");
}

function fillGenerationChunk(
  buffer: Buffer,
  generation: string,
  absoluteOffset: number,
): void {
  const seed = createHash("sha256").update(generation).digest();
  for (let index = 0; index < buffer.length; index += 1) {
    buffer[index] =
      (seed[(absoluteOffset + index) % seed.length] ?? 0) ^
      ((absoluteOffset + index) % 251);
  }
}

export function expectedGenerationHash(
  generation: string,
  bytes: number,
): string {
  const hasher = createHash("sha256");
  const buffer = Buffer.allocUnsafe(Math.min(CHUNK_BYTES, bytes));
  for (let offset = 0; offset < bytes; offset += buffer.length) {
    const length = Math.min(buffer.length, bytes - offset);
    const chunk =
      length === buffer.length ? buffer : buffer.subarray(0, length);
    fillGenerationChunk(chunk, generation, offset);
    hasher.update(chunk);
  }
  return hasher.digest("hex");
}

async function writeGeneration(
  path: string,
  generation: string,
  bytes: number,
  flags: "wx" | "w",
): Promise<string> {
  const handle = await open(path, flags, 0o600);
  const hasher = createHash("sha256");
  const buffer = Buffer.allocUnsafe(Math.min(CHUNK_BYTES, bytes));
  try {
    for (let offset = 0; offset < bytes; offset += buffer.length) {
      const length = Math.min(buffer.length, bytes - offset);
      const chunk =
        length === buffer.length ? buffer : buffer.subarray(0, length);
      fillGenerationChunk(chunk, generation, offset);
      let written = 0;
      while (written < length) {
        const result = await handle.write(
          chunk,
          written,
          length - written,
          offset + written,
        );
        if (result.bytesWritten === 0) throw new Error("SHORT_WRITE");
        written += result.bytesWritten;
      }
      hasher.update(chunk);
    }
    await handle.sync();
  } finally {
    await handle.close();
  }
  return hasher.digest("hex");
}

async function hashHandle(handle: Awaited<ReturnType<typeof open>>): Promise<{
  bytes: number;
  hash: string;
}> {
  const before = await handle.stat();
  if (before.size > MAX_BYTES) throw new Error("FILE_TOO_LARGE");
  const hasher = createHash("sha256");
  const buffer = Buffer.allocUnsafe(CHUNK_BYTES);
  let offset = 0;
  for (;;) {
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
    if (bytesRead === 0) break;
    hasher.update(buffer.subarray(0, bytesRead));
    offset += bytesRead;
    if (offset > MAX_BYTES) throw new Error("FILE_TOO_LARGE");
  }
  return { bytes: offset, hash: hasher.digest("hex") };
}

async function hashPath(
  path: string,
): Promise<{ bytes: number; hash: string }> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    return await hashHandle(handle);
  } finally {
    await handle.close();
  }
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, constants.O_RDONLY);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function errorCode(error: unknown): string {
  const code = (error as NodeJS.ErrnoException)?.code;
  if (typeof code === "string" && /^[A-Z0-9_]+$/.test(code)) return code;
  if (error instanceof Error && /^[A-Z0-9_]+$/.test(error.message))
    return error.message;
  return "PEER_ACTION_FAILED";
}

async function validateEvidencePath(
  path: string | undefined,
  root: string,
): Promise<string | undefined> {
  if (!path) return undefined;
  const requested = resolve(path);
  const requestedInfo = await lstat(requested).catch(() => null);
  if (requestedInfo?.isSymbolicLink()) {
    throw new PeerSafetyError("Evidence path must not be a symlink");
  }
  const resolved = await canonicalizeProspectivePath(requested);
  if (atOrInside(root, resolved)) {
    throw new PeerSafetyError("Evidence must be outside the namespace");
  }
  const parent = dirname(resolved);
  const parentInfo = await lstat(parent);
  if (!parentInfo.isDirectory() || parentInfo.isSymbolicLink()) {
    throw new PeerSafetyError("Evidence parent must be a real directory");
  }
  if (requestedInfo && !requestedInfo.isFile()) {
    throw new PeerSafetyError("Evidence path is unsafe");
  }
  return resolved;
}

async function appendEvidence(
  path: string | undefined,
  result: PeerResult,
): Promise<void> {
  if (!path) return;
  const line = `${JSON.stringify({ at: new Date().toISOString(), ...result })}\n`;
  if (Buffer.byteLength(line) > 4096)
    throw new PeerSafetyError("Evidence record is too large");
  const handle = await open(
    path,
    constants.O_WRONLY |
      constants.O_APPEND |
      constants.O_CREAT |
      constants.O_NOFOLLOW,
    0o600,
  );
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new PeerSafetyError("Evidence path is unsafe");
    if (info.size + Buffer.byteLength(line) > MAX_LOG_BYTES) {
      throw new PeerSafetyError("Evidence has reached its bounded size");
    }
    await handle.writeFile(line);
    await handle.sync();
    await handle.chmod(0o600);
  } finally {
    await handle.close();
  }
}

function result(
  options: PeerArguments,
  ok: boolean,
  details: PeerResult["details"],
  code?: string,
): PeerResult {
  return {
    action: options.action,
    details,
    dryRun: options.dryRun,
    ...(code ? { errorCode: code } : {}),
    ok,
    peer: "posix-gate1",
    runId: options.runId,
  };
}

async function executeAction(
  options: PeerArguments,
  root: string,
  control: string | undefined,
  hooks: PeerHooks,
): Promise<PeerResult> {
  const path = targetPath(root, options.target);
  switch (options.action) {
    case "seed": {
      if ((await readdir(root)).length !== 1) throw new Error("ROOT_NOT_EMPTY");
      const hash = await writeGeneration(
        path,
        options.generation ?? "",
        options.bytes,
        "wx",
      );
      await syncDirectory(root);
      return result(options, true, {
        bytes: options.bytes,
        generation: options.generation ?? "",
        hash,
      });
    }
    case "atomic-replace": {
      await hashPath(path);
      const stage = join(root, ".peer-stage");
      try {
        const hash = await writeGeneration(
          stage,
          options.generation ?? "",
          options.bytes,
          "wx",
        );
        await rename(stage, path);
        await syncDirectory(root);
        const published = await hashPath(path);
        if (published.hash !== hash || published.bytes !== options.bytes)
          throw new Error("HASH_MISMATCH");
        return result(options, true, {
          bytes: published.bytes,
          generation: options.generation ?? "",
          hash,
        });
      } finally {
        await rm(stage, { force: true });
      }
    }
    case "rename": {
      if (options.target !== "payload") throw new Error("INVALID_TARGET");
      await rename(path, targetPath(root, "renamed"));
      await syncDirectory(root);
      const moved = await hashPath(targetPath(root, "renamed"));
      return result(options, true, moved);
    }
    case "unlink": {
      const before = await hashPath(path);
      await unlink(path);
      await syncDirectory(root);
      return result(options, true, before);
    }
    case "hold-read": {
      if (!control) throw new Error("CONTROL_REQUIRED");
      const handle = await open(
        path,
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
      try {
        const before = await hashHandle(handle);
        const ready = result(options, true, { event: "ready", ...before });
        const readyPath = join(control, "ready.json");
        await writeFile(readyPath, `${JSON.stringify(ready)}\n`, {
          flag: "wx",
          mode: 0o600,
        });
        await syncDirectory(control);
        await hooks.onReady?.(ready);
        const deadline = Date.now() + options.holdMs;
        let released = false;
        while (Date.now() < deadline) {
          const releasePath = join(control, "release");
          const release = await lstat(releasePath).catch(() => null);
          if (release) {
            if (!release.isFile() || release.isSymbolicLink())
              throw new Error("UNSAFE_RELEASE");
            if ((await readFile(releasePath, "utf8")) !== "release\n")
              throw new Error("INVALID_RELEASE");
            released = true;
            break;
          }
          await Bun.sleep(25);
        }
        const after = await hashHandle(handle);
        return result(options, true, {
          afterBytes: after.bytes,
          afterHash: after.hash,
          beforeBytes: before.bytes,
          beforeHash: before.hash,
          released,
        });
      } finally {
        await handle.close();
      }
    }
    case "snapshot-loop": {
      const expectedHashes = Object.fromEntries(
        options.expectedGenerations.map((generation) => [
          generation,
          expectedGenerationHash(generation, options.bytes),
        ]),
      );
      const byHash = Object.fromEntries(
        Object.entries(expectedHashes).map(([generation, hash]) => [
          hash,
          generation,
        ]),
      );
      const counts: Record<string, number> = {};
      let missing = 0;
      let unknown = 0;
      for (let iteration = 0; iteration < options.iterations; iteration += 1) {
        try {
          const snapshot = await hashPath(path);
          const generation = byHash[snapshot.hash];
          if (!generation || snapshot.bytes !== options.bytes) unknown += 1;
          else counts[generation] = (counts[generation] ?? 0) + 1;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") missing += 1;
          else throw error;
        }
        if (options.delayMs > 0) await Bun.sleep(options.delayMs);
      }
      return result(options, missing === 0 && unknown === 0, {
        counts,
        expectedHashes,
        iterations: options.iterations,
        missing,
        unknown,
      });
    }
    case "inject-test-link": {
      if (options.target !== "payload") throw new Error("INVALID_TARGET");
      await hashPath(path);
      await link(path, join(root, "test-hardlink"));
      await symlink("payload.bin", join(root, "test-symlink"));
      await syncDirectory(root);
      const source = await lstat(path);
      const symbolic = await lstat(join(root, "test-symlink"));
      return result(options, source.nlink === 2 && symbolic.isSymbolicLink(), {
        hardLinkCount: source.nlink,
        symbolicLink: symbolic.isSymbolicLink(),
      });
    }
  }
}

export async function runPosixGate1Peer(
  options: PeerArguments,
  hooks: PeerHooks = {},
): Promise<PeerResult> {
  const root = await validatePeerRoot(options);
  const control = await validateControlDirectory(options, root);
  const evidence = await validateEvidencePath(options.logPath, root);
  if (options.dryRun) {
    return result(options, false, { planned: true, writes: false });
  }

  let peerResult: PeerResult;
  try {
    peerResult = await executeAction(options, root, control, hooks);
  } catch (error) {
    peerResult = result(options, false, {}, errorCode(error));
  }
  await appendEvidence(evidence, peerResult);
  return peerResult;
}

if (import.meta.main) {
  try {
    const options = parsePeerArguments(process.argv.slice(2));
    const peerResult = await runPosixGate1Peer(options, {
      onReady(event) {
        console.info(JSON.stringify(event));
      },
    });
    console.info(JSON.stringify(peerResult));
    if (!peerResult.ok && !peerResult.dryRun) process.exit(1);
  } catch (error) {
    const code = errorCode(error);
    process.stderr.write(`posix-gate1-peer failed: ${code}\n`);
    process.exit(1);
  }
}
