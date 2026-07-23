import { afterAll, describe, expect, it } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  authAccount,
  authTwoFactor,
  authUser,
  authVerification,
  createDb,
  encryptLegacyTotpSecret,
  recoveryCodes,
  totpSecrets,
  users,
} from "@repo/cloud-core";
import { symmetricDecrypt } from "better-auth/crypto";
import { eq } from "drizzle-orm";

import { signupTokenIdentifier } from "../src/auth/users";
import {
  type LegacyUserRecord,
  planUserMigration,
  runUserMigration,
  summarizeUserMigration,
} from "./migrate-users";

const LEGACY_TOTP_KEY = "test-legacy-totp-key";
const REPORT_KEY = "test-report-encryption-key-at-least-32-characters";
const now = new Date("2026-07-23T12:00:00.000Z");

function legacyRecords(): LegacyUserRecord[] {
  const encrypted = encryptLegacyTotpSecret(
    "JBSWY3DPEHPK3PXP",
    LEGACY_TOTP_KEY,
  );
  return [
    {
      oldRecoveryCodeCount: 4,
      totp: {
        id: "0127abdc-180b-42f3-8853-cef821bfbb5f",
        userId: "9008081f-2656-4a5c-8c85-1c93b47ad6ce",
        encryptedSecret: encrypted.encrypted,
        iv: encrypted.iv,
        authTag: encrypted.authTag,
        verified: true,
        createdAt: now,
      },
      user: {
        id: "9008081f-2656-4a5c-8c85-1c93b47ad6ce",
        username: "owner",
        email: "owner@example.com",
        passwordHash: "$argon2id$legacy",
        role: "superuser",
        status: "active",
        totpEnabled: true,
        createdAt: now,
        updatedAt: now,
      },
    },
    {
      oldRecoveryCodeCount: 0,
      totp: null,
      user: {
        id: "3fe54bba-0c99-4f67-81ee-e5e12ac5df1f",
        username: "pending",
        email: null,
        passwordHash: null,
        role: "user",
        status: "pending",
        totpEnabled: false,
        createdAt: now,
        updatedAt: now,
      },
    },
  ];
}

describe("plan 003 user migration dry-run", () => {
  it("invalidates legacy TOTP and recovery codes and requires re-enrollment", async () => {
    const plan = await planUserMigration(legacyRecords());
    const summary = summarizeUserMigration(plan);
    const owner = plan.users[0];
    const pending = plan.users[1];

    expect(summary).toEqual({
      activeUsers: 1,
      alreadyComplete: false,
      credentialsCarried: 1,
      legacyRecoveryCodeSetsInvalidated: 1,
      legacyTotpEnrollmentsInvalidated: 1,
      pendingUsers: 1,
      totalUsers: 2,
      usersRequiringTotpEnrollment: 2,
    });
    expect(owner?.authRole).toBe("admin");
    expect(owner?.legacyTotpEnrollmentInvalidated).toBe(true);
    expect(pending?.signupToken).toBeString();
    expect(pending?.authEmail).toEndWith("@missing-email.invalid");
  });

  it("does not decode or require a legacy TOTP secret", async () => {
    const [record] = legacyRecords();
    if (!record) {
      throw new Error("Missing migration fixture");
    }

    const plan = await planUserMigration([{ ...record, totp: null }]);
    expect(plan.users[0]?.legacyTotpEnrollmentInvalidated).toBe(true);
  });
});

const integrationUrl = process.env.CLOUD_AUTH_TEST_DATABASE_URL;
const integrationTest = integrationUrl ? it : it.skip;
let integrationDb: ReturnType<typeof createDb> | undefined;

afterAll(async () => {
  if (integrationDb) {
    await integrationDb.$client.end({ timeout: 5 });
  }
});

integrationTest(
  "runs idempotently against seeded legacy tables and writes an encrypted report",
  async () => {
    if (!integrationUrl) {
      throw new Error("CLOUD_AUTH_TEST_DATABASE_URL is required");
    }
    const databaseName = new URL(integrationUrl).pathname.slice(1);
    if (!databaseName.endsWith("_auth_test")) {
      throw new Error("Integration database name must end in _auth_test");
    }

    const db = createDb(integrationUrl, { max: 1 });
    integrationDb = db;
    await db.delete(authVerification);
    await db.delete(authTwoFactor);
    await db.delete(authAccount);
    await db.delete(authUser);
    await db.delete(recoveryCodes);
    await db.delete(totpSecrets);
    await db.delete(users);

    const records = legacyRecords();
    await db.insert(users).values(records.map(({ user }) => user));
    const owner = records[0];
    if (!owner?.totp) {
      throw new Error("Missing owner TOTP fixture");
    }
    await db.insert(totpSecrets).values(owner.totp);
    await db.insert(recoveryCodes).values({
      userId: owner.user.id,
      codeHash: "legacy-code-hash",
    });

    const dryRun = await runUserMigration({
      db,
      dryRun: true,
    });
    expect(dryRun.totalUsers).toBe(2);
    expect(await db.select().from(authUser)).toHaveLength(0);

    const reportPath = join(
      tmpdir(),
      `deniz-cloud-auth-migration-${crypto.randomUUID()}.enc.json`,
    );
    const migrated = await runUserMigration({
      db,
      dryRun: false,
      reportEncryptionKey: REPORT_KEY,
      reportPath,
    });
    expect(migrated.totalUsers).toBe(2);
    expect(await db.select().from(authUser)).toHaveLength(2);
    expect(await db.select().from(authAccount)).toHaveLength(1);
    expect(await db.select().from(authTwoFactor)).toHaveLength(0);
    expect(
      (await db.select().from(authUser)).every(
        ({ twoFactorEnabled }) => twoFactorEnabled === false,
      ),
    ).toBe(true);
    expect(
      await db
        .select({ totpEnabled: users.totpEnabled })
        .from(users)
        .orderBy(users.createdAt),
    ).toEqual([{ totpEnabled: true }, { totpEnabled: false }]);

    const encryptedWrapper = await Bun.file(reportPath).json();
    if (
      typeof encryptedWrapper !== "object" ||
      encryptedWrapper === null ||
      !("ciphertext" in encryptedWrapper) ||
      typeof encryptedWrapper.ciphertext !== "string"
    ) {
      throw new Error("Encrypted report wrapper is invalid");
    }
    const report = await symmetricDecrypt({
      data: encryptedWrapper.ciphertext,
      key: REPORT_KEY,
    });
    expect(report).toContain('"oldRecoveryCodesInvalidated":true');
    expect(report).toContain('"legacyTotpEnrollmentInvalidated":true');
    expect(report).toContain('"requiresTotpEnrollment":true');
    expect(report).not.toContain("freshBackupCodes");
    expect(report).toContain('"signupCompletionToken":');

    const pendingRecord = records[1];
    if (!pendingRecord) {
      throw new Error("Missing pending user fixture");
    }
    const [signupVerification] = await db
      .select()
      .from(authVerification)
      .where(eq(authVerification.id, `signup:${pendingRecord.user.id}`));
    expect(signupVerification?.identifier).toBe(
      signupTokenIdentifier(pendingRecord.user.username),
    );

    const repeated = await runUserMigration({
      db,
      dryRun: false,
      reportEncryptionKey: REPORT_KEY,
      reportPath,
    });
    expect(repeated.alreadyComplete).toBe(true);

    await Bun.file(reportPath).delete();
  },
);
