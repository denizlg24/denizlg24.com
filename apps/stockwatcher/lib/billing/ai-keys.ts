import "server-only";
import { createHash } from "node:crypto";
import { createGateway } from "ai";
import { z } from "zod";
import { store } from "../db";
import { sealer } from "../seal";
import { creditConfig, MC_PER_CREDIT } from "./credits";

/**
 * A per-user AI Gateway key whose budget is a backstop under the credit
 * ledger: if a billing bug ever let someone spend past what they bought, the
 * gateway refuses with 402 quota_for_entity_exceeded instead of the app
 * paying for it. The ledger stays the meter.
 */

const vercelApi = "https://api.vercel.com";
const keys = sealer("ai-gateway-key");

/** Covers one request settling after the ledger already reached zero. */
const slackUsd = 0.5;

export const userKeysEnabled = () =>
  Boolean(
    process.env.VERCEL_API_TOKEN?.trim() &&
      process.env.AI_GATEWAY_TEAM_ID?.trim() &&
      process.env.DATABASE_URL,
  );

type Gateway = ReturnType<typeof createGateway>;

async function pg() {
  const s = await store();
  if (s.kind !== "pg") throw new Error("Per-user AI keys need DATABASE_URL.");
  return s.sql;
}

async function vercel(path: string, init: { method: string; body: unknown }) {
  const team = process.env.AI_GATEWAY_TEAM_ID?.trim() ?? "";
  const response = await fetch(
    `${vercelApi}${path}?teamId=${encodeURIComponent(team)}`,
    {
      method: init.method,
      headers: {
        Authorization: `Bearer ${process.env.VERCEL_API_TOKEN?.trim()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(init.body),
    },
  );
  const text = await response.text();
  if (!response.ok)
    throw new Error(
      `Vercel ${init.method} ${path} answered ${response.status}: ${text.slice(0, 300)}`,
    );
  return JSON.parse(text);
}

const createdKey = z.object({
  apiKeyString: z.string().min(1),
  apiKey: z.object({ id: z.string().min(1) }),
});

/** Every credit ever granted (free resets, purchases, refunds, adjustments) at cost. */
async function budgetUsd(userId: string) {
  const sql = await pg();
  const [row] = await sql<{ granted: string | null }[]>`
    SELECT COALESCE(SUM(amount_mc), 0) AS granted
    FROM stockwatcher_credit_ledger
    WHERE user_id = ${userId}
      AND kind IN ('free_reset', 'purchase', 'refund', 'adjust')`;
  const credits = Math.max(0, Number(row?.granted ?? 0)) / MC_PER_CREDIT;
  const usd = credits / 100 / Math.max(creditConfig().markup, 1);
  return Math.ceil((usd + slackUsd) * 100) / 100;
}

/** Keys are named by a hash so the Vercel dashboard never shows who they belong to. */
const keyName = (userId: string) =>
  `stockwatcher-${createHash("sha256").update(userId).digest("hex").slice(0, 16)}`;

/**
 * Creates the user's key on their first purchase and re-fits its budget on
 * every later purchase or refund.
 */
export async function syncUserKey(userId: string): Promise<void> {
  if (!userKeysEnabled()) return;
  const sql = await pg();
  const limitAmount = await budgetUsd(userId);
  const [existing] = await sql<{ key_id: string; limit_usd: string }[]>`
    SELECT key_id, limit_usd FROM stockwatcher_ai_keys WHERE user_id = ${userId}`;
  if (existing) {
    if (Number(existing.limit_usd) === limitAmount) return;
    await vercel(`/v1/api-keys/${encodeURIComponent(existing.key_id)}/quota`, {
      method: "PATCH",
      body: { limitAmount, refreshPeriod: "none" },
    });
    await sql`
      UPDATE stockwatcher_ai_keys SET limit_usd = ${limitAmount}, updated_at = now()
      WHERE user_id = ${userId}`;
    return;
  }
  const created = createdKey.parse(
    await vercel("/v1/api-keys", {
      method: "POST",
      body: {
        purpose: "ai-gateway",
        name: keyName(userId),
        metadata: { spendAttribution: "team" },
        aiGatewayQuota: { limitAmount, refreshPeriod: "none" },
      },
    }),
  );
  await sql`
    INSERT INTO stockwatcher_ai_keys
      (user_id, key_id, sealed_key, limit_usd, created_at, updated_at)
    VALUES (${userId}, ${created.apiKey.id}, ${keys.seal(created.apiKeyString)},
      ${limitAmount}, now(), now())
    ON CONFLICT (user_id) DO NOTHING`;
}

const providers = new Map<string, Gateway>();

/** The user's own gateway when they have a key, otherwise null (the app key). */
export async function userGateway(userId: string): Promise<Gateway | null> {
  if (!userKeysEnabled()) return null;
  const cached = providers.get(userId);
  if (cached) return cached;
  const sql = await pg();
  const [row] = await sql<{ sealed_key: string }[]>`
    SELECT sealed_key FROM stockwatcher_ai_keys WHERE user_id = ${userId}`;
  if (!row) return null;
  const provider = createGateway({
    apiKey: keys.open(row.sealed_key),
    teamIdOrSlug: process.env.AI_GATEWAY_TEAM_ID?.trim() || undefined,
  });
  providers.set(userId, provider);
  return provider;
}
