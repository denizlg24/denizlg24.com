import { randomUUID } from "node:crypto";
import { mkdir, open, realpath, rm, stat, writeFile } from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";

import { ProbeSafetyError, validateDisposableRoot } from "./posix-gate1-probe";

const LOGICAL_BYTES = 5_800_000_000;
const SAMPLE_BYTES = 16 * 1024 * 1024;
const MAX_RSS_DELTA_BYTES = 128 * 1024 * 1024;
const READ_DELAY_MS = 40;

export interface SlowClientArguments {
  dryRun: boolean;
  logPath?: string;
  root: string;
}

export interface SlowClientOptions extends SlowClientArguments {
  logicalBytes?: number;
  maxRssDeltaBytes?: number;
  readDelayMs?: number;
  sampleBytes?: number;
}

function valueAfter(argv: readonly string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  if (index === -1) return undefined;
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new ProbeSafetyError(`${flag} requires a value`);
  }
  return value;
}

export function parseSlowClientArguments(
  argv: readonly string[],
): SlowClientArguments {
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

function validateBoundedOptions(
  options: Required<
    Pick<
      SlowClientOptions,
      "logicalBytes" | "maxRssDeltaBytes" | "readDelayMs" | "sampleBytes"
    >
  >,
): void {
  if (
    !Number.isSafeInteger(options.logicalBytes) ||
    options.logicalBytes < options.sampleBytes ||
    options.logicalBytes > 8_000_000_000 ||
    !Number.isSafeInteger(options.sampleBytes) ||
    options.sampleBytes < 64 * 1024 ||
    options.sampleBytes > 64 * 1024 * 1024 ||
    !Number.isSafeInteger(options.maxRssDeltaBytes) ||
    options.maxRssDeltaBytes < 16 * 1024 * 1024 ||
    options.maxRssDeltaBytes > 512 * 1024 * 1024 ||
    !Number.isSafeInteger(options.readDelayMs) ||
    options.readDelayMs < 0 ||
    options.readDelayMs > 1_000
  ) {
    throw new ProbeSafetyError("Slow-client bounds are invalid");
  }
}

async function writeEvidence(
  logPath: string | undefined,
  record: Record<string, boolean | number | string>,
): Promise<void> {
  if (!logPath) return;
  const resolved = resolve(logPath);
  if (!isAbsolute(logPath) || basename(resolved) === "") {
    throw new ProbeSafetyError("Evidence path must be an absolute file path");
  }
  await writeFile(
    resolved,
    `${JSON.stringify({ schemaVersion: 1, at: new Date().toISOString(), ...record })}\n`,
    { encoding: "utf8", flag: "wx", mode: 0o600 },
  );
}

export async function runSlowClientProbe(options: SlowClientOptions) {
  const root = await validateDisposableRoot(options.root);
  const logicalBytes = options.logicalBytes ?? LOGICAL_BYTES;
  const sampleBytes = options.sampleBytes ?? SAMPLE_BYTES;
  const maxRssDeltaBytes = options.maxRssDeltaBytes ?? MAX_RSS_DELTA_BYTES;
  const readDelayMs = options.readDelayMs ?? READ_DELAY_MS;
  validateBoundedOptions({
    logicalBytes,
    maxRssDeltaBytes,
    readDelayMs,
    sampleBytes,
  });
  if (options.logPath) {
    const resolvedLog = resolve(options.logPath);
    if (!isAbsolute(options.logPath)) {
      throw new ProbeSafetyError("Evidence path must be absolute");
    }
    const canonicalLog = join(
      await realpath(dirname(resolvedLog)),
      basename(resolvedLog),
    );
    if (atOrInside(root, canonicalLog) || dirname(canonicalLog) === root) {
      throw new ProbeSafetyError(
        "Evidence log must be outside the disposable root",
      );
    }
  }
  if (options.dryRun) {
    return {
      allGreen: false,
      allocatedBytes: 0,
      dryRun: true,
      logicalBytes,
      maxRssDeltaBytes,
      probe: "posix-gate1-slow-client" as const,
      receivedBytes: 0,
      rssDeltaBytes: 0,
      sampleBytes,
    };
  }

  const workspace = join(root, `.posix-gate1-slow-${randomUUID()}`);
  const sparsePath = join(workspace, "slow-shape.bin");
  await mkdir(workspace, { mode: 0o700 });
  let server: ReturnType<typeof Bun.serve> | undefined;
  try {
    const file = await open(sparsePath, "wx", 0o600);
    try {
      await file.write(Buffer.from([0x7f]), 0, 1, logicalBytes - 1);
      await file.sync();
    } finally {
      await file.close();
    }
    const sparseInfo = await stat(sparsePath);
    if (sparseInfo.size !== logicalBytes) {
      throw new Error("Slow-client sparse shape has the wrong logical size");
    }
    const allocatedBytes = sparseInfo.blocks * 512;
    if (allocatedBytes > 16 * 1024 * 1024) {
      throw new Error("Slow-client shape exceeded its sparse allocation bound");
    }

    server = Bun.serve({
      hostname: "127.0.0.1",
      idleTimeout: 240,
      port: 0,
      fetch() {
        const body = Bun.file(sparsePath);
        return new Response(body, {
          headers: { "content-length": String(body.size) },
        });
      },
    });
    const rssBefore = process.memoryUsage.rss();
    let peakRss = rssBefore;
    let receivedBytes = 0;
    const controller = new AbortController();
    const response = await fetch(`http://127.0.0.1:${server.port}/slow`, {
      signal: controller.signal,
    });
    if (response.headers.get("content-length") !== String(logicalBytes)) {
      throw new Error("Slow-client response Content-Length is incorrect");
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Slow-client response has no body");
    try {
      while (receivedBytes < sampleBytes) {
        const { done, value } = await reader.read();
        if (done || !value) {
          throw new Error("Slow client ended before the bounded sample");
        }
        for (const byte of value) {
          if (byte !== 0) {
            throw new Error("Slow-client sample returned unexpected bytes");
          }
        }
        receivedBytes += value.byteLength;
        peakRss = Math.max(peakRss, process.memoryUsage.rss());
        if (readDelayMs > 0) await Bun.sleep(readDelayMs);
      }
    } finally {
      await reader.cancel("bounded Gate 1 sample complete").catch(() => {});
      controller.abort();
    }
    const rssDeltaBytes = Math.max(0, peakRss - rssBefore);
    if (rssDeltaBytes > maxRssDeltaBytes) {
      throw new Error(
        `Slow-client RSS delta ${rssDeltaBytes} exceeded ${maxRssDeltaBytes}`,
      );
    }
    const result = {
      allGreen: true,
      allocatedBytes,
      dryRun: false,
      logicalBytes,
      maxRssDeltaBytes,
      probe: "posix-gate1-slow-client" as const,
      receivedBytes,
      rssDeltaBytes,
      sampleBytes,
    };
    await writeEvidence(options.logPath, result);
    return result;
  } finally {
    server?.stop(true);
    await rm(workspace, { force: true, recursive: true });
  }
}

if (import.meta.main) {
  try {
    const result = await runSlowClientProbe(
      parseSlowClientArguments(process.argv.slice(2)),
    );
    console.info(JSON.stringify(result));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`posix-gate1-slow-client failed: ${message}\n`);
    process.exit(1);
  }
}
