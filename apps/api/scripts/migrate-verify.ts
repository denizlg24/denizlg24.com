import { stat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

import {
  apiKeys,
  authAccount,
  authTwoFactor,
  authUser,
  computeChecksum,
  createDb,
  createMeiliClient,
  type Database,
  decryptS3Secret,
  files,
  projectCollections,
  projects,
  requiredEnv,
  s3Credentials,
  scheduledTasks,
  storageConfigFromEnv,
  users,
  verifyPassword,
  verifyShareToken,
} from "@repo/cloud-core";
import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";

import { runScript } from "./lib/runner";

/**
 * The ALL-GREEN-or-abort gate for the cutover (plan 012 Half B step 3).
 *
 * Read-only by construction — it opens no write transaction and has no
 * --execute path. Every check runs even after an earlier one fails, because
 * during a cutover window the operator needs the complete picture in one pass,
 * not a bisect. Checks that need operator-supplied input (a sample password, a
 * pre-cutover share token) report SKIP rather than silently passing.
 */

const FILE_SAMPLE_SIZE = 12;

type Status = "pass" | "fail" | "skip";

interface CheckResult {
  detail: string;
  name: string;
  status: Status;
}

type Check = (db: Database) => Promise<Omit<CheckResult, "name">>;

function pass(detail: string): Omit<CheckResult, "name"> {
  return { detail, status: "pass" };
}
function fail(detail: string): Omit<CheckResult, "name"> {
  return { detail, status: "fail" };
}
function skip(detail: string): Omit<CheckResult, "name"> {
  return { detail, status: "skip" };
}

async function countRows(db: Database, table: PgTable): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(table);
  return row?.count ?? 0;
}

/** Every legacy user must have a Better Auth row; counts must agree exactly. */
const checkUsersMigrated: Check = async (db) => {
  const [legacyCount, authCount] = await Promise.all([
    countRows(db, users),
    countRows(db, authUser),
  ]);
  // legacy `users.id` is uuid, Better Auth `auth_user.id` is text — Postgres
  // has no uuid = text operator, so the cast is required, not cosmetic.
  const orphans = await db
    .select({ username: users.username })
    .from(users)
    .leftJoin(authUser, sql`${users.id}::text = ${authUser.id}`)
    .where(isNull(authUser.id));

  if (orphans.length > 0) {
    return fail(
      `${orphans.length} legacy user(s) have no Better Auth row: ${orphans
        .map((row) => row.username)
        .slice(0, 5)
        .join(", ")}`,
    );
  }
  if (legacyCount !== authCount) {
    return fail(`legacy users ${legacyCount} != auth_user ${authCount}`);
  }
  return pass(`${authCount} users migrated`);
};

/** Password hashes must carry over byte-for-byte — invariant 5. */
const checkPasswordsCarried: Check = async (db) => {
  const mismatched = await db
    .select({ username: users.username })
    .from(users)
    .leftJoin(
      authAccount,
      and(
        sql`${authAccount.userId} = ${users.id}::text`,
        eq(authAccount.providerId, "credential"),
      ),
    )
    .where(
      and(
        isNotNull(users.passwordHash),
        sql`${authAccount.password} IS DISTINCT FROM ${users.passwordHash}`,
      ),
    );

  return mismatched.length === 0
    ? pass("all legacy password hashes carried over unchanged")
    : fail(
        `${mismatched.length} user(s) have a changed or missing password hash: ${mismatched
          .map((row) => row.username)
          .slice(0, 5)
          .join(", ")}`,
      );
};

/**
 * Cutover mandates TOTP re-enrollment (003/012 drift): no user may arrive with
 * an active enrollment, and no legacy secret may have been copied across.
 */
const checkTotpUnenrolled: Check = async (db) => {
  const [enrolledRows, twoFactorCount] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(authUser)
      .where(eq(authUser.twoFactorEnabled, true)),
    countRows(db, authTwoFactor),
  ]);
  const enrolled = enrolledRows[0]?.count ?? 0;

  if (enrolled > 0 || twoFactorCount > 0) {
    return fail(
      `expected zero enrollments; found twoFactorEnabled=${enrolled}, auth_two_factor rows=${twoFactorCount}`,
    );
  }
  return pass("every user is unenrolled; no legacy TOTP secrets imported");
};

/** Optional: proves a real password still authenticates post-migration. */
const checkSamplePasswordVerifies: Check = async (db) => {
  const username = process.env.VERIFY_SAMPLE_USERNAME;
  const password = process.env.VERIFY_SAMPLE_PASSWORD;
  if (!username || !password) {
    return skip(
      "set VERIFY_SAMPLE_USERNAME and VERIFY_SAMPLE_PASSWORD to exercise a real login",
    );
  }

  const [account] = await db
    .select({ password: authAccount.password })
    .from(authUser)
    .innerJoin(
      authAccount,
      and(
        eq(authAccount.userId, authUser.id),
        eq(authAccount.providerId, "credential"),
      ),
    )
    .where(eq(authUser.username, username.toLowerCase()));

  if (!account?.password) {
    return fail(`no credential account for ${username}`);
  }
  return (await verifyPassword({ hash: account.password, password }))
    ? pass(`${username} authenticates against the migrated hash`)
    : fail(`${username} failed password verification`);
};

/** Invariant 4: the legacy keypair must exist as the NULL-project row. */
const checkLegacyS3Credential: Check = async (db) => {
  const rows = await db
    .select({
      accessKeyId: s3Credentials.accessKeyId,
      encryptedSecretAccessKey: s3Credentials.encryptedSecretAccessKey,
      revokedAt: s3Credentials.revokedAt,
      secretAuthTag: s3Credentials.secretAuthTag,
      secretIv: s3Credentials.secretIv,
    })
    .from(s3Credentials)
    .where(isNull(s3Credentials.projectId));

  const active = rows.filter((row) => row.revokedAt === null);
  if (active.length !== 1) {
    return fail(
      `expected exactly one active NULL-project credential, found ${active.length}`,
    );
  }

  const credential = active[0];
  if (!credential) return fail("unreachable: missing credential row");

  const expected = process.env.S3_SECRET_ACCESS_KEY;
  try {
    const decrypted = decryptS3Secret(
      credential.encryptedSecretAccessKey,
      credential.secretIv,
      credential.secretAuthTag,
      storageConfigFromEnv().s3.credentialEncryptionKey,
    );
    if (expected && decrypted !== expected) {
      return fail("legacy credential decrypts to a different secret than env");
    }
  } catch {
    return fail(
      "legacy credential does not decrypt under S3_CREDENTIAL_ENCRYPTION_KEY",
    );
  }
  return pass(`legacy credential ${credential.accessKeyId} valid`);
};

/** Invariant 2: sync must resume, not full-resync. */
const checkResumeTokens: Check = async (db) => {
  const stale = await db
    .select({
      name: projectCollections.name,
      lastSyncedAt: projectCollections.lastSyncedAt,
    })
    .from(projectCollections)
    .where(
      and(
        eq(projectCollections.syncEnabled, true),
        isNull(projectCollections.resumeToken),
        isNotNull(projectCollections.lastSyncedAt),
      ),
    );

  const total = await countRows(db, projectCollections);
  return stale.length === 0
    ? pass(
        `${total} collection(s); every previously-synced one has a resume token`,
      )
    : fail(
        `${stale.length} collection(s) synced before but have no resume token — they would full-resync: ${stale
          .map((row) => row.name)
          .slice(0, 5)
          .join(", ")}`,
      );
};

/** Invariant 2: every issued Meilisearch key must still exist in Meili. */
const checkMeiliKeys: Check = async (db) => {
  const url = process.env.MEILISEARCH_URL;
  const masterKey =
    process.env.MEILI_MASTER_KEY || process.env.MEILISEARCH_ADMIN_KEY;
  if (!url || !masterKey) {
    return skip("MEILISEARCH_URL / master key not configured");
  }

  const rows = await db
    .select({ slug: projects.slug, uid: projects.meiliApiKeyUid })
    .from(projects)
    .where(isNotNull(projects.meiliApiKeyUid));
  if (rows.length === 0) return pass("no project Meilisearch keys issued");

  const client = createMeiliClient(url, masterKey);
  const missing: string[] = [];
  for (const row of rows) {
    if (!row.uid) continue;
    try {
      await client.getKey(row.uid);
    } catch {
      missing.push(row.slug);
    }
  }
  return missing.length === 0
    ? pass(`${rows.length} project key(s) validate`)
    : fail(`key missing in Meilisearch for: ${missing.join(", ")}`);
};

/** Invariant 3: files must still be on disk with matching checksums. */
const checkFilesOnDisk: Check = async (db) => {
  const total = await countRows(db, files);
  if (total === 0) return pass("no files to verify");

  const config = storageConfigFromEnv();
  const sample = await db
    .select({
      checksum: files.checksum,
      diskPath: files.diskPath,
      filename: files.filename,
      tier: files.tier,
    })
    .from(files)
    .orderBy(sql`random()`)
    .limit(FILE_SAMPLE_SIZE);

  const problems: string[] = [];
  for (const file of sample) {
    const root =
      file.tier === "hdd" ? config.hddStoragePath : config.ssdStoragePath;
    const path = isAbsolute(file.diskPath)
      ? file.diskPath
      : join(root, file.diskPath);

    const stats = await stat(path).catch(() => null);
    if (!stats) {
      problems.push(`${file.filename}: missing at ${path}`);
      continue;
    }
    if ((await computeChecksum(path)) !== file.checksum) {
      problems.push(`${file.filename}: checksum mismatch`);
    }
  }

  return problems.length === 0
    ? pass(
        `${sample.length}/${total} sampled files present with valid checksums`,
      )
    : fail(problems.slice(0, 5).join("; "));
};

/** Invariant 3: share links issued before cutover must still open. */
const checkShareToken: Check = async (db) => {
  const token = process.env.VERIFY_SHARE_TOKEN;
  if (!token) {
    return skip(
      "set VERIFY_SHARE_TOKEN to a share token issued before cutover to prove JWT_SECRET carried over",
    );
  }
  const verified = verifyShareToken(token, requiredEnv("JWT_SECRET"));
  if (!verified) {
    return fail("pre-cutover share token failed HMAC verification");
  }

  const [file] = await db
    .select({ filename: files.filename })
    .from(files)
    .where(eq(files.id, verified.fileId));
  return file
    ? pass(`share token verifies and resolves to ${file.filename}`)
    : fail(`share token verifies but file ${verified.fileId} is missing`);
};

/**
 * 006/012: the rollup task must be live, and real tiering must stay OFF until
 * the operator enables it after the 48h soak.
 */
const checkSeededTasks: Check = async (db) => {
  const rows = await db
    .select({
      enabled: scheduledTasks.enabled,
      type: scheduledTasks.type,
    })
    .from(scheduledTasks);

  const rollup = rows.filter((row) => row.type === "metrics_rollup");
  const tiering = rows.filter((row) => row.type === "tiering_pass");

  if (rollup.length === 0) return fail("no metrics_rollup task seeded");
  if (!rollup.some((row) => row.enabled)) {
    return fail("metrics_rollup exists but is disabled");
  }
  if (tiering.some((row) => row.enabled)) {
    return fail(
      "tiering_pass is ENABLED — it must stay disabled through cutover and soak",
    );
  }
  return pass(
    `metrics_rollup enabled; tiering_pass ${tiering.length === 0 ? "not seeded" : "disabled"}`,
  );
};

/** Sanity: projects and their scoped keys survived. */
const checkProjectSurface: Check = async (db) => {
  const [projectCount, keyCount, credentialCount] = await Promise.all([
    countRows(db, projects),
    countRows(db, apiKeys),
    countRows(db, s3Credentials),
  ]);
  return projectCount === 0
    ? fail("no projects present — dependent projects would break")
    : pass(
        `${projectCount} project(s), ${keyCount} API key(s), ${credentialCount} S3 credential(s)`,
      );
};

/** --live only: the production API answers and reports a version. */
async function checkLiveHealth(): Promise<Omit<CheckResult, "name">> {
  const url =
    process.env.VERIFY_HEALTH_URL ?? "https://api.denizlg24.com/healthz";
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return fail(`${url} returned ${response.status}`);
    const body = (await response.json()) as {
      status?: string;
      version?: string;
    };
    return body.status
      ? pass(`${url} → status=${body.status} version=${body.version ?? "?"}`)
      : fail(`${url} returned an unexpected body`);
  } catch (error) {
    return fail(
      `${url} unreachable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

const CHECKS: [string, Check][] = [
  ["users-migrated", checkUsersMigrated],
  ["passwords-carried", checkPasswordsCarried],
  ["totp-unenrolled", checkTotpUnenrolled],
  ["sample-password-verifies", checkSamplePasswordVerifies],
  ["legacy-s3-credential", checkLegacyS3Credential],
  ["project-surface", checkProjectSurface],
  ["resume-tokens", checkResumeTokens],
  ["meili-keys", checkMeiliKeys],
  ["files-on-disk", checkFilesOnDisk],
  ["share-token", checkShareToken],
  ["seeded-tasks", checkSeededTasks],
];

await runScript("migrate-verify", async (flags, log) => {
  const db = createDb(requiredEnv("DATABASE_URL"), { max: 1 });
  const results: CheckResult[] = [];

  try {
    for (const [name, check] of CHECKS) {
      let result: Omit<CheckResult, "name">;
      try {
        result = await check(db);
      } catch (error) {
        result = fail(error instanceof Error ? error.message : String(error));
      }
      results.push({ ...result, name });
      await log.event("check", { name, ...result });
    }

    if (flags.live) {
      const result = await checkLiveHealth();
      results.push({ ...result, name: "live-health" });
      await log.event("check", { name: "live-health", ...result });
    }
  } finally {
    await db.$client.end({ timeout: 5 });
  }

  for (const result of results) {
    const marker =
      result.status === "pass"
        ? "PASS"
        : result.status === "skip"
          ? "SKIP"
          : "FAIL";
    process.stderr.write(`${marker}  ${result.name}: ${result.detail}\n`);
  }

  const failed = results.filter((result) => result.status === "fail");
  const skipped = results.filter((result) => result.status === "skip");

  if (failed.length > 0) {
    throw new Error(
      `${failed.length} check(s) FAILED: ${failed.map((result) => result.name).join(", ")} — ABORT the cutover`,
    );
  }

  return {
    checks: results.length,
    green: true,
    passed: results.length - skipped.length,
    skipped: skipped.map((result) => result.name),
  };
});
