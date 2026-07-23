import { randomBytes } from "node:crypto";
import { rename, rm, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  authAccount,
  authTwoFactor,
  authUser,
  authVerification,
  createDb,
  type Database,
  recoveryCodes,
  requiredEnv,
  type TotpSecret,
  totpSecrets,
  type User,
  users,
} from "@repo/cloud-core";
import { symmetricEncrypt } from "better-auth/crypto";
import { and, eq, sql } from "drizzle-orm";

const MIGRATION_MARKER_ID = "cloud-migration:003-users";
const MIGRATION_MARKER_IDENTIFIER = "cloud-migration:003";
const SIGNUP_TOKEN_PREFIX = "cloud-signup:";
const SIGNUP_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const REPORT_FORMAT_VERSION = 1;

export interface LegacyUserRecord {
  user: User;
  totp: TotpSecret | null;
  oldRecoveryCodeCount: number;
}

export interface PlannedUserMigration {
  user: User;
  authEmail: string;
  authRole: "admin" | "user";
  legacyTotpEnrollmentInvalidated: boolean;
  oldRecoveryCodeCount: number;
  signupToken: string | null;
}

export interface UserMigrationPlan {
  users: PlannedUserMigration[];
}

export interface UserMigrationSummary {
  alreadyComplete: boolean;
  activeUsers: number;
  credentialsCarried: number;
  legacyRecoveryCodeSetsInvalidated: number;
  legacyTotpEnrollmentsInvalidated: number;
  pendingUsers: number;
  totalUsers: number;
  usersRequiringTotpEnrollment: number;
}

interface MigrationReportUser {
  userId: string;
  username: string;
  legacyTotpEnrollmentInvalidated: boolean;
  oldRecoveryCodeCount: number;
  oldRecoveryCodesInvalidated: boolean;
  requiresTotpEnrollment: boolean;
  signupCompletionToken: string | null;
}

interface MigrationReport {
  generatedAt: string;
  plan: "003";
  users: MigrationReportUser[];
}

interface EncryptedMigrationReport {
  ciphertext: string;
  cipher: "xchacha20-poly1305";
  formatVersion: number;
}

export interface RunUserMigrationOptions {
  db: Database;
  dryRun: boolean;
  reportEncryptionKey?: string;
  reportPath?: string;
}

function placeholderEmail(user: User): string {
  return user.email ?? `${user.id}@missing-email.invalid`;
}

function signupTokenIdentifier(username: string): string {
  return `${SIGNUP_TOKEN_PREFIX}${username.trim().toLowerCase()}`;
}

async function loadLegacyUsers(db: Database): Promise<LegacyUserRecord[]> {
  const [legacyUsers, legacyTotpSecrets, recoveryCounts] = await Promise.all([
    db.select().from(users).orderBy(users.createdAt),
    db.select().from(totpSecrets),
    db
      .select({
        count: sql<number>`count(*)::int`,
        userId: recoveryCodes.userId,
      })
      .from(recoveryCodes)
      .groupBy(recoveryCodes.userId),
  ]);
  const totpByUser = new Map(
    legacyTotpSecrets.map((record) => [record.userId, record]),
  );
  const recoveryCountByUser = new Map(
    recoveryCounts.map((record) => [record.userId, record.count]),
  );

  return legacyUsers.map((user) => ({
    oldRecoveryCodeCount: recoveryCountByUser.get(user.id) ?? 0,
    totp: totpByUser.get(user.id) ?? null,
    user,
  }));
}

export async function planUserMigration(
  records: LegacyUserRecord[],
): Promise<UserMigrationPlan> {
  const plannedUsers: PlannedUserMigration[] = [];

  for (const record of records) {
    plannedUsers.push({
      authEmail: placeholderEmail(record.user),
      authRole: record.user.role === "superuser" ? "admin" : "user",
      legacyTotpEnrollmentInvalidated:
        record.user.totpEnabled || record.totp !== null,
      oldRecoveryCodeCount: record.oldRecoveryCodeCount,
      signupToken:
        record.user.status === "pending"
          ? randomBytes(32).toString("base64url")
          : null,
      user: record.user,
    });
  }

  return { users: plannedUsers };
}

export function summarizeUserMigration(
  plan: UserMigrationPlan,
  alreadyComplete = false,
): UserMigrationSummary {
  return {
    activeUsers: plan.users.filter(({ user }) => user.status === "active")
      .length,
    alreadyComplete,
    credentialsCarried: plan.users.filter(({ user }) => user.passwordHash)
      .length,
    legacyRecoveryCodeSetsInvalidated: plan.users.filter(
      ({ oldRecoveryCodeCount }) => oldRecoveryCodeCount > 0,
    ).length,
    legacyTotpEnrollmentsInvalidated: plan.users.filter(
      ({ legacyTotpEnrollmentInvalidated }) => legacyTotpEnrollmentInvalidated,
    ).length,
    pendingUsers: plan.users.filter(({ user }) => user.status === "pending")
      .length,
    totalUsers: plan.users.length,
    usersRequiringTotpEnrollment: plan.users.length,
  };
}

function migrationReport(plan: UserMigrationPlan): MigrationReport {
  return {
    generatedAt: new Date().toISOString(),
    plan: "003",
    users: plan.users.map(
      ({
        legacyTotpEnrollmentInvalidated,
        oldRecoveryCodeCount,
        signupToken,
        user,
      }) => ({
        legacyTotpEnrollmentInvalidated,
        oldRecoveryCodeCount,
        oldRecoveryCodesInvalidated: oldRecoveryCodeCount > 0,
        requiresTotpEnrollment: true,
        signupCompletionToken: signupToken,
        userId: user.id,
        username: user.username,
      }),
    ),
  };
}

async function pathExists(path: string): Promise<boolean> {
  return stat(path)
    .then(() => true)
    .catch(() => false);
}

async function stageEncryptedReport(
  plan: UserMigrationPlan,
  reportPath: string,
  reportEncryptionKey: string,
): Promise<string> {
  if (reportEncryptionKey.length < 32) {
    throw new Error("AUTH_MIGRATION_REPORT_KEY must be at least 32 characters");
  }
  if (await pathExists(reportPath)) {
    throw new Error(`Refusing to overwrite migration report: ${reportPath}`);
  }

  const ciphertext = await symmetricEncrypt({
    data: JSON.stringify(migrationReport(plan)),
    key: reportEncryptionKey,
  });
  const wrapper: EncryptedMigrationReport = {
    cipher: "xchacha20-poly1305",
    ciphertext,
    formatVersion: REPORT_FORMAT_VERSION,
  };
  const temporaryPath = `${reportPath}.tmp-${process.pid}`;
  await writeFile(temporaryPath, `${JSON.stringify(wrapper)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  return temporaryPath;
}

async function applyUserMigration(
  db: Database,
  plan: UserMigrationPlan,
): Promise<void> {
  const now = new Date();
  await db.transaction(async (tx) => {
    for (const planned of plan.users) {
      const { user } = planned;
      await tx
        .insert(authUser)
        .values({
          id: user.id,
          name: user.username,
          email: planned.authEmail,
          emailVerified: false,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt,
          role: planned.authRole,
          banned: false,
          twoFactorEnabled: false,
          username: user.username.toLowerCase(),
          displayUsername: user.username,
          status: user.status,
        })
        .onConflictDoUpdate({
          target: authUser.id,
          set: {
            displayUsername: user.username,
            email: planned.authEmail,
            name: user.username,
            role: planned.authRole,
            status: user.status,
            twoFactorEnabled: false,
            updatedAt: user.updatedAt,
            username: user.username.toLowerCase(),
          },
        });

      if (user.passwordHash) {
        await tx
          .insert(authAccount)
          .values({
            id: `credential:${user.id}`,
            accountId: user.id,
            providerId: "credential",
            userId: user.id,
            password: user.passwordHash,
            createdAt: user.createdAt,
            updatedAt: user.updatedAt,
          })
          .onConflictDoUpdate({
            target: authAccount.id,
            set: {
              password: user.passwordHash,
              updatedAt: user.updatedAt,
            },
          });
      }

      await tx.delete(authTwoFactor).where(eq(authTwoFactor.userId, user.id));

      if (planned.signupToken) {
        await tx
          .insert(authVerification)
          .values({
            id: `signup:${user.id}`,
            identifier: signupTokenIdentifier(user.username),
            value: new Bun.CryptoHasher("sha256")
              .update(planned.signupToken)
              .digest("hex"),
            expiresAt: new Date(now.getTime() + SIGNUP_TOKEN_TTL_MS),
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: authVerification.id,
            set: {
              value: new Bun.CryptoHasher("sha256")
                .update(planned.signupToken)
                .digest("hex"),
              expiresAt: new Date(now.getTime() + SIGNUP_TOKEN_TTL_MS),
              updatedAt: now,
            },
          });
      }
    }

    await tx.insert(authVerification).values({
      id: MIGRATION_MARKER_ID,
      identifier: MIGRATION_MARKER_IDENTIFIER,
      value: "complete",
      expiresAt: new Date("9999-12-31T23:59:59.999Z"),
      createdAt: now,
      updatedAt: now,
    });
  });
}

export async function runUserMigration(
  options: RunUserMigrationOptions,
): Promise<UserMigrationSummary> {
  const marker = await options.db.query.authVerification.findFirst({
    columns: { id: true },
    where: and(
      eq(authVerification.id, MIGRATION_MARKER_ID),
      eq(authVerification.identifier, MIGRATION_MARKER_IDENTIFIER),
    ),
  });
  if (marker) {
    if (
      !options.dryRun &&
      options.reportPath &&
      !(await pathExists(options.reportPath))
    ) {
      throw new Error(
        "Migration is marked complete but its encrypted report is missing",
      );
    }
    return summarizeUserMigration({ users: [] }, true);
  }

  const plan = await planUserMigration(await loadLegacyUsers(options.db));
  const summary = summarizeUserMigration(plan);
  if (options.dryRun) {
    return summary;
  }
  if (!options.reportEncryptionKey || !options.reportPath) {
    throw new Error(
      "Non-dry-run migration requires reportEncryptionKey and reportPath",
    );
  }

  const reportPath = resolve(options.reportPath);
  const stagedReport = await stageEncryptedReport(
    plan,
    reportPath,
    options.reportEncryptionKey,
  );
  try {
    await applyUserMigration(options.db, plan);
  } catch (error) {
    await rm(stagedReport, { force: true });
    throw error;
  }
  try {
    await rename(stagedReport, reportPath);
  } catch {
    throw new Error(
      `Migration committed; recover the encrypted report from ${stagedReport}`,
    );
  }

  return summary;
}

function reportPathArgument(args: string[]): string | undefined {
  const index = args.indexOf("--report");
  return index === -1 ? undefined : args[index + 1];
}

async function main(): Promise<void> {
  const execute = process.argv.includes("--execute");
  if (execute && process.argv.includes("--dry-run")) {
    throw new Error("Choose either --dry-run or --execute");
  }
  const dryRun = !execute;
  const db = createDb(requiredEnv("DATABASE_URL"), { max: 1 });

  try {
    const summary = await runUserMigration({
      db,
      dryRun,
      reportEncryptionKey: process.env.AUTH_MIGRATION_REPORT_KEY,
      reportPath: reportPathArgument(process.argv),
    });
    console.info(
      JSON.stringify({
        dryRun,
        migration: "003-users",
        summary,
      }),
    );
  } finally {
    await db.$client.end({ timeout: 5 });
  }
}

if (import.meta.main) {
  await main();
}
