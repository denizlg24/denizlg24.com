import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  chmod,
  link,
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  symlink,
  unlink,
  utimes,
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

const DISPOSABLE_MARKER = ".posix-gate1-disposable";
const DISPOSABLE_MARKER_CONTENT = "deniz-cloud-posix-gate1\n";
const MAX_AUDIT_RECORDS = 64;
const FOUR_GIB = 4 * 1024 * 1024 * 1024;

const PROTECTED_ROOTS = [
  "/",
  "/data/hdd",
  "/data/ssd",
  "/mnt/hdd/storage",
  "/mnt/ssd/storage",
  "/opt/deniz-cloud",
  "/srv/deniz-cloud/storage",
] as const;

export interface ProbeArguments {
  dryRun: boolean;
  logPath?: string;
  root: string;
}

export interface ProbeCheck {
  detail?: Record<string, boolean | number | string>;
  name: string;
  status: "pass" | "skipped";
}

export interface ProbeSummary {
  allGreen: boolean;
  checks: ProbeCheck[];
  dryRun: boolean;
  probe: "posix-gate1";
  runtime: {
    bun: string;
    platform: NodeJS.Platform;
  };
}

export class ProbeSafetyError extends Error {}

function valueAfter(argv: readonly string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  if (index === -1) return undefined;
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new ProbeSafetyError(`${flag} requires a value`);
  }
  return value;
}

export function parseProbeArguments(argv: readonly string[]): ProbeArguments {
  const execute = argv.includes("--execute");
  const explicitDryRun = argv.includes("--dry-run");
  if (execute && explicitDryRun) {
    throw new ProbeSafetyError(
      "Choose either --dry-run or --execute, not both",
    );
  }
  const root = valueAfter(argv, "--root");
  if (!root) throw new ProbeSafetyError("--root is required");

  const known = new Set(["--dry-run", "--execute", "--root", "--log"]);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument?.startsWith("--")) continue;
    if (!known.has(argument)) {
      throw new ProbeSafetyError(`Unknown option: ${argument}`);
    }
    if (argument === "--root" || argument === "--log") index += 1;
  }

  return {
    dryRun: !execute,
    logPath: valueAfter(argv, "--log"),
    root,
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

function assertPathShape(root: string): string {
  if (!isAbsolute(root)) {
    throw new ProbeSafetyError("Disposable root must be an absolute path");
  }
  const resolved = resolve(root);
  if (
    !/^posix-gate1-disposable(?:[-_.][a-zA-Z0-9-]+)?$/.test(basename(resolved))
  ) {
    throw new ProbeSafetyError(
      "Disposable root basename must start with posix-gate1-disposable",
    );
  }
  for (const protectedRoot of PROTECTED_ROOTS) {
    if (
      (protectedRoot === "/" && resolved === "/") ||
      (protectedRoot !== "/" && atOrInside(protectedRoot, resolved))
    ) {
      throw new ProbeSafetyError(
        "Disposable root overlaps a protected production path",
      );
    }
  }
  return resolved;
}

async function assertNoSymlinkComponents(path: string): Promise<void> {
  const components = resolve(path).split(sep).filter(Boolean);
  let current: string = sep;
  for (const component of components) {
    current = join(current, component);
    const info = await lstat(current);
    if (info.isSymbolicLink()) {
      throw new ProbeSafetyError("Disposable root has a symlink component");
    }
  }
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

export async function validateDisposableRoot(root: string): Promise<string> {
  const resolved = assertPathShape(root);
  const requestedInfo = await lstat(resolved);
  if (requestedInfo.isSymbolicLink()) {
    throw new ProbeSafetyError("Disposable root must not be a symlink");
  }
  const canonical = await realpath(resolved);
  assertPathShape(canonical);
  await assertNoSymlinkComponents(canonical);
  const rootInfo = await lstat(canonical);
  if (!rootInfo.isDirectory()) {
    throw new ProbeSafetyError("Disposable root is not a directory");
  }

  const entries = await readdir(canonical);
  if (entries.some((entry) => entry !== DISPOSABLE_MARKER)) {
    throw new ProbeSafetyError(
      "Disposable root must be empty except for its marker",
    );
  }
  const markerPath = join(canonical, DISPOSABLE_MARKER);
  const markerInfo = await lstat(markerPath).catch(() => null);
  if (!markerInfo?.isFile() || markerInfo.isSymbolicLink()) {
    throw new ProbeSafetyError("Disposable root marker is missing or unsafe");
  }
  if ((await readFile(markerPath, "utf8")) !== DISPOSABLE_MARKER_CONTENT) {
    throw new ProbeSafetyError("Disposable root marker has invalid content");
  }
  return canonical;
}

function deterministicBytes(length: number): Buffer {
  const bytes = Buffer.allocUnsafe(length);
  for (let index = 0; index < length; index += 1) bytes[index] = index % 251;
  return bytes;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function requireUnlinkedRegularFile(path: string): Promise<void> {
  const info = await lstat(path);
  if (info.isSymbolicLink())
    throw new ProbeSafetyError("Symbolic link rejected");
  if (!info.isFile()) throw new ProbeSafetyError("Non-regular entry rejected");
  if (info.nlink !== 1) throw new ProbeSafetyError("Hard link rejected");
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, constants.O_RDONLY);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function appendAudit(
  logPath: string | undefined,
  records: ProbeCheck[],
): Promise<void> {
  if (!logPath) return;
  const resolved = resolve(logPath);
  const parent = dirname(resolved);
  const parentInfo = await lstat(parent);
  if (!parentInfo.isDirectory() || parentInfo.isSymbolicLink()) {
    throw new ProbeSafetyError("Evidence parent must be a real directory");
  }
  if (await lstat(resolved).catch(() => null)) {
    throw new ProbeSafetyError("Refusing to overwrite probe evidence");
  }
  const bounded = records.slice(0, MAX_AUDIT_RECORDS).map((record) =>
    JSON.stringify({
      at: new Date().toISOString(),
      event: "probe-check",
      ...record,
    }),
  );
  await writeFile(resolved, `${bounded.join("\n")}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  await chmod(resolved, 0o600);
}

async function probeNamespace(workspace: string): Promise<ProbeCheck[]> {
  const checks: ProbeCheck[] = [];

  const directory = join(workspace, "directory");
  const renamedDirectory = join(workspace, "renamed-directory");
  await mkdir(directory);
  await rename(directory, renamedDirectory);
  const caseName = join(workspace, "Case-Rename");
  const caseRenamed = join(workspace, "case-rename");
  await writeFile(caseName, "case");
  await rename(caseName, caseRenamed);
  await unlink(caseRenamed);
  await rm(renamedDirectory, { recursive: true });
  checks.push({ name: "directory-and-case-rename", status: "pass" });

  const linkedSource = join(workspace, "link-source");
  const hardLink = join(workspace, "hard-link");
  const symbolicLink = join(workspace, "symbolic-link");
  await writeFile(linkedSource, "links");
  await link(linkedSource, hardLink);
  await symlink(linkedSource, symbolicLink);
  const hardInfo = await lstat(hardLink);
  const symbolicInfo = await lstat(symbolicLink);
  if (hardInfo.nlink < 2 || !symbolicInfo.isSymbolicLink()) {
    throw new Error("Filesystem did not expose link identity correctly");
  }
  let hardLinkRejected = false;
  let symbolicLinkRejected = false;
  try {
    await requireUnlinkedRegularFile(hardLink);
  } catch (error) {
    hardLinkRejected =
      error instanceof ProbeSafetyError &&
      error.message === "Hard link rejected";
  }
  try {
    await requireUnlinkedRegularFile(symbolicLink);
  } catch (error) {
    symbolicLinkRejected =
      error instanceof ProbeSafetyError &&
      error.message === "Symbolic link rejected";
  }
  if (!hardLinkRejected || !symbolicLinkRejected) {
    throw new Error("Unsafe link was not rejected");
  }
  await Promise.all([
    unlink(symbolicLink),
    unlink(hardLink),
    unlink(linkedSource),
  ]);
  checks.push({
    name: "hardlink-and-symlink-rejection-signals",
    status: "pass",
  });

  const atomicTarget = join(workspace, "atomic-target");
  const atomicStage = join(workspace, ".atomic-stage");
  await writeFile(atomicTarget, "old");
  const stageHandle = await open(atomicStage, "wx", 0o600);
  try {
    await stageHandle.writeFile("new");
    await stageHandle.sync();
  } finally {
    await stageHandle.close();
  }
  try {
    await rename(atomicStage, atomicTarget);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EXDEV") {
      throw new Error("rename crossed filesystems (EXDEV)");
    }
    throw error;
  }
  await syncDirectory(workspace);
  if ((await readFile(atomicTarget, "utf8")) !== "new") {
    throw new Error("Atomic replacement did not publish exact bytes");
  }
  checks.push({ name: "same-mount-atomic-rename", status: "pass" });

  const tusStage = join(workspace, ".tus-stage");
  const tusPublished = join(workspace, "tus-published");
  const firstChunk = deterministicBytes(32 * 1024);
  const secondChunk = deterministicBytes(48 * 1024);
  const interrupted = await open(tusStage, "wx", 0o600);
  try {
    await interrupted.write(firstChunk, 0, firstChunk.length, 0);
    await interrupted.sync();
  } finally {
    await interrupted.close();
  }
  const resumed = await open(tusStage, "r+");
  try {
    const partial = await resumed.stat();
    if (partial.size !== firstChunk.length)
      throw new Error("TUS resume offset changed");
    await resumed.write(secondChunk, 0, secondChunk.length, partial.size);
    await resumed.sync();
  } finally {
    await resumed.close();
  }
  await rename(tusStage, tusPublished);
  await syncDirectory(workspace);
  const published = new Uint8Array(await Bun.file(tusPublished).arrayBuffer());
  const expectedUpload = Buffer.concat([firstChunk, secondChunk]);
  if (sha256(published) !== sha256(expectedUpload)) {
    throw new Error("Published TUS bytes differ from resumed upload");
  }
  checks.push({
    detail: { bytes: published.byteLength, interruptedAt: firstChunk.length },
    name: "tus-interrupt-fsync-resume-publish",
    status: "pass",
  });

  const fullPath = join(workspace, "full-response");
  const fullBytes = deterministicBytes(128 * 1024);
  await writeFile(fullPath, fullBytes);
  const sparsePath = join(workspace, "sparse-over-4gib");
  const sparseTail = Buffer.from("deniz-cloud-sparse-tail");
  const sparseOffset = FOUR_GIB + 8192;
  const sparse = await open(sparsePath, "wx", 0o600);
  try {
    await sparse.write(sparseTail, 0, sparseTail.length, sparseOffset);
    await sparse.sync();
  } finally {
    await sparse.close();
  }
  const sparseInfo = await stat(sparsePath);
  if (sparseInfo.size !== sparseOffset + sparseTail.length) {
    throw new Error("Sparse file has the wrong logical size");
  }
  const allocatedBytes = sparseInfo.blocks * 512;
  if (allocatedBytes > 16 * 1024 * 1024) {
    throw new Error("Sparse file allocated more than the bounded probe budget");
  }

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const url = new URL(request.url);
      const file =
        url.pathname === "/sparse" ? Bun.file(sparsePath) : Bun.file(fullPath);
      const range = request.headers.get("range")?.match(/^bytes=(\d+)-(\d+)$/);
      if (range) {
        const start = Number(range[1]);
        const end = Number(range[2]);
        if (
          !Number.isSafeInteger(start) ||
          !Number.isSafeInteger(end) ||
          end < start
        ) {
          return new Response(null, { status: 416 });
        }
        return new Response(file.slice(start, end + 1), {
          headers: {
            "content-length": String(end - start + 1),
            "content-range": `bytes ${start}-${end}/${file.size}`,
          },
          status: 206,
        });
      }
      return new Response(file, {
        headers: { "content-length": String(file.size) },
      });
    },
  });
  const rssBefore = process.memoryUsage.rss();
  try {
    const fullResponse = await fetch(`http://127.0.0.1:${server.port}/full`);
    const fullReceived = new Uint8Array(await fullResponse.arrayBuffer());
    if (
      fullResponse.headers.get("content-length") !== String(fullBytes.length) ||
      sha256(fullReceived) !== sha256(fullBytes)
    ) {
      throw new Error("Bun.file full response was not byte-exact");
    }
    const rangeEnd = sparseOffset + sparseTail.length - 1;
    const rangeResponse = await fetch(
      `http://127.0.0.1:${server.port}/sparse`,
      {
        headers: { range: `bytes=${sparseOffset}-${rangeEnd}` },
      },
    );
    const rangeReceived = new Uint8Array(await rangeResponse.arrayBuffer());
    if (
      rangeResponse.status !== 206 ||
      rangeResponse.headers.get("content-length") !==
        String(sparseTail.length) ||
      rangeResponse.headers.get("content-range") !==
        `bytes ${sparseOffset}-${rangeEnd}/${sparseInfo.size}` ||
      sha256(rangeReceived) !== sha256(sparseTail)
    ) {
      throw new Error("Bun.file Range response was not byte-exact");
    }
  } finally {
    server.stop(true);
  }
  checks.push({
    detail: {
      allocatedBytes,
      fullBytes: fullBytes.length,
      logicalBytes: sparseInfo.size,
      rssDeltaBytes: Math.max(0, process.memoryUsage.rss() - rssBefore),
    },
    name: "bun-file-full-range-and-sparse-offset",
    status: "pass",
  });

  const timestampPath = join(workspace, "timestamps");
  await writeFile(timestampPath, "time");
  const expectedTime = new Date("2020-01-02T03:04:05.678Z");
  await utimes(timestampPath, expectedTime, expectedTime);
  const timestampInfo = await stat(timestampPath);
  if (Math.abs(timestampInfo.mtimeMs - expectedTime.getTime()) > 1) {
    throw new Error("Filesystem did not preserve millisecond timestamps");
  }
  checks.push({ name: "fsync-and-timestamps", status: "pass" });

  checks.push({
    detail: { reason: "Bun exposes no mmap primitive" },
    name: "mmap",
    status: "skipped",
  });
  return checks;
}

export async function runPosixGate1Probe(
  options: ProbeArguments,
): Promise<ProbeSummary> {
  const root = await validateDisposableRoot(options.root);
  if (
    options.logPath &&
    atOrInside(root, await canonicalizeProspectivePath(options.logPath))
  ) {
    throw new ProbeSafetyError(
      "Evidence log must be outside the disposable root",
    );
  }
  if (options.dryRun) {
    return {
      allGreen: false,
      checks: [
        { name: "disposable-root-boundary", status: "pass" },
        {
          detail: { reason: "dry-run" },
          name: "mutation-matrix",
          status: "skipped",
        },
      ],
      dryRun: true,
      probe: "posix-gate1",
      runtime: { bun: Bun.version, platform: process.platform },
    };
  }

  const workspace = join(root, `.posix-gate1-run-${randomUUID()}`);
  await mkdir(workspace, { mode: 0o700 });
  let checks: ProbeCheck[] = [];
  try {
    checks = await probeNamespace(workspace);
    await appendAudit(options.logPath, checks);
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
  return {
    allGreen: checks.every(({ status }) => status === "pass"),
    checks,
    dryRun: false,
    probe: "posix-gate1",
    runtime: { bun: Bun.version, platform: process.platform },
  };
}

if (import.meta.main) {
  try {
    const options = parseProbeArguments(process.argv.slice(2));
    const summary = await runPosixGate1Probe(options);
    console.info(JSON.stringify(summary));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`posix-gate1-probe failed: ${message}\n`);
    process.exit(1);
  }
}
