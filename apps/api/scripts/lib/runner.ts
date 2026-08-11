import { appendFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { authVerification, type Database } from "@repo/cloud-core";
import { and, eq } from "drizzle-orm";

/** cloud-core exports `Database` but not its transaction handle; derive it. */
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * Markers are rows in `auth_verification` with a never-expiring `expiresAt`, so
 * Better Auth's sweeper leaves them alone. They exist so a cutover step can
 * prove its predecessor ran: re-running a completed step must report
 * `alreadyComplete` rather than write twice, and running out of order must
 * fail loudly instead of half-migrating.
 */
export const MARKER_IDENTIFIER = "cloud-migration:012";
export const NEVER_EXPIRES = new Date("9999-12-31T23:59:59.999Z");

export const MARKERS = {
  resources: "cloud-migration:016-resources",
  s3Legacy: "cloud-migration:012-s3-legacy",
  schema: "cloud-migration:012-schema",
  users: "cloud-migration:003-users",
} as const;

export type MarkerId = (typeof MARKERS)[keyof typeof MARKERS];

/**
 * `migrate-users.ts` predates this harness and writes its marker under plan
 * 003's identifier. Reading it under 012's would never match, which would
 * permanently block the S3 preflight's predecessor check.
 */
const MARKER_IDENTIFIERS: Record<MarkerId, string> = {
  [MARKERS.resources]: "cloud-migration:016",
  [MARKERS.s3Legacy]: MARKER_IDENTIFIER,
  [MARKERS.schema]: MARKER_IDENTIFIER,
  [MARKERS.users]: "cloud-migration:003",
};

export function markerIdentifier(id: MarkerId): string {
  return MARKER_IDENTIFIERS[id];
}

/** The order cutover steps must run in. Index = position in the sequence. */
export const MARKER_SEQUENCE: readonly MarkerId[] = [
  MARKERS.schema,
  MARKERS.users,
  MARKERS.s3Legacy,
  MARKERS.resources,
];

export interface ScriptFlags {
  dryRun: boolean;
  json: boolean;
  live: boolean;
  logPath: string | undefined;
  reportPath: string | undefined;
}

export class ScriptError extends Error {}

function flagValue(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  if (index === -1) return undefined;
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new ScriptError(`${flag} requires a value`);
  }
  return value;
}

/**
 * Dry-run is the default for every cutover script: `--execute` must be typed
 * deliberately, and passing both is an error rather than a silent precedence
 * rule the operator has to remember at 3am.
 */
export function parseFlags(argv: string[]): ScriptFlags {
  const execute = argv.includes("--execute");
  const explicitDryRun = argv.includes("--dry-run");
  if (execute && explicitDryRun) {
    throw new ScriptError("Choose either --dry-run or --execute, not both");
  }
  return {
    dryRun: !execute,
    json: argv.includes("--json"),
    live: argv.includes("--live"),
    logPath: flagValue(argv, "--log"),
    reportPath: flagValue(argv, "--report"),
  };
}

export interface Logger {
  event(name: string, fields?: Record<string, unknown>): Promise<void>;
}

/**
 * Every run appends JSONL to its log file so a cutover leaves an artifact that
 * can be diffed against the rehearsal. Log writes never abort the run — losing
 * the audit trail is bad, but failing a migration because a disk is full is
 * worse.
 */
export function createLogger(
  script: string,
  dryRun: boolean,
  logPath: string | undefined,
): Logger {
  const resolved = logPath ? resolve(logPath) : undefined;
  let ensured = resolved === undefined;

  return {
    async event(name, fields = {}) {
      const line = JSON.stringify({
        at: new Date().toISOString(),
        dryRun,
        event: name,
        script,
        ...fields,
      });
      process.stderr.write(`${line}\n`);
      if (!resolved) return;
      try {
        if (!ensured) {
          await mkdir(dirname(resolved), { recursive: true });
          ensured = true;
        }
        await appendFile(resolved, `${line}\n`, { encoding: "utf8" });
      } catch (error) {
        process.stderr.write(
          `${JSON.stringify({
            error: error instanceof Error ? error.message : String(error),
            event: "log-write-failed",
            script,
          })}\n`,
        );
      }
    },
  };
}

export async function readMarker(
  db: Database,
  id: MarkerId,
): Promise<Date | null> {
  const row = await db.query.authVerification.findFirst({
    columns: { createdAt: true },
    where: and(
      eq(authVerification.id, id),
      eq(authVerification.identifier, MARKER_IDENTIFIERS[id]),
    ),
  });
  return row?.createdAt ?? null;
}

export async function writeMarker(
  tx: Transaction | Database,
  id: MarkerId,
  value = "complete",
): Promise<void> {
  const now = new Date();
  await tx.insert(authVerification).values({
    createdAt: now,
    expiresAt: NEVER_EXPIRES,
    id,
    identifier: MARKER_IDENTIFIERS[id],
    updatedAt: now,
    value,
  });
}

/**
 * Refuses to proceed when an earlier step in MARKER_SEQUENCE has not completed.
 * This is what stops `migrate-s3-legacy --execute` from running against a
 * database that never had its schema migrated.
 */
export async function requirePredecessors(
  db: Database,
  id: MarkerId,
): Promise<void> {
  const position = MARKER_SEQUENCE.indexOf(id);
  if (position <= 0) return;

  for (const predecessor of MARKER_SEQUENCE.slice(0, position)) {
    if ((await readMarker(db, predecessor)) === null) {
      throw new ScriptError(
        `Out of order: ${predecessor} has not completed. Run it before ${id}.`,
      );
    }
  }
}

export interface RunResult {
  alreadyComplete?: boolean;
  [key: string]: unknown;
}

/**
 * Wraps a script body with the shared contract: parse flags, log start/finish,
 * emit one machine-readable summary line on stdout, and exit non-zero with a
 * single-line reason on failure.
 */
export async function runScript(
  script: string,
  body: (flags: ScriptFlags, log: Logger) => Promise<RunResult>,
): Promise<void> {
  let flags: ScriptFlags;
  try {
    flags = parseFlags(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exit(2);
  }

  const log = createLogger(script, flags.dryRun, flags.logPath);
  await log.event("start", { argv: process.argv.slice(2) });

  try {
    const result = await body(flags, log);
    await log.event("finish", { ok: true });
    console.info(JSON.stringify({ dryRun: flags.dryRun, script, ...result }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await log.event("finish", { error: message, ok: false });
    process.stderr.write(`${script} failed: ${message}\n`);
    process.exit(1);
  }
}
