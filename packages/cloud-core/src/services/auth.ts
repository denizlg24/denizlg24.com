import { createHash, randomBytes } from "node:crypto";

import { type ApiKeyScope, apiKeyScopeSchema } from "@repo/schemas/cloud";
import { and, eq, sql } from "drizzle-orm";

import type { Database } from "../db";
import {
  apiKeys,
  authUser,
  recoveryCodes,
  totpSecrets,
  type User,
  type UserRole,
  users,
} from "../db/schema";
import {
  AuthenticationError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from "../errors";
import { isPostgresErrorCode } from "./database-errors";
import { pagination } from "./pagination";
import type {
  SafeApiKeyRecord,
  SafeProjectRecord,
  SafeUserRecord,
} from "./types";

export function toSafeUser(user: User): SafeUserRecord {
  const { passwordHash: _passwordHash, ...safeUser } = user;
  return safeUser;
}

export async function createPendingUser(
  db: Database,
  input: { username: string; role?: UserRole },
): Promise<SafeUserRecord> {
  try {
    const [user] = await db
      .insert(users)
      .values({
        username: input.username,
        role: input.role ?? "user",
        status: "pending",
      })
      .returning();

    if (!user) {
      throw new Error("Failed to create user");
    }
    return toSafeUser(user);
  } catch (error) {
    if (isPostgresErrorCode(error, "23505")) {
      throw new ConflictError("Username already exists", "USERNAME_EXISTS");
    }
    throw error;
  }
}

export async function listUsers(
  db: Database,
  options: { page?: number; limit?: number } = {},
): Promise<{ users: SafeUserRecord[]; total: number }> {
  const { limit, offset } = pagination(options, { limit: 50 });
  const [allUsers, countResult] = await Promise.all([
    db
      .select()
      .from(users)
      .orderBy(users.createdAt)
      .limit(limit)
      .offset(offset),
    db.select({ count: sql<number>`count(*)::int` }).from(users),
  ]);

  return {
    users: allUsers.map(toSafeUser),
    total: countResult[0]?.count ?? 0,
  };
}

export async function deleteUser(db: Database, userId: string): Promise<void> {
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
  });

  if (!user) {
    throw new NotFoundError("User not found", "USER_NOT_FOUND");
  }
  if (user.role === "superuser") {
    throw new ForbiddenError("Cannot delete superuser accounts");
  }

  await db.transaction(async (tx) => {
    await tx.delete(authUser).where(eq(authUser.id, userId));
    await tx.delete(users).where(eq(users.id, userId));
  });
}

export async function resetUserMfa(
  db: Database,
  userId: string,
): Promise<void> {
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
  });

  if (!user) {
    throw new NotFoundError("User not found", "USER_NOT_FOUND");
  }

  await db.transaction(async (tx) => {
    await tx.delete(totpSecrets).where(eq(totpSecrets.userId, userId));
    await tx.delete(recoveryCodes).where(eq(recoveryCodes.userId, userId));
    await tx
      .update(users)
      .set({
        totpEnabled: false,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));
  });
}

export async function createApiKey(
  db: Database,
  input: {
    userId: string;
    projectId: string;
    name: string;
    scopes: ApiKeyScope[];
    expiresAt?: Date;
  },
): Promise<{ id: string; key: string; prefix: string }> {
  const key = randomBytes(32).toString("base64url");
  const prefix = key.slice(0, 8);
  const keyHash = createHash("sha256").update(key).digest("hex");

  const [record] = await db
    .insert(apiKeys)
    .values({
      userId: input.userId,
      projectId: input.projectId,
      name: input.name,
      keyHash,
      keyPrefix: prefix,
      scopes: input.scopes,
      expiresAt: input.expiresAt,
    })
    .returning({ id: apiKeys.id });

  if (!record) {
    throw new Error("Failed to create API key");
  }

  return {
    id: record.id,
    key,
    prefix,
  };
}

export async function validateApiKey(
  db: Database,
  key: string,
): Promise<{
  user: SafeUserRecord;
  project: SafeProjectRecord;
  scopes: ApiKeyScope[];
}> {
  const keyHash = createHash("sha256").update(key).digest("hex");
  const record = await db.query.apiKeys.findFirst({
    where: eq(apiKeys.keyHash, keyHash),
    with: {
      user: true,
      project: true,
    },
  });

  if (!record) {
    throw new AuthenticationError("Invalid API key", "INVALID_API_KEY");
  }
  if (record.expiresAt && record.expiresAt < new Date()) {
    throw new AuthenticationError("API key expired", "API_KEY_EXPIRED");
  }
  const parsedScopes = apiKeyScopeSchema.array().safeParse(record.scopes);
  if (!parsedScopes.success) {
    throw new AuthenticationError(
      "API key has invalid scopes",
      "INVALID_API_KEY_SCOPES",
    );
  }

  const [validatedKey] = await db
    .update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(and(eq(apiKeys.id, record.id), eq(apiKeys.keyHash, keyHash)))
    .returning({ id: apiKeys.id });
  if (!validatedKey) {
    throw new AuthenticationError("Invalid API key", "INVALID_API_KEY");
  }

  return {
    user: toSafeUser(record.user),
    project: record.project,
    scopes: parsedScopes.data,
  };
}

export async function listApiKeys(
  db: Database,
  projectId: string,
): Promise<SafeApiKeyRecord[]> {
  const keys = await db.query.apiKeys.findMany({
    where: eq(apiKeys.projectId, projectId),
    orderBy: apiKeys.createdAt,
  });

  return keys.map(({ keyHash: _keyHash, ...safeKey }) => safeKey);
}

export async function revokeApiKey(
  db: Database,
  keyId: string,
  projectId: string,
): Promise<void> {
  const [deleted] = await db
    .delete(apiKeys)
    .where(and(eq(apiKeys.id, keyId), eq(apiKeys.projectId, projectId)))
    .returning({ id: apiKeys.id });

  if (!deleted) {
    throw new NotFoundError("API key not found", "API_KEY_NOT_FOUND");
  }
}
