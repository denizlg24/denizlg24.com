import { createHash, randomBytes } from "node:crypto";

import {
  authAccount,
  authUser,
  authVerification,
  type Database,
  hashPassword,
  type SafeUserRecord,
  toSafeUser,
  users,
} from "@repo/cloud-core";
import type {
  CompleteSignupInput,
  CompleteSignupResult,
  CreatePendingUserInput,
  PendingUserCreated,
  SafeUser,
} from "@repo/schemas/cloud";
import { and, eq, gt } from "drizzle-orm";

import type { CloudAuth } from "./better-auth";

const SIGNUP_TOKEN_PREFIX = "cloud-signup:";
const SIGNUP_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export class SignupCompletionError extends Error {
  constructor() {
    super("Unable to complete signup");
    this.name = "SignupCompletionError";
  }
}

function normalizedUsername(username: string): string {
  return username.trim().toLowerCase();
}

function signupTokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function signupTokenIdentifier(username: string): string {
  return `${SIGNUP_TOKEN_PREFIX}${normalizedUsername(username)}`;
}

export function serializeSafeUser(user: SafeUserRecord): SafeUser {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role,
    status: user.status,
    totpEnabled: user.totpEnabled,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}

export async function createPendingAuthUser(
  db: Database,
  auth: CloudAuth,
  input: CreatePendingUserInput,
): Promise<PendingUserCreated> {
  const username = normalizedUsername(input.username);
  const placeholderPassword = randomBytes(32).toString("base64url");
  const signupToken = randomBytes(32).toString("base64url");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SIGNUP_TOKEN_TTL_MS);
  let authUserId: string | undefined;

  try {
    const created = await auth.api.createUser({
      body: {
        data: {
          displayUsername: username,
          username,
        },
        email: `${crypto.randomUUID()}@pending.invalid`,
        name: username,
        password: placeholderPassword,
        role: input.role === "superuser" ? "admin" : "user",
      },
    });
    authUserId = created.user.id;

    const legacyUser = await db.transaction(async (tx) => {
      const [createdLegacyUser] = await tx
        .insert(users)
        .values({
          id: created.user.id,
          role: input.role,
          status: "pending",
          username,
        })
        .returning();
      if (!createdLegacyUser) {
        throw new Error("Failed to create pending cloud user");
      }

      await tx
        .update(authUser)
        .set({
          displayUsername: username,
          status: "pending",
          username,
          updatedAt: now,
        })
        .where(eq(authUser.id, created.user.id));

      await tx
        .delete(authVerification)
        .where(
          eq(authVerification.identifier, signupTokenIdentifier(username)),
        );
      await tx.insert(authVerification).values({
        id: crypto.randomUUID(),
        identifier: signupTokenIdentifier(username),
        value: signupTokenHash(signupToken),
        expiresAt,
        createdAt: now,
        updatedAt: now,
      });

      return createdLegacyUser;
    });

    return {
      signupToken,
      user: serializeSafeUser(toSafeUser(legacyUser)),
    };
  } catch (error) {
    if (authUserId) {
      await db.delete(authUser).where(eq(authUser.id, authUserId));
    }
    throw error;
  }
}

export interface CompletedSignup {
  result: CompleteSignupResult;
  responseHeaders: Headers;
}

export async function completePendingSignup(
  db: Database,
  auth: CloudAuth,
  input: CompleteSignupInput,
): Promise<CompletedSignup> {
  const username = normalizedUsername(input.username);
  const email = input.email.trim().toLowerCase();
  const tokenHash = signupTokenHash(input.token);
  const now = new Date();
  const passwordHash = await hashPassword(input.password);

  const updatedUser = await db.transaction(async (tx) => {
    const verification = await tx.query.authVerification.findFirst({
      where: and(
        eq(authVerification.identifier, signupTokenIdentifier(username)),
        eq(authVerification.value, tokenHash),
        gt(authVerification.expiresAt, now),
      ),
    });
    const legacyUser = await tx.query.users.findFirst({
      where: and(eq(users.username, username), eq(users.status, "pending")),
    });
    if (!verification || !legacyUser) {
      throw new SignupCompletionError();
    }

    const matchingAuthUser = await tx.query.authUser.findFirst({
      where: and(
        eq(authUser.id, legacyUser.id),
        eq(authUser.status, "pending"),
      ),
    });
    if (!matchingAuthUser) {
      throw new SignupCompletionError();
    }

    const updatedCredentials = await tx
      .update(authAccount)
      .set({
        password: passwordHash,
        updatedAt: now,
      })
      .where(
        and(
          eq(authAccount.userId, legacyUser.id),
          eq(authAccount.providerId, "credential"),
        ),
      )
      .returning({ id: authAccount.id });
    if (updatedCredentials.length === 0) {
      await tx.insert(authAccount).values({
        id: `credential:${legacyUser.id}`,
        accountId: legacyUser.id,
        providerId: "credential",
        userId: legacyUser.id,
        password: passwordHash,
        createdAt: now,
        updatedAt: now,
      });
    }
    await tx
      .update(authUser)
      .set({
        email,
        name: username,
        updatedAt: now,
      })
      .where(eq(authUser.id, legacyUser.id));
    const [activatedCredentialsUser] = await tx
      .update(users)
      .set({
        email,
        passwordHash,
        updatedAt: now,
      })
      .where(eq(users.id, legacyUser.id))
      .returning();
    if (!activatedCredentialsUser) {
      throw new SignupCompletionError();
    }

    await tx
      .delete(authVerification)
      .where(
        and(
          eq(authVerification.id, verification.id),
          eq(authVerification.value, tokenHash),
        ),
      );

    return activatedCredentialsUser;
  });

  const signIn = await auth.api.signInUsername({
    body: {
      password: input.password,
      username,
    },
    returnHeaders: true,
  });

  return {
    responseHeaders: signIn.headers,
    result: {
      requiresTotpEnrollment: true,
      user: serializeSafeUser(toSafeUser(updatedUser)),
    },
  };
}
