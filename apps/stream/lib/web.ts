import "server-only";

import { createMachineTokenSource } from "@denizlg24/auth/server";
import type { z } from "zod";

import { authIssuer, webUrl } from "@/lib/config";

let tokens: ReturnType<typeof createMachineTokenSource> | null = null;

function webTokens() {
  const clientId = process.env.STREAM_WEB_OAUTH_CLIENT_ID;
  const clientSecret = process.env.STREAM_WEB_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  tokens ??= createMachineTokenSource({
    issuer: authIssuer(),
    clientId,
    clientSecret,
    resource: webUrl(),
    scope: "superuser",
  });
  return tokens;
}

/**
 * Model calls go through web's `llm-service`. Null on any failure, so every
 * caller has a fallback that keeps the screen filled.
 */
export async function postToWeb<T extends z.ZodType>(
  path: string,
  body: unknown,
  schema: T,
  timeoutMs: number,
): Promise<z.infer<T> | null> {
  const source = webTokens();
  if (!source) return null;
  try {
    const response = await fetch(`${webUrl()}${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${await source.getToken()}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (response.status === 401) source.invalidate();
    if (!response.ok) return null;
    return schema.parse(await response.json());
  } catch (error) {
    console.error(`[stream] ${path} failed`, error);
    return null;
  }
}
