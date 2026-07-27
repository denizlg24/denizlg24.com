import {
  envoyAuthTokenResponseSchema,
  envoyGithubDeviceCodeSchema,
  envoyGithubTokenInputSchema,
} from "@repo/schemas/envoy";
import type { Context } from "hono";
import {
  completeGithubDeviceFlow,
  startGithubDeviceFlow,
} from "./auth.service";

export async function githubDevice(c: Context) {
  const data = await startGithubDeviceFlow();
  return c.json(envoyGithubDeviceCodeSchema.parse(data));
}

export async function githubToken(c: Context) {
  const body = await c.req.json().catch(() => null);
  const parsed = envoyGithubTokenInputSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "A valid device_code is required" }, 400);
  }

  const result = await completeGithubDeviceFlow(parsed.data.device_code);
  return c.json(envoyAuthTokenResponseSchema.parse(result));
}
