import type { Context } from "hono";
import { completeGithubDeviceFlow, startGithubDeviceFlow } from "./auth.service";


export async function githubDevice(c:Context) {
  const data = await startGithubDeviceFlow();
  return c.json(data);
}

export async function githubToken(c:Context) {
  const { device_code } = await c.req.json();
  const result = await completeGithubDeviceFlow(device_code);
  return c.json(result);
}