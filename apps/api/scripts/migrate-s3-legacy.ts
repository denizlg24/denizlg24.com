import {
  createDb,
  type Database,
  decryptS3Secret,
  encryptS3Secret,
  ensureLegacyS3Credential,
  hashS3Secret,
  requiredEnv,
  s3Credentials,
  storageConfigFromEnv,
} from "@repo/cloud-core";
import { eq } from "drizzle-orm";

import {
  MARKERS,
  readMarker,
  requirePredecessors,
  runScript,
  ScriptError,
  writeMarker,
} from "./lib/runner";

/**
 * Preflight for the NULL-project legacy S3 credential.
 *
 * The credential itself is created idempotently by `ensureLegacyS3Credential`
 * during the new API's first boot (apps/api/src/runtime.ts). This script does
 * not reimplement that; it runs the same assertions BEFORE the boot so a
 * collision or key mismatch surfaces while the old stack is still up and
 * rollback is free, rather than as a crash loop during the cutover window.
 *
 * It also checks one thing startup cannot: that the stored ciphertext actually
 * decrypts under the currently configured S3_CREDENTIAL_ENCRYPTION_KEY. The
 * startup path only compares the SHA-256 hash, so a row encrypted under a
 * previous key passes there and then fails on every signed S3 request.
 */

type Outcome = "already-correct" | "created" | "would-create" | "would-reuse";

interface LegacyEnv {
  accessKeyId: string;
  credentialEncryptionKey: string;
  secretAccessKey: string;
}

function readLegacyEnv(): LegacyEnv {
  const accessKeyId = process.env.S3_ACCESS_KEY_ID || undefined;
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY || undefined;
  if ((accessKeyId === undefined) !== (secretAccessKey === undefined)) {
    throw new ScriptError(
      "S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY must be configured together",
    );
  }
  if (!accessKeyId || !secretAccessKey) {
    throw new ScriptError(
      "S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY must be set; the legacy keypair is what dependent projects sign with today",
    );
  }
  return {
    accessKeyId,
    credentialEncryptionKey: storageConfigFromEnv().s3.credentialEncryptionKey,
    secretAccessKey,
  };
}

/** Proves the configured key can round-trip before anything is persisted. */
function assertEncryptionKeyUsable(env: LegacyEnv): void {
  const probe = "s3-preflight-probe";
  const { encrypted, iv, authTag } = encryptS3Secret(
    probe,
    env.credentialEncryptionKey,
  );
  if (
    decryptS3Secret(encrypted, iv, authTag, env.credentialEncryptionKey) !==
    probe
  ) {
    throw new ScriptError(
      "S3_CREDENTIAL_ENCRYPTION_KEY failed an encrypt/decrypt round-trip",
    );
  }
}

async function inspectExisting(db: Database, env: LegacyEnv): Promise<Outcome> {
  const existing = await db.query.s3Credentials.findFirst({
    where: eq(s3Credentials.accessKeyId, env.accessKeyId),
  });
  if (!existing) return "would-create";

  if (existing.projectId !== null) {
    throw new ScriptError(
      `Legacy access key ${env.accessKeyId} is already assigned to project ${existing.projectId}. The new API will refuse to start.`,
    );
  }
  if (existing.secretAccessKeyHash !== hashS3Secret(env.secretAccessKey)) {
    throw new ScriptError(
      `Legacy access key ${env.accessKeyId} exists with a different secret. Reconcile S3_SECRET_ACCESS_KEY before cutover.`,
    );
  }
  if (existing.revokedAt !== null) {
    throw new ScriptError(
      `Legacy access key ${env.accessKeyId} is revoked (${existing.revokedAt.toISOString()}). Dependent projects would start failing SigV4.`,
    );
  }

  let decrypted: string;
  try {
    decrypted = decryptS3Secret(
      existing.encryptedSecretAccessKey,
      existing.secretIv,
      existing.secretAuthTag,
      env.credentialEncryptionKey,
    );
  } catch {
    throw new ScriptError(
      `Legacy credential ciphertext does not decrypt under the configured S3_CREDENTIAL_ENCRYPTION_KEY. Startup would not catch this; every signed S3 request would fail.`,
    );
  }
  if (decrypted !== env.secretAccessKey) {
    throw new ScriptError(
      "Legacy credential decrypts to a different secret than S3_SECRET_ACCESS_KEY",
    );
  }

  return "would-reuse";
}

await runScript("migrate-s3-legacy", async (flags, log) => {
  const env = readLegacyEnv();
  assertEncryptionKeyUsable(env);
  await log.event("env-validated", { accessKeyId: env.accessKeyId });

  const db = createDb(requiredEnv("DATABASE_URL"), { max: 1 });
  try {
    if ((await readMarker(db, MARKERS.s3Legacy)) !== null) {
      const outcome = await inspectExisting(db, env);
      return { alreadyComplete: true, outcome };
    }

    const projected = await inspectExisting(db, env);
    await log.event("inspected", { projected });

    if (flags.dryRun) {
      return { alreadyComplete: false, outcome: projected };
    }

    await requirePredecessors(db, MARKERS.s3Legacy);

    const result = await ensureLegacyS3Credential(db, {
      accessKeyId: env.accessKeyId,
      keyEncryptionSecret: env.credentialEncryptionKey,
      secretAccessKey: env.secretAccessKey,
    });

    // Re-inspect after writing so a bad encryption key cannot be committed
    // silently; inspectExisting throws if the row does not decrypt cleanly.
    await inspectExisting(db, env);
    await writeMarker(db, MARKERS.s3Legacy, result);
    await log.event("committed", { result });

    const outcome: Outcome =
      result === "created" ? "created" : "already-correct";
    return { alreadyComplete: false, outcome };
  } finally {
    await db.$client.end({ timeout: 5 });
  }
});
