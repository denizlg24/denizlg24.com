import "server-only";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { type Identity, store } from "../db";

export const tokenScopes = ["read", "write"] as const;
export type TokenScope = (typeof tokenScopes)[number];

export const tokenInputSchema = z.object({
  name: z.string().trim().min(1).max(60),
  scope: z.enum(tokenScopes),
});

export type AccessToken = {
  id: string;
  name: string;
  scope: TokenScope;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
};

export const maxTokensPerUser = 10;
const tokenPrefix = "swk_";

const hash = (token: string) =>
  createHash("sha256").update(token).digest("hex");

async function pg() {
  const s = await store();
  if (s.kind !== "pg")
    throw new Error("Access tokens need the production database.");
  return s.sql;
}

type TokenRow = {
  id: string;
  name: string;
  scope: TokenScope;
  prefix: string;
  created_at: Date;
  last_used_at: Date | null;
};

const toToken = (row: TokenRow): AccessToken => ({
  id: row.id,
  name: row.name,
  scope: row.scope,
  prefix: row.prefix,
  createdAt: row.created_at.toISOString(),
  lastUsedAt: row.last_used_at?.toISOString() ?? null,
});

export async function listTokens(userId: string): Promise<AccessToken[]> {
  const sql = await pg();
  const rows = await sql<TokenRow[]>`
    SELECT id, name, scope, prefix, created_at, last_used_at
    FROM stockwatcher_access_tokens
    WHERE user_id = ${userId} AND revoked_at IS NULL
    ORDER BY created_at DESC`;
  return rows.map(toToken);
}

/** Returns the secret once; only its hash is stored. */
export async function createToken(
  userId: string,
  input: z.infer<typeof tokenInputSchema>,
): Promise<{ token: AccessToken; secret: string }> {
  const sql = await pg();
  const secret = `${tokenPrefix}${randomBytes(32).toString("base64url")}`;
  const id = randomUUID();
  const prefix = secret.slice(0, tokenPrefix.length + 6);
  const [row] = await sql<TokenRow[]>`
    INSERT INTO stockwatcher_access_tokens
      (id, user_id, name, scope, prefix, token_hash, created_at)
    SELECT ${id}, ${userId}, ${input.name}, ${input.scope}, ${prefix},
      ${hash(secret)}, now()
    WHERE (
      SELECT COUNT(*) FROM stockwatcher_access_tokens
      WHERE user_id = ${userId} AND revoked_at IS NULL
    ) < ${maxTokensPerUser}
    RETURNING id, name, scope, prefix, created_at, last_used_at`;
  if (!row)
    throw new Error(
      `You already have ${maxTokensPerUser} tokens. Revoke one first.`,
    );
  return { token: toToken(row), secret };
}

export async function revokeToken(userId: string, id: string) {
  const sql = await pg();
  const result = await sql`
    UPDATE stockwatcher_access_tokens SET revoked_at = now()
    WHERE id = ${id} AND user_id = ${userId} AND revoked_at IS NULL`;
  return result.count === 1;
}

export type TokenIdentity = {
  user: Identity;
  tokenId: string;
  scope: TokenScope;
};

/** The account behind a bearer token, or null for an unknown or revoked one. */
export async function verifyToken(
  authorization: string | null,
): Promise<TokenIdentity | null> {
  const secret = authorization?.match(
    /^Bearer\s+(swk_[A-Za-z0-9_-]{43})$/,
  )?.[1];
  if (!secret) return null;
  const sql = await pg();
  const [row] = await sql<
    {
      id: string;
      user_id: string;
      scope: TokenScope;
      last_used_at: Date | null;
      name: string | null;
      email: string | null;
    }[]
  >`
    SELECT t.id, t.user_id, t.scope, t.last_used_at, u.name, u.email
    FROM stockwatcher_access_tokens t
    LEFT JOIN stockwatcher_users u ON u.id = t.user_id
    WHERE t.token_hash = ${hash(secret)} AND t.revoked_at IS NULL`;
  if (row && Date.now() - (row.last_used_at?.getTime() ?? 0) > 60_000)
    void sql`
      UPDATE stockwatcher_access_tokens SET last_used_at = now()
      WHERE id = ${row.id}`.catch(() => undefined);
  if (!row) return null;
  return {
    tokenId: row.id,
    scope: row.scope,
    user: {
      id: row.user_id,
      name: row.name ?? "Stockwatcher user",
      email: row.email,
      demo: false,
    },
  };
}
