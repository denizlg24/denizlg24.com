/**
 * Resumable triage backfill.
 *
 * Completed emails are persisted immediately and skipped on the next run.
 * Auto-accept is off unless explicitly requested so historical mail cannot
 * create assignments, cards, or calendar events unexpectedly.
 */
import { randomUUID } from "node:crypto";
import { runTriage, type TriageRunStats } from "@/lib/triage";
import {
  releaseTriageRunLease,
  resetTriageRunLease,
  withTriageRunLease,
} from "@/lib/triage-run-lease";

interface Options {
  since?: Date;
  limit?: number;
  concurrency: number;
  extractionConcurrency: number;
  fetchBatchSize: number;
  autoAccept: boolean;
  skipMissing: boolean;
  force: boolean;
}

function usage(): string {
  return [
    "Usage: bun run triage:backfill [options]",
    "",
    "Options:",
    "  --since <ISO date>          Override the saved triage cursor",
    "  --limit <count>             Process at most this many pending emails",
    "  --concurrency <count>       Concurrent classifier/extraction workers (default: 4)",
    "  --extraction-concurrency <n> Concurrent LLM extractions (default: 2)",
    "  --fetch-batch-size <count>  Emails fetched per IMAP connection (default: 50)",
    "  --auto-accept               Allow task/event creation (off by default)",
    "  --skip-missing              Permanently skip UIDs confirmed absent from INBOX",
    "  --force                     Run even when triage is disabled",
    "  --reset-lease               Clear a lease after confirming its worker died",
    "  --help                      Show this help",
  ].join("\n");
}

function flagValue(argv: string[], name: string): string | undefined {
  const equals = argv.find((arg) => arg.startsWith(`${name}=`));
  if (equals) return equals.slice(name.length + 1);
  const index = argv.indexOf(name);
  return index === -1 ? undefined : argv[index + 1];
}

function positiveInteger(
  value: string | undefined,
  name: string,
): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function parseOptions(argv: string[]): Options {
  const sinceValue = flagValue(argv, "--since");
  const since = sinceValue === undefined ? undefined : new Date(sinceValue);
  if (since && Number.isNaN(since.getTime())) {
    throw new Error("--since must be a valid ISO date");
  }

  return {
    since,
    limit: positiveInteger(flagValue(argv, "--limit"), "--limit"),
    concurrency:
      positiveInteger(flagValue(argv, "--concurrency"), "--concurrency") ?? 4,
    extractionConcurrency:
      positiveInteger(
        flagValue(argv, "--extraction-concurrency"),
        "--extraction-concurrency",
      ) ?? 2,
    fetchBatchSize:
      positiveInteger(
        flagValue(argv, "--fetch-batch-size"),
        "--fetch-batch-size",
      ) ?? 50,
    autoAccept: argv.includes("--auto-accept"),
    skipMissing: argv.includes("--skip-missing"),
    force: argv.includes("--force"),
  };
}

function validateEnvironment(): void {
  const required = [
    "MONGODB_URI",
    "IMAP_ENCRYPTION_KEY",
    "EMAIL_CLASSIFIER_URL",
    "EMAIL_CLASSIFIER_API_TOKEN",
    "AI_GATEWAY_API_KEY",
  ] as const;
  const missing = required.filter((name) => !process.env[name]?.trim());
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}`,
    );
  }
  if (!/^[\da-f]{64}$/i.test(process.env.IMAP_ENCRYPTION_KEY ?? "")) {
    throw new Error(
      "IMAP_ENCRYPTION_KEY must be a 64-character hexadecimal key",
    );
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes("--help")) {
    console.log(usage());
    return;
  }

  if (argv.includes("--reset-lease")) {
    const previous = await resetTriageRunLease();
    console.log(
      previous.owner
        ? `Cleared triage lease held by ${previous.owner} (expiry ${previous.expiresAt?.toISOString() ?? "unknown"})`
        : "No active triage lease was present",
    );
    return;
  }

  const options = parseOptions(argv);
  validateEnvironment();
  console.log("Starting resumable triage backfill", {
    since: options.since?.toISOString() ?? "saved cursor",
    limit: options.limit ?? "all pending",
    concurrency: options.concurrency,
    extractionConcurrency: options.extractionConcurrency,
    fetchBatchSize: options.fetchBatchSize,
    autoAccept: options.autoAccept,
    skipMissing: options.skipMissing,
    force: options.force,
  });

  const owner = `backfill-script:${process.pid}:${randomUUID()}`;
  let terminating = false;
  const releaseAndTerminate = (signal: "SIGINT" | "SIGTERM") => {
    if (terminating) return;
    terminating = true;
    console.error(`Received ${signal}; releasing the triage lease...`);
    void releaseTriageRunLease(owner).finally(() => {
      process.removeListener("SIGINT", onSigint);
      process.removeListener("SIGTERM", onSigterm);
      process.kill(process.pid, signal);
    });
  };
  const onSigint = () => releaseAndTerminate("SIGINT");
  const onSigterm = () => releaseAndTerminate("SIGTERM");
  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);

  let run: { acquired: false } | { acquired: true; result: TriageRunStats };
  try {
    run = await withTriageRunLease(owner, () =>
      runTriage({
        since: options.since,
        limit: options.limit,
        concurrency: options.concurrency,
        extractionConcurrency: options.extractionConcurrency,
        fetchBatchSize: options.fetchBatchSize,
        autoAccept: options.autoAccept,
        skipUnavailable: options.skipMissing,
        force: options.force,
        ignoreSchedule: true,
        updateLastRunAt: false,
      }),
    );
  } finally {
    process.removeListener("SIGINT", onSigint);
    process.removeListener("SIGTERM", onSigterm);
  }

  if (!run.acquired) {
    throw new Error(
      "Another triage run holds the lease. Wait up to 90 seconds, or use --reset-lease only after confirming that worker died.",
    );
  }

  console.log("Triage backfill finished", run.result);
  if (run.result.errors > 0 || run.result.remaining > 0) {
    console.error(
      "Some emails remain. Fix any reported errors, then rerun the same command.",
    );
    process.exitCode = 1;
  }
}

void main().catch((error) => {
  console.error(
    "Triage backfill failed:",
    error instanceof Error ? error.message : error,
  );
  process.exitCode = 1;
});
